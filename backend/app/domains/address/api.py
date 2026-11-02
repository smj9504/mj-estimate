"""
Address lookup for the address boxes.

Mounted at /api/address. Goes through the backend so the Google key stays on
the server. Not behind ENABLE_INTEGRATIONS: every address box depends on it.

A 502 here is not shown to anyone: the browser asks OpenStreetMap instead.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.domains.auth.dependencies import get_current_staff
from app.domains.staff.models import Staff

from . import google_places
from .schemas import AddressDetails, AddressSuggestions

logger = logging.getLogger(__name__)
router = APIRouter()

SESSION_TOKEN_MAX_LENGTH = 36  # Google's limit


def _unavailable(exc: google_places.AddressLookupError) -> HTTPException:
    logger.warning("Address lookup failed: %s", exc)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Address lookup is unavailable",
    )


@router.get("/autocomplete", response_model=AddressSuggestions)
async def autocomplete(
    q: str = Query(..., min_length=1, max_length=200),
    session_token: Optional[str] = Query(None, max_length=SESSION_TOKEN_MAX_LENGTH),
    _staff: Staff = Depends(get_current_staff),
):
    try:
        return AddressSuggestions(
            suggestions=await google_places.autocomplete(q, session_token)
        )
    except google_places.AddressLookupError as exc:
        raise _unavailable(exc)


@router.get("/details", response_model=AddressDetails)
async def details(
    place_id: str = Query(..., min_length=1, max_length=512, pattern=r"^[\w-]+$"),
    session_token: Optional[str] = Query(None, max_length=SESSION_TOKEN_MAX_LENGTH),
    _staff: Staff = Depends(get_current_staff),
):
    try:
        return await google_places.details(place_id, session_token)
    except google_places.AddressLookupError as exc:
        raise _unavailable(exc)
