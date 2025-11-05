"""
Google Cloud Storage provider with optimization support
Production-ready storage with Service Account support
Applicable to GCS, S3, Azure with same optimization patterns
"""

import os
import io
from typing import BinaryIO, Optional, List, Dict, Any
from datetime import datetime, timedelta
import logging

from google.cloud import storage
from google.oauth2 import service_account
from google.api_core import exceptions

from .base import StorageProvider, UploadResult, FileMetadata

logger = logging.getLogger(__name__)


class GCSProvider(StorageProvider):
    """
    Google Cloud Storage provider with built-in optimization

    Features:
    - Service Account authentication
    - Hierarchical folder structure
    - Automatic image optimization (WebP conversion, resizing)
    - File deduplication (hash-based)
    - Text file compression (Gzip)
    - Public/private access control
    - CDN integration ready

    Same optimization patterns applicable to:
    - AWS S3 (S3Provider)
    - Azure Blob Storage (AzureBlobProvider)
    - Any object storage system
    """

    def __init__(
        self,
        bucket_name: str,
        service_account_file: Optional[str] = None,
        project_id: Optional[str] = None,
        make_public: bool = False,
        enable_optimization: bool = True
    ):
        """
        Initialize GCS provider

        Args:
            bucket_name: GCS bucket name
            service_account_file: Path to service account JSON file (optional)
            project_id: GCP project ID (optional, read from service account)
            make_public: Make uploaded files publicly accessible
            enable_optimization: Enable storage optimization (90-95% cost reduction)
        """
        super().__init__()
        self.bucket_name = bucket_name
        self.make_public = make_public
        self.enable_optimization = enable_optimization

        # Initialize optimizer if enabled
        if self.enable_optimization:
            from .optimization import StorageOptimizer
            self.optimizer = StorageOptimizer(
                enable_image_optimization=True,
                enable_deduplication=True,
                enable_compression=True,
                image_quality=85,
                image_format='WebP'
            )
            logger.info("GCS provider initialized with optimization enabled")

        # Initialize GCS client
        if service_account_file:
            credentials = service_account.Credentials.from_service_account_file(
                service_account_file
            )
            self.client = storage.Client(
                credentials=credentials,
                project=project_id or credentials.project_id
            )
        else:
            # Use default credentials (for Cloud Run, etc.)
            self.client = storage.Client(project=project_id)

        # Get bucket
        try:
            self.bucket = self.client.bucket(bucket_name)
            if not self.bucket.exists():
                logger.warning(f"Bucket {bucket_name} does not exist. Creating...")
                self.bucket.create()
            logger.info(f"GCS provider initialized: bucket={bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GCS bucket: {e}")
            raise RuntimeError(f"GCS bucket initialization failed: {e}")

    def _strip_gs_prefix(self, file_id: str) -> str:
        """Strip gs:// prefix from file path if present"""
        if file_id.startswith('gs://'):
            # Extract path after bucket name
            # Format: gs://bucket-name/path/to/file
            parts = file_id.replace('gs://', '').split('/', 1)
            if len(parts) == 2:
                return parts[1]
        return file_id

    def _build_blob_path(
        self,
        context: str,
        context_id: str,
        filename: str,
        category: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """Build hierarchical blob path"""
        # Create job folder name with metadata
        if metadata and 'address' in metadata:
            address = metadata['address'].replace(' ', '-').replace('/', '-')
            job_folder_name = f"{context_id}_{address}"
        else:
            job_folder_name = context_id

        # Build path: context/job_folder/category/filename
        parts = [context, job_folder_name]
        if category:
            parts.append(category)
        parts.append(filename)

        return '/'.join(parts)

    def upload(
        self,
        file_data: BinaryIO,
        filename: str,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        content_type: Optional[str] = None
    ) -> UploadResult:
        """Upload file to GCS with optional optimization"""
        try:
            # Apply optimizations (image compression, dedup, etc.)
            optimized_file, opt_metadata = self._apply_optimizations(
                file_data, filename, content_type
            )

            # Update content type and filename if image was optimized to WebP
            if 'image_optimization' in opt_metadata:
                img_opt = opt_metadata['image_optimization']
                if img_opt.get('optimized_format') == 'WebP':
                    content_type = 'image/webp'
                    filename = filename.rsplit('.', 1)[0] + '.webp'
                logger.info(f"Image optimized: {img_opt.get('compression_ratio', '0%')} reduction")

            # Check deduplication
            dedup_key = opt_metadata.get('dedup_key')
            if dedup_key:
                # Check if file already exists (dedup)
                dedup_blob = self.bucket.blob(f"_dedup/{dedup_key}.meta")
                if dedup_blob.exists():
                    existing_path = dedup_blob.download_as_text()
                    logger.info(f"Duplicate file detected: {opt_metadata.get('file_hash', 'unknown')}")
                    return UploadResult(
                        file_id=existing_path,
                        file_path=existing_path,
                        file_url=f"gs://{self.bucket_name}/{existing_path}",
                        folder_path=existing_path.rsplit('/', 1)[0],
                        storage_metadata={
                            'deduplicated': True,
                            'original_path': existing_path,
                            'file_hash': opt_metadata.get('file_hash')
                        }
                    )

            # Build blob path
            blob_path = self._build_blob_path(
                context, context_id, filename, category, metadata
            )

            logger.info(f"Uploading to GCS: {blob_path}")

            # Create blob
            blob = self.bucket.blob(blob_path)

            # Set content type
            if content_type:
                blob.content_type = content_type

            # Build metadata
            blob_metadata = {
                'context': context,
                'context_id': context_id,
                'category': category or '',
                'original_filename': filename,
                'uploaded_at': datetime.utcnow().isoformat()
            }

            # Add job metadata
            if metadata:
                for key, value in metadata.items():
                    if isinstance(value, (str, int, float, bool)):
                        blob_metadata[f'job_{key}'] = str(value)

            # Add optimization metadata
            if opt_metadata and opt_metadata.get('optimizations_applied'):
                blob_metadata['optimized'] = 'true'
                for opt in opt_metadata.get('optimizations_applied', []):
                    blob_metadata[f'opt_{opt}'] = 'true'
                if 'file_hash' in opt_metadata:
                    blob_metadata['file_hash'] = opt_metadata['file_hash']

            blob.metadata = blob_metadata

            # Upload file
            optimized_file.seek(0)
            blob.upload_from_file(optimized_file, content_type=content_type)

            # Save dedup reference if enabled
            if dedup_key:
                dedup_blob.upload_from_string(blob_path)

            # Make public if configured
            if self.make_public:
                blob.make_public()

            # Get URL
            if self.make_public:
                file_url = blob.public_url
            else:
                file_url = f"gs://{self.bucket_name}/{blob_path}"

            logger.info(f"File uploaded to GCS: {filename} -> {blob_path}")

            # Extract folder path
            folder_parts = blob_path.split('/')[:-1]
            folder_path = '/'.join(folder_parts) if folder_parts else ''

            return UploadResult(
                file_id=blob_path,
                file_path=blob_path,
                file_url=file_url,
                thumbnail_url=None,  # GCS doesn't auto-generate thumbnails
                folder_path=folder_path,
                storage_metadata={
                    'bucket': self.bucket_name,
                    'blob_name': blob_path,
                    'size': blob.size,
                    'content_type': blob.content_type,
                    'public': self.make_public,
                    'optimizations': opt_metadata.get('optimizations_applied', [])
                }
            )

        except Exception as e:
            logger.error(f"GCS upload failed: {e}")
            raise RuntimeError(f"Failed to upload to GCS: {e}")

    def download(self, file_id: str) -> bytes:
        """Download file from GCS"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)

            if not blob.exists():
                raise FileNotFoundError(f"File not found in GCS: {file_id}")

            logger.info(f"Downloading from GCS: {file_id}")
            return blob.download_as_bytes()

        except exceptions.NotFound:
            raise FileNotFoundError(f"File not found in GCS: {file_id}")
        except Exception as e:
            logger.error(f"GCS download failed: {e}")
            raise RuntimeError(f"Failed to download from GCS: {e}")

    def delete(self, file_id: str) -> bool:
        """Delete file from GCS"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)

            if not blob.exists():
                logger.warning(f"File not found for deletion: {file_id}")
                return False

            blob.delete()
            logger.info(f"File deleted from GCS: {file_id}")
            return True

        except Exception as e:
            logger.error(f"GCS delete failed: {e}")
            return False

    def get_url(self, file_id: str, expires_in: Optional[int] = None) -> str:
        """Get file URL (public or signed)"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)

            if not blob.exists():
                raise FileNotFoundError(f"File not found in GCS: {file_id}")

            # Return public URL if configured
            if self.make_public:
                return blob.public_url

            # Generate signed URL
            if expires_in:
                expiration = timedelta(seconds=expires_in)
            else:
                expiration = timedelta(hours=1)  # Default 1 hour

            url = blob.generate_signed_url(
                version="v4",
                expiration=expiration,
                method="GET"
            )

            return url

        except Exception as e:
            logger.error(f"Failed to get GCS URL: {e}")
            raise RuntimeError(f"Failed to get URL: {e}")

    def list_files(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None
    ) -> List[FileMetadata]:
        """List files in specific context/category"""
        try:
            # Build prefix
            prefix_parts = [context, context_id]
            if category:
                prefix_parts.append(category)
            prefix = '/'.join(prefix_parts) + '/'

            logger.info(f"Listing files in GCS: prefix={prefix}")

            # List blobs
            blobs = self.bucket.list_blobs(prefix=prefix)

            files = []
            for blob in blobs:
                # Skip folder markers and dedup metadata
                if blob.name.endswith('/') or '/_dedup/' in blob.name:
                    continue

                filename = blob.name.split('/')[-1]

                files.append(FileMetadata(
                    file_id=blob.name,
                    filename=filename,
                    size=blob.size or 0,
                    mime_type=blob.content_type or '',
                    created_at=blob.time_created,
                    url=blob.public_url if self.make_public else f"gs://{self.bucket_name}/{blob.name}",
                    custom_properties=blob.metadata or {}
                ))

            logger.info(f"Found {len(files)} files in {prefix}")
            return files

        except Exception as e:
            logger.error(f"GCS list failed: {e}")
            return []

    def update_metadata(
        self,
        file_id: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update file metadata"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)

            if not blob.exists():
                logger.warning(f"File not found for metadata update: {file_id}")
                return False

            # Reload to get current metadata
            blob.reload()

            # Update metadata
            if metadata:
                current_metadata = blob.metadata or {}
                current_metadata.update(metadata)
                blob.metadata = current_metadata

            # Patch blob
            blob.patch()

            logger.info(f"Metadata updated for: {file_id}")
            return True

        except Exception as e:
            logger.error(f"GCS metadata update failed: {e}")
            return False

    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """Get file metadata"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)

            if not blob.exists():
                return None

            blob.reload()

            return FileMetadata(
                file_id=blob.name,
                filename=blob.name.split('/')[-1],
                size=blob.size or 0,
                mime_type=blob.content_type or '',
                created_at=blob.time_created,
                url=blob.public_url if self.make_public else f"gs://{self.bucket_name}/{blob.name}",
                custom_properties=blob.metadata or {}
            )

        except Exception as e:
            logger.error(f"Failed to get metadata: {e}")
            return None

    def move(
        self,
        file_id: str,
        new_category: str,
        context: str,
        context_id: str
    ) -> bool:
        """Move file to different category/folder"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            source_blob = self.bucket.blob(blob_path)

            if not source_blob.exists():
                logger.warning(f"Source file not found: {file_id}")
                return False

            # Build new path
            filename = file_id.split('/')[-1]
            new_path = self._build_blob_path(
                context, context_id, filename, new_category, None
            )

            # Copy to new location
            self.bucket.copy_blob(source_blob, self.bucket, new_path)

            # Delete old file
            source_blob.delete()

            logger.info(f"File moved: {file_id} -> {new_path}")
            return True

        except Exception as e:
            logger.error(f"GCS move failed: {e}")
            return False

    def exists(self, file_id: str) -> bool:
        """Check if file exists"""
        try:
            # Strip gs:// prefix if present
            blob_path = self._strip_gs_prefix(file_id)
            blob = self.bucket.blob(blob_path)
            return blob.exists()
        except Exception as e:
            logger.error(f"GCS exists check failed: {e}")
            return False

    @property
    def provider_name(self) -> str:
        """Storage provider name"""
        return 'gcs'
