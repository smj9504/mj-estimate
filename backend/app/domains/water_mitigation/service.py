"""
Water Mitigation service layer
"""

import json
import logging
import os
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import UploadFile
from PIL import Image
from PIL.ExifTags import TAGS

from app.core.config import settings
from app.core.interfaces import DatabaseSession
from app.domains.storage.factory import StorageFactory

from .document_repository import WMDocumentRepository
from .models import (
    PhotoCategory,
    WaterMitigationJob,
    WMDocument,
    WMJobStatusHistory,
    WMPhoto,
    WMReportConfig,
)
from .repository import (
    PhotoCategoryRepository,
    WaterMitigationJobRepository,
    WMJobStatusHistoryRepository,
    WMPhotoRepository,
    WMReportConfigRepository,
)
from .schemas import (
    CategoryCreate,
    JobCreate,
    JobStatusUpdate,
    JobUpdate,
    ReportConfigCreate,
    ReportConfigUpdate,
)

logger = logging.getLogger(__name__)

# Photo upload directory
UPLOAD_DIR = Path("uploads/water_mitigation/photos")


class WaterMitigationService:
    """Water mitigation business logic"""

    def __init__(self, session: DatabaseSession):
        self.session = session
        self.job_repo = WaterMitigationJobRepository(session)
        self.category_repo = PhotoCategoryRepository(session)
        self.photo_repo = WMPhotoRepository(session)
        self.document_repo = WMDocumentRepository(session)
        self.status_history_repo = WMJobStatusHistoryRepository(session)
        self.report_config_repo = WMReportConfigRepository(session)

    # Job operations
    def create_job(self, data: JobCreate, created_by_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Create new job"""
        job_data = data.dict()
        job_data['created_by_id'] = created_by_id
        job_data['updated_by_id'] = created_by_id

        created_job = self.job_repo.create(job_data)

        # Create initial status history
        self._create_status_history(
            job_id=created_job['id'],
            previous_status=None,
            new_status=created_job.get('status', 'Lead'),
            changed_by_id=created_by_id
        )

        return created_job

    def get_job(self, job_id: UUID) -> Optional[Dict[str, Any]]:
        """Get job by ID"""
        job = self.job_repo.get_by_id(job_id)
        return self.job_repo._convert_to_dict(job) if job else None

    def get_job_with_photos(self, job_id: UUID) -> Optional[Dict[str, Any]]:
        """Get job with photos"""
        job = self.job_repo.find_with_photos(job_id)
        return self.job_repo._convert_to_dict(job) if job else None

    def update_job(
        self,
        job_id: UUID,
        data: JobUpdate,
        updated_by_id: Optional[UUID] = None
    ) -> Optional[WaterMitigationJob]:
        """Update job"""
        job = self.job_repo.get_by_id(job_id)
        if not job:
            return None

        update_data = data.dict(exclude_unset=True)
        update_data['updated_by_id'] = updated_by_id

        updated_job = self.job_repo.update(job_id, update_data)
        return updated_job

    def update_job_status(
        self,
        job_id: UUID,
        status_update: JobStatusUpdate,
        changed_by_id: Optional[UUID] = None
    ) -> Optional[WaterMitigationJob]:
        """Update job status and create history record"""
        job = self.job_repo.get_by_id(job_id)
        if not job:
            return None

        previous_status = job.status
        new_status = status_update.status

        # Update job status
        updated_job = self.job_repo.update(job_id, {
            'status': new_status,
            'updated_by_id': changed_by_id
        })

        # Create status history
        self._create_status_history(
            job_id=job_id,
            previous_status=previous_status,
            new_status=new_status,
            changed_by_id=changed_by_id,
            notes=status_update.notes
        )

        logger.info(f"Job {job_id} status changed: {previous_status} → {new_status}")

        return updated_job

    def toggle_job_active(
        self,
        job_id: UUID,
        active: bool,
        updated_by_id: Optional[UUID] = None
    ) -> Optional[WaterMitigationJob]:
        """Toggle job active status"""
        return self.job_repo.update(job_id, {
            'active': active,
            'updated_by_id': updated_by_id
        })

    def list_jobs(
        self,
        client_id: Optional[UUID] = None,
        search: Optional[str] = None,
        status: Optional[List[str]] = None,
        active: Optional[bool] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[List[WaterMitigationJob], int]:
        """List jobs with filters

        Note: photo_count is already attached to each job object by repository
        using optimized subquery JOIN to avoid N+1 queries.
        """
        jobs, total = self.job_repo.find_by_filters(
            client_id=client_id,
            search=search,
            status=status,
            active=active,
            page=page,
            page_size=page_size
        )

        # photo_count already attached by repository - no need for additional queries

        return jobs, total

    def delete_job(self, job_id: UUID) -> bool:
        """
        Delete job and all associated files (photos and documents)
        
        This method:
        1. Deletes all photo files from disk/storage
        2. Deletes all document files from disk/storage
        3. Deletes the job (cascade delete handles DB records)
        """
        # Get job first to verify it exists
        job = self.job_repo.get_by_id(job_id)
        if not job:
            return False
        
        # Get all photos for this job
        photos = self.photo_repo.find_by_job(job_id)
        
        # Delete photo files
        for photo in photos:
            try:
                # Handle both dict and model object
                storage_provider = (
                    photo.get('storage_provider') if isinstance(photo, dict)
                    else getattr(photo, 'storage_provider', 'local')
                )
                file_path_str = (
                    photo.get('file_path') if isinstance(photo, dict)
                    else getattr(photo, 'file_path', None)
                )
                storage_file_id = (
                    photo.get('storage_file_id') if isinstance(photo, dict)
                    else getattr(photo, 'storage_file_id', None)
                )
                photo_id = (
                    photo.get('id') if isinstance(photo, dict)
                    else getattr(photo, 'id', None)
                )
                
                # Delete based on storage provider
                if storage_provider == 'local' and file_path_str:
                    # Delete local file
                    file_path = Path(file_path_str)
                    if file_path.exists():
                        file_path.unlink()
                        logger.info(f"Deleted local photo file: {file_path_str}")
                    else:
                        logger.warning(
                            f"Photo file not found: {file_path_str}"
                        )
                elif storage_provider != 'local' and storage_file_id:
                    # Delete from cloud storage
                    try:
                        storage = StorageFactory.get_instance(storage_provider)
                        if hasattr(storage, 'delete'):
                            success = storage.delete(storage_file_id)
                            if success:
                                logger.info(
                                    f"Deleted {storage_provider} photo file: "
                                    f"{storage_file_id}"
                                )
                            else:
                                logger.warning(
                                    f"Failed to delete {storage_provider} "
                                    f"photo: {storage_file_id}"
                                )
                    except Exception as storage_error:
                        logger.error(
                            f"Failed to delete {storage_provider} photo "
                            f"{storage_file_id}: {storage_error}",
                            exc_info=True
                        )
            except Exception as e:
                logger.error(
                    f"Failed to delete photo file {photo_id}: {e}",
                    exc_info=True
                )
        
        # Get all documents for this job
        documents = self.document_repo.get_by_job(
            str(job_id), is_active=None
        )  # Get all, including inactive
        
        # Delete document files
        for document in documents:
            try:
                # Handle both dict and model object
                file_path_str = (
                    document.get('file_path') if isinstance(document, dict)
                    else getattr(document, 'file_path', None)
                )
                document_id = (
                    document.get('id') if isinstance(document, dict)
                    else getattr(document, 'id', None)
                )
                
                # Only delete local files
                # For other storage providers, files are managed externally
                if file_path_str:
                    file_path = Path(file_path_str)
                    if file_path.exists():
                        file_path.unlink()
                        logger.info(f"Deleted document file: {file_path_str}")
                    else:
                        logger.warning(
                            f"Document file not found: {file_path_str}"
                        )
            except Exception as e:
                logger.error(
                    f"Failed to delete document file {document_id}: {e}",
                    exc_info=True
                )
        
        # Delete job (cascade delete will handle DB records for photos, documents, etc.)
        return self.job_repo.delete(job_id)

    # Category operations
    def create_category(self, data: CategoryCreate, client_id: UUID) -> PhotoCategory:
        """Create new category"""
        # Check if category already exists
        existing = self.category_repo.find_by_name(client_id, data.category_name)
        if existing:
            raise ValueError(f"Category '{data.category_name}' already exists")

        category_data = data.dict()
        category_data['client_id'] = client_id

        return self.category_repo.create(category_data)

    def get_categories(self, client_id: UUID) -> List[PhotoCategory]:
        """Get all categories for client"""
        return self.category_repo.find_by_client(client_id)

    def get_category(self, category_id: UUID) -> Optional[PhotoCategory]:
        """Get category by ID"""
        return self.category_repo.get_by_id(category_id)

    def delete_category(self, category_id: UUID) -> bool:
        """Delete category"""
        return self.category_repo.delete(category_id)

    # Status history
    def get_status_history(self, job_id: UUID) -> List[WMJobStatusHistory]:
        """Get status history for job"""
        return self.status_history_repo.find_by_job(job_id)

    def _extract_photo_capture_date(self, file_path: Path) -> datetime:
        """
        Extract photo capture date from EXIF metadata

        Fallback order:
        1. EXIF DateTimeOriginal
        2. EXIF DateTime
        3. File modification time
        4. Current time

        Args:
            file_path: Path to the image file

        Returns:
            datetime: Photo capture date
        """
        try:
            # Open image and extract EXIF data
            image = Image.open(file_path)
            exif_data = image._getexif()

            if exif_data:
                # Find DateTimeOriginal (tag 36867) or DateTime (tag 306)
                for tag_id, value in exif_data.items():
                    tag = TAGS.get(tag_id, tag_id)

                    # Primary: DateTimeOriginal (when photo was taken)
                    if tag == 'DateTimeOriginal':
                        try:
                            # Parse EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
                            capture_date = datetime.strptime(value, '%Y:%m:%d %H:%M:%S')
                            logger.info(f"Extracted EXIF DateTimeOriginal: {capture_date}")
                            return capture_date
                        except ValueError as e:
                            logger.warning(f"Failed to parse DateTimeOriginal '{value}': {e}")

                    # Fallback: DateTime (when photo was modified)
                    elif tag == 'DateTime':
                        try:
                            capture_date = datetime.strptime(value, '%Y:%m:%d %H:%M:%S')
                            logger.info(f"Extracted EXIF DateTime: {capture_date}")
                            return capture_date
                        except ValueError as e:
                            logger.warning(f"Failed to parse DateTime '{value}': {e}")

        except Exception as e:
            logger.warning(f"Failed to extract EXIF data from {file_path.name}: {e}")

        # Fallback 3: Use file modification time
        try:
            file_mtime = file_path.stat().st_mtime
            capture_date = datetime.fromtimestamp(file_mtime)
            logger.info(f"Using file modification time: {capture_date}")
            return capture_date
        except Exception as e:
            logger.warning(f"Failed to get file modification time: {e}")

        # Fallback 4: Current time
        logger.warning(f"No capture date available, using current time")
        return datetime.utcnow()

    # Photo operations
    async def upload_photo(
        self,
        job_id: UUID,
        file: UploadFile,
        title: Optional[str] = None,
        description: Optional[str] = None,
        uploaded_by_id: Optional[UUID] = None
    ) -> WMPhoto:
        """
        Upload photo to job using configured storage provider
        
        Supports:
        - Local filesystem (development)
        - Google Cloud Storage (production)
        - Google Drive (production)
        """
        # Verify job exists
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Get storage provider
        storage = StorageFactory.get_instance()
        storage_provider_type = settings.STORAGE_PROVIDER.lower()

        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Determine file type
        is_image = file.content_type and file.content_type.startswith('image/')
        file_type = 'photo' if is_image else 'video'

        # Extract capture date from EXIF metadata
        captured_date = None
        if is_image:
            try:
                # Save to temp location for EXIF extraction
                temp_path = (
                    UPLOAD_DIR / "temp" /
                    f"temp_{datetime.utcnow().timestamp()}.jpg"
                )
                temp_path.parent.mkdir(parents=True, exist_ok=True)
                with temp_path.open("wb") as f:
                    f.write(file_content)
                captured_date = self._extract_photo_capture_date(temp_path)
                temp_path.unlink()  # Clean up temp file
            except Exception as e:
                logger.warning(f"Failed to extract EXIF date: {e}")
                captured_date = datetime.utcnow()
        else:
            captured_date = datetime.utcnow()

        # Upload to storage
        try:
            file_stream = BytesIO(file_content)
            upload_result = storage.upload(
                file_data=file_stream,
                filename=file.filename or f"photo_{datetime.utcnow().timestamp()}.jpg",
                context="water-mitigation",
                context_id=str(job_id),
                category="photos",
                content_type=file.content_type
            )
            
            # Get file path (works for both local and cloud storage)
            file_path = upload_result.file_path
            
            logger.info(
                f"Photo uploaded to {storage_provider_type} storage: "
                f"{upload_result.file_path}"
            )
            
        except Exception as e:
            logger.error(f"Failed to upload photo to storage: {e}", exc_info=True)
            raise

        # Create photo record
        photo_data = {
            'job_id': job_id,
            'source': 'manual_upload',
            'file_name': file.filename or upload_result.file_id,
            'file_path': file_path,
            'file_size': file_size,
            'mime_type': file.content_type,
            'file_type': file_type,
            'title': title,
            'description': description,
            'captured_date': captured_date,
            'upload_status': 'completed',
            'uploaded_by_id': uploaded_by_id,
            'storage_provider': storage_provider_type,
            'storage_file_id': upload_result.file_id,
            'storage_thumbnail_url': upload_result.thumbnail_url,
            'storage_folder_path': upload_result.folder_path
        }

        created_photo = self.photo_repo.create(photo_data)
        logger.info(f"Photo uploaded to job {job_id}: {file.filename}")

        return created_photo

    async def save_companycam_photo(
        self,
        job_id: UUID,
        photo_bytes: bytes,
        filename: str,
        companycam_photo_id: str,
        mime_type: str = 'image/jpeg',
        title: Optional[str] = None,
        description: Optional[str] = None,
        captured_date: Optional[datetime] = None
    ) -> WMPhoto:
        """
        Save CompanyCam photo to Water Mitigation job using configured storage provider

        Args:
            job_id: Water mitigation job ID
            photo_bytes: Photo file bytes
            filename: Original filename
            companycam_photo_id: CompanyCam photo ID
            mime_type: MIME type of the photo
            title: Photo title
            description: Photo description
            captured_date: When the photo was captured

        Returns:
            Created WMPhoto record
        """
        # Verify job exists
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Get storage provider
        storage = StorageFactory.get_instance()
        storage_provider_type = settings.STORAGE_PROVIDER.lower()

        # Get file size
        file_size = len(photo_bytes)

        # Extract capture date from EXIF if not provided
        if not captured_date:
            is_image = mime_type and mime_type.startswith('image/')
            if is_image:
                try:
                    # Save to temp location for EXIF extraction
                    temp_path = UPLOAD_DIR / "temp" / f"temp_{datetime.utcnow().timestamp()}.jpg"
                    temp_path.parent.mkdir(parents=True, exist_ok=True)
                    with temp_path.open("wb") as f:
                        f.write(photo_bytes)
                    captured_date = self._extract_photo_capture_date(temp_path)
                    temp_path.unlink()  # Clean up temp file
                except Exception as e:
                    logger.warning(f"Failed to extract EXIF date: {e}")
                    captured_date = datetime.utcnow()
            else:
                captured_date = datetime.utcnow()

        # Determine file type
        file_type = 'photo' if mime_type and mime_type.startswith('image/') else 'video'

        # Upload to storage
        try:
            # Generate unique filename
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            unique_filename = f"companycam_{timestamp}_{filename}"
            
            file_stream = BytesIO(photo_bytes)
            upload_result = storage.upload(
                file_data=file_stream,
                filename=unique_filename,
                context="water-mitigation",
                context_id=str(job_id),
                category="photos",
                content_type=mime_type
            )
            
            # Get file URL (for cloud storage) or path (for local)
            if storage_provider_type == 'local':
                file_path = upload_result.file_path
            else:
                # For cloud storage, file_path is the storage path
                file_path = upload_result.file_path
            
            logger.info(f"CompanyCam photo uploaded to {storage_provider_type} storage: {upload_result.file_path}")
            
        except Exception as e:
            logger.error(f"Failed to upload CompanyCam photo to storage: {e}", exc_info=True)
            raise

        # Create photo record
        photo_data = {
            'job_id': job_id,
            'source': 'companycam',
            'external_id': companycam_photo_id,
            'file_name': filename,
            'file_path': file_path,
            'file_size': file_size,
            'mime_type': mime_type,
            'file_type': file_type,
            'title': title,
            'description': description,
            'captured_date': captured_date,
            'upload_status': 'completed',
            'storage_provider': storage_provider_type,
            'storage_file_id': upload_result.file_id,
            'storage_thumbnail_url': upload_result.thumbnail_url,
            'storage_folder_path': upload_result.folder_path
        }

        created_photo = self.photo_repo.create(photo_data)
        # Flush to ensure photo is saved even if sync is cancelled
        self.session.flush()
        logger.info(f"Created WMPhoto record for CompanyCam photo {companycam_photo_id}")

        return created_photo

    def get_job_photos(self, job_id: UUID) -> List[WMPhoto]:
        """Get all photos for a job"""
        return self.photo_repo.find_by_job(job_id)

    def delete_photo(self, photo_id: UUID) -> bool:
        """Delete photo and its file"""
        photo = self.photo_repo.get_by_id(photo_id)
        if not photo:
            return False

        # Delete file from disk
        try:
            if photo.file_path and os.path.exists(photo.file_path):
                os.remove(photo.file_path)
                logger.info(f"Deleted photo file: {photo.file_path}")
        except Exception as e:
            logger.error(f"Failed to delete photo file: {e}")

        # Delete from database
        return self.photo_repo.delete(photo_id)

    def trash_photo(self, photo_id: UUID, trashed_by_id: Optional[UUID] = None, reason: str = 'manual') -> bool:
        """Move photo to trash (soft delete)"""
        photo = self.photo_repo.get_by_id(photo_id)
        if not photo:
            return False

        from datetime import datetime
        photo.is_trashed = True
        photo.trashed_at = datetime.utcnow()
        photo.trashed_by_id = trashed_by_id
        photo.trash_reason = reason

        self.photo_repo.update(photo_id, {
            'is_trashed': True,
            'trashed_at': datetime.utcnow(),
            'trashed_by_id': trashed_by_id,
            'trash_reason': reason
        })

        logger.info(f"Moved photo {photo_id} to trash (reason: {reason})")
        return True

    def restore_photo(self, photo_id: UUID) -> bool:
        """Restore photo from trash"""
        photo = self.photo_repo.get_by_id(photo_id)
        if not photo:
            return False

        self.photo_repo.update(photo_id, {
            'is_trashed': False,
            'trashed_at': None,
            'trashed_by_id': None,
            'trash_reason': None
        })

        logger.info(f"Restored photo {photo_id} from trash")
        return True

    def list_trashed_photos(self, job_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """List all trashed photos (optionally filtered by job)"""
        query = self.photo_repo.session.query(WMPhoto).filter(WMPhoto.is_trashed == True)

        if job_id:
            query = query.filter(WMPhoto.job_id == job_id)

        photos = query.order_by(WMPhoto.trashed_at.desc()).all()
        return [self._photo_to_dict(photo) for photo in photos]

    def _photo_to_dict(self, photo: WMPhoto) -> Dict[str, Any]:
        """Convert WMPhoto model to dictionary"""
        return {
            'id': str(photo.id),
            'job_id': str(photo.job_id) if photo.job_id else None,
            'source': photo.source,
            'external_id': photo.external_id,
            'file_name': photo.file_name,
            'file_path': photo.file_path,
            'file_size': photo.file_size,
            'mime_type': photo.mime_type,
            'file_type': photo.file_type,
            'storage_provider': photo.storage_provider,
            'storage_file_id': photo.storage_file_id,
            'storage_thumbnail_url': photo.storage_thumbnail_url,
            'title': photo.title,
            'description': photo.description,
            'captured_date': photo.captured_date.isoformat() if photo.captured_date else None,
            'category': photo.category,
            'is_trashed': photo.is_trashed,
            'trashed_at': photo.trashed_at.isoformat() if photo.trashed_at else None,
            'trash_reason': photo.trash_reason,
            'created_at': photo.created_at.isoformat() if photo.created_at else None,
            'updated_at': photo.updated_at.isoformat() if photo.updated_at else None
        }

    # Helper methods
    def _create_status_history(
        self,
        job_id: UUID,
        previous_status: Optional[str],
        new_status: str,
        changed_by_id: Optional[UUID] = None,
        notes: Optional[str] = None
    ) -> WMJobStatusHistory:
        """Create status history record"""
        history_data = {
            'job_id': job_id,
            'previous_status': previous_status,
            'new_status': new_status,
            'changed_by_id': changed_by_id,
            'notes': notes
        }
        return self.status_history_repo.create(history_data)

    # Report config operations
    def get_report_config(self, job_id: UUID) -> Optional[Dict[str, Any]]:
        """Get report config for job"""
        config = self.report_config_repo.find_by_job_id(job_id)
        return self.report_config_repo._convert_to_dict(config) if config else None

    def create_report_config(
        self,
        data: ReportConfigCreate,
        created_by_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """Create new report config"""
        config_data = data.dict()
        config_data['created_by_id'] = created_by_id

        # Check if config already exists for this job
        existing = self.report_config_repo.find_by_job_id(data.job_id)
        if existing:
            # Update existing config instead
            return self.update_report_config(data.job_id, ReportConfigUpdate(**config_data))

        created_config = self.report_config_repo.create(config_data)
        return created_config

    def update_report_config(
        self,
        job_id: UUID,
        data: ReportConfigUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update report config"""
        config = self.report_config_repo.find_by_job_id(job_id)
        if not config:
            return None

        update_data = data.dict(exclude_unset=True)
        config_id = config.get('id') if isinstance(config, dict) else config.id

        updated_config = self.report_config_repo.update(config_id, update_data)
        return updated_config

    def delete_report_config(self, job_id: UUID) -> bool:
        """Delete report config"""
        return self.report_config_repo.delete_by_job_id(job_id)

    # CompanyCam integration methods
    def get_by_companycam_project(self, companycam_project_id: str) -> Optional[WaterMitigationJob]:
        """Get job by CompanyCam project ID"""
        return self.job_repo.find_by_companycam_project_id(companycam_project_id)

    def get_by_street_address(
        self,
        street: Optional[str] = None,
        city: Optional[str] = None,
        state: Optional[str] = None,
        active_only: bool = True
    ) -> Optional[WaterMitigationJob]:
        """
        Get job by street address, city, and state using fuzzy matching
        
        This method prevents duplicate leads by matching addresses even when:
        - States are in different formats (Maryland vs MD, Virginia vs VA)
        - Zipcodes are present or missing
        - Address formatting differs slightly
        
        Args:
            street: Street address
            city: City name
            state: State name or abbreviation
            active_only: Only search active jobs (default: True)
            
        Returns:
            Matching job or None
        """
        return self.job_repo.find_by_street_address(
            street=street,
            city=city,
            state=state,
            active_only=active_only
        )

    def get_all(self, filters: Optional[Dict[str, Any]] = None) -> List[WaterMitigationJob]:
        """Get all jobs with optional filters"""
        # Use find_by_filters for active jobs
        if filters and 'active' in filters:
            jobs, _ = self.job_repo.find_by_filters(
                active=filters.get('active'),
                page=1,
                page_size=1000  # Get all active jobs
            )
            return jobs

        # If no filters, get all (use find_by_filters with no filters)
        jobs, _ = self.job_repo.find_by_filters(page=1, page_size=1000)
        return jobs

    def get_by_id(self, job_id: UUID) -> Optional[WaterMitigationJob]:
        """Get job model by ID (not dict)"""
        return self.job_repo.get_by_id(job_id)

    def create(self, data: Any) -> WaterMitigationJob:
        """Create job from schema (for CompanyCam integration)"""
        job_data = data.dict() if hasattr(data, 'dict') else data
        created = self.job_repo.create(job_data)
        # Return model object
        if isinstance(created, dict):
            return self.job_repo.get_by_id(created['id'])
        return created

    # CompanyCam photo sync
    async def sync_companycam_photos(
        self,
        job_id: UUID,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Sync photos from CompanyCam project to Water Mitigation job.

        Logic:
        1. Get job's companycam_project_id
        2. Fetch all photos from CompanyCam API (paginated)
        3. Compare with existing WMPhotos by external_id
        4. Add only new photos (skip existing and trashed)
        5. Preserve existing category assignments

        Args:
            job_id: Water mitigation job ID
            force_refresh: If True, re-download even if photo exists (not implemented)

        Returns:
            Dict with sync results
        """
        from app.domains.integrations.companycam.client import CompanyCamClient

        # Get job and validate
        job = self.job_repo.get_by_id(job_id)
        if not job:
            return {
                'success': False,
                'message': f'Job {job_id} not found',
                'synced_count': 0,
                'skipped_existing': 0,
                'skipped_trashed': 0,
                'total_companycam': 0,
                'errors': [f'Job {job_id} not found']
            }

        # Handle both dict and model object
        companycam_project_id = (
            job.get('companycam_project_id') if isinstance(job, dict)
            else getattr(job, 'companycam_project_id', None)
        )

        if not companycam_project_id:
            return {
                'success': False,
                'message': 'Job has no CompanyCam project linked',
                'synced_count': 0,
                'skipped_existing': 0,
                'skipped_trashed': 0,
                'total_companycam': 0,
                'errors': ['No CompanyCam project ID']
            }

        project_id = int(companycam_project_id)
        sync_key = f"companycam_sync:{job_id}"
        logger.info(f"Starting CompanyCam sync for job {job_id}, project {project_id}")

        # Get cache service for cancellation check and progress updates
        from app.core.cache import get_cache
        cache = get_cache()

        # Get existing photos by external_id (including trashed)
        existing_photos = self.photo_repo.find_by_job_with_external_ids(
            job_id, include_trashed=True
        )
        existing_external_ids = set(existing_photos.keys())

        # Initialize counters
        synced_count = 0
        skipped_existing = 0
        skipped_trashed = 0
        total_companycam = 0
        errors = []

        # Initialize CompanyCam client
        companycam_client = CompanyCamClient()

        # Helper to check cancellation
        async def is_cancelled() -> bool:
            status_json = await cache.get(sync_key)
            if status_json:
                try:
                    status = json.loads(status_json)
                    return status.get('status') == 'cancelled'
                except:
                    pass
            return False

        # Helper to update progress (preserves cancelled status if set)
        async def update_progress(page: int):
            # Check current status first to preserve cancelled flag
            current_status = 'running'
            status_json = await cache.get(sync_key)
            if status_json:
                try:
                    status_data = json.loads(status_json)
                    if status_data.get('status') == 'cancelled':
                        current_status = 'cancelled'
                except:
                    pass

            await cache.set(sync_key, json.dumps({
                'status': current_status,
                'synced_count': synced_count,
                'skipped_existing': skipped_existing,
                'skipped_trashed': skipped_trashed,
                'total_companycam': total_companycam,
                'current_page': page,
                'errors': errors[:5]
            }), ttl=3600)

        # Fetch photos page by page
        page = 1
        per_page = 100
        has_more = True
        cancelled = False

        while has_more:
            # Check for cancellation at start of each page
            if await is_cancelled():
                logger.info(f"Sync cancelled for job {job_id}")
                cancelled = True
                break

            try:
                logger.info(f"Fetching CompanyCam photos page {page}")
                response = await companycam_client.list_project_photos(
                    project_id=project_id,
                    page=page,
                    per_page=per_page
                )

                # Handle response (can be list or dict with data key)
                if isinstance(response, list):
                    photos = response
                elif isinstance(response, dict):
                    photos = response.get('data', response.get('photos', []))
                else:
                    photos = []

                if not photos:
                    has_more = False
                    break

                total_companycam += len(photos)

                # Filter photos to sync (skip existing and trashed)
                photos_to_sync = []
                for cc_photo in photos:
                    photo_id = str(cc_photo.get('id'))

                    # Check if already exists
                    if photo_id in existing_external_ids:
                        existing_photo = existing_photos.get(photo_id)
                        if existing_photo and existing_photo.is_trashed:
                            skipped_trashed += 1
                            logger.debug(f"Skipping trashed photo {photo_id}")
                        else:
                            skipped_existing += 1
                            logger.debug(f"Skipping existing photo {photo_id}")
                        continue

                    photos_to_sync.append(cc_photo)
                    existing_external_ids.add(photo_id)  # Mark as will be processed

                # Check cancellation before parallel download
                if await is_cancelled():
                    logger.info(f"Sync cancelled for job {job_id}")
                    cancelled = True
                    break

                # Parallel download in batches of 5 (balance speed vs memory/connections)
                # Note: Downloads are parallel, but DB saves are sequential to avoid session conflicts
                import asyncio
                PARALLEL_BATCH_SIZE = 5

                for batch_start in range(0, len(photos_to_sync), PARALLEL_BATCH_SIZE):
                    # Check cancellation before each batch
                    if await is_cancelled():
                        logger.info(f"Sync cancelled for job {job_id}")
                        cancelled = True
                        break

                    batch = photos_to_sync[batch_start:batch_start + PARALLEL_BATCH_SIZE]

                    async def download_photo_safe(cc_photo: Dict[str, Any]) -> tuple[str, Optional[bytes], Dict[str, Any], str]:
                        """Download single photo, return (photo_id, photo_bytes, cc_photo, error_msg)"""
                        photo_id = str(cc_photo.get('id'))
                        try:
                            # Extract photo URL from uris
                            uris = cc_photo.get('uris', [])
                            photo_url = None

                            if isinstance(uris, list):
                                for uri in uris:
                                    if isinstance(uri, dict):
                                        if uri.get('type') == 'original':
                                            photo_url = uri.get('uri')
                                            break
                                        elif uri.get('type') == 'large' and not photo_url:
                                            photo_url = uri.get('uri')
                                if not photo_url and uris:
                                    first_uri = uris[0]
                                    photo_url = first_uri.get('uri') if isinstance(first_uri, dict) else first_uri
                            elif isinstance(uris, dict):
                                photo_url = uris.get('original') or uris.get('large') or uris.get('medium')

                            if not photo_url:
                                return (photo_id, None, cc_photo, f"No photo URL found for {photo_id}")

                            # Download photo (parallel safe - no DB access)
                            photo_bytes = await companycam_client.download_photo(photo_url)
                            return (photo_id, photo_bytes, cc_photo, "")
                        except Exception as e:
                            error_msg = f"Failed to download photo {photo_id}: {str(e)}"
                            logger.error(error_msg, exc_info=True)
                            return (photo_id, None, cc_photo, error_msg)

                    # Run downloads in parallel
                    download_results = await asyncio.gather(*[download_photo_safe(p) for p in batch])

                    # Save to DB sequentially (SQLAlchemy session is not thread-safe)
                    for photo_id, photo_bytes, cc_photo, error_msg in download_results:
                        if error_msg:
                            errors.append(error_msg)
                            continue

                        if photo_bytes is None:
                            errors.append(f"No photo bytes for {photo_id}")
                            continue

                        try:
                            # Extract metadata
                            captured_at = cc_photo.get('captured_at')
                            captured_date = None
                            if captured_at:
                                try:
                                    if isinstance(captured_at, int):
                                        captured_date = datetime.fromtimestamp(captured_at)
                                    elif isinstance(captured_at, str):
                                        captured_date = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
                                    else:
                                        captured_date = datetime.utcnow()
                                except (ValueError, TypeError, OSError):
                                    captured_date = datetime.utcnow()

                            filename = f"companycam_{photo_id}.jpg"

                            # Save to storage and DB (sequential)
                            await self.save_companycam_photo(
                                job_id=job_id,
                                photo_bytes=photo_bytes,
                                filename=filename,
                                companycam_photo_id=photo_id,
                                mime_type='image/jpeg',
                                title=cc_photo.get('title'),
                                description=cc_photo.get('description'),
                                captured_date=captured_date
                            )
                            synced_count += 1
                            logger.info(f"Synced CompanyCam photo {photo_id}")
                        except Exception as e:
                            error_msg = f"Failed to save photo {photo_id}: {str(e)}"
                            errors.append(error_msg)
                            logger.error(error_msg, exc_info=True)

                    # Update progress after each batch
                    await update_progress(page)

                # Break outer loop if cancelled
                if cancelled:
                    break

                # Check if there are more pages
                if len(photos) < per_page:
                    has_more = False
                else:
                    page += 1

            except Exception as e:
                error_msg = f"Failed to fetch page {page}: {str(e)}"
                errors.append(error_msg)
                logger.error(error_msg, exc_info=True)
                has_more = False

        # Build result
        if cancelled:
            success = True
            message = (
                f"Sync cancelled. Synced {synced_count} photos before cancellation. "
                f"Skipped {skipped_existing} existing, {skipped_trashed} trashed."
            )
        else:
            success = len(errors) == 0 or synced_count > 0
            message = (
                f"Synced {synced_count} photos. "
                f"Skipped {skipped_existing} existing, {skipped_trashed} trashed. "
                f"Total in CompanyCam: {total_companycam}."
            )
            if errors:
                message += f" {len(errors)} errors occurred."

        logger.info(f"CompanyCam sync {'cancelled' if cancelled else 'completed'} for job {job_id}: {message}")

        # Update final status in cache
        final_status = 'cancelled' if cancelled else 'completed'
        await cache.set(sync_key, json.dumps({
            'status': final_status,
            'synced_count': synced_count,
            'skipped_existing': skipped_existing,
            'skipped_trashed': skipped_trashed,
            'total_companycam': total_companycam,
            'current_page': page,
            'errors': errors[:10],
            'message': message
        }), ttl=300)  # Keep result for 5 minutes

        return {
            'success': success,
            'message': message,
            'synced_count': synced_count,
            'skipped_existing': skipped_existing,
            'skipped_trashed': skipped_trashed,
            'total_companycam': total_companycam,
            'errors': errors[:10],
            'cancelled': cancelled
        }

    async def _sync_single_companycam_photo(
        self,
        job_id: UUID,
        cc_photo: Dict[str, Any],
        companycam_client: Any
    ) -> WMPhoto:
        """
        Download and save a single CompanyCam photo.

        Args:
            job_id: Water mitigation job ID
            cc_photo: CompanyCam photo data dict
            companycam_client: CompanyCam API client

        Returns:
            Created WMPhoto record
        """
        photo_id = str(cc_photo.get('id'))

        # Extract photo URL from uris
        uris = cc_photo.get('uris', [])
        photo_url = None

        if isinstance(uris, list):
            # Find best quality URL
            for uri in uris:
                if isinstance(uri, dict):
                    if uri.get('type') == 'original':
                        photo_url = uri.get('uri')
                        break
                    elif uri.get('type') == 'large' and not photo_url:
                        photo_url = uri.get('uri')
            # Fallback to first uri
            if not photo_url and uris:
                first_uri = uris[0]
                photo_url = first_uri.get('uri') if isinstance(first_uri, dict) else first_uri
        elif isinstance(uris, dict):
            photo_url = uris.get('original') or uris.get('large') or uris.get('medium')

        if not photo_url:
            raise ValueError(f"No photo URL found for CompanyCam photo {photo_id}")

        # Download photo
        photo_bytes = await companycam_client.download_photo(photo_url)

        # Extract metadata
        captured_at = cc_photo.get('captured_at')
        captured_date = None
        if captured_at:
            try:
                # Handle both Unix timestamp (int) and ISO string formats
                if isinstance(captured_at, int):
                    captured_date = datetime.fromtimestamp(captured_at)
                elif isinstance(captured_at, str):
                    captured_date = datetime.fromisoformat(
                        captured_at.replace('Z', '+00:00')
                    )
                else:
                    captured_date = datetime.utcnow()
            except (ValueError, TypeError, OSError):
                captured_date = datetime.utcnow()

        # Generate filename
        filename = f"companycam_{photo_id}.jpg"

        # Save photo using existing method
        return await self.save_companycam_photo(
            job_id=job_id,
            photo_bytes=photo_bytes,
            filename=filename,
            companycam_photo_id=photo_id,
            mime_type='image/jpeg',
            title=cc_photo.get('title'),
            description=cc_photo.get('description'),
            captured_date=captured_date
        )
