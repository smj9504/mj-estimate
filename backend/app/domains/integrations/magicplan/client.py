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
from typing import IO, Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# List endpoints default to 10 items per page and cap page_size at 50.
MAX_PAGE_SIZE = 50


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

    # ── Pagination ───────────────────────────────────────────

    async def _list_page(
        self,
        path: str,
        page: int,
        page_size: int,
        params: Optional[Dict] = None,
        items_key: str = "data",
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Fetch one page of a list endpoint: (items, page_info)."""
        result = await self._request(
            "GET",
            path,
            params={**(params or {}), "page": page, "page_size": page_size},
        )
        if isinstance(result, list):
            return result, {}
        items = result.get("data", result.get(items_key, []))
        return items or [], result.get("page_info") or {}

    async def _list_all(
        self,
        path: str,
        params: Optional[Dict] = None,
        items_key: str = "data",
        max_pages: int = 200,
    ) -> List[Dict[str, Any]]:
        """Fetch every page of a list endpoint.

        Without page/page_size the API returns only its first 10 items, which
        is why a sync used to bring over just part of a project's photos.
        """
        all_items: List[Dict[str, Any]] = []
        page = 1
        while page <= max_pages:
            items, page_info = await self._list_page(
                path, page, MAX_PAGE_SIZE, params, items_key
            )
            all_items.extend(items)
            total_pages = page_info.get("total_pages")
            if not items:
                break
            if total_pages is not None:
                if page >= total_pages:
                    break
            elif len(items) < MAX_PAGE_SIZE:
                break
            page += 1
        else:
            logger.warning(
                f"MagicPlan {path}: stopped after {max_pages} pages "
                f"({len(all_items)} items)"
            )
        return all_items

    # ── Projects ─────────────────────────────────────────────

    async def list_projects(
        self, page: int = 1, per_page: int = MAX_PAGE_SIZE
    ) -> List[Dict[str, Any]]:
        """List one page of projects in the workspace."""
        items, _ = await self._list_page(
            "/projects", page, min(per_page, MAX_PAGE_SIZE), items_key="projects"
        )
        return items

    async def get_project(self, project_id: str) -> Dict[str, Any]:
        """Get project details by ID."""
        return await self._request("GET", f"/projects/{project_id}")

    async def search_projects(self, query: str) -> List[Dict[str, Any]]:
        """Search projects by name (the API's partial-match `name` filter)."""
        try:
            return await self._list_all(
                "/projects", params={"name": query}, items_key="projects"
            )
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

    async def list_all_projects(self) -> List[Dict[str, Any]]:
        """Fetch all projects with pagination."""
        return await self._list_all("/projects", items_key="projects")

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
        Get every file of a project: captured photos and videos plus
        exported floor plans (JPG/PNG/SVG/PDF), across all pages.
        """
        return await self._list_all(
            f"/projects/{project_id}/files", items_key="files"
        )

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

    async def download_file_to(self, url: str, dest: IO[bytes]) -> int:
        """Stream a file into `dest` without holding it all in memory
        (videos can run to hundreds of MB). Returns the byte count."""
        try:
            if self._shared_client:
                stream = self._shared_client.stream("GET", url, timeout=60.0)
                async with stream as response:
                    return await self._write_stream(response, dest)
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("GET", url) as response:
                    return await self._write_stream(response, dest)
        except httpx.HTTPError as e:
            logger.error(f"Failed to download file from {url}: {e}")
            raise

    @staticmethod
    async def _write_stream(response: httpx.Response, dest: IO[bytes]) -> int:
        response.raise_for_status()
        size = 0
        async for chunk in response.aiter_bytes(1024 * 1024):
            dest.write(chunk)
            size += len(chunk)
        return size

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
