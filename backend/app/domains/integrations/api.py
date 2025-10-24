"""
Integrations API endpoints

Handles webhooks and API calls for external service integrations:
- CompanyCam webhooks
- Slack notifications
- Google Sheets sync (future)
"""

from fastapi import APIRouter, Request, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timedelta
import logging
import json

from app.core.database_factory import get_database
from app.core.config import settings
from .schemas import (
    WebhookEventCreate,
    WebhookEventResponse,
    IntegrationHealthCheck,
    IntegrationStats
)
from .models import WebhookEvent, CompanyCamPhoto
from .companycam.client import CompanyCamClient
from .companycam.webhook_handler_wm import CompanyCamWaterMitigationHandler
from .companycam.schemas import (
    PhotoCreatedWebhook,
    CompanyCamPhotoResponse,
    CompanyCamStatsResponse,
    PhotoProcessingResult
)
from .slack.client import SlackClient

logger = logging.getLogger(__name__)

router = APIRouter()


# Dependency to get database session
def get_db():
    """Get database session"""
    database = get_database()
    db = database.get_session()
    try:
        yield db
    finally:
        db.close()


# ========== CompanyCam Webhooks ==========

@router.post(
    "/companycam/webhook",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    summary="CompanyCam Webhook Receiver"
)
async def companycam_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Receive and process CompanyCam webhook events

    This endpoint:
    1. Verifies webhook signature
    2. Logs webhook event
    3. Processes photo upload events
    4. Matches addresses with work orders
    5. Sends Slack notifications

    **Webhook Events:**
    - `photo.created` - New photo uploaded to CompanyCam project

    **CompanyCam Setup:**
    1. Go to CompanyCam Settings → API & Webhooks
    2. Create webhook: `https://your-domain.com/api/integrations/companycam/webhook`
    3. Subscribe to `photo.created` event
    4. Configure `COMPANYCAM_WEBHOOK_TOKEN` in environment
    """
    # Get raw request body for signature verification
    body = await request.body()

    # Verify signature
    signature = request.headers.get("X-CompanyCam-Signature", "")
    if not CompanyCamClient.verify_webhook_signature(body, signature):
        logger.warning("Invalid webhook signature from CompanyCam")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature"
        )

    # Parse webhook payload
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in webhook payload: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload"
        )

    # Log webhook event
    webhook_event = WebhookEvent(
        service_name="companycam",
        event_type=payload.get("type", "unknown"),
        event_id=str(payload.get("photo", {}).get("id")),
        payload=payload,
        headers=dict(request.headers),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        status="pending"
    )

    db.add(webhook_event)
    db.commit()
    db.refresh(webhook_event)

    logger.info(f"Received {webhook_event.event_type} webhook event from CompanyCam")

    # Process event in background
    event_type = payload.get("type")

    if event_type == "photo.created":
        # Process photo upload event asynchronously
        background_tasks.add_task(
            process_photo_created_event,
            webhook_event.id,
            payload,
            db
        )
    else:
        # Unknown event type - mark as ignored
        webhook_event.status = "ignored"
        webhook_event.processed_at = datetime.utcnow()
        webhook_event.error_message = f"Unsupported event type: {event_type}"
        db.commit()

    return {"status": "ok", "event_id": str(webhook_event.id)}


async def process_photo_created_event(
    webhook_event_id: str,
    payload: dict,
    db: Session
):
    """
    Process photo.created webhook event for Water Mitigation (background task)

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
        db: Database session
    """
    try:
        # Parse webhook data
        webhook_data = PhotoCreatedWebhook(**payload)

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_photo_created(
            webhook_data,
            webhook_event_id=webhook_event_id
        )

        logger.info(f"Photo webhook processing result: {result.dict()}")

    except Exception as e:
        logger.error(f"Error processing photo webhook: {e}", exc_info=True)


@router.get(
    "/companycam/photos",
    response_model=List[CompanyCamPhotoResponse],
    summary="List CompanyCam Photos"
)
async def list_companycam_photos(
    job_id: Optional[str] = None,
    is_synced: Optional[bool] = None,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    List CompanyCam photos

    Filter by water mitigation job ID or sync status.
    """
    query = db.query(CompanyCamPhoto)

    if job_id:
        query = query.filter(CompanyCamPhoto.water_mitigation_job_id == job_id)

    if is_synced is not None:
        query = query.filter(CompanyCamPhoto.is_synced == is_synced)

    photos = query.order_by(CompanyCamPhoto.created_at.desc()).limit(limit).all()

    return photos


