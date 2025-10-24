"""
CompanyCam Webhook Handler for Water Mitigation Jobs

Processes incoming webhook events from CompanyCam:
- Photo upload events
- Water mitigation job matching
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
from ...water_mitigation.service import WaterMitigationService
from ...water_mitigation.schemas import WaterMitigationJobCreate
from ..slack.client import SlackClient

logger = logging.getLogger(__name__)


class CompanyCamWaterMitigationHandler:
    """
    Handler for CompanyCam webhook events for Water Mitigation
    """

    def __init__(self, db: Session):
        """
        Initialize webhook handler

        Args:
            db: Database session
        """
        self.db = db
        self.companycam_client = CompanyCamClient()
        self.wm_service = WaterMitigationService(db)
        self.slack_client = SlackClient()

    async def handle_photo_created(
        self,
        webhook_data: PhotoCreatedWebhook,
        webhook_event_id: Optional[UUID] = None
    ) -> PhotoProcessingResult:
        """
        Handle photo.created webhook event for Water Mitigation

        Workflow:
        1. Parse address from CompanyCam project
        2. Search for matching water mitigation job
        3. If match found: attach photo to existing job
        4. If no match: create new water mitigation job with photo
        5. Send Slack notification
        6. Update webhook event status

        Args:
            webhook_data: Parsed webhook payload
            webhook_event_id: ID of webhook event record

        Returns:
            Processing result with status
        """
        logger.info(f"Processing photo.created event for Water Mitigation: photo {webhook_data.photo.id}")

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

            # Step 2: Search for matching water mitigation job
            job_match = await self._find_matching_job(address_info, str(webhook_data.project.id))
            result.work_order_match = job_match  # Reusing work_order_match for consistency

            # Step 3 & 4: Create or attach to job
            if job_match.matched and job_match.work_order_id:
                # Attach photo to existing job
                logger.info(f"Found matching water mitigation job: {job_match.work_order_number}")
                job_id = job_match.work_order_id

            else:
                # Create new water mitigation job for unmatched address
                logger.info(f"No matching job found. Creating new water mitigation job.")
                job = await self._create_job_from_photo(
                    webhook_data,
                    address_info
                )
                job_id = job.id
                result.work_order_created = True
                result.work_order_match.work_order_id = job_id
                # Water mitigation jobs don't have job numbers by default

            # Step 5: Save photo metadata
            companycam_photo = await self._save_photo_metadata(
                webhook_data,
                address_info,
                job_id
                )

            # Step 6: Download and attach photo to job
            try:
                await self._download_and_attach_photo(
                    webhook_data,
                    job_id,
                    companycam_photo.id
                )
                result.photo_downloaded = True
            except Exception as e:
                logger.error(f"Failed to download photo: {e}")
                # Continue even if download fails - we have the metadata

            # Step 7: Send Slack notification
            try:
                await self._send_slack_notification(
                    job_id,
                    webhook_data,
                    is_new_job=result.work_order_created
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
                    related_entity_type="water_mitigation_job",
                    related_entity_id=job_id
                )

            result.success = True
            logger.info(f"Successfully processed photo {webhook_data.photo.id} for water mitigation")

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

    async def _find_matching_job(
        self,
        address_info: AddressInfo,
        companycam_project_id: str
    ) -> WorkOrderMatch:
        """
        Find water mitigation job matching the address or CompanyCam project ID

        Args:
            address_info: Parsed address information
            companycam_project_id: CompanyCam project ID

        Returns:
            Job match result
        """
        # First, try to find by companycam_project_id (exact match)
        job_by_project = self.wm_service.get_by_companycam_project(companycam_project_id)
        if job_by_project:
            logger.info(f"Found exact match by CompanyCam project ID: {companycam_project_id}")
            return WorkOrderMatch(
                matched=True,
                work_order_id=job_by_project.id,
                work_order_number=None,  # WM jobs don't have numbers
                confidence=1.0,
                match_type="exact_project_id"
            )

        # Get all active water mitigation jobs
        jobs = self.wm_service.get_all(filters={"active": True})

        best_match = WorkOrderMatch(matched=False, confidence=0.0)

        for job in jobs:
            is_match, confidence, match_type = match_addresses(
                companycam_address=address_info,
                work_order_address=job.property_address,
                work_order_city=None,  # WM jobs have full address in property_address
                work_order_state=None,
                work_order_zipcode=None
            )

            if is_match and confidence > best_match.confidence:
                best_match = WorkOrderMatch(
                    matched=True,
                    work_order_id=job.id,
                    work_order_number=None,
                    confidence=confidence,
                    match_type=match_type
                )

                # If exact match, stop searching
                if confidence >= 0.98:
                    break

        return best_match

    async def _create_job_from_photo(
        self,
        webhook_data: PhotoCreatedWebhook,
        address_info: AddressInfo
    ):
        """
        Create new water mitigation job from CompanyCam photo event

        Args:
            webhook_data: Webhook payload
            address_info: Parsed address

        Returns:
            Created water mitigation job
        """
        # Build full property address
        property_address = address_info.full_address

        job_data = WaterMitigationJobCreate(
            property_address=property_address,
            homeowner_name=webhook_data.project.name,
            status="Lead",  # Default status for new jobs
            active=True,
            companycam_project_id=str(webhook_data.project.id),
            # Optional fields from webhook
            # client_id=UUID("..."),  # Set from configuration or user context
        )

        job = self.wm_service.create(job_data)
        logger.info(f"Created new water mitigation job: {job.id}")

        return job

    async def _save_photo_metadata(
        self,
        webhook_data: PhotoCreatedWebhook,
        address_info: AddressInfo,
        job_id: UUID
    ) -> CompanyCamPhoto:
        """
        Save CompanyCam photo metadata to database

        Args:
            webhook_data: Webhook payload
            address_info: Parsed address
            job_id: Associated water mitigation job ID

        Returns:
            Saved CompanyCamPhoto record
        """
        photo_data = CompanyCamPhoto(
            companycam_photo_id=str(webhook_data.photo.id),
            companycam_project_id=str(webhook_data.project.id),
            companycam_project_name=webhook_data.project.name,
            water_mitigation_job_id=job_id,
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
        job_id: UUID,
        companycam_photo_id: UUID
    ):
        """
        Download photo from CompanyCam and attach to water mitigation job

        Args:
            webhook_data: Webhook payload
            job_id: Water mitigation job ID
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

        # Save photo to water mitigation job
        # Use WaterMitigationService to create WMPhoto entry
        from ...water_mitigation.schemas import WMPhotoCreate

        photo_create = WMPhotoCreate(
            job_id=job_id,
            source="companycam",
            external_id=str(webhook_data.photo.id),
            file_name=filename,
            file_path=f"uploads/water_mitigation/{job_id}/{filename}",  # Adjust based on your storage
            title=webhook_data.photo.photo_description or "CompanyCam Photo",
            description=webhook_data.photo.photo_description,
            captured_date=webhook_data.photo.captured_at or webhook_data.photo.created_at,
            file_type="photo",
            mime_type="image/jpeg"
        )

        # Save photo bytes to file system or cloud storage
        # TODO: Implement actual file storage based on your file service
        logger.info(f"Downloaded photo {filename}, creating WMPhoto entry for job {job_id}")

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
        job_id: UUID,
        webhook_data: PhotoCreatedWebhook,
        is_new_job: bool
    ):
        """
        Send Slack notification for photo upload

        Args:
            job_id: Water mitigation job ID
            webhook_data: Webhook payload
            is_new_job: Whether a new job was created
        """
        # Get job details
        job = self.wm_service.get_by_id(job_id)

        if not job:
            logger.warning(f"Water mitigation job {job_id} not found for Slack notification")
            return

        # Send notification via Slack client
        await self.slack_client.notify_wm_photo_upload(
            job=job,
            photo_url=webhook_data.photo.uris.large or webhook_data.photo.uris.original,
            photo_description=webhook_data.photo.photo_description,
            uploaded_by=webhook_data.user.name,
            is_new_job=is_new_job
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
