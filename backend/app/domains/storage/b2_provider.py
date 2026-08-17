"""
Backblaze B2 storage provider (S3-compatible API)
Lower-cost alternative to GCS for small/medium deployments

Same optimization patterns as GCSProvider - reuses StorageOptimizer
"""

from typing import BinaryIO, Optional, List, Dict, Any
from datetime import datetime
import logging

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from .base import StorageProvider, UploadResult, FileMetadata

logger = logging.getLogger(__name__)


class B2Provider(StorageProvider):
    """
    Backblaze B2 storage provider via S3-compatible API

    Features (same as GCSProvider):
    - Hierarchical folder structure
    - Automatic image optimization (WebP conversion, resizing)
    - File deduplication (hash-based)
    - Text file compression (Gzip)
    - Public/private access control

    Pricing (vs GCS Standard $0.020/GB/month):
    - Storage: $0.006/GB/month (~3x cheaper)
    - Download: 3x daily storage free/day, then $0.01/GB
    - First 10GB storage and 1GB/day download free
    """

    def __init__(
        self,
        bucket_name: str,
        key_id: str,
        application_key: str,
        endpoint_url: str,
        make_public: bool = False,
        enable_optimization: bool = True
    ):
        """
        Initialize B2 provider

        Args:
            bucket_name: B2 bucket name
            key_id: B2 application key ID
            application_key: B2 application key secret
            endpoint_url: B2 S3-compatible endpoint (e.g. https://s3.us-west-004.backblazeb2.com)
            make_public: Make uploaded files publicly accessible (bucket must allow public access)
            enable_optimization: Enable storage optimization (90-95% cost reduction)
        """
        super().__init__()
        self.bucket_name = bucket_name
        self.endpoint_url = endpoint_url
        self.make_public = make_public
        self.enable_optimization = enable_optimization

        if self.enable_optimization:
            from .optimization import StorageOptimizer
            self.optimizer = StorageOptimizer(
                enable_image_optimization=True,
                enable_deduplication=True,
                enable_compression=True,
                image_quality=85,
                image_format='WebP'
            )
            logger.info("B2 provider initialized with optimization enabled")

        try:
            # region_name is required by boto3's signer even though B2 ignores
            # it operationally; without it boto3 falls back to slow region
            # auto-discovery on first request. Derived from the endpoint host
            # (e.g. s3.us-east-005.backblazeb2.com -> us-east-005).
            region_name = endpoint_url.split('//')[-1].split('.')[1]
            self.client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=key_id,
                aws_secret_access_key=application_key,
                region_name=region_name,
                config=Config(
                    signature_version='s3v4',
                    connect_timeout=10,
                    read_timeout=30,
                    retries={'max_attempts': 3, 'mode': 'standard'},
                )
            )
            logger.info(f"B2 provider initialized: bucket={bucket_name}, region={region_name}")
        except Exception as e:
            logger.error(f"Failed to initialize B2 client: {e}")
            raise RuntimeError(f"B2 client initialization failed: {e}")

    def _strip_b2_prefix(self, file_id: str) -> str:
        """Strip b2:// prefix from file path if present"""
        if file_id.startswith('b2://'):
            # Format: b2://bucket-name/path/to/file
            parts = file_id.replace('b2://', '').split('/', 1)
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
        """Build hierarchical object key (same layout as GCSProvider)"""
        if metadata and 'address' in metadata:
            address = metadata['address'].replace(' ', '-').replace('/', '-')
            job_folder_name = f"{context_id}_{address}"
        else:
            job_folder_name = context_id

        parts = [context, job_folder_name]
        if category:
            parts.append(category)
        parts.append(filename)

        return '/'.join(parts)

    def _object_exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey'):
                return False
            raise

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
        """Upload file to B2 with optional optimization"""
        try:
            optimized_file, opt_metadata = self._apply_optimizations(
                file_data, filename, content_type
            )

            if 'image_optimization' in opt_metadata:
                img_opt = opt_metadata['image_optimization']
                if img_opt.get('optimized_format') == 'WebP':
                    content_type = 'image/webp'
                    filename = filename.rsplit('.', 1)[0] + '.webp'
                logger.info(f"Image optimized: {img_opt.get('compression_ratio', '0%')} reduction")

            # Check deduplication
            dedup_key = opt_metadata.get('dedup_key')
            if dedup_key:
                dedup_meta_key = f"_dedup/{dedup_key}.meta"
                if self._object_exists(dedup_meta_key):
                    existing_obj = self.client.get_object(Bucket=self.bucket_name, Key=dedup_meta_key)
                    existing_path = existing_obj['Body'].read().decode('utf-8')
                    logger.info(f"Duplicate file detected: {opt_metadata.get('file_hash', 'unknown')}")
                    return UploadResult(
                        file_id=existing_path,
                        file_path=existing_path,
                        file_url=f"b2://{self.bucket_name}/{existing_path}",
                        folder_path=existing_path.rsplit('/', 1)[0],
                        storage_metadata={
                            'deduplicated': True,
                            'original_path': existing_path,
                            'file_hash': opt_metadata.get('file_hash')
                        }
                    )

            blob_path = self._build_blob_path(
                context, context_id, filename, category, metadata
            )

            logger.info(f"Uploading to B2: {blob_path}")

            # Build metadata (S3 metadata values must be strings)
            blob_metadata = {
                'context': context,
                'context_id': context_id,
                'category': category or '',
                'original_filename': filename,
                'uploaded_at': datetime.utcnow().isoformat()
            }

            if metadata:
                for key, value in metadata.items():
                    if isinstance(value, (str, int, float, bool)):
                        blob_metadata[f'job_{key}'] = str(value)

            if opt_metadata and opt_metadata.get('optimizations_applied'):
                blob_metadata['optimized'] = 'true'
                for opt in opt_metadata.get('optimizations_applied', []):
                    blob_metadata[f'opt_{opt}'] = 'true'
                if 'file_hash' in opt_metadata:
                    blob_metadata['file_hash'] = opt_metadata['file_hash']

            optimized_file.seek(0)
            file_bytes = optimized_file.read()

            put_kwargs = {
                'Bucket': self.bucket_name,
                'Key': blob_path,
                'Body': file_bytes,
                'Metadata': blob_metadata
            }
            if content_type:
                put_kwargs['ContentType'] = content_type
            if self.make_public:
                put_kwargs['ACL'] = 'public-read'

            self.client.put_object(**put_kwargs)

            # Save dedup reference if enabled
            if dedup_key:
                self.client.put_object(
                    Bucket=self.bucket_name,
                    Key=dedup_meta_key,
                    Body=blob_path.encode('utf-8')
                )

            if self.make_public:
                file_url = f"{self.endpoint_url}/{self.bucket_name}/{blob_path}"
            else:
                file_url = f"b2://{self.bucket_name}/{blob_path}"

            logger.info(f"File uploaded to B2: {filename} -> {blob_path}")

            folder_parts = blob_path.split('/')[:-1]
            folder_path = '/'.join(folder_parts) if folder_parts else ''

            return UploadResult(
                file_id=blob_path,
                file_path=blob_path,
                file_url=file_url,
                thumbnail_url=None,  # B2 doesn't auto-generate thumbnails
                folder_path=folder_path,
                storage_metadata={
                    'bucket': self.bucket_name,
                    'blob_name': blob_path,
                    'size': len(file_bytes),
                    'content_type': content_type,
                    'public': self.make_public,
                    'optimizations': opt_metadata.get('optimizations_applied', [])
                }
            )

        except Exception as e:
            logger.error(f"B2 upload failed: {e}")
            raise RuntimeError(f"Failed to upload to B2: {e}")

    def download(self, file_id: str) -> bytes:
        """Download file from B2"""
        try:
            blob_path = self._strip_b2_prefix(file_id).replace('\\', '/')

            logger.info(f"Downloading from B2: {file_id}")
            obj = self.client.get_object(Bucket=self.bucket_name, Key=blob_path)
            return obj['Body'].read()

        except ClientError as e:
            if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey'):
                raise FileNotFoundError(f"File not found in B2: {file_id}")
            logger.error(f"B2 download failed: {e}")
            raise RuntimeError(f"Failed to download from B2: {e}")
        except Exception as e:
            logger.error(f"B2 download failed: {e}")
            raise RuntimeError(f"Failed to download from B2: {e}")

    def delete(self, file_id: str) -> bool:
        """Delete file from B2"""
        try:
            blob_path = self._strip_b2_prefix(file_id)

            if not self._object_exists(blob_path):
                logger.warning(f"File not found for deletion: {file_id}")
                return False

            self.client.delete_object(Bucket=self.bucket_name, Key=blob_path)
            logger.info(f"File deleted from B2: {file_id}")
            return True

        except Exception as e:
            logger.error(f"B2 delete failed: {e}")
            return False

    def get_url(self, file_id: str, expires_in: Optional[int] = None) -> str:
        """Get file URL (public or presigned)"""
        try:
            blob_path = self._strip_b2_prefix(file_id)

            if not self._object_exists(blob_path):
                raise FileNotFoundError(f"File not found in B2: {file_id}")

            if self.make_public:
                return f"{self.endpoint_url}/{self.bucket_name}/{blob_path}"

            url = self.client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': blob_path},
                ExpiresIn=expires_in or 3600
            )
            return url

        except FileNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Failed to get B2 URL: {e}")
            raise RuntimeError(f"Failed to get URL: {e}")

    def list_files(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None
    ) -> List[FileMetadata]:
        """List files in specific context/category"""
        try:
            prefix_parts = [context, context_id]
            if category:
                prefix_parts.append(category)
            prefix = '/'.join(prefix_parts) + '/'

            logger.info(f"Listing files in B2: prefix={prefix}")

            files = []
            paginator = self.client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.endswith('/') or '/_dedup/' in key:
                        continue

                    filename = key.split('/')[-1]

                    files.append(FileMetadata(
                        file_id=key,
                        filename=filename,
                        size=obj.get('Size', 0),
                        mime_type='',  # list_objects_v2 doesn't return content-type
                        created_at=obj.get('LastModified', datetime.utcnow()),
                        url=f"{self.endpoint_url}/{self.bucket_name}/{key}" if self.make_public else f"b2://{self.bucket_name}/{key}",
                        custom_properties={}
                    ))

            logger.info(f"Found {len(files)} files in {prefix}")
            return files

        except Exception as e:
            logger.error(f"B2 list failed: {e}")
            return []

    def update_metadata(
        self,
        file_id: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Update file metadata

        Note: S3-compatible metadata is immutable once set. This is implemented
        as a self-copy with REPLACE metadata directive (unlike GCS's in-place patch).
        """
        try:
            blob_path = self._strip_b2_prefix(file_id)

            if not self._object_exists(blob_path):
                logger.warning(f"File not found for metadata update: {file_id}")
                return False

            head = self.client.head_object(Bucket=self.bucket_name, Key=blob_path)
            current_metadata = head.get('Metadata', {})

            if metadata:
                for key, value in metadata.items():
                    if isinstance(value, (str, int, float, bool)):
                        current_metadata[key] = str(value)

            copy_source = {'Bucket': self.bucket_name, 'Key': blob_path}
            self.client.copy_object(
                Bucket=self.bucket_name,
                Key=blob_path,
                CopySource=copy_source,
                Metadata=current_metadata,
                MetadataDirective='REPLACE',
                ContentType=head.get('ContentType', 'application/octet-stream')
            )

            logger.info(f"Metadata updated for: {file_id}")
            return True

        except Exception as e:
            logger.error(f"B2 metadata update failed: {e}")
            return False

    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """Get file metadata"""
        try:
            blob_path = self._strip_b2_prefix(file_id)

            head = self.client.head_object(Bucket=self.bucket_name, Key=blob_path)

            return FileMetadata(
                file_id=blob_path,
                filename=blob_path.split('/')[-1],
                size=head.get('ContentLength', 0),
                mime_type=head.get('ContentType', ''),
                created_at=head.get('LastModified', datetime.utcnow()),
                url=f"{self.endpoint_url}/{self.bucket_name}/{blob_path}" if self.make_public else f"b2://{self.bucket_name}/{blob_path}",
                custom_properties=head.get('Metadata', {})
            )

        except ClientError as e:
            if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey'):
                return None
            logger.error(f"Failed to get metadata: {e}")
            return None
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
        """Move file to different category/folder (server-side copy, no re-upload)"""
        try:
            blob_path = self._strip_b2_prefix(file_id)

            if not self._object_exists(blob_path):
                logger.warning(f"Source file not found: {file_id}")
                return False

            filename = file_id.split('/')[-1]
            new_path = self._build_blob_path(
                context, context_id, filename, new_category, None
            )

            copy_source = {'Bucket': self.bucket_name, 'Key': blob_path}
            self.client.copy_object(
                Bucket=self.bucket_name,
                Key=new_path,
                CopySource=copy_source
            )

            self.client.delete_object(Bucket=self.bucket_name, Key=blob_path)

            logger.info(f"File moved: {file_id} -> {new_path}")
            return True

        except Exception as e:
            logger.error(f"B2 move failed: {e}")
            return False

    def exists(self, file_id: str) -> bool:
        """Check if file exists"""
        try:
            blob_path = self._strip_b2_prefix(file_id)
            return self._object_exists(blob_path)
        except Exception as e:
            logger.error(f"B2 exists check failed: {e}")
            return False

    @property
    def provider_name(self) -> str:
        """Storage provider name"""
        return 'b2'