@router.get(
    "/companycam/stats",
    response_model=CompanyCamStatsResponse,
    summary="CompanyCam Integration Statistics"
)
async def companycam_stats(db: Session = Depends(get_db)):
    """
    Get statistics for CompanyCam integration
    """
    total_photos = db.query(CompanyCamPhoto).count()
    synced_photos = db.query(CompanyCamPhoto).filter(CompanyCamPhoto.is_synced == True).count()
    unmatched_photos = db.query(CompanyCamPhoto).filter(CompanyCamPhoto.water_mitigation_job_id == None).count()

    # Count water mitigation jobs created from CompanyCam
    jobs_created = db.query(WebhookEvent).filter(
        WebhookEvent.service_name == "companycam",
        WebhookEvent.status == "processed",
        WebhookEvent.related_entity_type == "water_mitigation_job"
    ).count()

    # Last webhook event
    last_webhook = db.query(WebhookEvent).filter(
        WebhookEvent.service_name == "companycam"
    ).order_by(WebhookEvent.created_at.desc()).first()

    return CompanyCamStatsResponse(
        total_photos=total_photos,
        synced_photos=synced_photos,
        unmatched_photos=unmatched_photos,
        work_orders_created=jobs_created,  # Using field name for consistency
        last_webhook_at=last_webhook.created_at if last_webhook else None
    )


# ========== Webhook Event Management ==========

@router.get(
    "/webhook-events",
    response_model=List[WebhookEventResponse],
    summary="List Webhook Events"
)
async def list_webhook_events(
    service_name: Optional[str] = None,
    event_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    List webhook events with optional filters

    Useful for debugging and monitoring integrations.
    """
    query = db.query(WebhookEvent)

    if service_name:
        query = query.filter(WebhookEvent.service_name == service_name)

    if event_type:
        query = query.filter(WebhookEvent.event_type == event_type)

    if status:
        query = query.filter(WebhookEvent.status == status)

    events = query.order_by(WebhookEvent.created_at.desc()).limit(limit).all()

    return events


@router.get(
    "/webhook-events/{event_id}",
    response_model=WebhookEventResponse,
    summary="Get Webhook Event Details"
)
async def get_webhook_event(
    event_id: str,
    db: Session = Depends(get_db)
):
    """
    Get details of a specific webhook event
    """
    event = db.query(WebhookEvent).filter(WebhookEvent.id == event_id).first()

    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook event {event_id} not found"
        )

    return event


# ========== Health Checks ==========

@router.get(
    "/health",
    response_model=List[IntegrationHealthCheck],
    summary="Integration Services Health Check"
)
async def integration_health_check(db: Session = Depends(get_db)):
    """
    Check health status of all integration services

    Returns status for:
    - CompanyCam API connection
    - Slack webhook
    - Configuration status
    """
    health_checks = []

    # CompanyCam health check
    companycam_client = CompanyCamClient()
    companycam_healthy = await companycam_client.health_check()

    # Get last CompanyCam event
    last_cc_event = db.query(WebhookEvent).filter(
        WebhookEvent.service_name == "companycam"
    ).order_by(WebhookEvent.created_at.desc()).first()

    # Count events in last 24 hours
    since_24h = datetime.utcnow() - timedelta(hours=24)
    cc_events_24h = db.query(WebhookEvent).filter(
        WebhookEvent.service_name == "companycam",
        WebhookEvent.created_at >= since_24h
    ).count()

    health_checks.append(IntegrationHealthCheck(
        service_name="companycam",
        is_configured=bool(settings.COMPANYCAM_API_KEY and settings.COMPANYCAM_WEBHOOK_TOKEN),
        is_healthy=companycam_healthy,
        last_event=last_cc_event.created_at if last_cc_event else None,
        event_count_24h=cc_events_24h
    ))

    # Slack health check
    slack_client = SlackClient()
    slack_healthy = await slack_client.health_check()

    health_checks.append(IntegrationHealthCheck(
        service_name="slack",
        is_configured=bool(settings.SLACK_WEBHOOK_URL),
        is_healthy=slack_healthy,
        last_event=None,
        event_count_24h=0
    ))

    return health_checks


@router.get(
    "/stats",
    response_model=List[IntegrationStats],
    summary="Integration Statistics"
)
async def integration_stats(db: Session = Depends(get_db)):
    """
    Get statistics for all integration services
    """
    stats = []

    # Get stats for each service
    services = ["companycam", "slack", "google_sheets"]

    for service in services:
        total = db.query(WebhookEvent).filter(
            WebhookEvent.service_name == service
        ).count()

        successful = db.query(WebhookEvent).filter(
            WebhookEvent.service_name == service,
            WebhookEvent.status == "processed"
        ).count()

        failed = db.query(WebhookEvent).filter(
            WebhookEvent.service_name == service,
            WebhookEvent.status == "failed"
        ).count()

        pending = db.query(WebhookEvent).filter(
            WebhookEvent.service_name == service,
            WebhookEvent.status == "pending"
        ).count()

        last_event = db.query(WebhookEvent).filter(
            WebhookEvent.service_name == service
        ).order_by(WebhookEvent.created_at.desc()).first()

        stats.append(IntegrationStats(
            service_name=service,
            total_events=total,
            successful_events=successful,
            failed_events=failed,
            pending_events=pending,
            last_event_at=last_event.created_at if last_event else None
        ))

    return stats
