"""
Storage module for file management
Supports multiple storage providers (Local, Google Drive, S3, Azure, etc.)

Usage:
    from app.domains.storage import StorageFactory

    # Get storage provider (singleton)
    storage = StorageFactory.get_instance()

    # Upload file
    result = storage.upload(
        file_data=file,
        filename='photo.jpg',
        context='water-mitigation',
        context_id='job-123',
        category='before'
    )

    # Get file URL
    url = storage.get_url(result.file_id)

Configuration:
    Set STORAGE_PROVIDER environment variable:
    - 'local' (default): Local filesystem storage
    - 'gdrive': Google Drive storage
    - 's3': AWS S3 storage (future)
    - 'azure': Azure Blob storage (future)
"""

from .base import StorageProvider, UploadResult, FileMetadata
from .factory import StorageFactory
from .local_provider import LocalStorageProvider

__all__ = [
    'StorageProvider',
    'UploadResult',
    'FileMetadata',
    'StorageFactory',
    'LocalStorageProvider',
]
