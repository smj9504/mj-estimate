"""
Google Drive Export Service for CompanyCam Photos

Exports CompanyCam photos from Water Mitigation jobs to Google Drive.
Photos are organized in CompanyCam/{address}/ folder structure.
"""

import asyncio
import json
import logging
import re
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

import httpx
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload

from app.core.cache import get_cache
from app.core.config import settings
from app.core.interfaces import DatabaseSession

from .models import WMPhoto, WaterMitigationJob
from .repository import WMPhotoRepository, WaterMitigationJobRepository

logger = logging.getLogger(__name__)


class GDriveExportService:
    """
    Google Drive export service for CompanyCam photos.

    Folder structure in Google Drive:
    Root Folder/
      └─ CompanyCam/
          └─ {sanitized_address}/
              └─ photo files...

    Features:
    - Background async processing with progress tracking
    - Duplicate detection by filename
    - Cancellation support
    - Error handling with retry for rate limits
    - User-level credential support (OAuth 2.0 or Service Account)
    """

    CACHE_KEY_PREFIX = "gdrive_export"
    PARALLEL_BATCH_SIZE = 5
    MAX_RETRIES = 3
    RETRY_DELAY_BASE = 1  # seconds

    def __init__(
        self,
        session: DatabaseSession,
        service_account_json: Optional[str] = None,
        root_folder_id: Optional[str] = None,
        oauth_credentials: Optional[Any] = None  # Google OAuth Credentials object
    ):
        """
        Initialize GDriveExportService.

        Args:
            session: Database session
            service_account_json: Service account JSON string (user-level, decrypted)
            root_folder_id: Google Drive root folder ID (user-level)
            oauth_credentials: Google OAuth Credentials object (for user authentication)

        Priority for credentials:
        1. OAuth credentials (if provided)
        2. Service account JSON (if provided)
        3. Environment variable settings
        """
        self.session = session
        self.job_repo = WaterMitigationJobRepository(session)
        self.photo_repo = WMPhotoRepository(session)
        self._drive_service = None
        self._folder_cache: Dict[str, str] = {}

        # User-level credentials
        self._oauth_credentials = oauth_credentials
        self._service_account_json = service_account_json
        self._root_folder_id = root_folder_id

    @property
    def root_folder_id(self) -> str:
        """Get root folder ID (user-level or environment variable)"""
        if self._root_folder_id:
            return self._root_folder_id
        if settings.GDRIVE_ROOT_FOLDER_ID:
            return settings.GDRIVE_ROOT_FOLDER_ID
        raise ValueError("GDRIVE_ROOT_FOLDER_ID not configured")

    @property
    def drive_service(self):
        """Lazy initialization of Google Drive service"""
        if self._drive_service is None:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            credentials = None

            # Priority 1: OAuth credentials (user authentication)
            if self._oauth_credentials:
                credentials = self._oauth_credentials
                logger.info("Using OAuth credentials for Google Drive")

            # Priority 2: Service Account JSON (user-level)
            elif self._service_account_json:
                credentials_info = json.loads(self._service_account_json)
                credentials = service_account.Credentials.from_service_account_info(
                    credentials_info,
                    scopes=['https://www.googleapis.com/auth/drive']
                )
                logger.info("Using user-level service account for Google Drive")

            # Priority 3: Environment variable
            elif settings.GDRIVE_SERVICE_ACCOUNT_FILE:
                credentials = service_account.Credentials.from_service_account_file(
                    settings.GDRIVE_SERVICE_ACCOUNT_FILE,
                    scopes=['https://www.googleapis.com/auth/drive']
                )
                logger.info("Using environment service account for Google Drive")
            else:
                raise ValueError("Google Drive credentials not configured")

            self._drive_service = build('drive', 'v3', credentials=credentials)

        return self._drive_service

    async def export_to_gdrive(
        self,
        job_id: UUID,
        cache_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Export CompanyCam photos to Google Drive.

        Steps:
        1. Get job info (address for folder name)
        2. Get or create "CompanyCam" root folder
        3. Get or create address subfolder
        4. Get existing files in folder (for duplicate check)
        5. Filter CompanyCam photos from WMPhoto
        6. For each photo:
           - Check if filename exists (skip if duplicate)
           - Download from CompanyCam CDN
           - Upload to Google Drive
           - Update progress in Redis
        7. Return final status

        Args:
            job_id: Water mitigation job ID
            cache_key: Redis cache key for progress tracking

        Returns:
            Dict with export results
        """
        if cache_key is None:
            cache_key = f"{self.CACHE_KEY_PREFIX}:{job_id}"

        cache = get_cache()

        # Initialize counters
        total_photos = 0
        uploaded_count = 0
        skipped_count = 0
        error_count = 0
        errors: List[str] = []
        drive_folder_url = None
        cancelled = False

        try:
            # 1. Get job info
            job = self.job_repo.get_by_id(job_id)
            if not job:
                return await self._finalize_export(
                    cache_key=cache_key,
                    success=False,
                    message=f"Job {job_id} not found",
                    status="failed"
                )

            # Get address for folder name
            address = self._get_job_address(job)
            if not address:
                return await self._finalize_export(
                    cache_key=cache_key,
                    success=False,
                    message="Job has no address",
                    status="failed"
                )

            # 2. Get or create CompanyCam folder
            companycam_folder_id = self._get_or_create_companycam_folder()

            # 3. Get or create address subfolder
            address_folder_name = self._sanitize_folder_name(address)
            address_folder_id = self._get_or_create_folder(
                folder_name=address_folder_name,
                parent_id=companycam_folder_id
            )

            drive_folder_url = f"https://drive.google.com/drive/folders/{address_folder_id}"

            # 4. Get existing filenames in target folder
            existing_filenames = self._get_existing_filenames(address_folder_id)
            logger.info(f"Found {len(existing_filenames)} existing files in Drive folder")

            # 5. Get CompanyCam photos for this job
            companycam_photos = self.photo_repo.find_companycam_photos(job_id)
            total_photos = len(companycam_photos)

            if total_photos == 0:
                return await self._finalize_export(
                    cache_key=cache_key,
                    success=True,
                    message="No CompanyCam photos to export",
                    status="completed",
                    total_photos=0,
                    uploaded_count=0,
                    skipped_count=0,
                    error_count=0,
                    drive_folder_url=drive_folder_url
                )

            logger.info(f"Starting export of {total_photos} CompanyCam photos for job {job_id}")

            # Update initial progress
            await self._update_progress(
                cache_key=cache_key,
                status="running",
                total_photos=total_photos,
                uploaded_count=0,
                skipped_count=0,
                error_count=0,
                current_photo=0,
                current_filename="",
                message="Starting export...",
                drive_folder_url=drive_folder_url
            )

            # 6. Process photos in batches
            for batch_start in range(0, total_photos, self.PARALLEL_BATCH_SIZE):
                # Check for cancellation
                if await self._is_cancelled(cache_key):
                    logger.info(f"Export cancelled for job {job_id}")
                    cancelled = True
                    break

                batch = companycam_photos[batch_start:batch_start + self.PARALLEL_BATCH_SIZE]

                # Download photos in parallel
                download_tasks = [
                    self._download_photo_safe(photo)
                    for photo in batch
                ]
                download_results = await asyncio.gather(*download_tasks)

                # Upload sequentially (to avoid rate limits)
                for photo, (photo_bytes, download_error) in zip(batch, download_results):
                    # Check for cancellation
                    if await self._is_cancelled(cache_key):
                        logger.info(f"Export cancelled during upload for job {job_id}")
                        cancelled = True
                        break

                    filename = photo.file_name or f"companycam_{photo.external_id}.jpg"
                    current_photo_num = batch_start + batch.index(photo) + 1

                    # Update progress
                    await self._update_progress(
                        cache_key=cache_key,
                        status="running",
                        total_photos=total_photos,
                        uploaded_count=uploaded_count,
                        skipped_count=skipped_count,
                        error_count=error_count,
                        current_photo=current_photo_num,
                        current_filename=filename,
                        message=f"Processing {filename}...",
                        drive_folder_url=drive_folder_url,
                        errors=errors
                    )

                    # Check for duplicate
                    if filename in existing_filenames:
                        logger.debug(f"Skipping duplicate: {filename}")
                        skipped_count += 1
                        continue

                    # Handle download error
                    if download_error:
                        errors.append(f"Download failed for {filename}: {download_error}")
                        error_count += 1
                        continue

                    if photo_bytes is None:
                        errors.append(f"No data for {filename}")
                        error_count += 1
                        continue

                    # Upload to Google Drive
                    try:
                        file_id = self._upload_to_gdrive(
                            data=photo_bytes,
                            filename=filename,
                            folder_id=address_folder_id,
                            content_type='image/jpeg'
                        )
                        uploaded_count += 1
                        existing_filenames.add(filename)  # Track to avoid duplicates in same run
                        logger.debug(f"Uploaded {filename} to Google Drive (ID: {file_id})")
                    except Exception as e:
                        error_msg = f"Upload failed for {filename}: {str(e)}"
                        errors.append(error_msg)
                        error_count += 1
                        logger.error(error_msg)

                if cancelled:
                    break

            # 7. Build final result
            if cancelled:
                message = (
                    f"Export cancelled. Uploaded {uploaded_count} photos before cancellation. "
                    f"Skipped {skipped_count} duplicates."
                )
                status = "cancelled"
            else:
                message = (
                    f"Export completed. Uploaded {uploaded_count} photos. "
                    f"Skipped {skipped_count} duplicates."
                )
                if error_count > 0:
                    message += f" {error_count} errors occurred."
                status = "completed"

            success = error_count == 0 or uploaded_count > 0

            return await self._finalize_export(
                cache_key=cache_key,
                success=success,
                message=message,
                status=status,
                total_photos=total_photos,
                uploaded_count=uploaded_count,
                skipped_count=skipped_count,
                error_count=error_count,
                errors=errors,
                drive_folder_url=drive_folder_url,
                cancelled=cancelled
            )

        except Exception as e:
            error_msg = f"Export failed: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return await self._finalize_export(
                cache_key=cache_key,
                success=False,
                message=error_msg,
                status="failed",
                total_photos=total_photos,
                uploaded_count=uploaded_count,
                skipped_count=skipped_count,
                error_count=error_count + 1,
                errors=errors + [error_msg],
                drive_folder_url=drive_folder_url
            )

    def _get_job_address(self, job) -> Optional[str]:
        """Extract address from job"""
        if isinstance(job, dict):
            return job.get('property_address') or job.get('address')
        return getattr(job, 'property_address', None) or getattr(job, 'address', None)

    def _get_or_create_companycam_folder(self) -> str:
        """Get or create the CompanyCam root folder in Google Drive"""
        folder_name = "CompanyCam"
        cache_key = f"root:{folder_name}"

        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        # Use user-level or environment root folder ID
        root_folder = self.root_folder_id

        # Search for existing folder
        folder_id = self._find_folder(folder_name, root_folder)

        if not folder_id:
            # Create new folder
            folder_id = self._create_folder(folder_name, root_folder)
            logger.info(f"Created CompanyCam folder in Google Drive: {folder_id}")
        else:
            logger.info(f"Found existing CompanyCam folder: {folder_id}")

        self._folder_cache[cache_key] = folder_id
        return folder_id

    def _get_or_create_folder(self, folder_name: str, parent_id: str) -> str:
        """Get or create folder with caching"""
        cache_key = f"{parent_id}:{folder_name}"

        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        folder_id = self._find_folder(folder_name, parent_id)

        if not folder_id:
            folder_id = self._create_folder(folder_name, parent_id)
            logger.info(f"Created folder '{folder_name}' in Google Drive")

        self._folder_cache[cache_key] = folder_id
        return folder_id

    def _find_folder(self, folder_name: str, parent_id: str) -> Optional[str]:
        """Find folder by name in parent"""
        try:
            # Escape single quotes in folder name
            escaped_name = folder_name.replace("'", "\\'")
            query = (
                f"name='{escaped_name}' and "
                f"'{parent_id}' in parents and "
                f"mimeType='application/vnd.google-apps.folder' and "
                f"trashed=false"
            )

            results = self.drive_service.files().list(
                q=query,
                fields='files(id, name)',
                spaces='drive'
            ).execute()

            folders = results.get('files', [])
            return folders[0]['id'] if folders else None

        except HttpError as e:
            logger.error(f"Find folder failed: {e}")
            return None

    def _create_folder(self, folder_name: str, parent_id: str) -> str:
        """Create new folder in Google Drive"""
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }

        folder = self.drive_service.files().create(
            body=file_metadata,
            fields='id'
        ).execute()

        return folder['id']

    def _get_existing_filenames(self, folder_id: str) -> Set[str]:
        """List all filenames in a folder for duplicate detection"""
        filenames = set()
        page_token = None

        try:
            while True:
                query = (
                    f"'{folder_id}' in parents and "
                    f"trashed=false and "
                    f"mimeType!='application/vnd.google-apps.folder'"
                )

                results = self.drive_service.files().list(
                    q=query,
                    fields='nextPageToken, files(name)',
                    pageToken=page_token,
                    pageSize=1000
                ).execute()

                for file in results.get('files', []):
                    filenames.add(file['name'])

                page_token = results.get('nextPageToken')
                if not page_token:
                    break

        except HttpError as e:
            logger.error(f"List files failed: {e}")

        return filenames

    async def _download_photo_safe(
        self,
        photo: WMPhoto
    ) -> tuple[Optional[bytes], Optional[str]]:
        """
        Get photo data from local file or remote URL.

        Returns:
            Tuple of (photo_bytes, error_message)
        """
        import os
        from pathlib import Path

        try:
            # Get photo path from file_path
            photo_path = photo.file_path

            if not photo_path:
                return None, "No photo path available"

            # Check if it's a local file path (not a URL)
            if not photo_path.startswith(('http://', 'https://')):
                # It's a local file path - read from disk
                # Handle both relative and absolute paths
                if os.path.isabs(photo_path):
                    full_path = Path(photo_path)
                else:
                    # Relative path - resolve from backend directory
                    backend_dir = Path(__file__).resolve().parent.parent.parent.parent
                    full_path = backend_dir / photo_path

                if not full_path.exists():
                    return None, f"File not found: {full_path}"

                # Read file asynchronously
                import aiofiles
                async with aiofiles.open(full_path, 'rb') as f:
                    return await f.read(), None
            else:
                # It's a URL - download using httpx async client
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.get(photo_path)
                    response.raise_for_status()
                    return response.content, None

        except httpx.TimeoutException:
            return None, "Download timeout"
        except httpx.HTTPStatusError as e:
            return None, f"HTTP {e.response.status_code}"
        except Exception as e:
            return None, str(e)

    def _upload_to_gdrive(
        self,
        data: bytes,
        filename: str,
        folder_id: str,
        content_type: str = 'image/jpeg'
    ) -> str:
        """
        Upload file to Google Drive with retry for rate limits.

        Returns:
            File ID of uploaded file
        """
        file_metadata = {
            'name': filename,
            'parents': [folder_id]
        }

        media = MediaIoBaseUpload(
            BytesIO(data),
            mimetype=content_type,
            resumable=True
        )

        for attempt in range(self.MAX_RETRIES):
            try:
                file = self.drive_service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields='id'
                ).execute()

                return file['id']

            except HttpError as e:
                if e.resp.status in [429, 500, 503]:
                    # Rate limit or server error - retry with backoff
                    if attempt < self.MAX_RETRIES - 1:
                        delay = self.RETRY_DELAY_BASE * (2 ** attempt)
                        logger.warning(
                            f"Google Drive rate limit, retrying in {delay}s "
                            f"(attempt {attempt + 1}/{self.MAX_RETRIES})"
                        )
                        import time
                        time.sleep(delay)
                        continue
                raise

        raise Exception("Max retries exceeded for Google Drive upload")

    def _sanitize_folder_name(self, address: str) -> str:
        """Sanitize address for use as folder name"""
        # Remove special characters, keep alphanumeric, space, dash, underscore
        safe_name = re.sub(r'[^\w\s\-]', '', address)
        # Replace multiple spaces with single space
        safe_name = re.sub(r'\s+', ' ', safe_name).strip()
        # Limit length
        return safe_name[:100] if safe_name else "Unknown_Address"

    async def _is_cancelled(self, cache_key: str) -> bool:
        """Check if export has been cancelled"""
        cache = get_cache()
        status_json = await cache.get(cache_key)

        if status_json:
            try:
                status = json.loads(status_json)
                return status.get('status') == 'cancelled'
            except (json.JSONDecodeError, TypeError):
                pass

        return False

    async def _update_progress(
        self,
        cache_key: str,
        status: str,
        total_photos: int,
        uploaded_count: int,
        skipped_count: int,
        error_count: int,
        current_photo: int = 0,
        current_filename: str = "",
        message: str = "",
        drive_folder_url: Optional[str] = None,
        errors: Optional[List[str]] = None
    ):
        """Update export progress in cache"""
        cache = get_cache()

        # Preserve cancelled status if set
        current_status = status
        existing_json = await cache.get(cache_key)
        if existing_json:
            try:
                existing = json.loads(existing_json)
                if existing.get('status') == 'cancelled':
                    current_status = 'cancelled'
            except (json.JSONDecodeError, TypeError):
                pass

        progress_data = {
            'status': current_status,
            'total_photos': total_photos,
            'uploaded_count': uploaded_count,
            'skipped_count': skipped_count,
            'error_count': error_count,
            'current_photo': current_photo,
            'current_filename': current_filename,
            'message': message,
            'drive_folder_url': drive_folder_url,
            'errors': (errors or [])[:10]  # Keep last 10 errors
        }

        await cache.set(cache_key, json.dumps(progress_data), ttl=3600)

    async def _finalize_export(
        self,
        cache_key: str,
        success: bool,
        message: str,
        status: str,
        total_photos: int = 0,
        uploaded_count: int = 0,
        skipped_count: int = 0,
        error_count: int = 0,
        errors: Optional[List[str]] = None,
        drive_folder_url: Optional[str] = None,
        cancelled: bool = False
    ) -> Dict[str, Any]:
        """Finalize export and update cache with final status"""
        cache = get_cache()

        final_data = {
            'status': status,
            'total_photos': total_photos,
            'uploaded_count': uploaded_count,
            'skipped_count': skipped_count,
            'error_count': error_count,
            'current_photo': total_photos,
            'current_filename': '',
            'message': message,
            'drive_folder_url': drive_folder_url,
            'errors': (errors or [])[:10]
        }

        # Keep final result for 5 minutes
        await cache.set(cache_key, json.dumps(final_data), ttl=300)

        logger.info(f"Export {status}: {message}")

        return {
            'success': success,
            'message': message,
            'total_photos': total_photos,
            'uploaded_count': uploaded_count,
            'skipped_count': skipped_count,
            'error_count': error_count,
            'errors': errors or [],
            'drive_folder_url': drive_folder_url,
            'cancelled': cancelled
        }


async def cancel_gdrive_export(job_id: UUID) -> bool:
    """
    Cancel ongoing Google Drive export.

    Args:
        job_id: Water mitigation job ID

    Returns:
        True if cancellation was set, False otherwise
    """
    cache = get_cache()
    cache_key = f"{GDriveExportService.CACHE_KEY_PREFIX}:{job_id}"

    # Get current status
    status_json = await cache.get(cache_key)
    if not status_json:
        return False

    try:
        status = json.loads(status_json)
        if status.get('status') not in ['running']:
            return False

        # Set cancelled status
        status['status'] = 'cancelled'
        status['message'] = 'Export cancelled by user'
        await cache.set(cache_key, json.dumps(status), ttl=3600)

        logger.info(f"Export cancellation requested for job {job_id}")
        return True

    except (json.JSONDecodeError, TypeError):
        return False


async def get_gdrive_export_status(job_id: UUID) -> Optional[Dict[str, Any]]:
    """
    Get current export status from cache.

    Args:
        job_id: Water mitigation job ID

    Returns:
        Status dict or None if no export in progress
    """
    cache = get_cache()
    cache_key = f"{GDriveExportService.CACHE_KEY_PREFIX}:{job_id}"

    status_json = await cache.get(cache_key)
    if not status_json:
        return None

    try:
        return json.loads(status_json)
    except (json.JSONDecodeError, TypeError):
        return None
