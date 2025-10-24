"""
Slack message templates for different notification types
"""

from typing import Optional, Dict, Any
from datetime import datetime

from .schemas import SlackMessage, SlackBlock, SlackBlockField
from app.core.config import settings


class SlackTemplates:
    """
    Templates for Slack notifications
    """

    @staticmethod
    def photo_upload_notification(
        work_order: Any,
        photo_url: str,
        photo_description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        is_new_work_order: bool = False
    ) -> SlackMessage:
        """
        Template for photo upload notification from CompanyCam

        Args:
            work_order: Work order object
            photo_url: URL of uploaded photo
            photo_description: Photo description
            uploaded_by: Name of uploader
            is_new_work_order: Whether a new work order was created

        Returns:
            Formatted Slack message
        """
        # Header
        header_text = "🏠 New Work Order Created from CompanyCam" if is_new_work_order else "📸 Photo Added to Work Order"

        blocks = [
            SlackBlock(
                type="header",
                text={
                    "type": "plain_text",
                    "text": header_text
                }
            )
        ]

        # Work order details
        fields = [
            SlackBlockField(
                type="mrkdwn",
                text=f"*Work Order:*\n#{work_order.work_order_number}"
            ),
            SlackBlockField(
                type="mrkdwn",
                text=f"*Status:*\n{work_order.status.value if hasattr(work_order.status, 'value') else work_order.status}"
            ),
            SlackBlockField(
                type="mrkdwn",
                text=f"*Client:*\n{work_order.client_name}"
            ),
            SlackBlockField(
                type="mrkdwn",
                text=f"*Address:*\n{work_order.job_site_address or 'N/A'}"
            )
        ]

        if work_order.job_site_city and work_order.job_site_state:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Location:*\n{work_order.job_site_city}, {work_order.job_site_state}"
            ))

        if uploaded_by:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Uploaded By:*\n{uploaded_by}"
            ))

        blocks.append(SlackBlock(type="section", fields=fields))

        # Photo description
        if photo_description:
            blocks.append(SlackBlock(
                type="section",
                text={
                    "type": "mrkdwn",
                    "text": f"*Photo Description:*\n{photo_description}"
                }
            ))

        # Photo image
        blocks.append(SlackBlock(
            type="image",
            image_url=photo_url,
            alt_text="Uploaded photo from CompanyCam"
        ))

        # Action buttons
        work_order_url = f"{settings.FRONTEND_URL}/work-orders/{work_order.id}"
        blocks.append(SlackBlock(
            type="actions",
            elements=[
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "View Work Order"
                    },
                    "url": work_order_url,
                    "style": "primary"
                }
            ]
        ))

        # Timestamp context
        blocks.append(SlackBlock(
            type="context",
            elements=[{
                "type": "mrkdwn",
                "text": f"_Received at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_"
            }]
        ))

        return SlackMessage(
            text=f"{header_text}: {work_order.work_order_number}",
            blocks=blocks
        )

    @staticmethod
    def work_order_created(
        work_order: Any,
        created_by: Optional[str] = None,
        notes: Optional[str] = None
    ) -> SlackMessage:
        """
        Template for new work order creation notification

        Args:
            work_order: Work order object
            created_by: Name of creator
            notes: Additional notes

        Returns:
            Formatted Slack message
        """
        blocks = [
            SlackBlock(
                type="header",
                text={
                    "type": "plain_text",
                    "text": "📋 New Work Order Created"
                }
            )
        ]

        # Work order details
        fields = [
            SlackBlockField(type="mrkdwn", text=f"*Work Order:*\n#{work_order.work_order_number}"),
            SlackBlockField(type="mrkdwn", text=f"*Status:*\n{work_order.status.value if hasattr(work_order.status, 'value') else work_order.status}"),
            SlackBlockField(type="mrkdwn", text=f"*Client:*\n{work_order.client_name}"),
            SlackBlockField(type="mrkdwn", text=f"*Address:*\n{work_order.job_site_address or 'N/A'}")
        ]

        if created_by:
            fields.append(SlackBlockField(type="mrkdwn", text=f"*Created By:*\n{created_by}"))

        blocks.append(SlackBlock(type="section", fields=fields))

        # Notes
        if notes:
            blocks.append(SlackBlock(
                type="section",
                text={"type": "mrkdwn", "text": f"*Notes:*\n{notes}"}
            ))

        # Action button
        work_order_url = f"{settings.FRONTEND_URL}/work-orders/{work_order.id}"
        blocks.append(SlackBlock(
            type="actions",
            elements=[{
                "type": "button",
                "text": {"type": "plain_text", "text": "View Work Order"},
                "url": work_order_url,
                "style": "primary"
            }]
        ))

        return SlackMessage(
            text=f"New work order created: {work_order.work_order_number}",
            blocks=blocks
        )

    @staticmethod
    def work_order_updated(
        work_order: Any,
        updated_by: Optional[str] = None,
        changes: Optional[Dict[str, Any]] = None
    ) -> SlackMessage:
        """
        Template for work order update notification

        Args:
            work_order: Work order object
            updated_by: Name of updater
            changes: Dictionary of changed fields

        Returns:
            Formatted Slack message
        """
        blocks = [
            SlackBlock(
                type="header",
                text={
                    "type": "plain_text",
                    "text": "✏️ Work Order Updated"
                }
            )
        ]

        # Work order details
        fields = [
            SlackBlockField(type="mrkdwn", text=f"*Work Order:*\n#{work_order.work_order_number}"),
            SlackBlockField(type="mrkdwn", text=f"*Client:*\n{work_order.client_name}")
        ]

        if updated_by:
            fields.append(SlackBlockField(type="mrkdwn", text=f"*Updated By:*\n{updated_by}"))

        blocks.append(SlackBlock(type="section", fields=fields))

        # Changes
        if changes:
            changes_text = "\n".join([f"• *{key}:* {value}" for key, value in changes.items()])
            blocks.append(SlackBlock(
                type="section",
                text={"type": "mrkdwn", "text": f"*Changes:*\n{changes_text}"}
            ))

        # Action button
        work_order_url = f"{settings.FRONTEND_URL}/work-orders/{work_order.id}"
        blocks.append(SlackBlock(
            type="actions",
            elements=[{
                "type": "button",
                "text": {"type": "plain_text", "text": "View Work Order"},
                "url": work_order_url
            }]
        ))

        return SlackMessage(
            text=f"Work order updated: {work_order.work_order_number}",
            blocks=blocks
        )

    @staticmethod
    def wm_photo_upload_notification(
        job: Any,
        photo_url: str,
        photo_description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        is_new_job: bool = False
    ) -> SlackMessage:
        """
        Template for Water Mitigation photo upload notification from CompanyCam

        Args:
            job: Water mitigation job object
            photo_url: URL of uploaded photo
            photo_description: Photo description
            uploaded_by: Name of uploader
            is_new_job: Whether a new job was created

        Returns:
            Formatted Slack message
        """
        # Header
        header_text = "🏠 New Water Mitigation Job from CompanyCam" if is_new_job else "📸 Photo Added to Water Mitigation Job"

        blocks = [
            SlackBlock(
                type="header",
                text={
                    "type": "plain_text",
                    "text": header_text
                }
            )
        ]

        # Job details
        fields = [
            SlackBlockField(
                type="mrkdwn",
                text=f"*Property Address:*\n{job.property_address}"
            ),
            SlackBlockField(
                type="mrkdwn",
                text=f"*Status:*\n{job.status}"
            )
        ]

        if job.homeowner_name:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Homeowner:*\n{job.homeowner_name}"
            ))

        if job.claim_number:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Claim #:*\n{job.claim_number}"
            ))

        if job.insurance_company:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Insurance:*\n{job.insurance_company}"
            ))

        if uploaded_by:
            fields.append(SlackBlockField(
                type="mrkdwn",
                text=f"*Uploaded By:*\n{uploaded_by}"
            ))

        blocks.append(SlackBlock(type="section", fields=fields))

        # Photo description
        if photo_description:
            blocks.append(SlackBlock(
                type="section",
                text={
                    "type": "mrkdwn",
                    "text": f"*Photo Description:*\n{photo_description}"
                }
            ))

        # Photo image
        blocks.append(SlackBlock(
            type="image",
            image_url=photo_url,
            alt_text="Uploaded photo from CompanyCam"
        ))

        # Action buttons
        job_url = f"{settings.FRONTEND_URL}/water-mitigation/{job.id}"
        blocks.append(SlackBlock(
            type="actions",
            elements=[
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "View Job"
                    },
                    "url": job_url,
                    "style": "primary"
                }
            ]
        ))

        # Timestamp context
        blocks.append(SlackBlock(
            type="context",
            elements=[{
                "type": "mrkdwn",
                "text": f"_Received at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_"
            }]
        ))

        return SlackMessage(
            text=f"{header_text}: {job.property_address}",
            blocks=blocks
        )
