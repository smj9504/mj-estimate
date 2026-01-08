"""
Google OAuth 2.0 Service for Google Drive integration

This service handles the OAuth 2.0 flow for user-level Google Drive access,
allowing users to connect their own Google accounts without needing
service account credentials.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
from uuid import UUID

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from app.core.config import settings
from app.core.encryption import encrypt_text, decrypt_text

logger = logging.getLogger(__name__)

# Google Drive API scopes
GOOGLE_DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.file',  # Create/modify files created by app
    'https://www.googleapis.com/auth/userinfo.email',  # Get user email
    'openid',
]


class GoogleOAuthService:
    """Service for handling Google OAuth 2.0 flow"""

    def __init__(self, db_session=None):
        self.db_session = db_session
        self._client_config = None

    @property
    def client_config(self) -> Dict[str, Any]:
        """Get OAuth client configuration"""
        if self._client_config is None:
            if not settings.GOOGLE_OAUTH_CLIENT_ID or not settings.GOOGLE_OAUTH_CLIENT_SECRET:
                raise ValueError("Google OAuth credentials not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.")

            self._client_config = {
                "web": {
                    "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                    "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
                }
            }
        return self._client_config

    def get_authorization_url(self, state: str = None) -> Tuple[str, str]:
        """
        Generate the Google OAuth authorization URL.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Tuple of (authorization_url, state)
        """
        flow = Flow.from_client_config(
            self.client_config,
            scopes=GOOGLE_DRIVE_SCOPES,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI
        )

        authorization_url, state = flow.authorization_url(
            access_type='offline',  # Request refresh token
            include_granted_scopes='true',  # Incremental auth
            prompt='consent',  # Force consent to get refresh token
            state=state
        )

        return authorization_url, state

    def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """
        Exchange authorization code for access and refresh tokens.

        Args:
            code: Authorization code from Google

        Returns:
            Dictionary with token information
        """
        flow = Flow.from_client_config(
            self.client_config,
            scopes=GOOGLE_DRIVE_SCOPES,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI
        )

        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Get user email from userinfo
        user_email = self._get_user_email(credentials)

        return {
            'access_token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_expiry': credentials.expiry,
            'email': user_email,
        }

    def _get_user_email(self, credentials: Credentials) -> Optional[str]:
        """Get user email from Google userinfo API"""
        try:
            service = build('oauth2', 'v2', credentials=credentials)
            userinfo = service.userinfo().get().execute()
            return userinfo.get('email')
        except Exception as e:
            logger.warning(f"Failed to get user email: {e}")
            return None

    def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        Refresh an expired access token using the refresh token.

        Args:
            refresh_token: The OAuth refresh token

        Returns:
            Dictionary with new token information
        """
        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
            client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
        )

        credentials.refresh(Request())

        return {
            'access_token': credentials.token,
            'refresh_token': credentials.refresh_token or refresh_token,  # Keep old if not provided
            'token_expiry': credentials.expiry,
        }

    def get_credentials_from_staff(self, staff_data: Dict[str, Any]) -> Optional[Credentials]:
        """
        Build Google credentials from stored staff OAuth data.

        Args:
            staff_data: Staff dictionary with OAuth fields

        Returns:
            Google Credentials object or None if not configured
        """
        encrypted_access = staff_data.get('gdrive_oauth_access_token')
        encrypted_refresh = staff_data.get('gdrive_oauth_refresh_token')
        token_expiry = staff_data.get('gdrive_oauth_token_expiry')

        if not encrypted_refresh:
            return None

        try:
            access_token = decrypt_text(encrypted_access) if encrypted_access else None
            refresh_token = decrypt_text(encrypted_refresh) if encrypted_refresh else None

            # Convert token_expiry to datetime if it's a string
            if token_expiry and isinstance(token_expiry, str):
                from dateutil.parser import parse as parse_datetime
                token_expiry = parse_datetime(token_expiry)

            credentials = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
                client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
                expiry=token_expiry,
            )

            # Check if token needs refresh
            if credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())

            return credentials

        except Exception as e:
            logger.error(f"Failed to build credentials from staff data: {e}")
            return None

    def test_connection(self, credentials: Credentials) -> Dict[str, Any]:
        """
        Test Google Drive connection with the given credentials.

        Args:
            credentials: Google OAuth credentials

        Returns:
            Dictionary with test results
        """
        try:
            drive_service = build('drive', 'v3', credentials=credentials)

            # Try to get user's root folder info
            about = drive_service.about().get(fields='user').execute()
            user = about.get('user', {})

            return {
                'success': True,
                'message': 'Successfully connected to Google Drive',
                'email': user.get('emailAddress'),
                'display_name': user.get('displayName'),
            }

        except Exception as e:
            logger.error(f"Google Drive connection test failed: {e}")
            return {
                'success': False,
                'message': f'Connection failed: {str(e)}',
            }

    def list_folders(self, credentials: Credentials, parent_id: str = 'root') -> list:
        """
        List folders in Google Drive.

        Args:
            credentials: Google OAuth credentials
            parent_id: Parent folder ID ('root' for root folder)

        Returns:
            List of folder dictionaries
        """
        try:
            drive_service = build('drive', 'v3', credentials=credentials)

            query = f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"

            results = drive_service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name, webViewLink)',
                orderBy='name',
                pageSize=100
            ).execute()

            return results.get('files', [])

        except Exception as e:
            logger.error(f"Failed to list folders: {e}")
            return []

    def create_folder(self, credentials: Credentials, name: str, parent_id: str = 'root') -> Optional[Dict[str, Any]]:
        """
        Create a new folder in Google Drive.

        Args:
            credentials: Google OAuth credentials
            name: Folder name
            parent_id: Parent folder ID

        Returns:
            Created folder info or None
        """
        try:
            drive_service = build('drive', 'v3', credentials=credentials)

            file_metadata = {
                'name': name,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parent_id]
            }

            folder = drive_service.files().create(
                body=file_metadata,
                fields='id, name, webViewLink'
            ).execute()

            return folder

        except Exception as e:
            logger.error(f"Failed to create folder: {e}")
            return None

    def revoke_access(self, credentials: Credentials) -> bool:
        """
        Revoke OAuth access for the given credentials.

        Args:
            credentials: Google OAuth credentials

        Returns:
            True if revocation successful
        """
        try:
            import requests
            requests.post(
                'https://oauth2.googleapis.com/revoke',
                params={'token': credentials.token},
                headers={'content-type': 'application/x-www-form-urlencoded'}
            )
            return True
        except Exception as e:
            logger.error(f"Failed to revoke access: {e}")
            return False


def encrypt_tokens(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """Encrypt OAuth tokens for storage"""
    encrypted = {}

    if tokens.get('access_token'):
        encrypted['gdrive_oauth_access_token'] = encrypt_text(tokens['access_token'])

    if tokens.get('refresh_token'):
        encrypted['gdrive_oauth_refresh_token'] = encrypt_text(tokens['refresh_token'])

    if tokens.get('token_expiry'):
        encrypted['gdrive_oauth_token_expiry'] = tokens['token_expiry']

    if tokens.get('email'):
        encrypted['gdrive_oauth_email'] = tokens['email']

    return encrypted
