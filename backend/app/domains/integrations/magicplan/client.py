"""
MagicPlan REST API Client

Handles all API communication with MagicPlan:
- Authentication (API Key + Customer ID headers)
- Project listing and search
- Plan/floor data retrieval
- Photo/image downloads

API Docs: https://apidocs.magicplan.app/
Base URL: https://cloud.magicplan.app/api/v2/
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class MagicPlanClient:
    """
    MagicPlan REST API v2 Client

    Uses API Key + Customer ID header authentication.
    Supports reusable async HTTP client for connection pooling.

    Usage:
        async with MagicPlanClient() as client:
            projects = await client.list_projects()
            plan = await client.get_plan(plan_id)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        customer_id: Optional[str] = None,
    ):
        self.api_key = api_key or settings.MAGICPLAN_API_KEY
        self.customer_id = customer_id or settings.MAGICPLAN_CUSTOMER_ID
        self.base_url = "https://cloud.magicplan.app/api/v2"
        self.timeout = 30.0
        self._shared_client: Optional[httpx.AsyncClient] = None

        if not self.api_key or not self.customer_id:
            logger.warning("MagicPlan API credentials not configured")

    async def __aenter__(self):
        self._shared_client = httpx.AsyncClient(
            timeout=self.timeout,
            headers=self.headers,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._shared_client:
            await self._shared_client.aclose()
            self._shared_client = None

    @property
    def headers(self) -> Dict[str, str]:
        return {
            "customer": self.customer_id,
            "key": self.api_key,
            "Accept": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        """Make an authenticated API request."""
        url = f"{self.base_url}/{path.lstrip('/')}"
        try:
            if self._shared_client:
                response = await self._shared_client.request(
                    method, url, params=params, timeout=timeout
                )
            else:
                async with httpx.AsyncClient(
                    timeout=timeout or self.timeout
                ) as client:
                    response = await client.request(
                        method, url, headers=self.headers, params=params
                    )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(
                f"MagicPlan API error {e.response.status_code} "
                f"for {method} {url}: {e.response.text[:200]}"
            )
            raise
        except httpx.HTTPError as e:
            logger.error(f"MagicPlan API request failed for {method} {url}: {e}")
            raise

    # ── Projects ─────────────────────────────────────────────

    async def list_projects(
        self, page: int = 1, per_page: int = 50
    ) -> List[Dict[str, Any]]:
        """List all projects in the workspace."""
        result = await self._request(
            "GET", "/projects", params={"page": page, "per_page": per_page}
        )
        # API may return list directly or paginated dict
        if isinstance(result, list):
            return result
        return result.get("data", result.get("projects", []))

    async def get_project(self, project_id: str) -> Dict[str, Any]:
        """Get project details by ID."""
        return await self._request("GET", f"/projects/{project_id}")

    async def search_projects(self, query: str) -> List[Dict[str, Any]]:
        """
        Search projects by name/address.
        MagicPlan API may not have a dedicated search endpoint,
        so we list all and filter client-side if needed.
        """
        # Try query parameter first
        try:
            result = await self._request(
                "GET", "/projects", params={"query": query, "per_page": 100}
            )
            if isinstance(result, list):
                return result
            return result.get("data", result.get("projects", []))
        except httpx.HTTPStatusError:
            # Fallback: list all and filter
            all_projects = await self.list_all_projects()
            query_lower = query.lower()
            return [
                p
                for p in all_projects
                if query_lower in (p.get("title", "") or "").lower()
                or query_lower in (p.get("name", "") or "").lower()
            ]

    async def list_all_projects(self, max_pages: int = 20) -> List[Dict[str, Any]]:
        """Fetch all projects with pagination."""
        all_projects = []
        page = 1
        while page <= max_pages:
            projects = await self.list_projects(page=page, per_page=100)
            if not projects:
                break
            all_projects.extend(projects)
            if len(projects) < 100:
                break
            page += 1
        return all_projects

    # ── Plans / Floors ───────────────────────────────────────

    async def get_project_plan(self, project_id: str) -> Dict[str, Any]:
        """
        Get plan data for a project including floors, rooms, and spatial data.
        Endpoint: GET /projects/{id}/plan (singular)
        Returns plan_data with floors[], each floor has image (SVG URL).
        """
        result = await self._request("GET", f"/projects/{project_id}/plan")
        if isinstance(result, dict) and "data" in result:
            return result["data"]
        return result

    # ── Project Files (floor plan exports) ───────────────────

    async def get_project_files(self, project_id: str) -> List[Dict[str, Any]]:
        """
        Get exported files for a project (JPG/PNG/SVG/PDF floor plans).
        """
        result = await self._request("GET", f"/projects/{project_id}/files")
        if isinstance(result, list):
            return result
        return result.get("data", result.get("files", []))

    # ── File Download ────────────────────────────────────────

    async def download_file(self, url: str) -> bytes:
        """Download a file from a MagicPlan URL (presigned or CDN)."""
        try:
            if self._shared_client:
                response = await self._shared_client.get(url, timeout=60.0)
            else:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.get(url)
            response.raise_for_status()
            return response.content
        except httpx.HTTPError as e:
            logger.error(f"Failed to download file from {url}: {e}")
            raise

    # ── Health Check ─────────────────────────────────────────

    async def health_check(self) -> bool:
        """Check if MagicPlan API is accessible."""
        if not self.api_key or not self.customer_id:
            return False
        try:
            await self._request("GET", "/workspace")
            logger.info("MagicPlan API health check passed")
            return True
        except Exception as e:
            logger.error(f"MagicPlan API health check failed: {e}")
            return False
