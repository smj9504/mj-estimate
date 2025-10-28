"""
Google Drive storage provider
For production use with 30GB free storage
"""

import os
import re
from typing import BinaryIO, Optional, List, Dict, Any
from datetime import datetime
import logging

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload, MediaIoBaseUpload
from googleapiclient.errors import HttpError
import io

from .base import StorageProvider, UploadResult, FileMetadata

logger = logging.getLogger(__name__)


class GoogleDriveProvider(StorageProvider):
    """
    Google Drive storage provider

    Hierarchical structure:
    Root Folder/
      └─ context/
          └─ {context_id}_{readable_name}/
              └─ category/
                  └─ files...

    Example:
    MJ Estimate/
      └─ water-mitigation/
          └─ job-123_Main-Street/
              ├─ before/
              │   └─ photo1.jpg
              ├─ after/
              │   └─ photo2.jpg
              └─ documents/
                  └─ invoice.pdf
    """

    def __init__(
        self,
        service_account_file: str,
        root_folder_id: str,
        scopes: Optional[List[str]] = None
    ):
        """
        Initialize Google Drive provider

        Args:
            service_account_file: Path to service account JSON key
            root_folder_id: Root folder ID in Google Drive
            scopes: OAuth scopes (default: drive access)
        """
        if scopes is None:
            scopes = ['https://www.googleapis.com/auth/drive']

        try:
            credentials = service_account.Credentials.from_service_account_file(
                service_account_file,
                scopes=scopes
            )
            self.service = build('drive', 'v3', credentials=credentials)
            self.root_folder_id = root_folder_id
            self._folder_cache: Dict[str, str] = {}  # Cache folder IDs

            logger.info("Google Drive provider initialized")

        except Exception as e:
            logger.error(f"Failed to initialize Google Drive: {e}")
            raise

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
        """Upload file to Google Drive with hierarchical structure"""
        try:
            # 1. Get or create context folder (e.g., "water-mitigation")
            context_folder_id = self._get_or_create_folder(
                folder_name=context,
                parent_id=self.root_folder_id
            )

            # 2. Get or create job folder with readable name
            job_folder_name = self._build_job_folder_name(context_id, metadata)
            job_folder_id = self._get_or_create_folder(
                folder_name=job_folder_name,
                parent_id=context_folder_id
            )

            # 3. Get or create category folder (optional)
            if category:
                category_folder_id = self._get_or_create_folder(
                    folder_name=category,
                    parent_id=job_folder_id
                )
                parent_folder_id = category_folder_id
            else:
                parent_folder_id = job_folder_id

            # 4. Upload file
            file_metadata_dict = {
                'name': filename,
                'parents': [parent_folder_id],
                'properties': {
                    'context': context,
                    'context_id': context_id,
                    'category': category or '',
                    'upload_date': datetime.utcnow().isoformat(),
                }
            }

            # Add custom metadata
            if metadata:
                file_metadata_dict['properties'].update({
                    k: str(v) for k, v in metadata.items()
                    if k not in ['property_address', 'homeowner_name']
                })

            # Create media upload
            file_data.seek(0)
            media = MediaIoBaseUpload(
                file_data,
                mimetype=content_type or 'application/octet-stream',
                resumable=True
            )

            # Upload to Google Drive
            file = self.service.files().create(
                body=file_metadata_dict,
                media_body=media,
                fields='id, name, webViewLink, thumbnailLink, parents, size',
                supportsAllDrives=True
            ).execute()

            file_id = file['id']
            folder_path = f"{context}/{job_folder_name}/{category or ''}"

            logger.info(f"File uploaded to Google Drive: {filename} (ID: {file_id})")

            return UploadResult(
                file_id=file_id,
                file_url=f"https://drive.google.com/file/d/{file_id}/view",
                thumbnail_url=file.get('thumbnailLink'),
                folder_path=folder_path,
                storage_metadata={
                    'web_view_link': file.get('webViewLink'),
                    'size': file.get('size'),
                    'parent_folder_id': parent_folder_id
                }
            )

        except HttpError as e:
            logger.error(f"Google Drive upload failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Upload error: {e}")
            raise

    def download(self, file_id: str) -> bytes:
        """Download file content from Google Drive"""
        try:
            request = self.service.files().get_media(fileId=file_id)
            file_content = io.BytesIO()
            downloader = MediaIoBaseDownload(file_content, request)

            done = False
            while not done:
                status, done = downloader.next_chunk()

            file_content.seek(0)
            return file_content.read()

        except HttpError as e:
            logger.error(f"Download failed for {file_id}: {e}")
            raise

    def delete(self, file_id: str) -> bool:
        """Delete file from Google Drive"""
        try:
            self.service.files().delete(fileId=file_id).execute()
            logger.info(f"File deleted from Google Drive: {file_id}")
            return True

        except HttpError as e:
            logger.error(f"Delete failed for {file_id}: {e}")
            return False

    def get_url(self, file_id: str, expires_in: Optional[int] = None) -> str:
        """Get accessible URL for file (view or download)"""
        # Google Drive view URL
        return f"https://drive.google.com/uc?id={file_id}&export=download"

    def get_metadata(self, file_id: str) -> Optional[FileMetadata]:
        """Get file metadata from Google Drive"""
        try:
            file = self.service.files().get(
                fileId=file_id,
                fields='id, name, mimeType, size, createdTime, webViewLink, thumbnailLink, properties'
            ).execute()

            return FileMetadata(
                file_id=file['id'],
                filename=file['name'],
                size=int(file.get('size', 0)),
                mime_type=file['mimeType'],
                created_at=datetime.fromisoformat(file['createdTime'].replace('Z', '+00:00')),
                url=f"https://drive.google.com/file/d/{file['id']}/view",
                thumbnail_url=file.get('thumbnailLink'),
                custom_properties=file.get('properties')
            )

        except HttpError as e:
            logger.error(f"Failed to get metadata for {file_id}: {e}")
            return None

    def update_metadata(
        self,
        file_id: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update file metadata in Google Drive"""
        try:
            body = {}

            if filename:
                body['name'] = filename

            if metadata:
                body['properties'] = {k: str(v) for k, v in metadata.items()}

            if body:
                self.service.files().update(
                    fileId=file_id,
                    body=body
                ).execute()

                logger.info(f"Metadata updated for {file_id}")
                return True

            return False

        except HttpError as e:
            logger.error(f"Update metadata failed for {file_id}: {e}")
            return False

    def list_files(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None
    ) -> List[FileMetadata]:
        """List files in Google Drive folder"""
        try:
            # Find job folder
            context_folder_id = self._find_folder(context, self.root_folder_id)
            if not context_folder_id:
                return []

            job_folders = self._search_folders(
                parent_id=context_folder_id,
                name_contains=context_id
            )

            if not job_folders:
                return []

            job_folder_id = job_folders[0]['id']

            # Find category folder if specified
            if category:
                category_folder_id = self._find_folder(category, job_folder_id)
                if not category_folder_id:
                    return []
                search_folder_id = category_folder_id
            else:
                search_folder_id = job_folder_id

            # List files in folder
            query = f"'{search_folder_id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'"
            results = self.service.files().list(
                q=query,
                fields='files(id, name, mimeType, size, createdTime, webViewLink, thumbnailLink, properties)',
                orderBy='createdTime desc'
            ).execute()

            files = []
            for file in results.get('files', []):
                files.append(FileMetadata(
                    file_id=file['id'],
                    filename=file['name'],
                    size=int(file.get('size', 0)),
                    mime_type=file['mimeType'],
                    created_at=datetime.fromisoformat(file['createdTime'].replace('Z', '+00:00')),
                    url=f"https://drive.google.com/file/d/{file['id']}/view",
                    thumbnail_url=file.get('thumbnailLink'),
                    custom_properties=file.get('properties')
                ))

            return files

        except HttpError as e:
            logger.error(f"List files failed: {e}")
            return []

    def move(
        self,
        file_id: str,
        new_category: str,
        context: str,
        context_id: str
    ) -> bool:
        """Move file to different category folder"""
        try:
            # Get current parents
            file = self.service.files().get(
                fileId=file_id,
                fields='parents'
            ).execute()

            previous_parents = ','.join(file.get('parents', []))

            # Find new category folder
            context_folder_id = self._find_folder(context, self.root_folder_id)
            if not context_folder_id:
                return False

            job_folders = self._search_folders(
                parent_id=context_folder_id,
                name_contains=context_id
            )

            if not job_folders:
                return False

            job_folder_id = job_folders[0]['id']

            new_category_folder_id = self._get_or_create_folder(
                folder_name=new_category,
                parent_id=job_folder_id
            )

            # Move file
            self.service.files().update(
                fileId=file_id,
                addParents=new_category_folder_id,
                removeParents=previous_parents,
                fields='id, parents'
            ).execute()

            logger.info(f"File moved: {file_id} to {new_category}")
            return True

        except HttpError as e:
            logger.error(f"Move failed for {file_id}: {e}")
            return False

    def exists(self, file_id: str) -> bool:
        """Check if file exists in Google Drive"""
        try:
            self.service.files().get(
                fileId=file_id,
                fields='id'
            ).execute()
            return True

        except HttpError:
            return False

    @property
    def provider_name(self) -> str:
        """Provider name"""
        return "gdrive"

    # Helper methods

    def _get_or_create_folder(self, folder_name: str, parent_id: str) -> str:
        """Get or create folder, with caching"""
        cache_key = f"{parent_id}:{folder_name}"

        # Check cache
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        # Search for existing folder
        folder_id = self._find_folder(folder_name, parent_id)

        if not folder_id:
            # Create new folder
            folder_id = self._create_folder(folder_name, parent_id)

        # Cache folder ID
        self._folder_cache[cache_key] = folder_id
        return folder_id

    def _find_folder(self, folder_name: str, parent_id: str) -> Optional[str]:
        """Find folder by name in parent"""
        try:
            query = f"name='{folder_name}' and '{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = self.service.files().list(
                q=query,
                fields='files(id, name)',
                spaces='drive'
            ).execute()

            folders = results.get('files', [])
            return folders[0]['id'] if folders else None

        except HttpError as e:
            logger.error(f"Find folder failed: {e}")
            return None

    def _search_folders(self, parent_id: str, name_contains: str) -> List[Dict[str, Any]]:
        """Search folders by name pattern"""
        try:
            query = f"'{parent_id}' in parents and name contains '{name_contains}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = self.service.files().list(
                q=query,
                fields='files(id, name)',
                spaces='drive'
            ).execute()

            return results.get('files', [])

        except HttpError as e:
            logger.error(f"Search folders failed: {e}")
            return []

    def _create_folder(self, folder_name: str, parent_id: str) -> str:
        """Create new folder"""
        try:
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parent_id]
            }

            folder = self.service.files().create(
                body=file_metadata,
                fields='id'
            ).execute()

            logger.info(f"Folder created: {folder_name}")
            return folder['id']

        except HttpError as e:
            logger.error(f"Create folder failed: {e}")
            raise

    def _build_job_folder_name(self, context_id: str, metadata: Optional[Dict[str, Any]]) -> str:
        """Build readable folder name for job"""
        # Start with short context_id
        folder_name = context_id[:8]

        # Add address if available
        if metadata and metadata.get('property_address'):
            address = metadata['property_address']
            safe_address = self._sanitize_filename(address)
            folder_name = f"{folder_name}_{safe_address}"

        return folder_name

    def _sanitize_filename(self, filename: str) -> str:
        """Sanitize filename for Google Drive"""
        # Remove special characters, keep alphanumeric, space, dash, underscore
        safe_name = re.sub(r'[^\w\s-]', '', filename)
        # Replace spaces with underscores
        safe_name = re.sub(r'\s+', '_', safe_name)
        # Limit length
        return safe_name[:100]
