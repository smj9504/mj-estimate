"""
Crew Upload service - business logic
Context-agnostic: works with water-mitigation, work-order, or any future context.
"""

import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import BinaryIO, Optional

from sqlalchemy import select

from app.domains.storage import StorageFactory
from app.domains.file.models import File

from .models import UploadLink, UploadSession
from .repository import UploadLinkRepository, UploadSessionRepository
from .schemas import UploadLinkCreateRequest

logger = logging.getLogger(__name__)


def _get_address_for_context(db, context: str, context_id: str) -> Optional[str]:
    """Look up a human-readable address/name for any supported context."""
    try:
        if context == 'water-mitigation':
            from app.domains.water_mitigation.models import WaterMitigationJob
            result = db.execute(
                select(WaterMitigationJob.property_address)
                .where(WaterMitigationJob.id == context_id)
            )
            row = result.first()
            return row[0] if row else None

        elif context == 'work-order':
            from app.domains.work_order.models import WorkOrder
            result = db.execute(
                select(WorkOrder.job_site_address)
                .where(WorkOrder.id == context_id)
            )
            row = result.first()
            return row[0] if row else None

    except Exception as e:
        logger.warning(f"Failed to get address for {context}/{context_id}: {e}")

    return None


class CrewUploadService:
    def __init__(self, db):
        self.db = db
        self.link_repo = UploadLinkRepository(db)
        self.session_repo = UploadSessionRepository(db)

    # ===== Link Management (Admin) =====

    def create_link(
        self,
        request: UploadLinkCreateRequest,
        company_id: str,
        created_by_id: str,
    ) -> UploadLink:
        link = UploadLink(
            id=str(uuid.uuid4()),
            context=request.context,
            context_id=request.context_id,
            company_id=company_id,
            label=request.label,
            crew_name=request.crew_name,
            max_files=request.max_files,
            expires_at=datetime.now(timezone.utc) + timedelta(days=request.expires_in_days),
            created_by_id=created_by_id,
        )
        return self.link_repo.create(link)

    def get_links_for_job(self, context: str, context_id: str):
        return self.link_repo.get_by_context(context, context_id)

    def deactivate_link(self, link_id: str):
        self.link_repo.deactivate(link_id)
        self.db.commit()

    # ===== Public Upload Flow =====

    def validate_link(self, token: str) -> Optional[dict]:
        """Validate an upload link and return job info (any context)"""
        link = self.link_repo.get_active_by_token(token)
        if not link:
            return None

        self.link_repo.update_access(link.id)

        # Get address from the appropriate model
        address = _get_address_for_context(self.db, link.context, str(link.context_id))

        self.db.commit()

        return {
            "valid": True,
            "property_address": address,
            "job_id": str(link.context_id),
            "context": link.context,
            "label": link.label,
            "crew_name": link.crew_name,
            "max_files": link.max_files,
            "max_file_size_mb": link.max_file_size_mb,
            "upload_count": link.upload_count,
            "expires_at": link.expires_at,
            "link_id": str(link.id),
        }

    def create_session(
        self,
        token: str,
        total_files: int,
        device_info: Optional[str] = None,
    ) -> Optional[UploadSession]:
        link = self.link_repo.get_active_by_token(token)
        if not link:
            return None

        session = UploadSession(
            id=str(uuid.uuid4()),
            link_id=link.id,
            total_files=total_files,
            device_info=device_info,
        )
        session = self.session_repo.create(session)
        self.db.commit()
        return session

    def get_session_status(self, session_token: str) -> Optional[UploadSession]:
        return self.session_repo.get_by_token(session_token)

    def upload_file(
        self,
        token: str,
        session_token: str,
        file_data: BinaryIO,
        filename: str,
        content_type: str,
        file_size: int,
        fingerprint: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        captured_at: Optional[datetime] = None,
        device_model: Optional[str] = None,
    ) -> Optional[dict]:
        """Upload a single file from crew (any context)"""
        link = self.link_repo.get_active_by_token(token)
        if not link:
            return None

        # Check limits
        if link.upload_count >= link.max_files:
            return {"error": "Upload limit reached"}

        session = self.session_repo.get_by_token(session_token)
        if not session:
            return {"error": "Invalid session"}

        # Check duplicate
        if fingerprint in (session.completed_fingerprints or []):
            return {
                "file_id": "duplicate",
                "filename": filename,
                "size": file_size,
                "fingerprint": fingerprint,
                "completed_files": session.completed_files,
                "total_files": session.total_files,
                "duplicate": True,
            }

        # Determine file type
        file_type = 'video' if content_type.startswith('video/') else 'photo'

        try:
            storage = StorageFactory.get_instance()
            folder_path = f"{link.context}/{link.context_id}/crew-uploads"

            file_id = str(uuid.uuid4())
            ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'jpg'
            storage_filename = f"{file_id}.{ext}"

            result = storage.upload(
                file_data=file_data,
                filename=storage_filename,
                context=link.context,
                context_id=str(link.context_id),
                category='crew-uploads',
                content_type=content_type,
            )

            file_url = result.file_url or result.file_path

            # Build geo description for metadata
            geo_desc_parts = []
            if latitude is not None and longitude is not None:
                geo_desc_parts.append(f"GPS: {latitude},{longitude}")
            if device_model:
                geo_desc_parts.append(f"Device: {device_model}")
            geo_desc = " | ".join(geo_desc_parts) if geo_desc_parts else None

            # Create context-specific record
            if link.context == 'water-mitigation':
                self._create_wm_photo(
                    file_id, link, filename, file_url, file_size, content_type,
                    file_type, storage, result, folder_path, captured_at,
                    latitude, longitude, device_model,
                )
            else:
                # Generic File record for any other context
                file_record = File(
                    id=file_id,
                    filename=storage_filename,
                    original_name=filename,
                    content_type=content_type,
                    size=file_size,
                    url=file_url,
                    thumbnail_url=result.thumbnail_url,
                    context=link.context,
                    context_id=str(link.context_id),
                    category='crew-upload',
                    description=geo_desc,
                    uploaded_by='crew',
                )
                self.db.add(file_record)

            # Update tracking
            self.link_repo.increment_upload_count(link.id, file_size)
            self.session_repo.add_completed_fingerprint(session.id, fingerprint)

            self.db.commit()

            return {
                "file_id": file_id,
                "filename": filename,
                "size": file_size,
                "fingerprint": fingerprint,
                "completed_files": session.completed_files,
                "total_files": session.total_files,
            }

        except Exception as e:
            logger.error(f"Crew upload failed: {e}")
            self.session_repo.increment_failed(session.id)
            self.db.commit()
            return {"error": str(e)}

    def _create_wm_photo(
        self, file_id, link, filename, file_url, file_size, content_type,
        file_type, storage, result, folder_path, captured_at,
        latitude, longitude, device_model,
    ):
        """Create WMPhoto record for water-mitigation context"""
        from app.domains.water_mitigation.models import WMPhoto

        photo = WMPhoto(
            id=file_id,
            job_id=link.context_id,
            source='crew_upload',
            file_name=filename,
            file_path=file_url,
            file_size=file_size,
            mime_type=content_type,
            file_type=file_type,
            storage_provider=storage.provider_name,
            storage_file_id=result.file_id,
            storage_thumbnail_url=result.thumbnail_url,
            storage_folder_path=folder_path,
            title=filename,
            captured_date=captured_at,
            upload_status='completed',
            latitude=latitude,
            longitude=longitude,
            device_model=device_model,
            upload_link_id=link.id,
        )
        self.db.add(photo)
