"""
CompanyCam API Client

Handles all API communication with CompanyCam:
- Authentication
- Photo retrieval
- Project information
- Webhook signature verification
"""

import base64
import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import httpx

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

    def get_photo_url(self, photo_id: str) -> Optional[str]:
        """
        Get photo URL from CompanyCam (synchronous)

        Args:
            photo_id: CompanyCam photo ID (as string)

        Returns:
            Photo URL or None if not found

        Raises:
            httpx.HTTPError: If API request fails
        """
        url = f"{self.base_url}/photos/{photo_id}"

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.get(url, headers=self.headers)
                response.raise_for_status()
                photo_data = response.json()

                # Log full response to understand structure
                logger.debug(
                    f"CompanyCam photo {photo_id} response keys: "
                    f"{list(photo_data.keys())}"
                )

                # Extract photo URL from response
                # Try multiple possible field names from CompanyCam API
                photo_url = None

                # Try direct URL fields first
                photo_url = (
                    photo_data.get('uri') or
                    photo_data.get('url') or
                    photo_data.get('photo_url') or
                    photo_data.get('image_url')
                )

                # Handle 'uris' field which can be dict or list
                if not photo_url and 'uris' in photo_data:
                    uris = photo_data['uris']
                    logger.debug(
                        f"CompanyCam photo {photo_id} uris type: "
                        f"{type(uris)}, value: {uris}"
                    )

                    if isinstance(uris, dict):
                        # Handle dict structure
                        photo_url = (
                            uris.get('original') or
                            uris.get('large') or
                            uris.get('medium')
                        )
                    elif isinstance(uris, list) and len(uris) > 0:
                        # Handle list structure - find best quality
                        for uri_item in uris:
                            if isinstance(uri_item, dict):
                                # Look for 'original' or 'large'
                                if (uri_item.get('size') == 'original' or
                                        uri_item.get('type') == 'original'):
                                    photo_url = (
                                        uri_item.get('uri') or
                                        uri_item.get('url')
                                    )
                                    break
                        # If no 'original' found, take first one
                        if not photo_url and isinstance(uris[0], dict):
                            photo_url = (
                                uris[0].get('uri') or
                                uris[0].get('url')
                            )
                        elif not photo_url and isinstance(uris[0], str):
                            photo_url = uris[0]

                if not photo_url:
                    logger.warning(
                        f"No photo URL found in CompanyCam photo "
                        f"{photo_id} response. Available keys: "
                        f"{list(photo_data.keys())}"
                    )
                    logger.debug(f"Full response data: {photo_data}")
                    return None

                logger.info(
                    f"Successfully retrieved CompanyCam photo URL "
                    f"for {photo_id}"
                )
                return photo_url

        except httpx.HTTPError as e:
            logger.error(
                f"Failed to get photo URL for {photo_id} "
                f"from CompanyCam: {e}"
            )
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

    async def get_project_photos(self, project_id: int, limit: int = 10) -> list:
        """
        Get recent photos from a project (non-paginated helper)

        Args:
            project_id: CompanyCam project ID
            limit: Maximum number of photos to return

        Returns:
            List of photo dictionaries

        Raises:
            httpx.HTTPError: If API request fails
        """
        try:
            result = await self.list_project_photos(project_id, page=1, per_page=limit)

            # Handle both direct list response and paginated dict response
            if isinstance(result, list):
                return result
            elif isinstance(result, dict):
                return result.get("data", [])
            else:
                logger.warning(f"Unexpected response type from CompanyCam API: {type(result)}")
                return []

        except Exception as e:
            logger.error(f"Failed to get photos for project {project_id}: {e}")
            return []

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
