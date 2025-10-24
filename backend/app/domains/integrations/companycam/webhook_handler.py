"""
CompanyCam Webhook Handler

Processes incoming webhook events from CompanyCam:
- Photo upload events
- Work order matching
- Photo download and storage
- Slack notifications
"""

import logging
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from uuid import UUID

from .schemas import (
    PhotoCreatedWebhook,
    WorkOrderMatch,
    PhotoProcessingResult,
    AddressInfo
)
from .client import CompanyCamClient
from .utils import parse_companycam_address, match_addresses, extract_photo_filename
from ..models import WebhookEvent, CompanyCamPhoto
from ...work_order.service import WorkOrderService
from ...work_order.schemas import WorkOrderCreate
from ...file.service import FileService
from ..slack.client import SlackClient

logger = logging.getLogger(__name__)


class CompanyCamWebhookHandler:
    """
    Handler for CompanyCam webhook events
    """

    def __init__(self, db: Session):
        """
        Initialize webhook handler

        Args:
            db: Database session
        """
        self.db = db
        self.companycam_client = CompanyCamClient()
        self.work_order_service = WorkOrderService(db)
        self.file_service = FileService(db)
        self.slack_client = SlackClient()

    async def handle_photo_created(
        self,
        webhook_data: PhotoCreatedWebhook,
        webhook_event_id: Optional[UUID] = None
    ) -> PhotoProcessingResult:
        """
        Handle photo.created webhook event

        Workflow:
        1. Parse address from CompanyCam project
        2. Search for matching work order
        3. If match found: attach photo to existing work order
        4. If no match: create new work order with photo
        5. Send Slack notification
        6. Update webhook event status

        Args:
            webhook_data: Parsed webhook payload
            webhook_event_id: ID of webhook event record

        Returns:
            Processing result with status
        """
        logger.info(f"Processing photo.created event for photo {webhook_data.photo.id}")

        result = PhotoProcessingResult(
            success=False,
            photo_id=webhook_data.photo.id,
            work_order_match=WorkOrderMatch(matched=False, confidence=0.0)
        )

        try:
            # Step 1: Parse address from project
            address_info = parse_companycam_address(webhook_data.project)
            logger.info(f"Parsed address: {address_info.full_address}")

            if not address_info.is_complete:
                logger.warning(f"Incomplete address from project {webhook_data.project.id}")
                result.error_message = "Incomplete address information"
                return result

            # Step 2: Search for matching work order
            work_order_match = await self._find_matching_work_order(address_info)
            result.work_order_match = work_order_match

            # Step 3 & 4: Create or attach to work order
            if work_order_match.matched and work_order_match.work_order_id:
                # Attach photo to existing work order
                logger.info(f"Found matching work order: {work_order_match.work_order_number}")
                work_order_id = work_order_match.work_order_id

            else:
                # Create new work order for unmatched address
                logger.info(f"No matching work order found. Creating new work order.")
                work_order = await self._create_work_order_from_photo(
                    webhook_data,
                    address_info
                )
                work_order_id = work_order.id
                result.work_order_created = True
                result.work_order_match.work_order_id = work_order_id
                result.work_order_match.work_order_number = work_order.work_order_number

            # Step 5: Save photo metadata
            companycam_photo = await self._save_photo_metadata(
                webhook_data,
                address_info,
                work_order_id
            )

            # Step 6: Download and attach photo to work order
            try:
                await self._download_and_attach_photo(
                    webhook_data,
                    work_order_id,
                    companycam_photo.id
                )
                result.photo_downloaded = True
            except Exception as e:
                logger.error(f"Failed to download photo: {e}")
                # Continue even if download fails - we have the metadata

            # Step 7: Send Slack notification
            try:
                await self._send_slack_notification(
                    work_order_id,
                    webhook_data,
                    is_new_work_order=result.work_order_created
                )
                result.slack_notified = True
            except Exception as e:
                logger.error(f"Failed to send Slack notification: {e}")
                # Continue even if Slack fails

            # Step 8: Update webhook event status
            if webhook_event_id:
                self._update_webhook_event(
                    webhook_event_id,
                    status="processed",
                    related_entity_type="work_order",
                    related_entity_id=work_order_id
                )

            result.success = True
            logger.info(f"Successfully processed photo {webhook_data.photo.id}")

        except Exception as e:
            logger.error(f"Error processing photo webhook: {e}", exc_info=True)
            result.error_message = str(e)

            if webhook_event_id:
                self._update_webhook_event(
                    webhook_event_id,
                    status="failed",
                    error_message=str(e)
                )

        return result

    async def _find_matching_work_order(self, address_info: AddressInfo) -> WorkOrderMatch:
        """
        Find work order matching the address

        Args:
            address_info: Parsed address information

        Returns:
            Work order match result
        """
        # Get all active work orders
        work_orders = self.work_order_service.get_all(filters={"is_active": True})

        best_match = WorkOrderMatch(matched=False, confidence=0.0)

        for wo in work_orders:
            is_match, confidence, match_type = match_addresses(
                companycam_address=address_info,
                work_order_address=wo.job_site_address,
                work_order_city=wo.job_site_city,
                work_order_state=wo.job_site_state,
                work_order_zipcode=wo.job_site_zipcode
            )

            if is_match and confidence > best_match.confidence:
                best_match = WorkOrderMatch(
                    matched=True,
                    work_order_id=wo.id,
                    work_order_number=wo.work_order_number,
                    confidence=confidence,
                    match_type=match_type
                )

                # If exact match, stop searching
                if confidence >= 0.98:
                    break

        return best_match

    async def _create_work_order_from_photo(
        self,
        webhook_data: PhotoCreatedWebhook,
        address_info: AddressInfo
    ):
        """
        Create new work order from CompanyCam photo event

        Args:
            webhook_data: Webhook payload
            address_info: Parsed address

        Returns:
            Created work order
        """
        # Note: You'll need to provide required fields like company_id and created_by_staff_id
        # These should come from your configuration or default values

        work_order_data = WorkOrderCreate(
            client_name=webhook_data.project.name,
            job_site_address=address_info.street,
            job_site_city=address_info.city,
            job_site_state=address_info.state,
            job_site_zipcode=address_info.zipcode,
            work_description=f"Auto-created from CompanyCam photo upload by {webhook_data.user.name}",
            status="draft",
            document_type="PHOTO_UPLOAD",  # You may want to configure this
            # These fields need to be provided - configure as needed
            # company_id=UUID("..."),
            # created_by_staff_id=UUID("..."),
        )

        work_order = self.work_order_service.create(work_order_data)
        logger.info(f"Created new work order: {work_order.work_order_number}")

        return work_order

    async def _save_photo_metadata(
        self,
        webhook_data: PhotoCreatedWebhook,
        address_info: AddressInfo,
        work_order_id: UUID
    ) -> CompanyCamPhoto:
        """
        Save CompanyCam photo metadata to database

        Args:
            webhook_data: Webhook payload
            address_info: Parsed address
            work_order_id: Associated work order ID

        Returns:
            Saved CompanyCamPhoto record
        """
        photo_data = CompanyCamPhoto(
            companycam_photo_id=str(webhook_data.photo.id),
            companycam_project_id=str(webhook_data.project.id),
            companycam_project_name=webhook_data.project.name,
            work_order_id=work_order_id,
            photo_url=webhook_data.photo.uris.original,
            thumbnail_url=webhook_data.photo.uris.thumbnail,
            original_filename=extract_photo_filename(
                webhook_data.photo.uris.original,
                webhook_data.photo.id
            ),
            description=webhook_data.photo.photo_description,
            tags=webhook_data.photo.tags,
            coordinates=webhook_data.photo.coordinates.dict() if webhook_data.photo.coordinates else None,
            project_address=address_info.street,
            project_city=address_info.city,
            project_state=address_info.state,
            project_zipcode=address_info.zipcode,
            uploaded_by_name=webhook_data.user.name,
            uploaded_by_email=webhook_data.user.email_address,
            companycam_created_at=webhook_data.photo.created_at,
            is_synced=False
        )

        self.db.add(photo_data)
        self.db.commit()
        self.db.refresh(photo_data)

        logger.info(f"Saved photo metadata: {photo_data.id}")
        return photo_data

    async def _download_and_attach_photo(
        self,
        webhook_data: PhotoCreatedWebhook,
        work_order_id: UUID,
        companycam_photo_id: UUID
    ):
        """
        Download photo from CompanyCam and attach to work order

        Args:
            webhook_data: Webhook payload
            work_order_id: Work order ID to attach photo to
            companycam_photo_id: CompanyCamPhoto record ID
        """
        # Download photo from CompanyCam
        photo_bytes = await self.companycam_client.download_photo(
            webhook_data.photo.uris.original
        )

        # Generate filename
        filename = extract_photo_filename(
            webhook_data.photo.uris.original,
            webhook_data.photo.id
        )

        # Save to work order files
        # Note: Implement file attachment logic based on your file service
        # This is a placeholder - adjust based on your FileService implementation
        logger.info(f"Downloaded photo {filename}, ready to attach to work order {work_order_id}")

        # Update CompanyCamPhoto sync status
        companycam_photo = self.db.query(CompanyCamPhoto).filter(
            CompanyCamPhoto.id == companycam_photo_id
        ).first()

        if companycam_photo:
            companycam_photo.is_synced = True
            companycam_photo.synced_at = datetime.utcnow()
            self.db.commit()

    async def _send_slack_notification(
        self,
        work_order_id: UUID,
        webhook_data: PhotoCreatedWebhook,
        is_new_work_order: bool
    ):
        """
        Send Slack notification for photo upload

        Args:
            work_order_id: Work order ID
            webhook_data: Webhook payload
            is_new_work_order: Whether a new work order was created
        """
        # Get work order details
        work_order = self.work_order_service.get_by_id(work_order_id)

        if not work_order:
            logger.warning(f"Work order {work_order_id} not found for Slack notification")
            return

        # Send notification via Slack client
        await self.slack_client.notify_photo_upload(
            work_order=work_order,
            photo_url=webhook_data.photo.uris.large or webhook_data.photo.uris.original,
            photo_description=webhook_data.photo.photo_description,
            uploaded_by=webhook_data.user.name,
            is_new_work_order=is_new_work_order
        )

    def _update_webhook_event(
        self,
        webhook_event_id: UUID,
        status: str,
        error_message: Optional[str] = None,
        related_entity_type: Optional[str] = None,
        related_entity_id: Optional[UUID] = None
    ):
        """
        Update webhook event status

        Args:
            webhook_event_id: Webhook event ID
            status: New status
            error_message: Error message if failed
            related_entity_type: Type of related entity
            related_entity_id: ID of related entity
        """
        webhook_event = self.db.query(WebhookEvent).filter(
            WebhookEvent.id == webhook_event_id
        ).first()

        if webhook_event:
            webhook_event.status = status
            webhook_event.processed_at = datetime.utcnow()

            if error_message:
                webhook_event.error_message = error_message

            if related_entity_type:
                webhook_event.related_entity_type = related_entity_type

            if related_entity_id:
                webhook_event.related_entity_id = related_entity_id

            self.db.commit()
