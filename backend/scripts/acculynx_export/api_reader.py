"""
Read-only AccuLynx API v2 client for the bulk export.

Kept separate from app/domains/integrations/acculynx/client.py on purpose:
that client serves the live app (async, upload-focused), while this one is a
synchronous, throttled reader built for walking the whole account once.

AccuLynx allows 10 requests/second per API key, so every call goes through
a single throttle and 429 / 5xx responses are retried with backoff.
"""

import logging
import time
from typing import Any, Dict, Iterator, List, Optional

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.acculynx.com/api/v2"


class NotFound(Exception):
    """The resource does not exist for this job (e.g. no insurance on file)."""


class AccuLynxReader:
    def __init__(self, api_key: str, requests_per_second: float = 8.0, max_retries: int = 6):
        if not api_key:
            raise RuntimeError("ACCULYNX_API_KEY is not set")
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=60.0,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
        self._min_interval = 1.0 / requests_per_second
        self._last_call = 0.0
        self._max_retries = max_retries
        self.call_count = 0

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _throttle(self):
        wait = self._min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """GET a path; raises NotFound on 404, retries 429 / 5xx / network errors."""
        params = {k: v for k, v in (params or {}).items() if v is not None}
        for attempt in range(self._max_retries + 1):
            self._throttle()
            self.call_count += 1
            try:
                response = self._client.get(path, params=params)
            except httpx.TransportError as e:
                if attempt == self._max_retries:
                    raise
                delay = 2 ** attempt
                logger.warning(f"Network error on {path} ({e}), retrying in {delay}s")
                time.sleep(delay)
                continue

            if response.status_code == 404:
                raise NotFound(path)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == self._max_retries:
                    response.raise_for_status()
                try:
                    delay = float(response.headers.get("RateLimit-Reset", "")) or 2 ** attempt
                except ValueError:
                    delay = 2 ** attempt
                logger.warning(f"{response.status_code} on {path}, retrying in {delay}s")
                time.sleep(delay)
                continue
            response.raise_for_status()
            if not response.content:
                return None
            return response.json()
        raise RuntimeError(f"Exhausted retries for {path}")

    def get_optional(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        """GET that returns None instead of raising when the resource is missing."""
        try:
            return self.get(path, params)
        except NotFound:
            return None

    def paginate(self, path: str, params: Optional[Dict[str, Any]] = None, page_size: int = 25) -> Iterator[Dict]:
        """
        Walk a paginated collection ({count, pageSize, pageStartIndex, items}).

        AccuLynx endpoints disagree on the offset parameter name
        (recordStartIndex vs pageStartIndex), so both are sent.
        Endpoints that are not paginated (plain {items}) stop after one page.
        """
        start = 0
        while True:
            page_params = dict(params or {})
            page_params.update({"pageSize": page_size, "recordStartIndex": start, "pageStartIndex": start})
            data = self.get(path, page_params)
            if data is None:
                return
            if isinstance(data, list):
                yield from data
                return
            items: List[Dict] = data.get("items") or []
            yield from items
            count = data.get("count")
            start += len(items)
            if not items or count is None or start >= count:
                return

    def get_all(self, path: str, params: Optional[Dict[str, Any]] = None, page_size: int = 25) -> List[Dict]:
        try:
            return list(self.paginate(path, params, page_size))
        except NotFound:
            return []
