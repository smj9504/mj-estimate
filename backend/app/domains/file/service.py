"""
File service for business logic operations
"""

import os
import uuid
import hashlib
from typing import List, Optional, Dict, Any, BinaryIO
from pathlib import Path
from PIL import Image
import logging

from app.common.base_service import BaseService
from .repository import FileRepository
from .models import File
from .schemas import FileCreate, FileUpdate
from .wm_photo_adapter import WMPhotoAdapter


logger = logging.getLogger(__name__)


class FileService(BaseService[File, str]):
    """Service for file operations"""

    def __init__(self, database):
        super().__init__(database)
        self.repository = FileRepository(database.get_session())

    def get_repository(self) -> FileRepository:
        """Get the repository used by this service"""
        return self.repository

    def _get_repository_instance(self, session):
        """Get repository instance with the given session"""
        return FileRepository(session)

    # File upload and storage methods
    async def upload_file(
        self,
        file_data: BinaryIO,
        original_filename: str,
        content_type: str,
        context: str,
        context_id: str,
        category: str = 'general',
        description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        upload_dir: str = "uploads"
    ) -> Dict[str, Any]:
        """Upload and store a file"""
        try:
            # Generate unique filename
            file_extension = Path(original_filename).suffix.lower()
            unique_filename = f"{uuid.uuid4()}{file_extension}"

            # Create directory structure: uploads/context/context_id/
            context_dir = Path(upload_dir) / context / context_id
            context_dir.mkdir(parents=True, exist_ok=True)

            file_path = context_dir / unique_filename

            # Save file
            with open(file_path, 'wb') as f:
                f.write(file_data.read())

            # Get file size
            file_size = file_path.stat().st_size

            # Generate thumbnail for images
            thumbnail_url = None
            if content_type.startswith('image/'):
                thumbnail_url = await self._generate_thumbnail(file_path, context_dir)

            # Handle water-mitigation context specially
            if context == 'water-mitigation':
                return await self._upload_wm_photo(
                    file_path=str(file_path),
                    original_filename=original_filename,
                    content_type=content_type,
                    file_size=file_size,
                    job_id=context_id,
                    description=description,
                    uploaded_by=uploaded_by
                )

            # Create file record
            file_record = FileCreate(
                filename=unique_filename,
                original_name=original_filename,
                content_type=content_type,
                size=file_size,
                url=str(file_path),
                thumbnail_url=thumbnail_url,
                context=context,
                context_id=context_id,
                category=category,
                description=description,
                uploaded_by=uploaded_by
            )

            # Save to database
            created_file = self.repository.create(file_record.dict())

            logger.info(f"File uploaded successfully: {unique_filename}")
            return created_file

        except Exception as e:
            logger.error(f"Error uploading file {original_filename}: {e}")
            raise

    async def _upload_wm_photo(
        self,
        file_path: str,
        original_filename: str,
        content_type: str,
        file_size: int,
        job_id: str,
        description: Optional[str] = None,
        uploaded_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """Upload water mitigation photo"""
        try:
            from app.domains.water_mitigation.repository import WMPhotoRepository
            from datetime import datetime

            wm_photo_repo = WMPhotoRepository(self.repository.session)

            photo_data = {
                'job_id': job_id,
                'source': 'manual_upload',
                'file_name': original_filename,
                'file_path': file_path,
                'file_size': file_size,
                'mime_type': content_type,
                'file_type': 'photo' if content_type.startswith('image/') else 'video',
                'title': description,
                'description': description,
                'captured_date': datetime.utcnow(),
                'upload_status': 'completed',
                'uploaded_by_id': uploaded_by
            }

            created_photo = wm_photo_repo.create(photo_data)

            # Convert to FileItem format
            return WMPhotoAdapter.to_file_item(created_photo)

        except Exception as e:
            logger.error(f"Error uploading WM photo: {e}")
            raise

    async def upload_multiple_files(
        self,
        files_data: List[tuple],  # List of (file_data, original_filename, content_type)
        context: str,
        context_id: str,
        category: str = 'general',
        description: Optional[str] = None,
        uploaded_by: Optional[str] = None,
        upload_dir: str = "uploads"
    ) -> List[Dict[str, Any]]:
        """Upload multiple files"""
        uploaded_files = []

        for file_data, original_filename, content_type in files_data:
            try:
                uploaded_file = await self.upload_file(
                    file_data=file_data,
                    original_filename=original_filename,
                    content_type=content_type,
                    context=context,
                    context_id=context_id,
                    category=category,
                    description=description,
                    uploaded_by=uploaded_by,
                    upload_dir=upload_dir
                )
                uploaded_files.append(uploaded_file)
            except Exception as e:
                logger.error(f"Error uploading file {original_filename}: {e}")
                # Continue with other files
                continue

        return uploaded_files

    async def _generate_thumbnail(
        self,
        image_path: Path,
        output_dir: Path,
        size: tuple = (200, 200)
    ) -> Optional[str]:
        """Generate thumbnail for image files"""
        try:
            with Image.open(image_path) as img:
                # Convert to RGB if necessary
                if img.mode != 'RGB':
                    img = img.convert('RGB')

                # Create thumbnail
                img.thumbnail(size, Image.Resampling.LANCZOS)

                # Generate thumbnail filename
                thumb_filename = f"thumb_{image_path.stem}.jpg"
                thumb_path = output_dir / thumb_filename

                # Save thumbnail
                img.save(thumb_path, 'JPEG', quality=85)

                return str(thumb_path)
        except Exception as e:
            logger.error(f"Error generating thumbnail for {image_path}: {e}")
            return None

    # File retrieval methods
    def get_files_by_context(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get files by context and context_id"""
        # Handle water-mitigation context specially
        if context == 'water-mitigation':
            return self._get_wm_photos(context_id)

        return self.repository.get_by_context(context, context_id, category, is_active)

    def _get_wm_photos(self, job_id: str) -> List[Dict[str, Any]]:
        """Get water mitigation photos for a job"""
        try:
            from app.domains.water_mitigation.repository import WMPhotoRepository

            wm_photo_repo = WMPhotoRepository(self.repository.session)
            photos = wm_photo_repo.find_by_job(job_id)

            return WMPhotoAdapter.to_file_items(photos)
        except Exception as e:
            logger.error(f"Error retrieving WM photos for job {job_id}: {e}")
            return []

    def get_files_by_type(
        self,
        context: str,
        context_id: str,
        file_type: str,  # 'image' or 'document'
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get files by type (image/document)"""
        # Handle water-mitigation context specially
        if context == 'water-mitigation':
            if file_type == 'image':
                # Get images from wm_photos table
                photos = self._get_wm_photos(context_id)
                return photos
            elif file_type == 'document':
                # Get documents from files table
                return self.repository.get_by_file_type(context, context_id, file_type, is_active)
            else:
                # Get all files
                photos = self._get_wm_photos(context_id)
                documents = self.repository.get_by_file_type(context, context_id, 'document', is_active)
                return photos + documents

        return self.repository.get_by_file_type(context, context_id, file_type, is_active)

    def get_file_count(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        is_active: bool = True
    ) -> int:
        """Get file count by context"""
        # Handle water-mitigation context specially
        if context == 'water-mitigation':
            try:
                from app.domains.water_mitigation.repository import WMPhotoRepository

                wm_photo_repo = WMPhotoRepository(self.repository.session)
                return wm_photo_repo.count_by_job(context_id)
            except Exception as e:
                logger.error(f"Error counting WM photos for job {context_id}: {e}")
                return 0

        return self.repository.get_count_by_context(context, context_id, category, is_active)

    def get_file_count_by_type(
        self,
        context: str,
        context_id: str,
        file_type: str,  # 'image' or 'document'
        is_active: bool = True
    ) -> int:
        """Get file count by type"""
        # Handle water-mitigation context specially
        if context == 'water-mitigation':
            if file_type == 'image':
                try:
                    from app.domains.water_mitigation.repository import WMPhotoRepository

                    wm_photo_repo = WMPhotoRepository(self.repository.session)
                    return wm_photo_repo.count_by_job(context_id)
                except Exception as e:
                    logger.error(f"Error counting WM photos for job {context_id}: {e}")
                    return 0
            else:
                return 0  # WM only has images

        return self.repository.get_count_by_file_type(context, context_id, file_type, is_active)

    def get_categories(
        self,
        context: str,
        context_id: str,
        is_active: bool = True
    ) -> List[str]:
        """Get available categories for a context"""
        return self.repository.get_categories_by_context(context, context_id, is_active)

    def search_files(
        self,
        context: str,
        context_id: str,
        query: str,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Search files"""
        return self.repository.search_files(context, context_id, query, is_active)

    # File management methods
    def update_file_metadata(
        self,
        file_id: str,
        update_data: FileUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update file metadata"""
        return self.repository.update(file_id, update_data.dict(exclude_none=True))

    def delete_file(self, file_id: str, context: Optional[str] = None) -> bool:
        """Soft delete a file"""
        # Handle water-mitigation context specially
        if context == 'water-mitigation':
            return self._delete_wm_photo(file_id)

        return self.repository.soft_delete(file_id)

    def _delete_wm_photo(self, photo_id: str) -> bool:
        """Delete water mitigation photo"""
        try:
            from app.domains.water_mitigation.repository import WMPhotoRepository
            from app.domains.water_mitigation.models import WMPhoto

            wm_photo_repo = WMPhotoRepository(self.repository.session)

            # Query the photo directly from session
            photo = self.repository.session.query(WMPhoto).filter(
                WMPhoto.id == photo_id
            ).first()

            if not photo:
                return False

            # Remove file from filesystem
            file_path = Path(photo.file_path)
            if file_path.exists():
                file_path.unlink()

            # Delete from database
            self.repository.session.delete(photo)
            self.repository.session.commit()

            return True
        except Exception as e:
            logger.error(f"Error deleting WM photo {photo_id}: {e}")
            self.repository.session.rollback()
            return False

    def hard_delete_file(self, file_id: str) -> bool:
        """Hard delete a file (remove from database and filesystem)"""
        try:
            # Get file record
            file_record = self.repository.get_by_id(file_id)
            if not file_record:
                return False

            # Remove from filesystem
            file_path = Path(file_record['url'])
            if file_path.exists():
                file_path.unlink()

            # Remove thumbnail if exists
            if file_record.get('thumbnail_url'):
                thumb_path = Path(file_record['thumbnail_url'])
                if thumb_path.exists():
                    thumb_path.unlink()

            # Remove from database
            return self.repository.delete(file_id)

        except Exception as e:
            logger.error(f"Error hard deleting file {file_id}: {e}")
            return False

    # Utility methods
    def get_file_url(self, file_id: str) -> Optional[str]:
        """Get file URL by ID"""
        file_record = self.repository.get_by_id(file_id)
        return file_record['url'] if file_record else None

    def validate_file_type(self, content_type: str, allowed_types: List[str]) -> bool:
        """Validate if file type is allowed"""
        for allowed_type in allowed_types:
            if allowed_type.endswith('/*'):
                if content_type.startswith(allowed_type[:-1]):
                    return True
            elif content_type == allowed_type:
                return True
        return False

    def validate_file_size(self, file_size: int, max_size: int) -> bool:
        """Validate file size"""
        return file_size <= max_size