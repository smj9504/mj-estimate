"""
Slack Client for sending notifications

Uses Slack Incoming Webhooks to send rich notifications
"""

import httpx
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.core.config import settings
from .schemas import SlackMessage, SlackBlock, SlackBlockField
from .templates import SlackTemplates

logger = logging.getLogger(__name__)


class SlackClient:
    """
    Slack API client for sending notifications

    Uses Slack Incoming Webhooks:
    https://api.slack.com/messaging/webhooks
    """

    def __init__(self, webhook_url: Optional[str] = None):
        """
        Initialize Slack client

        Args:
            webhook_url: Slack webhook URL (uses settings.SLACK_WEBHOOK_URL if not provided)
        """
        self.webhook_url = webhook_url or settings.SLACK_WEBHOOK_URL
        self.timeout = 10.0

        if not self.webhook_url:
            logger.warning("Slack webhook URL not configured")

    async def send_message(self, message: SlackMessage) -> bool:
        """
        Send message to Slack

        Args:
            message: Slack message payload

        Returns:
            True if sent successfully, False otherwise
        """
        if not self.webhook_url:
            logger.warning("Cannot send Slack message: webhook URL not configured")
            return False

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.webhook_url,
                    json=message.dict(exclude_none=True)
                )
                response.raise_for_status()

            logger.info("Slack message sent successfully")
            return True

        except httpx.HTTPError as e:
            logger.error(f"Failed to send Slack message: {e}")
            return False

        except Exception as e:
            logger.error(f"Unexpected error sending Slack message: {e}")
            return False

    async def notify_photo_upload(
        self,
        work_order: Any,  # WorkOrder model
        photo_url: str,
        photo_description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        is_new_work_order: bool = False
    ) -> bool:
        """
        Send notification for photo upload from CompanyCam

        Args:
            work_order: Work order object
            photo_url: URL of uploaded photo
            photo_description: Photo description
            uploaded_by: Name of uploader
            is_new_work_order: Whether a new work order was created

        Returns:
            True if sent successfully
        """
        message = SlackTemplates.photo_upload_notification(
            work_order=work_order,
            photo_url=photo_url,
            photo_description=photo_description,
            uploaded_by=uploaded_by,
            is_new_work_order=is_new_work_order
        )

        return await self.send_message(message)

    async def notify_wm_photo_upload(
        self,
        job: Any,  # WaterMitigationJob model
        photo_url: str,
        photo_description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        is_new_job: bool = False
    ) -> bool:
        """
        Send notification for photo upload to Water Mitigation job

        Args:
            job: Water mitigation job object
            photo_url: URL of uploaded photo
            photo_description: Photo description
            uploaded_by: Name of uploader
            is_new_job: Whether a new job was created

        Returns:
            True if sent successfully
        """
        message = SlackTemplates.wm_photo_upload_notification(
            job=job,
            photo_url=photo_url,
            photo_description=photo_description,
            uploaded_by=uploaded_by,
            is_new_job=is_new_job
        )

        return await self.send_message(message)

    async def notify_work_order_created(
        self,
        work_order: Any,
        created_by: Optional[str] = None,
        notes: Optional[str] = None
    ) -> bool:
        """
        Send notification for new work order creation

        Args:
            work_order: Work order object
            created_by: Name of creator
            notes: Additional notes

        Returns:
            True if sent successfully
        """
        message = SlackTemplates.work_order_created(
            work_order=work_order,
            created_by=created_by,
            notes=notes
        )

        return await self.send_message(message)

    async def notify_work_order_updated(
        self,
        work_order: Any,
        updated_by: Optional[str] = None,
        changes: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Send notification for work order update

        Args:
            work_order: Work order object
            updated_by: Name of updater
            changes: Dictionary of changed fields

        Returns:
            True if sent successfully
        """
        message = SlackTemplates.work_order_updated(
            work_order=work_order,
            updated_by=updated_by,
            changes=changes
        )

        return await self.send_message(message)

    async def send_system_alert(
        self,
        title: str,
        message: str,
        severity: str = "info",
        details: Optional[Dict[str, str]] = None
    ) -> bool:
        """
        Send system alert notification

        Args:
            title: Alert title
            message: Alert message
            severity: Alert severity (info, warning, error, critical)
            details: Additional details dictionary

        Returns:
            True if sent successfully
        """
        # Color coding for severity
        colors = {
            "info": "#36a64f",      # Green
            "warning": "#ff9800",   # Orange
            "error": "#f44336",     # Red
            "critical": "#9c27b0"   # Purple
        }

        blocks = [
            SlackBlock(
                type="header",
                text={
                    "type": "plain_text",
                    "text": f"⚠️ {title}" if severity in ["warning", "error", "critical"] else f"ℹ️ {title}"
                }
            ),
            SlackBlock(
                type="section",
                text={
                    "type": "mrkdwn",
                    "text": message
                }
            )
        ]

        # Add details as fields
        if details:
            fields = [
                SlackBlockField(type="mrkdwn", text=f"*{key}:*\n{value}")
                for key, value in details.items()
            ]
            blocks.append(SlackBlock(type="section", fields=fields))

        # Add timestamp
        blocks.append(SlackBlock(
            type="context",
            elements=[{
                "type": "mrkdwn",
                "text": f"_Sent at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_"
            }]
        ))

        message_payload = SlackMessage(
            text=f"{title}: {message}",
            blocks=blocks,
            attachments=[{
                "color": colors.get(severity, "#36a64f")
            }]
        )

        return await self.send_message(message_payload)

    async def health_check(self) -> bool:
        """
        Check if Slack webhook is accessible

        Returns:
            True if webhook is accessible
        """
        if not self.webhook_url:
            return False

        # Send a minimal test message
        test_message = SlackMessage(
            text="Health check",
            blocks=[]
        )

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    self.webhook_url,
                    json=test_message.dict(exclude_none=True)
                )
                return response.status_code == 200

        except Exception as e:
            logger.error(f"Slack health check failed: {e}")
            return False
