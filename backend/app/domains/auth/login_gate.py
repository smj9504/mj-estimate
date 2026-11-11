"""Every route needs a signed-in staff member unless it is listed in PUBLIC_ROUTES.

The app adds `require_login_unless_public` to every route (FastAPI app-level
dependency), so a route someone forgets to protect is closed, not open to the
internet. Routes that already ask for get_current_staff (directly or through
require_admin / require_screen / ...) keep doing their own check and the gate
steps aside; it only does the check itself for routes that have none.

A route belongs in PUBLIC_ROUTES only when the people calling it can't sign in:
customers and crews following a link with its own token, webhooks, the email
open pixel, and raw <img>/<video>/PDF links (a browser can't attach a bearer
token to those; their ids are random UUIDs).
"""
import inspect
from typing import Dict, FrozenSet, Optional, Tuple

from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.cache import get_cache
from app.core.database_factory import get_db

from .dependencies import get_current_staff

_optional_bearer = HTTPBearer(auto_error=False)

PUBLIC_ROUTES: FrozenSet[Tuple[str, str]] = frozenset({
    # Signing in, and getting back in
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/password-reset/request"),
    ("POST", "/api/auth/password-reset/verify"),
    ("POST", "/api/auth/password-reset/confirm"),
    ("POST", "/api/auth/init-admin"),  # only acts on an empty staff table

    # Customer contract signing link (/sign/:token)
    ("GET", "/api/sign/{token}"),
    ("POST", "/api/sign/{token}"),
    ("GET", "/api/sign/{token}/pdf"),
    ("POST", "/api/sign/{token}/send-copy"),

    # Contractor payment portal link (/contractor-portal/:token)
    ("GET", "/api/contractor-portal/{token}/validate"),
    ("GET", "/api/contractor-portal/{token}/claims"),
    ("GET", "/api/contractor-portal/{token}/claims/{claim_id}/payments"),
    ("POST", "/api/contractor-portal/{token}/claims/{claim_id}/payments"),
    ("POST", "/api/contractor-portal/{token}/upload-check-photo"),

    # Crew photo upload link (/upload/:token)
    ("GET", "/api/crew-upload/{token}"),
    ("POST", "/api/crew-upload/{token}/session"),
    ("GET", "/api/crew-upload/{token}/session/{session_token}"),
    ("POST", "/api/crew-upload/{token}/files"),

    # WM payment board link for managers (/wm-payments/:token)
    ("GET", "/api/wm-payment-board/{token}"),
    ("PATCH", "/api/wm-payment-board/{token}/jobs/{job_id}/received"),
    ("PATCH", "/api/wm-payment-board/{token}/jobs/{job_id}/check-recipient"),
    ("PATCH", "/api/wm-payment-board/{token}/jobs/{job_id}/note"),

    # Pixel in sent emails; CompanyCam webhook checks its own signature
    ("GET", "/api/claim-followup/emails/{email_id}/track-open.gif"),
    ("POST", "/api/integrations/companycam/webhook"),

    # Raw file, photo and PDF links used as <img>/<video>/href (and in emails)
    ("GET", "/api/files/download/{file_id}"),
    ("GET", "/api/files/preview/{file_id}"),
    ("GET", "/api/files/thumbnail/{file_id}"),
    ("GET", "/api/files/video/{file_id}"),
    ("HEAD", "/api/files/video/{file_id}"),
    ("GET", "/api/files/wm-photo/{photo_id}/preview"),
    ("GET", "/api/water-mitigation/documents/{document_id}/download"),
    ("GET", "/api/water-mitigation/documents/{document_id}/preview"),
    ("GET", "/api/water-mitigation/photos/{photo_id}/download"),
    ("GET", "/api/water-mitigation/photos/{photo_id}/preview"),
    ("GET", "/api/water-mitigation/photos/{photo_id}/video"),
    ("HEAD", "/api/water-mitigation/photos/{photo_id}/video"),
    ("GET", "/api/water-mitigation/sketch/floors/{floor_sketch_id}/background-image/preview"),
    ("GET", "/api/contracts/contracts/{contract_id}/pdf"),
    ("GET", "/api/contracts/templates/{template_id}/pdf"),
    ("GET", "/api/rebuild/projects/{project_id}/docs/{doc_id}/pdf"),
    ("GET", "/api/receipts/{receipt_id}/pdf"),

    # Render's health check and the bare root
    ("GET", "/health"),
    ("HEAD", "/health"),
    ("GET", "/"),
    ("HEAD", "/"),
})

_checks_itself: Dict[int, bool] = {}


def _asks_for_staff(dependant, seen: set) -> bool:
    if dependant.call is get_current_staff:
        return True
    for sub in dependant.dependencies:
        if id(sub) in seen:
            continue
        seen.add(id(sub))
        if _asks_for_staff(sub, seen):
            return True
    return False


def route_checks_login_itself(route) -> bool:
    """True when the route already depends on get_current_staff somewhere."""
    key = id(route)
    if key not in _checks_itself:
        dependant = getattr(route, "dependant", None)
        _checks_itself[key] = bool(dependant) and _asks_for_staff(dependant, set())
    return _checks_itself[key]


def is_public(method: str, path: str) -> bool:
    return (method.upper(), path) in PUBLIC_ROUTES


async def require_login_unless_public(request: Request) -> None:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if path is None or is_public(request.method, path):
        return
    if route_checks_login_itself(route):
        return

    # Tests stand in a staff member through dependency_overrides (the app
    # itself never sets any); ask the stand-in so they see what they set up.
    stand_in = request.app.dependency_overrides.get(get_current_staff)
    if stand_in is not None:
        if not any(
            p.default is inspect.Parameter.empty
            for p in inspect.signature(stand_in).parameters.values()
        ):
            result = stand_in()
            if inspect.isawaitable(result):
                await result
        return

    credentials: Optional[HTTPAuthorizationCredentials] = await _optional_bearer(request)
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Open a DB session only when there is a token to check, so public and
    # self-checking routes (thumbnails, previews) don't pay for one.
    db_session = get_db()
    db = next(db_session)
    try:
        await get_current_staff(credentials, db, get_cache())
    finally:
        db_session.close()
