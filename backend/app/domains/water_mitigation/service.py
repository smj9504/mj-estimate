"""
Water Mitigation service layer
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
import logging
import os
import shutil
from pathlib import Path
from fastapi import UploadFile
from PIL import Image
from PIL.ExifTags import TAGS

from app.core.interfaces import DatabaseSession
from .repository import (
    WaterMitigationJobRepository,
    PhotoCategoryRepository,
    WMPhotoRepository,
    WMJobStatusHistoryRepository,
    WMReportConfigRepository
)
from .document_repository import WMDocumentRepository
from .models import WaterMitigationJob, PhotoCategory, WMPhoto, WMJobStatusHistory, WMDocument, WMReportConfig
from .schemas import JobCreate, JobUpdate, JobStatusUpdate, CategoryCreate, ReportConfigCreate, ReportConfigUpdate

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
        """List jobs with filters"""
        jobs, total = self.job_repo.find_by_filters(
            client_id=client_id,
            search=search,
            status=status,
            active=active,
            page=page,
            page_size=page_size
        )

        # Enrich with photo counts
        for job in jobs:
            job.photo_count = self.photo_repo.count_by_job(job.id)

        return jobs, total

    def delete_job(self, job_id: UUID) -> bool:
        """Delete job (cascades to photos and history)"""
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
        """Upload photo to job"""
        # Verify job exists
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Create upload directory if it doesn't exist
        job_upload_dir = UPLOAD_DIR / str(job_id)
        job_upload_dir.mkdir(parents=True, exist_ok=True)

        # Generate unique filename
        file_ext = Path(file.filename).suffix if file.filename else '.jpg'
        unique_filename = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
        file_path = job_upload_dir / unique_filename

        # Save file
        try:
            with file_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        finally:
            file.file.close()

        # Get file size
        file_size = file_path.stat().st_size

        # Extract capture date from EXIF metadata
        is_image = file.content_type and file.content_type.startswith('image/')
        if is_image:
            captured_date = self._extract_photo_capture_date(file_path)
        else:
            # For videos, use file modification time
            try:
                file_mtime = file_path.stat().st_mtime
                captured_date = datetime.fromtimestamp(file_mtime)
            except Exception:
                captured_date = datetime.utcnow()

        # Create photo record
        photo_data = {
            'job_id': job_id,
            'source': 'manual_upload',
            'file_name': file.filename or unique_filename,
            'file_path': str(file_path),
            'file_size': file_size,
            'mime_type': file.content_type,
            'file_type': 'photo' if is_image else 'video',
            'title': title,
            'description': description,
            'captured_date': captured_date,
            'upload_status': 'completed',
            'uploaded_by_id': uploaded_by_id
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
        Save CompanyCam photo to Water Mitigation job

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

        # Create upload directory
        job_upload_dir = UPLOAD_DIR / str(job_id)
        job_upload_dir.mkdir(parents=True, exist_ok=True)

        # Generate unique filename
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        file_ext = Path(filename).suffix or '.jpg'
        unique_filename = f"companycam_{timestamp}_{filename}"
        file_path = job_upload_dir / unique_filename

        # Save photo bytes to file
        try:
            with file_path.open("wb") as f:
                f.write(photo_bytes)
            logger.info(f"Saved CompanyCam photo to {file_path}")
        except Exception as e:
            logger.error(f"Failed to save photo file: {e}")
            raise

        # Get file size
        file_size = len(photo_bytes)

        # Extract capture date from EXIF if not provided
        if not captured_date:
            is_image = mime_type and mime_type.startswith('image/')
            if is_image:
                try:
                    captured_date = self._extract_photo_capture_date(file_path)
                except Exception as e:
                    logger.warning(f"Failed to extract EXIF date: {e}")
                    captured_date = datetime.utcnow()
            else:
                captured_date = datetime.utcnow()

        # Determine file type
        file_type = 'photo' if mime_type and mime_type.startswith('image/') else 'video'

        # Create photo record
        photo_data = {
            'job_id': job_id,
            'source': 'companycam',
            'external_id': companycam_photo_id,
            'file_name': filename,
            'file_path': str(file_path),
            'file_size': file_size,
            'mime_type': mime_type,
            'file_type': file_type,
            'title': title,
            'description': description,
            'captured_date': captured_date,
            'upload_status': 'completed'
        }

        created_photo = self.photo_repo.create(photo_data)
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
