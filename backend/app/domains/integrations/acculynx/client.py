"""
AccuLynx API Client

Handles all API communication with AccuLynx (roofing/restoration CRM):
- Job (lead) search and lookup
- Photo/video upload
- Document upload
- Document folder lookup

Docs: https://apidocs.acculynx.com
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class AccuLynxRateLimitError(Exception):
    """Raised when AccuLynx returns 429. `retry_after_seconds` comes from the RateLimit-Reset header."""

    def __init__(self, retry_after_seconds: float = 1.0):
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"AccuLynx rate limit exceeded, retry after {retry_after_seconds}s")


class AccuLynxClient:
    """
    AccuLynx API v2 Client

    Authentication: single company API Key sent as a Bearer token
    (no OAuth - see settings.ACCULYNX_API_KEY).

    Rate limit: 10 requests/second per API key. Callers doing bulk
    uploads (see service.py) must send requests sequentially, not
    in parallel, to avoid 429s.

        async with AccuLynxClient() as client:
            results = await client.search_jobs("123 Main St")
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.ACCULYNX_API_KEY
        self.base_url = "https://api.acculynx.com/api/v2"
        self.timeout = 30.0
        self._shared_client: Optional[httpx.AsyncClient] = None

        if not self.api_key:
            logger.warning("AccuLynx API key not configured")

    async def __aenter__(self):
        self._shared_client = httpx.AsyncClient(
            timeout=self.timeout,
            headers=self._json_headers,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._shared_client:
            await self._shared_client.aclose()
            self._shared_client = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._shared_client:
            return self._shared_client
        return httpx.AsyncClient(timeout=self.timeout)

    @property
    def _json_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    @property
    def _auth_headers(self) -> Dict[str, str]:
        """Headers for multipart requests (no Content-Type - httpx sets the boundary)."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }

    def _raise_for_rate_limit(self, response: httpx.Response) -> None:
        if response.status_code == 429:
            reset_header = response.headers.get("RateLimit-Reset", "1")
            try:
                retry_after = float(reset_header)
            except ValueError:
                retry_after = 1.0
            raise AccuLynxRateLimitError(retry_after)

    async def search_jobs(
        self,
        search_term: Optional[str] = None,
        page_size: int = 25
    ) -> Dict[str, Any]:
        """
        Search AccuLynx jobs/leads by address or text.

        Args:
            search_term: Address, name, or other free text
            page_size: Max results (1-25)

        Returns:
            {"count": int, "items": [...]}
        """
        url = f"{self.base_url}/jobs/search"
        params = {"pageSize": min(page_size, 25)}
        body: Dict[str, Any] = {}
        if search_term:
            body["searchTerm"] = search_term

        client = self._get_client()
        try:
            response = await client.post(url, headers=self._json_headers, params=params, json=body)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to search AccuLynx jobs (term='{search_term}'): {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def get_job(self, acculynx_job_id: str) -> Dict[str, Any]:
        """Get a single AccuLynx job (lead) by ID."""
        url = f"{self.base_url}/jobs/{acculynx_job_id}"

        client = self._get_client()
        try:
            response = await client.get(url, headers=self._json_headers)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to get AccuLynx job {acculynx_job_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def list_document_folders(self, page_size: int = 100) -> List[Dict[str, Any]]:
        """List the company's AccuLynx document folders (needed for document upload)."""
        url = f"{self.base_url}/company-settings/job-file-settings/document-folders"
        params = {"pageSize": page_size}

        client = self._get_client()
        try:
            response = await client.get(url, headers=self._json_headers, params=params)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json().get("items", [])
        except httpx.HTTPError as e:
            logger.error(f"Failed to list AccuLynx document folders: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    # ---- Contacts / Users / Job creation (for "create a new lead") ----

    async def get_contact_types(self) -> List[Dict[str, Any]]:
        """List AccuLynx contact types (e.g. 'Customer', 'General Contact')."""
        url = f"{self.base_url}/contacts/contact-types"

        client = self._get_client()
        try:
            response = await client.get(url, headers=self._json_headers, params={"pageSize": 100})
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json().get("items", [])
        except httpx.HTTPError as e:
            logger.error(f"Failed to list AccuLynx contact types: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def search_contacts(self, search_term: str, page_size: int = 10) -> Dict[str, Any]:
        """
        Search AccuLynx contacts by name/company.

        AccuLynx requires startDate/endDate/sort on this endpoint even
        though we only care about the text search - use a wide date range
        (contact creation date, not relevant to us) to satisfy it.
        """
        from datetime import date

        url = f"{self.base_url}/contacts/search"
        params = {"pageSize": min(page_size, 25)}
        body = {
            "searchTerm": search_term,
            "startDate": "2000-01-01",
            "endDate": date.today().isoformat(),
            "sort": {"sortColumn": "CreatedDate", "sortDirection": "Descending"}
        }

        client = self._get_client()
        try:
            response = await client.post(url, headers=self._json_headers, params=params, json=body)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to search AccuLynx contacts (term='{search_term}'): {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def get_contact(self, contact_id: str) -> Dict[str, Any]:
        """Get a single AccuLynx contact by ID (used to display a reused contact's name)."""
        url = f"{self.base_url}/contacts/{contact_id}"

        client = self._get_client()
        try:
            response = await client.get(url, headers=self._json_headers)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to get AccuLynx contact {contact_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def create_contact(
        self,
        contact_type_id: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        address: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Create a new AccuLynx contact.

        `address`, if given, should have street1/city/state/zipCode/country
        (plain strings - AccuLynx accepts abbreviations like "VA"/"USA" here,
        not the nested {id,name} objects it returns on reads).
        """
        url = f"{self.base_url}/contacts"
        body: Dict[str, Any] = {"contactTypeIds": [contact_type_id]}
        if first_name:
            body["firstName"] = first_name
        if last_name:
            body["lastName"] = last_name
        if email:
            body["emailAddresses"] = [{"address": email, "type": "Personal", "primary": True}]
        if phone:
            digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
            if len(digits) == 10:
                body["phoneNumbers"] = [{"number": digits, "type": "Mobile", "primary": True}]
        if address:
            body["mailingAddress"] = address

        client = self._get_client()
        try:
            response = await client.post(url, headers=self._json_headers, json=body)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to create AccuLynx contact '{first_name} {last_name}': {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def get_users(self, status: str = "Active") -> List[Dict[str, Any]]:
        """List company users (candidates for job representative assignment)."""
        url = f"{self.base_url}/users"

        client = self._get_client()
        try:
            response = await client.get(url, headers=self._json_headers, params={"status": status, "pageSize": 50})
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json().get("items", [])
        except httpx.HTTPError as e:
            logger.error(f"Failed to list AccuLynx users: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def create_job(
        self,
        contact_id: str,
        address: Optional[Dict[str, str]] = None,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new AccuLynx job (lead). New jobs start in the
        "Lead (Unassigned)" milestone - they won't show up in search_jobs()
        until a company representative is assigned (see
        assign_company_representative below).
        """
        url = f"{self.base_url}/jobs"
        body: Dict[str, Any] = {"contact": {"id": contact_id}}
        if address:
            body["locationAddress"] = address
        if notes:
            body["notes"] = notes[:1000]

        client = self._get_client()
        try:
            response = await client.post(url, headers=self._json_headers, json=body)
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Failed to create AccuLynx job for contact {contact_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def assign_company_representative(self, acculynx_job_id: str, user_id: str) -> None:
        """Assign a company representative (user) to a job."""
        url = f"{self.base_url}/jobs/{acculynx_job_id}/representatives/company"

        client = self._get_client()
        try:
            response = await client.post(url, headers=self._json_headers, json={"id": user_id})
            self._raise_for_rate_limit(response)
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.error(f"Failed to assign representative {user_id} to AccuLynx job {acculynx_job_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def upload_photo(
        self,
        acculynx_job_id: str,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        description: Optional[str] = None
    ) -> httpx.Response:
        """
        Upload a photo/video to an AccuLynx job.

        Returns the raw response (202 Accepted = queued for processing,
        AccuLynx does not confirm completion synchronously).
        """
        url = f"{self.base_url}/jobs/{acculynx_job_id}/photos-videos"
        files = {"file": (filename, file_bytes, content_type)}
        data = {}
        if description:
            data["description"] = description

        client = self._get_client()
        try:
            response = await client.post(
                url, headers=self._auth_headers, files=files, data=data, timeout=60.0
            )
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response
        except httpx.HTTPError as e:
            logger.error(f"Failed to upload photo '{filename}' to AccuLynx job {acculynx_job_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def upload_document(
        self,
        acculynx_job_id: str,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        document_folder_id: str,
        description: Optional[str] = None
    ) -> httpx.Response:
        """
        Upload a document (contract, estimate PDF, etc.) to an AccuLynx job.

        `document_folder_id` is required by AccuLynx - see
        settings.ACCULYNX_DOCUMENT_FOLDER_ID (single fixed folder for now).
        """
        url = f"{self.base_url}/jobs/{acculynx_job_id}/documents"
        files = {"file": (filename, file_bytes, content_type)}
        data = {"documentFolderId": document_folder_id}
        if description:
            data["description"] = description

        client = self._get_client()
        try:
            response = await client.post(
                url, headers=self._auth_headers, files=files, data=data, timeout=60.0
            )
            self._raise_for_rate_limit(response)
            response.raise_for_status()
            return response
        except httpx.HTTPError as e:
            logger.error(f"Failed to upload document '{filename}' to AccuLynx job {acculynx_job_id}: {e}")
            raise
        finally:
            if client is not self._shared_client:
                await client.aclose()

    async def health_check(self) -> bool:
        """
        Check if the AccuLynx API is reachable with the configured key.

        AccuLynx has no dedicated health endpoint, so a lightweight
        document-folders call (pageSize=1) is used instead.
        """
        if not self.api_key:
            logger.warning("Cannot perform health check: AccuLynx API key not configured")
            return False

        try:
            await self.list_document_folders(page_size=1)
            logger.info("AccuLynx API health check passed")
            return True
        except Exception as e:
            logger.error(f"AccuLynx API health check failed: {e}")
            return False
