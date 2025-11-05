"""
CompanyCam Webhook Handler for Water Mitigation Jobs

Processes incoming webhook events from CompanyCam:
- Photo upload events
- Water mitigation job matching
- Photo download and storage
- Slack notifications
"""

import logging
import asyncio
from typing import Optional, Dict
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from uuid import UUID

from .schemas import (
    PhotoCreatedWebhook,
    ProjectCreatedWebhook,
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

    Implements smart batch notification:
    - Tracks photos uploaded to each job
    - Sends notification once per 5-minute window
    - Includes count of all photos uploaded during that window
    """

    # Class-level tracking for photo batch notifications
    # Format: {job_id: {'last_notification': datetime, 'pending_photos': list}}
    _photo_batches: Dict[str, Dict] = {}
    _notification_cooldown_minutes = 5
    _batch_window_seconds = 3  # Wait 3 seconds to collect batch uploads

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

    def _should_send_photo_notification(self, job_id: UUID) -> tuple[bool, int]:
        """
        Check if we should send a Slack notification for this photo upload.
        Implements smart batching with delayed aggregation:
        - First photo: schedule delayed notification (3 seconds)
        - Subsequent photos: add to pending, delayed task will send all
        - Cooldown: wait N minutes before next batch

        Strategy:
        - First photo in batch: start async delay, return False (don't send now)
        - Subsequent photos within batch window: accumulate, return False
        - Delayed task: send notification with all accumulated photos

        Args:
            job_id: Water mitigation job ID

        Returns:
            Tuple of (should_send_immediately, photo_count) - always (False, 0) now
        """
        job_id_str = str(job_id)
        now = datetime.utcnow()

        # Get or create batch tracking for this job
        if job_id_str not in self._photo_batches:
            self._photo_batches[job_id_str] = {
                'last_notification': None,
                'pending_photos': [],
                'last_photo_time': None,
                'delayed_task': None  # Track async task
            }

        batch = self._photo_batches[job_id_str]

        # Check main cooldown first
        last_notif = batch.get('last_notification')
        if last_notif:
            cooldown_elapsed = now - last_notif
            if cooldown_elapsed < timedelta(minutes=self._notification_cooldown_minutes):
                # Still in main cooldown period - don't schedule anything
                logger.info(f"Photo added to job {job_id}, in cooldown period")
                return False, 0

        # Add current photo to pending list
        batch['pending_photos'].append(now)
        batch['last_photo_time'] = now

        # Cancel existing task if any (we'll restart the timer)
        existing_task = batch.get('delayed_task')
        if existing_task and not existing_task.done():
            existing_task.cancel()
            logger.info(f"Cancelled previous notification task for job {job_id} - restarting timer")

        # Always start a new delayed notification task
        # This ensures we wait 3 seconds after the LAST photo, not the first
        task = asyncio.create_task(
            self._send_delayed_batch_notification(job_id, delay_seconds=self._batch_window_seconds)
        )
        batch['delayed_task'] = task
        logger.info(f"Started delayed notification task for job {job_id} ({self._batch_window_seconds}s delay, {len(batch['pending_photos'])} photo(s) pending)")

        # Never send immediately - always wait for delayed task
        return False, 0

    def _cleanup_old_batches(self):
        """Clean up old batch tracking data to prevent memory leaks"""
        now = datetime.utcnow()
        cutoff = now - timedelta(hours=1)  # Keep last 1 hour of data

        to_remove = []
        for job_id, batch in self._photo_batches.items():
            last_notif = batch.get('last_notification')
            if last_notif and last_notif < cutoff and not batch['pending_photos']:
                to_remove.append(job_id)

        for job_id in to_remove:
            del self._photo_batches[job_id]

    async def _send_delayed_batch_notification(self, job_id: UUID, delay_seconds: int = 3):
        """
        Send batched photo notification after a delay.
        This allows collecting multiple photos uploaded in quick succession.

        Args:
            job_id: Water mitigation job ID
            delay_seconds: Seconds to wait before sending notification
        """
        db_session = None
        try:
            # Wait for the batch window to collect photos
            await asyncio.sleep(delay_seconds)

            job_id_str = str(job_id)

            # Check if there are pending photos to notify
            if job_id_str not in self._photo_batches:
                return

            batch = self._photo_batches[job_id_str]
            pending_photos = batch.get('pending_photos', [])

            if not pending_photos:
                return

            # Check cooldown
            last_notif = batch.get('last_notification')
            now = datetime.utcnow()
            if last_notif:
                cooldown_elapsed = now - last_notif
                if cooldown_elapsed < timedelta(minutes=self._notification_cooldown_minutes):
                    logger.info(f"Delayed notification skipped for job {job_id} - in cooldown period")
                    return

            # Create new DB session for this async task (original session is closed)
            from ....core.database_factory import get_database
            db = get_database()
            db_session = db.get_session()

            # Create new service instance with new session
            wm_service = WaterMitigationService(db_session)

            # Send notification with all accumulated photos
            photo_count = len(pending_photos)
            job = wm_service.get_by_id(job_id)

            if job:
                from ..slack.schemas import SlackMessage, SlackBlock

                # Handle both dict and model object
                property_address = job.get('property_address') if isinstance(job, dict) else job.property_address
                status = job.get('status') if isinstance(job, dict) else job.status
                created_at = job.get('created_at') if isinstance(job, dict) else job.created_at

                # Parse string to datetime if needed
                from datetime import timezone
                if isinstance(created_at, str):
                    from dateutil import parser
                    created_at = parser.parse(created_at)

                # Make sure both datetimes are timezone-aware for comparison
                now_tz = datetime.now(timezone.utc)
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)

                # Check if this is a newly created job (within last 2 minutes)
                is_new_job = (now_tz - created_at) < timedelta(minutes=2)

                if is_new_job:
                    # New lead created message
                    photo_text = f"with {photo_count} photo{'s' if photo_count > 1 else ''}" if photo_count > 1 else "with 1 photo"
                    slack_message = SlackMessage(
                        text=f"🆕 New Water Mitigation Lead Created",
                        blocks=[
                            SlackBlock(
                                type="section",
                                text={
                                    "type": "mrkdwn",
                                    "text": f"*New Lead from CompanyCam*\n"
                                           f"• Address: {property_address}\n"
                                           f"• Status: {status}\n"
                                           f"• Photos: {photo_text}"
                                }
                            )
                        ]
                    )
                else:
                    # Photo uploaded to existing job
                    photo_text = f"{photo_count} new photo{'s' if photo_count > 1 else ''}" if photo_count > 1 else "New photo"
                    slack_message = SlackMessage(
                        text=f"📸 {photo_text} added to Water Mitigation Job",
                        blocks=[
                            SlackBlock(
                                type="section",
                                text={
                                    "type": "mrkdwn",
                                    "text": f"*{photo_text} uploaded*\n"
                                           f"• Job Address: {property_address}\n"
                                           f"• Status: {status}\n"
                                           f"• Total Photos: {photo_count}"
                                }
                            )
                        ]
                    )

                success = await self.slack_client.send_message(slack_message)

                if success:
                    msg_type = "new lead" if is_new_job else f"{photo_count} photo(s)"
                    logger.info(f"✅ Sent delayed batched Slack notification for {msg_type} to job {job_id}")

                    # Update batch tracking
                    batch['last_notification'] = now
                    batch['pending_photos'] = []
                    batch['last_photo_time'] = None
                else:
                    logger.warning(f"⚠️ Failed to send delayed Slack notification for job {job_id}")

        except Exception as e:
            logger.error(f"Failed to send delayed batch notification: {e}", exc_info=True)
        finally:
            # Clean up DB session
            if db_session:
                db_session.close()
                logger.debug(f"Closed DB session for delayed batch notification task (job {job_id})")

    async def handle_project_created(
        self,
        webhook_data: ProjectCreatedWebhook,
        webhook_event_id: Optional[UUID] = None
    ) -> dict:
        """
        Handle project.created webhook event for Water Mitigation

        When a new project is created in CompanyCam, create a Water Mitigation Lead.

        Args:
            webhook_data: Parsed webhook payload
            webhook_event_id: ID of webhook event record

        Returns:
            Processing result with status
        """
        logger.info(f"Processing project.created event: project {webhook_data.project.id}")

        result = {
            "success": False,
            "job_id": None,
            "job_created": False,
            "error_message": None
        }

        try:
            # Check if job already exists for this project
            companycam_project_id = str(webhook_data.project.id)
            existing_job = self.wm_service.get_by_companycam_project(companycam_project_id)

            if existing_job:
                logger.info(f"Job already exists for project {companycam_project_id}: {existing_job.id}")
                result["success"] = True
                result["job_id"] = str(existing_job.id)
                result["job_created"] = False
                return result

            # Parse address from payload.project.address
            address_info = parse_companycam_address(webhook_data.project)

            # Use address from project.address field (NOT project.name)
            # project.name is a custom name, not the address
            if address_info.full_address:
                property_address = address_info.full_address
            else:
                # Fallback if no address provided
                property_address = f"Project {companycam_project_id}"

            # Create Water Mitigation Lead with separated address fields
            # homeowner_name gets the project.name (which is NOT the address)
            job_data = WaterMitigationJobCreate(
                property_address=property_address,
                property_street=address_info.street if address_info.street else None,
                property_city=address_info.city if address_info.city else None,
                property_state=address_info.state if address_info.state else None,
                property_zipcode=address_info.zipcode if address_info.zipcode else None,
                homeowner_name=webhook_data.project.name,  # This is the project name, not address
                status="Lead",  # Default status for new projects
                active=True,
                companycam_project_id=companycam_project_id,
            )

            job = self.wm_service.create(job_data)

            # Handle both dict and model object
            job_id = job.get('id') if isinstance(job, dict) else job.id
            logger.info(f"Created Water Mitigation Lead: {job_id} for project {companycam_project_id}")

            result["success"] = True
            result["job_id"] = str(job_id)
            result["job_created"] = True

            # Fetch and process photos from the newly created project
            photos_processed = 0
            try:
                logger.info(f"Fetching photos for project {companycam_project_id}")
                photos = await self.companycam_client.get_project_photos(int(companycam_project_id))

                if photos:
                    logger.info(f"Found {len(photos)} photos in project {companycam_project_id}")

                    for photo in photos:
                        try:
                            # Convert raw photo data to PhotoCreatedWebhook format
                            photo_webhook = self._convert_to_photo_webhook(
                                photo,
                                webhook_data.project.dict(),
                                {"user": {"id": webhook_data.project.creator_id, "name": webhook_data.project.creator_name or "Unknown"}}
                            )

                            # Process the photo
                            await self.handle_photo_created(photo_webhook, None)
                            photos_processed += 1

                        except Exception as e:
                            logger.error(f"Failed to process photo {photo.get('id')}: {e}")

                    logger.info(f"Successfully processed {photos_processed} photos for project {companycam_project_id}")
                    result["photos_processed"] = photos_processed
                else:
                    logger.info(f"No photos found in project {companycam_project_id}")
                    result["photos_processed"] = 0

            except Exception as e:
                logger.error(f"Failed to fetch/process photos for project {companycam_project_id}: {e}")
                result["photos_processed"] = 0

            # Update webhook event status
            if webhook_event_id:
                self._update_webhook_event(
                    webhook_event_id,
                    status="completed",
                    error_message=None
                )

            # Send Slack notification only if no photos were processed
            # (If photos exist, delayed batch notification will send combined message)
            if photos_processed == 0:
                try:
                    from ..slack.schemas import SlackMessage, SlackBlock

                    slack_message = SlackMessage(
                        text=f"🆕 New Water Mitigation Lead Created",
                        blocks=[
                            SlackBlock(
                                type="section",
                                text={
                                    "type": "mrkdwn",
                                    "text": f"*New Lead from CompanyCam*\n"
                                           f"• Project: {webhook_data.project.name or 'Unnamed'}\n"
                                           f"• Address: {property_address}\n"
                                           f"• Status: Lead\n"
                                           f"• CompanyCam Project ID: {companycam_project_id}"
                                }
                            )
                        ]
                    )

                    success = await self.slack_client.send_message(slack_message)
                    if success:
                        logger.info("✅ Sent Slack notification for new lead (no photos)")
                    else:
                        logger.warning("⚠️ Failed to send Slack notification for new lead")

                except Exception as e:
                    logger.error(f"Failed to send Slack notification: {e}", exc_info=True)
            else:
                logger.info(f"⏭️ Skipping project.created Slack notification - {photos_processed} photo(s) processed, delayed batch notification will handle it")

        except Exception as e:
            logger.error(f"Error processing project.created webhook: {e}", exc_info=True)
            result["error_message"] = str(e)

            if webhook_event_id:
                self._update_webhook_event(
                    webhook_event_id,
                    status="failed",
                    error_message=str(e)
                )

        return result

    async def handle_project_updated(
        self,
        webhook_data: dict,
        webhook_event_id: Optional[UUID] = None
    ) -> PhotoProcessingResult:
        """
        Handle project.updated webhook event for Water Mitigation

        This event fires when a project is updated, including when photos are saved.
        We fetch the latest photos from the project to process them.

        Workflow:
        1. Extract project info from webhook
        2. Fetch latest photos from CompanyCam API
        3. Process only new photos (not already in our database)
        4. Create/update water mitigation job
        5. Send Slack notifications

        Args:
            webhook_data: Raw webhook payload dict
            webhook_event_id: ID of webhook event record

        Returns:
            Processing result with status
        """
        logger.info(f"Processing project.updated event for Water Mitigation")

        result = PhotoProcessingResult(
            success=False,
            work_order_match=WorkOrderMatch(matched=False, confidence=0.0)
        )

        try:
            # Extract project info
            project_data = webhook_data.get("payload", {}).get("project", {})
            project_id = project_data.get("id")

            if not project_id:
                logger.warning("No project ID in webhook payload")
                result.error_message = "No project ID in webhook"
                return result

            logger.info(f"Project updated: {project_id}")

            # Fetch latest photos from CompanyCam API (convert to int)
            photos = await self.companycam_client.get_project_photos(int(project_id))

            if not photos:
                logger.info(f"No photos found for project {project_id}")
                result.success = True
                return result

            # Process only new photos (not already synced)
            new_photos = []
            for photo in photos:
                photo_id = str(photo.get("id"))
                existing = self.db.query(CompanyCamPhoto).filter(
                    CompanyCamPhoto.companycam_photo_id == photo_id
                ).first()

                if not existing:
                    new_photos.append(photo)

            logger.info(f"Found {len(new_photos)} new photos out of {len(photos)} total")

            # Process each new photo
            for photo in new_photos:
                try:
                    # Convert raw photo data to PhotoCreatedWebhook format
                    photo_webhook = self._convert_to_photo_webhook(photo, project_data, webhook_data)
                    await self.handle_photo_created(photo_webhook, webhook_event_id)
                except Exception as e:
                    logger.error(f"Error processing photo {photo.get('id')}: {e}")

            result.success = True

        except Exception as e:
            logger.error(f"Error processing project.updated webhook: {e}", exc_info=True)
            result.error_message = str(e)

            if webhook_event_id:
                self._update_webhook_event(
                    webhook_event_id,
                    status="failed",
                    error_message=str(e)
                )

        return result

    def _convert_to_photo_webhook(self, photo: dict, project: dict, webhook_data: dict) -> PhotoCreatedWebhook:
        """
        Convert raw API photo data to PhotoCreatedWebhook format

        Args:
            photo: Photo data from API
            project: Project data
            webhook_data: Original webhook data for user info

        Returns:
            PhotoCreatedWebhook object
        """
        from .schemas import (
            PhotoData, ProjectData, UserData,
            PhotoCoordinates, PhotoURIs
        )

        # Build PhotoCreatedWebhook structure
        return PhotoCreatedWebhook(
            photo=PhotoData(
                id=photo.get("id"),
                uris=PhotoURIs(
                    original=photo.get("uris", {}).get("original"),
                    large=photo.get("uris", {}).get("large"),
                    thumbnail=photo.get("uris", {}).get("thumbnail")
                ),
                photo_description=photo.get("photo_description"),
                tags=photo.get("tags", []),
                coordinates=PhotoCoordinates(**photo["coordinates"]) if photo.get("coordinates") else None,
                created_at=photo.get("created_at"),
                captured_at=photo.get("captured_at")
            ),
            project=ProjectData(
                id=project.get("id"),
                name=project.get("name"),
                address=project.get("address", {}),
                coordinates=project.get("coordinates")
            ),
            user=UserData(
                id=webhook_data.get("user", {}).get("id"),
                name=webhook_data.get("user", {}).get("name", "Unknown"),
                email_address=webhook_data.get("user", {}).get("email_address")
            )
        )

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
            # Step 1: Get project ID
            companycam_project_id = str(webhook_data.project.id)

            # Step 2: Try to find existing job by CompanyCam project ID first
            job_by_project = self.wm_service.get_by_companycam_project(companycam_project_id)

            if job_by_project:
                # Found existing job by project ID
                logger.info(f"Found existing job by CompanyCam project ID: {companycam_project_id}")
                job_id = job_by_project.id
                result.work_order_match = WorkOrderMatch(
                    matched=True,
                    work_order_id=job_id,
                    work_order_number=None,
                    confidence=1.0,
                    match_type="exact_project_id"
                )
            else:
                # No existing job found by project ID
                # Fetch full project details from CompanyCam API to get address
                logger.info(f"No existing job found. Fetching project details from CompanyCam API...")

                try:
                    project_details = await self.companycam_client.get_project(int(companycam_project_id))
                    if not project_details:
                        logger.error(f"Failed to fetch project {companycam_project_id} from CompanyCam API")
                        result.error_message = "Failed to fetch project details from CompanyCam"
                        return result

                    # Parse address from fetched project details
                    from .schemas import ProjectData
                    project_obj = ProjectData(**project_details)
                    address_info = parse_companycam_address(project_obj)
                    logger.info(f"Parsed address from API: {address_info.full_address}")

                except Exception as e:
                    logger.error(f"Error fetching project from CompanyCam: {e}")
                    result.error_message = f"Error fetching project: {str(e)}"
                    return result

                if not address_info.is_complete:
                    logger.warning(f"Incomplete address from project {companycam_project_id} and no existing job found")
                    result.error_message = "Incomplete address information and no existing job"
                    return result

                # Try to find by address matching
                job_match = await self._find_matching_job(address_info, companycam_project_id)
                result.work_order_match = job_match

                if job_match.matched and job_match.work_order_id:
                    # Found job by address matching
                    logger.info(f"Found matching water mitigation job by address")
                    job_id = job_match.work_order_id
                else:
                    # Create new water mitigation job
                    logger.info(f"No matching job found. Creating new water mitigation job.")
                    job = await self._create_job_from_photo(
                        webhook_data,
                        address_info
                    )
                    # Handle both dict and model object
                    job_id = job.get('id') if isinstance(job, dict) else job.id
                    result.work_order_created = True
                    result.work_order_match.work_order_id = job_id

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

            # Step 7: Smart batch notification (send once per 5-minute window)
            try:
                should_send, photo_count = self._should_send_photo_notification(job_id)

                if should_send:
                    # Send batched notification with photo count
                    job = self.wm_service.get_by_id(job_id)
                    if job:
                        from ..slack.schemas import SlackMessage, SlackBlock

                        # Handle both dict and model object
                        property_address = job.get('property_address') if isinstance(job, dict) else job.property_address
                        status = job.get('status') if isinstance(job, dict) else job.status
                        created_at = job.get('created_at') if isinstance(job, dict) else job.created_at

                        # Parse string to datetime if needed
                        from datetime import datetime, timedelta, timezone
                        if isinstance(created_at, str):
                            from dateutil import parser
                            created_at = parser.parse(created_at)

                        # Make sure both datetimes are timezone-aware for comparison
                        now = datetime.now(timezone.utc)
                        if created_at.tzinfo is None:
                            # If created_at is naive, assume it's UTC
                            created_at = created_at.replace(tzinfo=timezone.utc)

                        # Check if this is a newly created job (within last 2 minutes)
                        is_new_job = (now - created_at) < timedelta(minutes=2)

                        if is_new_job:
                            # New lead created message
                            photo_text = f"with {photo_count} photo{'s' if photo_count > 1 else ''}" if photo_count > 1 else "with 1 photo"
                            slack_message = SlackMessage(
                                text=f"🆕 New Water Mitigation Lead Created",
                                blocks=[
                                    SlackBlock(
                                        type="section",
                                        text={
                                            "type": "mrkdwn",
                                            "text": f"*New Lead from CompanyCam*\n"
                                                   f"• Address: {property_address}\n"
                                                   f"• Status: {status}\n"
                                                   f"• Photos: {photo_text}"
                                        }
                                    )
                                ]
                            )
                        else:
                            # Photo uploaded to existing job
                            photo_text = f"{photo_count} new photo{'s' if photo_count > 1 else ''}" if photo_count > 1 else "New photo"
                            slack_message = SlackMessage(
                                text=f"📸 {photo_text} added to Water Mitigation Job",
                                blocks=[
                                    SlackBlock(
                                        type="section",
                                        text={
                                            "type": "mrkdwn",
                                            "text": f"*{photo_text} uploaded*\n"
                                                   f"• Job Address: {property_address}\n"
                                                   f"• Status: {status}\n"
                                                   f"• Total Photos: {photo_count}"
                                        }
                                    )
                                ]
                            )

                        success = await self.slack_client.send_message(slack_message)
                        result.slack_notified = success

                        if success:
                            msg_type = "new lead" if is_new_job else f"{photo_count} photo(s)"
                            logger.info(f"✅ Sent batched Slack notification for {msg_type} to job {job_id}")
                        else:
                            logger.warning(f"⚠️ Failed to send Slack notification for job {job_id}")
                else:
                    logger.info(f"Photo added to job {job_id}, notification in cooldown period")

                # Cleanup old batch data periodically
                self._cleanup_old_batches()

            except Exception as e:
                logger.error(f"Failed to send batched Slack notification: {e}", exc_info=True)

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

        # Handle both dict and model object
        job_id = job.get('id') if isinstance(job, dict) else job.id
        logger.info(f"Created new water mitigation job: {job_id}")

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
        try:
            # Download photo from CompanyCam
            photo_bytes = await self.companycam_client.download_photo(
                webhook_data.photo.uris.original
            )

            # Generate filename
            filename = extract_photo_filename(
                webhook_data.photo.uris.original,
                webhook_data.photo.id
            )

            # Parse captured date
            captured_date = None
            if webhook_data.photo.captured_at:
                try:
                    from dateutil import parser
                    captured_date = parser.parse(webhook_data.photo.captured_at)
                except Exception as e:
                    logger.warning(f"Failed to parse captured_at date: {e}")

            # Save photo to water mitigation job
            wm_photo = await self.wm_service.save_companycam_photo(
                job_id=job_id,
                photo_bytes=photo_bytes,
                filename=filename,
                companycam_photo_id=str(webhook_data.photo.id),
                mime_type='image/jpeg',  # CompanyCam photos are typically JPEG
                title=webhook_data.photo.photo_description,
                description=webhook_data.photo.photo_description,
                captured_date=captured_date
            )

            logger.info(f"Successfully saved CompanyCam photo {webhook_data.photo.id} to WM job {job_id}")

            # Update CompanyCamPhoto sync status
            companycam_photo = self.db.query(CompanyCamPhoto).filter(
                CompanyCamPhoto.id == companycam_photo_id
            ).first()

            if companycam_photo:
                companycam_photo.is_synced = True
                companycam_photo.synced_at = datetime.utcnow()
                self.db.commit()

        except Exception as e:
            logger.error(f"Failed to download and attach photo: {e}", exc_info=True)
            raise

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
