"""
Local filesystem storage provider
For development and small deployments
"""

import os
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO, Optional, List, Dict, Any
from datetime import datetime
import mimetypes
import logging

from .base import StorageProvider, UploadResult, FileMetadata
from PIL import Image

logger = logging.getLogger(__name__)


class LocalStorageProvider(StorageProvider):
    """
    Local filesystem storage provider

    Structure: {base_dir}/{context}/{context_id}/{category}/{filename}
    Example: uploads/water-mitigation/job-123/before/photo.jpg
    """

    def __init__(self, base_dir: str = "uploads"):
        """
        Initialize local storage provider

        Args:
            base_dir: Base directory for file storage
        """
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def upload(
        self,
        file_data: BinaryIO,
        filename: str,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        content_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> UploadResult:
        """Upload file to local filesystem"""
        try:
            # Generate unique file ID
            file_extension = Path(filename).suffix.lower()
            file_id = f"{uuid.uuid4()}{file_extension}"

            # Build directory structure
            folder_parts = [context, context_id]
            if category:
                folder_parts.append(category)

            folder_path = "/".join(folder_parts)
            target_dir = self.base_dir / Path(*folder_parts)
            target_dir.mkdir(parents=True, exist_ok=True)

            # Save file
            file_path = target_dir / file_id
            with open(file_path, 'wb') as f:
                file_data.seek(0)
                shutil.copyfileobj(file_data, f)

            # Generate thumbnail for images
            thumbnail_url = None
            if content_type and content_type.startswith('image/'):
                thumbnail_url = self._generate_thumbnail(file_path, target_dir)

            # Build file URL (relative path)
            file_url = str(file_path.relative_to(self.base_dir))

            logger.info(f"File uploaded: {file_url}")

            return UploadResult(
                file_id=file_id,
                file_url=file_url,
                thumbnail_url=thumbnail_url,
                folder_path=folder_path,
                storage_metadata={
                    'absolute_path': str(file_path),
                    'size': file_path.stat().st_size
                }
            )

        except Exception as e:
            logger.error(f"Local upload failed: {e}")
            raise

    def download(self, file_id: str) -> bytes:
        """Download file content"""
        file_path = self._find_file_path(file_id)
        if not file_path or not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_id}")

        with open(file_path, 'rb') as f:
            return f.read()

    def delete(self, file_id: str) -> bool:
        """Delete file from filesystem"""
        try:
            file_path = self._find_file_path(file_id)
            if file_path and file_path.exists():
                file_path.unlink()

                # Delete thumbnail if exists
                thumb_path = file_path.parent / f"thumb_{file_path.stem}.jpg"
                if thumb_path.exists():
                    thumb_path.unlink()

                logger.info(f"File deleted: {file_id}")
                return True
            return False

        except Exception as e:
            logger.error(f"Delete failed for {file_id}: {e}")
            return False

    def get_url(self, file_id: str, expires_in: Optional[int] = None) -> str:
        """Get file URL (relative path for local storage)"""
        file_path = self._find_file_path(file_id)
        if not file_path:
            raise FileNotFoundError(f"File not found: {file_id}")

        return str(file_path.relative_to(self.base_dir))

    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """Get file metadata"""
        file_path = self._find_file_path(file_id)
        if not file_path or not file_path.exists():
            return None

        stat = file_path.stat()
        mime_type, _ = mimetypes.guess_type(str(file_path))

        return FileMetadata(
            file_id=file_id,
            filename=file_path.name,
            size=stat.st_size,
            mime_type=mime_type or 'application/octet-stream',
            created_at=datetime.fromtimestamp(stat.st_ctime),
            url=str(file_path.relative_to(self.base_dir)),
            folder_path=str(file_path.parent.relative_to(self.base_dir))
        )

    def update_metadata(
        self,
        file_id: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update file metadata (rename file if filename provided)"""
        try:
            file_path = self._find_file_path(file_id)
            if not file_path or not file_path.exists():
                return False

            # Rename file if new filename provided
            if filename:
                new_path = file_path.parent / filename
                file_path.rename(new_path)
                logger.info(f"File renamed: {file_id} to {filename}")

            return True

        except Exception as e:
            logger.error(f"Update metadata failed for {file_id}: {e}")
            return False

    def list_files(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None
    ) -> List[FileMetadata]:
        """List files in directory"""
        folder_parts = [context, context_id]
        if category:
            folder_parts.append(category)

        target_dir = self.base_dir / Path(*folder_parts)
        if not target_dir.exists():
            return []

        files = []
        for file_path in target_dir.iterdir():
            if file_path.is_file() and not file_path.name.startswith('thumb_'):
                metadata = self.get_metadata(file_path.name)
                if metadata:
                    files.append(metadata)

        return files

    def move(
        self,
        file_id: str,
        new_category: str,
        context: str,
        context_id: str
    ) -> bool:
        """Move file to different category folder"""
        try:
            file_path = self._find_file_path(file_id)
            if not file_path or not file_path.exists():
                return False

            # Build new path
            new_dir = self.base_dir / context / context_id / new_category
            new_dir.mkdir(parents=True, exist_ok=True)
            new_path = new_dir / file_path.name

            # Move file
            shutil.move(str(file_path), str(new_path))

            # Move thumbnail if exists
            thumb_path = file_path.parent / f"thumb_{file_path.stem}.jpg"
            if thumb_path.exists():
                new_thumb_path = new_dir / thumb_path.name
                shutil.move(str(thumb_path), str(new_thumb_path))

            logger.info(f"File moved: {file_id} to {new_category}")
            return True

        except Exception as e:
            logger.error(f"Move failed for {file_id}: {e}")
            return False

    def exists(self, file_id: str) -> bool:
        """Check if file exists"""
        file_path = self._find_file_path(file_id)
        return file_path is not None and file_path.exists()

    @property
    def provider_name(self) -> str:
        """Provider name"""
        return "local"

    # Helper methods

    def _find_file_path(self, file_id: str) -> Optional[Path]:
        """Find file path by searching base directory"""
        for file_path in self.base_dir.rglob(file_id):
            if file_path.is_file():
                return file_path
        return None

    def _generate_thumbnail(
        self,
        image_path: Path,
        output_dir: Path,
        size: tuple = (200, 200)
    ) -> Optional[str]:
        """Generate thumbnail for image"""
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

                return str(thumb_path.relative_to(self.base_dir))

        except Exception as e:
            logger.error(f"Thumbnail generation failed: {e}")
            return None
