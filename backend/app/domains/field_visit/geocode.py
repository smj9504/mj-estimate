"""
The street address at a phone's position, from OpenStreetMap's public Nominatim.

Its usage policy (https://operations.osmfoundation.org/policies/nominatim/) asks
for at most one request a second, an application that identifies itself, cached
results, attribution on screen and a way to switch it off without a release. So
requests go through here rather than from the browser, one at a time, and
NOMINATIM_REVERSE_ENABLED=false turns it off: the screen then just asks for the address.
"""

import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
_MIN_SECONDS_APART = 1.1
_CACHE_SIZE = 256

_lock = threading.Lock()
_last_request = 0.0
_cache: "OrderedDict[Tuple[float, float], Dict[str, Any]]" = OrderedDict()


def _parse(found: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Our address fields from Nominatim's. Many US homes come back with no number."""
    address = found.get('address') or {}
    road = address.get('road') or address.get('pedestrian') or address.get('footway')
    if not road:
        return None
    number = address.get('house_number')
    # US-VA gives the two-letter state the client records use
    state_code = (address.get('ISO3166-2-lvl4') or '').rsplit('-', 1)[-1]
    return {
        'street': f"{number} {road}" if number else road,
        'has_number': bool(number),
        'city': (address.get('city') or address.get('town') or address.get('village')
                 or address.get('hamlet') or address.get('suburb') or ''),
        'state': state_code or address.get('state') or '',
        'zipcode': (address.get('postcode') or '').split('-')[0],
    }


def reverse_geocode(latitude: float, longitude: float) -> Optional[Dict[str, Any]]:
    """The address nearest a position, or None when there's no telling. 5 decimals is about 1m."""
    global _last_request

    if not settings.NOMINATIM_REVERSE_ENABLED:
        return None
    key = (round(latitude, 5), round(longitude, 5))
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        wait = _MIN_SECONDS_APART - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            response = httpx.get(
                _REVERSE_URL,
                params={
                    'format': 'jsonv2',
                    'lat': key[0],
                    'lon': key[1],
                    'zoom': 18,
                    'addressdetails': 1,
                },
                headers={
                    'User-Agent': f"SimpleWorks field visits (+{settings.FRONTEND_URL})",
                    'Accept-Language': 'en',
                },
                timeout=8.0,
            )
            response.raise_for_status()
            parsed = _parse(response.json())
        except (httpx.HTTPError, ValueError) as e:
            logger.warning(f"Reverse geocoding failed: {e}")
            return None
        if parsed:
            _cache[key] = parsed
            while len(_cache) > _CACHE_SIZE:
                _cache.popitem(last=False)
        return parsed
