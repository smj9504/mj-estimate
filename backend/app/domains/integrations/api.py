"""
Integrations API endpoints

Handles webhooks and API calls for external service integrations:
- CompanyCam webhooks
- Slack notifications
- Google Sheets sync (future)
"""

import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database_factory import get_database

from .companycam.client import CompanyCamClient
from .companycam.schemas import (
    CompanyCamPhotoResponse,
    CompanyCamStatsResponse,
    PhotoCreatedWebhook,
    ProjectCreatedWebhook,
)
from .companycam.webhook_handler_wm import CompanyCamWaterMitigationHandler
from .models import CompanyCamPhoto, WebhookEvent
from .schemas import (
    IntegrationHealthCheck,
    IntegrationStats,
    WebhookEventCreate,
    WebhookEventResponse,
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
    - `project.created` - New project created in CompanyCam
    - `project.updated` - Project updated (may include new photos)
    - `project.deleted` - Project deleted in CompanyCam (marks lead as inactive)

    **CompanyCam Setup:**
    1. Go to CompanyCam Settings → API & Webhooks
    2. Create webhook: `https://your-domain.com/api/integrations/companycam/webhook`
    3. Subscribe to events: `photo.created`, `project.created`, `project.updated`, `project.deleted`
    4. Configure `COMPANYCAM_WEBHOOK_TOKEN` in environment
    """
    # Log incoming webhook request
    logger.info(f"📥 Received webhook request from {request.client.host if request.client else 'unknown'}")
    logger.info(f"Headers: {dict(request.headers)}")

    # Get raw request body for signature verification
    body = await request.body()
    logger.info(f"Body preview: {body[:200]}...")  # First 200 bytes

    # Verify signature
    signature = request.headers.get("X-CompanyCam-Signature", "")
    logger.info(f"Signature present: {bool(signature)}")

    if not CompanyCamClient.verify_webhook_signature(body, signature):
        logger.warning(f"Invalid webhook signature from CompanyCam (signature={signature[:20]}...)")
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

    # Extract event type - support both new and legacy webhook formats
    # New format: payload.get("event_type")
    # Legacy format: payload.get("type")
    event_type = payload.get("event_type") or payload.get("type", "unknown")

    # Extract event_id based on event type
    if event_type in ["photo.created", "photo.updated", "photo.deleted"]:
        # New format: payload.payload.photo.id
        # Legacy format: payload.photo.id
        event_id = str(
            payload.get("payload", {}).get("photo", {}).get("id") or
            payload.get("photo", {}).get("id", "")
        )
    elif event_type in ["project.created", "project.updated", "project.deleted"]:
        # New format: payload.payload.project.id
        # Legacy format: payload.project.id
        event_id = str(
            payload.get("payload", {}).get("project", {}).get("id") or
            payload.get("project", {}).get("id", "")
        )
    else:
        event_id = ""

    # Log webhook event
    webhook_event = WebhookEvent(
        service_name="companycam",
        event_type=event_type,
        event_id=event_id,
        payload=payload,
        headers=dict(request.headers),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        status="pending"
    )

    db.add(webhook_event)
    db.commit()
    db.refresh(webhook_event)

    logger.info(f"📥 Received {event_type} webhook from CompanyCam (Event ID: {webhook_event.id})")

    # Process event immediately (Render deployment: background tasks may not complete)
    # In production, webhooks need immediate processing to ensure completion
    try:
        if event_type == "photo.created":
            await process_photo_created_event(
                str(webhook_event.id),
                payload
            )
        elif event_type == "project.created":
            await process_project_created_event(
                str(webhook_event.id),
                payload
            )
        elif event_type == "project.updated":
            await process_project_updated_event(
                str(webhook_event.id),
                payload
            )
        elif event_type == "project.deleted":
            await process_project_deleted_event(
                str(webhook_event.id),
                payload
            )
        elif event_type == "photo.deleted":
            await process_photo_deleted_event(
                str(webhook_event.id),
                payload
            )
        else:
            # Unknown event type - mark as ignored
            webhook_event.status = "ignored"
            webhook_event.processed_at = datetime.utcnow()
            webhook_event.error_message = f"Unsupported event type: {event_type}"
            db.commit()
            logger.info(f"⏭️ Ignored unsupported event type: {event_type}")
    except Exception as e:
        # Log error but don't fail the webhook response
        logger.error(f"❌ Error processing webhook {webhook_event.id}: {e}", exc_info=True)
        webhook_event.status = "failed"
        webhook_event.processed_at = datetime.utcnow()
        webhook_event.error_message = str(e)
        db.commit()

    return {"status": "ok", "event_id": str(webhook_event.id)}


async def process_photo_created_event(
    webhook_event_id: str,
    payload: dict
):
    """
    Process photo.created webhook event for Water Mitigation (background task)

    Performance optimizations:
    - Creates new DB session (original session is closed)
    - Async photo download (non-blocking)
    - Batch notification system (prevents spam)

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
    """
    db = None
    try:
        # Create new DB session for background task
        database = get_database()
        db = database.get_session()

        logger.info(f"⚙️ Processing photo.created event (Webhook: {webhook_event_id})")

        # Parse webhook data - support both new and legacy formats
        try:
            # Try new format first (payload.payload structure)
            if "payload" in payload and "photo" in payload["payload"]:
                # Convert new format to legacy PhotoCreatedWebhook format
                photo_data = payload["payload"]["photo"]
                # In new format, project info is nested under payload.payload.project
                # But project_id is also in photo_data.project_id
                project_data = payload["payload"].get("project", {})
                user_data = payload.get("user", payload["payload"].get("user", {}))

                # Extract project_id from photo if not in project object
                # Use photo_data.project_id first (more reliable), fallback to project_data.id
                project_id = photo_data.get("project_id") or project_data.get("id") or 0
                # Convert to int and validate (0 is invalid)
                try:
                    project_id = int(project_id) if project_id else 0
                except (ValueError, TypeError):
                    project_id = 0

                # Log for debugging
                if project_id == 0:
                    logger.warning(f"Invalid project_id detected. photo_data.project_id={photo_data.get('project_id')}, project_data.id={project_data.get('id')}")
                    logger.debug(f"Full photo_data keys: {list(photo_data.keys())}")
                    logger.debug(f"Full project_data: {project_data}")

                # Extract URIs from list format to dict format
                uris = {}
                for uri_obj in photo_data.get("uris", []):
                    uri_type = uri_obj.get("type", "")
                    if uri_type:
                        uris[uri_type] = uri_obj.get("url", "")

                # Build dict format that matches PhotoCreatedWebhook schema
                webhook_payload = {
                    "type": "photo.created",  # Add required 'type' field
                    "photo": {
                        "id": int(photo_data.get("id", 0)),
                        "project_id": int(project_id) if project_id else 0,
                        "creator_id": int(photo_data.get("creator_id") or user_data.get("id", 0)),
                        "photo_description": photo_data.get("description"),
                        "uris": {
                            "original": uris.get("original", ""),
                            "large": uris.get("large"),
                            "medium": uris.get("medium"),
                            "small": uris.get("small"),
                            "thumbnail": uris.get("thumbnail")
                        },
                        "coordinates": photo_data.get("coordinates"),
                        "captured_at": photo_data.get("captured_at"),
                        "created_at": photo_data.get("created_at"),
                        "updated_at": photo_data.get("updated_at", photo_data.get("created_at"))
                    },
                    "project": {
                        "id": int(project_id) if project_id else 0,
                        "name": project_data.get("name") or photo_data.get("project_name"),
                        "address": project_data.get("address", {}),
                        "coordinates": project_data.get("coordinates") or photo_data.get("coordinates")
                    },
                    "user": {
                        "id": int(user_data.get("id", 0)),
                        "name": user_data.get("name", "Unknown"),
                        "email_address": user_data.get("email_address")
                    }
                }

                webhook_data = PhotoCreatedWebhook(**webhook_payload)
            else:
                # Legacy format
                webhook_data = PhotoCreatedWebhook(**payload)
        except Exception as parse_error:
            logger.error(f"Failed to parse webhook payload: {parse_error}", exc_info=True)
            logger.debug(f"Payload structure: {json.dumps(payload, indent=2)}")
            raise

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_photo_created(
            webhook_data,
            webhook_event_id=webhook_event_id
        )

        logger.info(f"✅ Photo webhook processed successfully: {result.dict()}")

    except Exception as e:
        logger.error(f"❌ Error processing photo webhook: {e}", exc_info=True)

        # Update webhook event status to failed
        if db:
            try:
                webhook_event = db.query(WebhookEvent).filter(
                    WebhookEvent.id == webhook_event_id
                ).first()
                if webhook_event:
                    webhook_event.status = "failed"
                    webhook_event.error_message = str(e)
                    webhook_event.processed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update webhook event status: {db_error}")

    finally:
        # Always close DB session
        if db:
            db.close()


async def process_project_created_event(
    webhook_event_id: str,
    payload: dict
):
    """
    Process project.created webhook event for Water Mitigation (background task)

    When a new CompanyCam project is created, automatically:
    1. Create a Water Mitigation Lead
    2. Fetch and download all existing photos from the project
    3. Send Slack notification

    Performance optimizations:
    - Creates new DB session
    - Async API calls to CompanyCam
    - Batch photo processing

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
    """
    db = None
    try:
        # Create new DB session for background task
        database = get_database()
        db = database.get_session()

        logger.info(f"⚙️ Processing project.created event (Webhook: {webhook_event_id})")

        # Parse webhook data - support both new and legacy formats
        try:
            if "payload" in payload and "project" in payload["payload"]:
                # New format
                from .companycam.schemas import ProjectData, UserData

                project_data = payload["payload"]["project"]
                user_data = payload.get("user", payload["payload"].get("user", {}))

                # Build webhook_payload dict first, then convert to ProjectCreatedWebhook
                webhook_payload = {
                    "type": "project.created",  # Required field
                    "project": {
                        "id": int(project_data.get("id", 0)),
                        "name": project_data.get("name"),
                        "address": project_data.get("address", {}),
                        "coordinates": project_data.get("coordinates"),
                        "creator_id": project_data.get("creator_id"),
                        "creator_name": project_data.get("creator_name")
                    },
                    "user": {
                        "id": int(user_data.get("id", 0)),
                        "name": user_data.get("name", "Unknown"),
                        "email_address": user_data.get("email_address")
                    }
                }

                webhook_data = ProjectCreatedWebhook(**webhook_payload)
            else:
                # Legacy format
                webhook_data = ProjectCreatedWebhook(**payload)
        except Exception as parse_error:
            logger.error(f"Failed to parse project webhook payload: {parse_error}", exc_info=True)
            logger.debug(f"Payload structure: {json.dumps(payload, indent=2)}")
            raise

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_project_created(
            webhook_data,
            webhook_event_id=webhook_event_id
        )

        logger.info(f"✅ Project.created webhook processed: Job ID {result.get('job_id')}, "
                   f"Created: {result.get('job_created')}, Photos: {result.get('photos_processed', 0)}")

    except Exception as e:
        logger.error(f"❌ Error processing project.created webhook: {e}", exc_info=True)

        # Update webhook event status to failed
        if db:
            try:
                webhook_event = db.query(WebhookEvent).filter(
                    WebhookEvent.id == webhook_event_id
                ).first()
                if webhook_event:
                    webhook_event.status = "failed"
                    webhook_event.error_message = str(e)
                    webhook_event.processed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update webhook event status: {db_error}")

    finally:
        # Always close DB session
        if db:
            db.close()


async def process_project_updated_event(
    webhook_event_id: str,
    payload: dict
):
    """
    Process project.updated webhook event for Water Mitigation (background task)

    When a CompanyCam project is updated (may include new photos):
    1. Fetch latest photos from the project
    2. Process only new photos (not already synced)
    3. Attach to existing Water Mitigation job or create new one

    Performance optimizations:
    - Creates new DB session
    - Only fetches new photos (checks DB first)
    - Batch processing for multiple photos

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
    """
    db = None
    try:
        # Create new DB session for background task
        database = get_database()
        db = database.get_session()

        logger.info(f"⚙️ Processing project.updated event (Webhook: {webhook_event_id})")

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_project_updated(
            payload,
            webhook_event_id=webhook_event_id
        )

        photos_count = len(result.work_order_match.matched) if hasattr(result.work_order_match, 'matched') else 0
        logger.info(f"✅ Project.updated webhook processed: {photos_count} new photo(s) found")

    except Exception as e:
        logger.error(f"❌ Error processing project.updated webhook: {e}", exc_info=True)

        # Update webhook event status to failed
        if db:
            try:
                webhook_event = db.query(WebhookEvent).filter(
                    WebhookEvent.id == webhook_event_id
                ).first()
                if webhook_event:
                    webhook_event.status = "failed"
                    webhook_event.error_message = str(e)
                    webhook_event.processed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update webhook event status: {db_error}")

    finally:
        # Always close DB session
        if db:
            db.close()


async def process_project_deleted_event(
    webhook_event_id: str,
    payload: dict
):
    """
    Process project.deleted webhook event for Water Mitigation (background task)

    When a CompanyCam project is deleted:
    1. Find the corresponding Water Mitigation job
    2. Mark the job as inactive (active=False)
    3. Send Slack notification

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
    """
    db = None
    try:
        # Create new DB session for background task
        database = get_database()
        db = database.get_session()

        logger.info(f"⚙️ Processing project.deleted event (Webhook: {webhook_event_id})")

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_project_deleted(
            payload,
            webhook_event_id=webhook_event_id
        )

        if result.get("success"):
            logger.info(f"✅ Project.deleted webhook processed: Job ID {result.get('job_id')}, "
                       f"Deactivated: {result.get('job_deactivated')}")
        else:
            logger.warning(f"⚠️ Project.deleted processed with warning: {result.get('error_message')}")

    except Exception as e:
        logger.error(f"❌ Error processing project.deleted webhook: {e}", exc_info=True)

        # Update webhook event status to failed
        if db:
            try:
                webhook_event = db.query(WebhookEvent).filter(
                    WebhookEvent.id == webhook_event_id
                ).first()
                if webhook_event:
                    webhook_event.status = "failed"
                    webhook_event.error_message = str(e)
                    webhook_event.processed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update webhook event status: {db_error}")

    finally:
        # Always close DB session
        if db:
            db.close()


async def process_photo_deleted_event(
    webhook_event_id: str,
    payload: dict
):
    """
    Process photo.deleted webhook event for Water Mitigation (background task)

    When a CompanyCam photo is deleted:
    1. Find the corresponding WM photo by external_id
    2. Move the photo to trash (soft delete)
    3. Send Slack notification

    Args:
        webhook_event_id: Webhook event ID
        payload: Webhook payload
    """
    db = None
    try:
        # Create new DB session for background task
        database = get_database()
        db = database.get_session()

        logger.info(f"⚙️ Processing photo.deleted event (Webhook: {webhook_event_id})")

        # Process with Water Mitigation webhook handler
        handler = CompanyCamWaterMitigationHandler(db)
        result = await handler.handle_photo_deleted(
            payload,
            webhook_event_id=webhook_event_id
        )

        if result.get("success"):
            logger.info(f"✅ Photo.deleted webhook processed: Photo ID {result.get('photo_id')}, "
                       f"Trashed: {result.get('photo_trashed')}")
        else:
            logger.warning(f"⚠️ Photo.deleted processed with warning: {result.get('error_message')}")

    except Exception as e:
        logger.error(f"❌ Error processing photo.deleted webhook: {e}", exc_info=True)

        # Update webhook event status to failed
        if db:
            try:
                webhook_event = db.query(WebhookEvent).filter(
                    WebhookEvent.id == webhook_event_id
                ).first()
                if webhook_event:
                    webhook_event.status = "failed"
                    webhook_event.error_message = str(e)
                    webhook_event.processed_at = datetime.utcnow()
                    db.commit()
            except Exception as db_error:
                logger.error(f"Failed to update webhook event status: {db_error}")

    finally:
        # Always close DB session
        if db:
            db.close()


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
