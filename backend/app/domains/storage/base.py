"""
Base storage provider interface
All storage providers (Google Drive, S3, Azure, Local) must implement this interface
"""

from abc import ABC, abstractmethod
from typing import BinaryIO, Optional, List, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class UploadResult:
    """Result of file upload operation"""
    file_id: str                        # Unique file identifier
    file_path: str                      # File path in storage
    file_url: str = ""                  # Accessible URL
    thumbnail_url: Optional[str] = None  # Thumbnail URL (if available)
    folder_path: Optional[str] = None   # Hierarchical path (e.g., "context/job_id/category")
    storage_metadata: Optional[Dict[str, Any]] = None  # Provider-specific metadata


@dataclass
class FileMetadata:
    """File metadata"""
    file_id: str
    filename: str
    size: int
    mime_type: str
    created_at: datetime
    url: str
    thumbnail_url: Optional[str] = None
    folder_path: Optional[str] = None
    custom_properties: Optional[Dict[str, Any]] = None


class StorageProvider(ABC):
    """
    Abstract base class for storage providers

    Implementations:
    - LocalStorageProvider: Local filesystem storage
    - GoogleDriveProvider: Google Drive storage
    - GCSProvider: Google Cloud Storage
    - S3Provider: AWS S3 storage (future)
    - AzureBlobProvider: Azure Blob storage (future)

    Optional: Providers can enable storage optimization by setting
    enable_optimization=True in constructor
    """

    def __init__(self):
        """Initialize provider with optional optimization"""
        self.enable_optimization = False
        self.optimizer = None

    def _apply_optimizations(
        self,
        file_data: BinaryIO,
        filename: str,
        content_type: Optional[str] = None
    ) -> tuple[BinaryIO, Dict[str, Any]]:
        """
        Apply storage optimizations if enabled

        Args:
            file_data: File data
            filename: Original filename
            content_type: MIME type

        Returns:
            Tuple of (optimized_file, optimization_metadata)
        """
        if not self.enable_optimization or not self.optimizer:
            return file_data, {}

        try:
            from .optimization import StorageOptimizer

            if not isinstance(self.optimizer, StorageOptimizer):
                self.optimizer = StorageOptimizer()

            optimized_file, metadata = self.optimizer.optimize_file(
                file_data, filename, content_type
            )

            logger.info(f"Optimizations applied: {metadata.get('optimizations_applied', [])}")
            return optimized_file, metadata

        except Exception as e:
            logger.warning(f"Optimization failed, using original file: {e}")
            file_data.seek(0)
            return file_data, {'optimization_error': str(e)}

    @abstractmethod
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
        """
        Upload file to storage

        Args:
            file_data: File binary data
            filename: Original filename
            context: Context type (e.g., 'water-mitigation', 'estimate')
            context_id: Context ID (e.g., job_id)
            category: File category (e.g., 'before', 'after')
            content_type: MIME type
            metadata: Additional metadata

        Returns:
            UploadResult with file_id, urls, and metadata
        """
        pass

    @abstractmethod
    def download(self, file_id: str) -> bytes:
        """
        Download file content

        Args:
            file_id: File identifier

        Returns:
            File binary data
        """
        pass

    @abstractmethod
    def delete(self, file_id: str) -> bool:
        """
        Delete file from storage

        Args:
            file_id: File identifier

        Returns:
            True if successful, False otherwise
        """
        pass

    @abstractmethod
    def get_url(self, file_id: str, expires_in: Optional[int] = None) -> str:
        """
        Get accessible URL for file

        Args:
            file_id: File identifier
            expires_in: URL expiration in seconds (if applicable)

        Returns:
            Accessible URL
        """
        pass

    @abstractmethod
    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """
        Get file metadata

        Args:
            file_id: File identifier

        Returns:
            FileMetadata or None if not found
        """
        pass

    @abstractmethod
    def update_metadata(
        self,
        file_id: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Update file metadata

        Args:
            file_id: File identifier
            filename: New filename (optional)
            metadata: Updated metadata (optional)

        Returns:
            True if successful, False otherwise
        """
        pass

    @abstractmethod
    def list_files(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None
    ) -> List[FileMetadata]:
        """
        List files by context

        Args:
            context: Context type
            context_id: Context ID
            category: File category (optional)

        Returns:
            List of FileMetadata
        """
        pass

    @abstractmethod
    def move(
        self,
        file_id: str,
        new_category: str,
        context: str,
        context_id: str
    ) -> bool:
        """
        Move file to different category/folder

        Args:
            file_id: File identifier
            new_category: New category
            context: Context type
            context_id: Context ID

        Returns:
            True if successful, False otherwise
        """
        pass

    @abstractmethod
    def exists(self, file_id: str) -> bool:
        """
        Check if file exists

        Args:
            file_id: File identifier

        Returns:
            True if exists, False otherwise
        """
        pass

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Storage provider name (e.g., 'local', 'gdrive', 's3')"""
        pass
