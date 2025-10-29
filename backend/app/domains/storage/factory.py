"""
Storage factory for creating storage provider instances
Supports dynamic provider selection via configuration
"""

import os
import logging
from typing import Optional

from .base import StorageProvider
from .local_provider import LocalStorageProvider

logger = logging.getLogger(__name__)


class StorageFactory:
    """
    Factory for creating storage providers

    Supported providers:
    - local: Local filesystem storage
    - gdrive: Google Drive storage
    - gcs: Google Cloud Storage
    - s3: AWS S3 storage (future)
    - azure: Azure Blob storage (future)

    Configuration via environment variables:
    - STORAGE_PROVIDER: Provider type (default: 'local')
    - STORAGE_BASE_DIR: Base directory for local storage
    - GDRIVE_SERVICE_ACCOUNT_FILE: Google Drive service account JSON path
    - GDRIVE_ROOT_FOLDER_ID: Google Drive root folder ID
    - GCS_BUCKET_NAME: GCS bucket name
    - GCS_SERVICE_ACCOUNT_FILE: GCS service account JSON path
    - GCS_MAKE_PUBLIC: Make uploaded files public (default: false)
    """

    _instance: Optional[StorageProvider] = None
    _provider_type: Optional[str] = None

    @classmethod
    def create(cls, provider_type: Optional[str] = None) -> StorageProvider:
        """
        Create storage provider instance

        Args:
            provider_type: Provider type ('local', 'gdrive', 'gcs', 's3', 'azure')
                          If None, uses STORAGE_PROVIDER env var (default: 'local')

        Returns:
            StorageProvider instance

        Raises:
            ValueError: If provider type is not supported
            RuntimeError: If required configuration is missing
        """
        # Get provider type from parameter or environment
        if provider_type is None:
            provider_type = os.getenv('STORAGE_PROVIDER', 'local').lower()

        # Create provider
        if provider_type == 'local':
            return cls._create_local_provider()

        elif provider_type == 'gdrive':
            return cls._create_google_drive_provider()

        elif provider_type == 'gcs':
            return cls._create_gcs_provider()

        elif provider_type == 's3':
            raise NotImplementedError("AWS S3 provider not yet implemented")

        elif provider_type == 'azure':
            raise NotImplementedError("Azure Blob provider not yet implemented")

        else:
            raise ValueError(f"Unsupported storage provider: {provider_type}")

    @classmethod
    def get_instance(cls, provider_type: Optional[str] = None) -> StorageProvider:
        """
        Get singleton storage provider instance

        Args:
            provider_type: Provider type (optional)

        Returns:
            Cached StorageProvider instance
        """
        # Check if provider type changed
        current_provider_type = provider_type or os.getenv('STORAGE_PROVIDER', 'local').lower()

        if cls._instance is None or cls._provider_type != current_provider_type:
            cls._instance = cls.create(provider_type)
            cls._provider_type = current_provider_type
            logger.info(f"Storage provider initialized: {cls._provider_type}")
        else:
            # Provider already initialized - reusing cached instance (no INFO log to reduce noise)
            logger.debug(f"Reusing cached storage provider: {cls._provider_type}")

        return cls._instance

    @classmethod
    def _create_local_provider(cls) -> LocalStorageProvider:
        """Create local storage provider"""
        base_dir = os.getenv('STORAGE_BASE_DIR', 'uploads')
        logger.info(f"Creating local storage provider: base_dir={base_dir}")
        return LocalStorageProvider(base_dir=base_dir)

    @classmethod
    def _create_google_drive_provider(cls):
        """Create Google Drive storage provider"""
        from .google_drive_provider import GoogleDriveProvider

        # Get required configuration
        service_account_file = os.getenv('GDRIVE_SERVICE_ACCOUNT_FILE')
        root_folder_id = os.getenv('GDRIVE_ROOT_FOLDER_ID')

        if not service_account_file:
            raise RuntimeError(
                "GDRIVE_SERVICE_ACCOUNT_FILE environment variable is required for Google Drive storage"
            )

        if not root_folder_id:
            raise RuntimeError(
                "GDRIVE_ROOT_FOLDER_ID environment variable is required for Google Drive storage"
            )

        logger.info(f"Creating Google Drive storage provider: root_folder_id={root_folder_id}")

        return GoogleDriveProvider(
            service_account_file=service_account_file,
            root_folder_id=root_folder_id
        )

    @classmethod
    def _create_gcs_provider(cls):
        """Create Google Cloud Storage provider"""
        from .gcs_provider import GCSProvider

        # Get required configuration
        bucket_name = os.getenv('GCS_BUCKET_NAME')
        service_account_file = os.getenv('GCS_SERVICE_ACCOUNT_FILE')
        make_public = os.getenv('GCS_MAKE_PUBLIC', 'false').lower() == 'true'

        if not bucket_name:
            raise RuntimeError(
                "GCS_BUCKET_NAME environment variable is required for GCS storage"
            )

        logger.debug(f"Creating GCS storage provider: bucket={bucket_name}, optimizations=enabled")

        return GCSProvider(
            bucket_name=bucket_name,
            service_account_file=service_account_file,
            make_public=make_public,
            enable_optimization=True  # Enable cost-saving optimizations
        )

    @classmethod
    def reset(cls):
        """Reset singleton instance (for testing)"""
        cls._instance = None
        cls._provider_type = None
