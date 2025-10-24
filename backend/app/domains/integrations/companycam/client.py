"""
CompanyCam API Client

Handles all API communication with CompanyCam:
- Authentication
- Photo retrieval
- Project information
- Webhook signature verification
"""

import httpx
import hmac
import hashlib
import base64
from typing import Optional, Dict, Any
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class CompanyCamClient:
    """
    CompanyCam API v2 Client

    Documentation: https://docs.companycam.com/
    """

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize CompanyCam client

        Args:
            api_key: CompanyCam API key (uses settings.COMPANYCAM_API_KEY if not provided)
        """
        self.api_key = api_key or settings.COMPANYCAM_API_KEY
        self.base_url = "https://api.companycam.com/v2"
        self.timeout = 30.0

        if not self.api_key:
            logger.warning("CompanyCam API key not configured")

    @property
    def headers(self) -> Dict[str, str]:
        """Get default headers for API requests"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

    async def get_photo(self, photo_id: int) -> Dict[str, Any]:
        """
        Get photo details from CompanyCam

        Args:
            photo_id: CompanyCam photo ID

        Returns:
            Photo details dictionary

        Raises:
            httpx.HTTPError: If API request fails
        """
        url = f"{self.base_url}/photos/{photo_id}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Failed to get photo {photo_id} from CompanyCam: {e}")
            raise

    async def get_project(self, project_id: int) -> Dict[str, Any]:
        """
        Get project details from CompanyCam

        Args:
            project_id: CompanyCam project ID

        Returns:
            Project details dictionary

        Raises:
            httpx.HTTPError: If API request fails
        """
        url = f"{self.base_url}/projects/{project_id}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Failed to get project {project_id} from CompanyCam: {e}")
            raise

    async def download_photo(self, photo_url: str) -> bytes:
        """
        Download photo file from CompanyCam URL

        Args:
            photo_url: Photo URL from CompanyCam

        Returns:
            Photo file bytes

        Raises:
            httpx.HTTPError: If download fails
        """
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:  # Longer timeout for downloads
                response = await client.get(photo_url, headers=self.headers)
                response.raise_for_status()
                return response.content

        except httpx.HTTPError as e:
            logger.error(f"Failed to download photo from {photo_url}: {e}")
            raise

    async def list_project_photos(
        self,
        project_id: int,
        page: int = 1,
        per_page: int = 100
    ) -> Dict[str, Any]:
        """
        List all photos for a project

        Args:
            project_id: CompanyCam project ID
            page: Page number (1-indexed)
            per_page: Photos per page (max 100)

        Returns:
            Paginated photo list

        Raises:
            httpx.HTTPError: If API request fails
        """
        url = f"{self.base_url}/projects/{project_id}/photos"
        params = {
            "page": page,
            "per_page": min(per_page, 100)
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url, headers=self.headers, params=params)
                response.raise_for_status()
                return response.json()

        except httpx.HTTPError as e:
            logger.error(f"Failed to list photos for project {project_id}: {e}")
            raise

    @staticmethod
    def verify_webhook_signature(
        payload: bytes,
        signature: str,
        webhook_token: Optional[str] = None
    ) -> bool:
        """
        Verify webhook signature from CompanyCam

        CompanyCam signs webhook payloads with HMAC-SHA1.
        The signature is in the X-CompanyCam-Signature header.

        Args:
            payload: Raw request body (bytes)
            signature: Signature from X-CompanyCam-Signature header
            webhook_token: Webhook token (uses settings.COMPANYCAM_WEBHOOK_TOKEN if not provided)

        Returns:
            True if signature is valid, False otherwise
        """
        token = webhook_token or settings.COMPANYCAM_WEBHOOK_TOKEN

        if not token:
            logger.warning("CompanyCam webhook token not configured")
            return False

        try:
            # Calculate expected signature using HMAC-SHA1
            expected_signature = base64.b64encode(
                hmac.new(
                    token.encode('utf-8'),
                    payload,
                    hashlib.sha1
                ).digest()
            ).decode('utf-8')

            # Use constant-time comparison to prevent timing attacks
            return hmac.compare_digest(expected_signature, signature)

        except Exception as e:
            logger.error(f"Error verifying webhook signature: {e}")
            return False

    async def health_check(self) -> bool:
        """
        Check if CompanyCam API is accessible

        Returns:
            True if API is accessible, False otherwise
        """
        if not self.api_key:
            logger.warning("Cannot perform health check: API key not configured")
            return False

        try:
            # Try to get current company info as health check
            url = f"{self.base_url}/company"
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                logger.info("CompanyCam API health check passed")
                return True

        except Exception as e:
            logger.error(f"CompanyCam API health check failed: {e}")
            return False
