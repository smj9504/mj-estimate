"""
Google Places API (New) calls behind the address boxes.

The key only works with the New API (places.googleapis.com); the legacy
maps.googleapis.com endpoints are not enabled on the project.

Autocomplete and the details call that follows share a session token, which
Google bills as one lookup instead of one per keystroke.
"""

from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

from .schemas import AddressDetails, AddressSuggestion

PLACES_URL = "https://places.googleapis.com/v1/places"
TIMEOUT_SECONDS = 5.0
KEEPALIVE_SECONDS = 60.0  # Long enough to last through a pause in typing

# Addresses only, so a shop or a landmark doesn't crowd out the house being typed
ADDRESS_TYPES = ["street_address", "premise", "subpremise", "route"]

# Our jobs are in the DC, Maryland and Virginia area. Calls come from the server,
# so without this Google would favor addresses near the server instead of the
# person typing. Only a preference: addresses elsewhere still come up.
SERVICE_AREA = {
    "rectangle": {
        "low": {"latitude": 37.6, "longitude": -78.6},
        "high": {"latitude": 39.8, "longitude": -75.9},
    }
}


_client: Optional[httpx.AsyncClient] = None


class AddressLookupError(Exception):
    """Google couldn't answer, or the key isn't set."""


def _get_client() -> httpx.AsyncClient:
    # One client for the life of the server. Building one loads the TLS certificates
    # (measured at 5s on a busy machine) and a fresh connection adds a handshake,
    # where a reused one answers in 0.1s: this runs on nearly every keystroke.
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            limits=httpx.Limits(keepalive_expiry=KEEPALIVE_SECONDS),
        )
    return _client


def _headers(field_mask: str) -> Dict[str, str]:
    if not settings.GOOGLE_ADDRESS_AUTOCOMPLETE_API_KEY:
        raise AddressLookupError("GOOGLE_ADDRESS_AUTOCOMPLETE_API_KEY is not set")
    return {
        "X-Goog-Api-Key": settings.GOOGLE_ADDRESS_AUTOCOMPLETE_API_KEY,
        "X-Goog-FieldMask": field_mask,
    }


async def _send(method: str, url: str, **kwargs: Any) -> Dict[str, Any]:
    try:
        response = await _get_client().request(method, url, **kwargs)
        if response.status_code != 200:
            raise AddressLookupError(
                f"Google Places answered {response.status_code}: {response.text[:300]}"
            )
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise AddressLookupError(f"Could not reach Google Places: {exc!r}") from exc


async def autocomplete(query: str, session_token: Optional[str] = None) -> List[AddressSuggestion]:
    body: Dict[str, Any] = {
        "input": query,
        "includedRegionCodes": ["us"],
        "includedPrimaryTypes": ADDRESS_TYPES,
        "locationBias": SERVICE_AREA,
        "languageCode": "en",
    }
    if session_token:
        body["sessionToken"] = session_token

    data = await _send(
        "POST",
        f"{PLACES_URL}:autocomplete",
        json=body,
        headers=_headers(
            "suggestions.placePrediction.placeId,"
            "suggestions.placePrediction.text.text,"
            "suggestions.placePrediction.structuredFormat"
        ),
    )

    suggestions = []
    for item in data.get("suggestions", []):
        prediction = item.get("placePrediction") or {}
        if not prediction.get("placeId"):
            continue
        full_text = (prediction.get("text") or {}).get("text", "")
        structured = prediction.get("structuredFormat") or {}
        suggestions.append(AddressSuggestion(
            place_id=prediction["placeId"],
            full_text=full_text,
            main_text=(structured.get("mainText") or {}).get("text") or full_text.split(",")[0],
            secondary_text=(structured.get("secondaryText") or {}).get("text", ""),
        ))
    return suggestions


def parse_details(place: Dict[str, Any]) -> AddressDetails:
    """Split a Place into the street, city, state and zip our forms store."""
    long_text: Dict[str, str] = {}
    short_text: Dict[str, str] = {}
    for component in place.get("addressComponents", []):
        for kind in component.get("types", []):
            long_text.setdefault(kind, component.get("longText", ""))
            short_text.setdefault(kind, component.get("shortText", ""))

    street = " ".join(
        part for part in (short_text.get("street_number"), short_text.get("route")) if part
    )
    unit = short_text.get("subpremise")
    if unit:
        street = f"{street} #{unit}" if unit.isdigit() else f"{street} {unit}"
    street = street.strip()

    # Places outside incorporated towns have no locality; the next ones down are
    # what the post office and our customers call them
    city = (
        long_text.get("locality")
        or long_text.get("sublocality")
        or long_text.get("neighborhood")
        or long_text.get("administrative_area_level_3")
        or ""
    )

    return AddressDetails(
        street_address=street,
        city=city,
        state=short_text.get("administrative_area_level_1", ""),
        zip=short_text.get("postal_code", ""),
        county=long_text.get("administrative_area_level_2"),
    )


async def details(place_id: str, session_token: Optional[str] = None) -> AddressDetails:
    params = {"languageCode": "en"}
    if session_token:
        params["sessionToken"] = session_token

    place = await _send(
        "GET",
        f"{PLACES_URL}/{place_id}",
        params=params,
        headers=_headers("addressComponents"),
    )
    return parse_details(place)
