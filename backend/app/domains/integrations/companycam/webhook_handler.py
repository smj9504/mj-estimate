"""
Simplified CompanyCam Webhook Handler for Integration Server

Processes webhook events and communicates with main backend via HTTP
"""

import logging
from typing import Dict, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from .models import WebhookEvent, CompanyCamPhoto
from .client import CompanyCamClient
from .schemas import PhotoCreatedWebhook, ProjectCreatedWebhook
from app.core.backend_client import BackendClient
from app.integrations.slack.client import SlackClient

logger = logging.getLogger(__name__)


async def process_companycam_webhook(
    payload: Dict,
    headers: Dict,
    ip_address: Optional[str],
    db: Session
):
    """
    Process CompanyCam webhook event

    Args:
        payload: Webhook payload
        headers: Request headers
        ip_address: Client IP
        db: Database session
    """
    event_type = payload.get("event_type", payload.get("type", "unknown"))

    # Extract event_id
    if event_type == "project.updated":
        event_id = str(payload.get("payload", {}).get("project", {}).get("id", ""))
    elif event_type == "photo.created":
        event_id = str(payload.get("payload", {}).get("photo", {}).get("id", ""))
    elif event_type == "project.created":
        event_id = str(payload.get("payload", {}).get("project", {}).get("id", ""))
    else:
        event_id = ""

    # Log webhook event
    webhook_event = WebhookEvent(
        service_name="companycam",
        event_type=event_type,
        event_id=event_id,
        payload=payload,
        headers=headers,
        ip_address=ip_address,
        user_agent=headers.get("user-agent"),
        status="pending"
    )

    db.add(webhook_event)
    db.commit()
    db.refresh(webhook_event)

    logger.info(f"Processing {event_type} webhook (ID: {webhook_event.id})")

    try:
        # Process based on event type
        if event_type == "photo.created":
            await process_photo_created(webhook_event.id, payload, db)
        elif event_type == "project.created":
            await process_project_created(webhook_event.id, payload, db)
        elif event_type == "project.updated":
            await process_project_updated(webhook_event.id, payload, db)
        else:
            webhook_event.status = "ignored"
            webhook_event.error_message = f"Unsupported event type: {event_type}"
            webhook_event.processed_at = datetime.utcnow()
            db.commit()

    except Exception as e:
        logger.error(f"Error processing webhook {webhook_event.id}: {e}", exc_info=True)
        webhook_event.status = "failed"
        webhook_event.error_message = str(e)
        webhook_event.processed_at = datetime.utcnow()
        db.commit()


async def process_photo_created(
    webhook_event_id: str,
    payload: Dict,
    db: Session
):
    """Process photo.created event"""
    backend = BackendClient()
    slack = SlackClient()

    # Extract photo data
    photo_payload = payload.get("payload", {}).get("photo", {})
    project_payload = payload.get("payload", {}).get("project", {})

    logger.info(f"Photo created: {photo_payload.get('id')}")

    # Store photo metadata
    photo = CompanyCamPhoto(
        companycam_photo_id=str(photo_payload.get("id")),
        companycam_project_id=str(photo_payload.get("project_id")),
        companycam_project_name=project_payload.get("name"),
        photo_url=photo_payload.get("uris", {}).get("original", ""),
        thumbnail_url=photo_payload.get("uris", {}).get("thumbnail"),
        description=photo_payload.get("description"),
        project_address=project_payload.get("address", {}).get("street_address_1"),
        project_city=project_payload.get("address", {}).get("city"),
        project_state=project_payload.get("address", {}).get("state"),
        project_zipcode=project_payload.get("address", {}).get("postal_code"),
        companycam_created_at=datetime.fromtimestamp(photo_payload.get("created_at", 0))
    )

    db.add(photo)
    db.commit()

    # Try to match with water mitigation job via backend
    # Backend will handle matching logic
    result = await backend.notify_webhook_processed(
        service_name="companycam",
        event_type="photo.created",
        event_data={
            "photo_id": photo.id,
            "companycam_photo_id": photo.companycam_photo_id,
            "project_address": photo.project_address,
            "photo_url": photo.photo_url
        }
    )

    # Update webhook status
    webhook = db.query(WebhookEvent).filter(
        WebhookEvent.id == webhook_event_id
    ).first()

    if webhook:
        webhook.status = "processed"
        webhook.processed_at = datetime.utcnow()
        db.commit()

    logger.info(f"Photo webhook processed successfully")


async def process_project_created(
    webhook_event_id: str,
    payload: Dict,
    db: Session
):
    """Process project.created event"""
    backend = BackendClient()

    project_payload = payload.get("payload", {}).get("project", {})

    logger.info(f"Project created: {project_payload.get('name')}")

    # Notify backend about new project
    result = await backend.notify_webhook_processed(
        service_name="companycam",
        event_type="project.created",
        event_data={
            "project_id": project_payload.get("id"),
            "project_name": project_payload.get("name"),
            "address": project_payload.get("address")
        }
    )

    # Update webhook status
    webhook = db.query(WebhookEvent).filter(
        WebhookEvent.id == webhook_event_id
    ).first()

    if webhook:
        webhook.status = "processed"
        webhook.processed_at = datetime.utcnow()
        db.commit()


async def process_project_updated(
    webhook_event_id: str,
    payload: Dict,
    db: Session
):
    """Process project.updated event"""
    backend = BackendClient()

    project_payload = payload.get("payload", {}).get("project", {})

    logger.info(f"Project updated: {project_payload.get('name')}")

    # Notify backend
    result = await backend.notify_webhook_processed(
        service_name="companycam",
        event_type="project.updated",
        event_data={
            "project_id": project_payload.get("id"),
            "project_name": project_payload.get("name")
        }
    )

    # Update webhook status
    webhook = db.query(WebhookEvent).filter(
        WebhookEvent.id == webhook_event_id
    ).first()

    if webhook:
        webhook.status = "processed"
        webhook.processed_at = datetime.utcnow()
        db.commit()
