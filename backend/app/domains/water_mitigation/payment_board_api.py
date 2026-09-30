"""
WM Payment Board API endpoints

Public endpoints (no auth - manager link):
- GET   /api/wm-payment-board/{token}                        - Board rows
- PATCH /api/wm-payment-board/{token}/jobs/{job_id}/received - Toggle received
- PATCH /api/wm-payment-board/{token}/jobs/{job_id}/note     - Save manager note

Admin endpoints (auth required):
- GET  /api/wm-payment-board/admin/token            - Current active link
- POST /api/wm-payment-board/admin/token/regenerate - Retire old link, issue new
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession
from app.domains.auth.dependencies import get_current_staff

from .payment_board_schemas import (
    BoardTokenResponse,
    PaymentRowResponse,
    PublicBoardResponse,
    PublicNoteUpdate,
    PublicReceivedUpdate,
)
from .payment_board_service import WMPaymentBoardService
from .insurance_amount import insurance_amounts_for_jobs

logger = logging.getLogger(__name__)


def _rows(db, jobs) -> list:
    """Job rows with the claim's insurance amount attached as approved_amount_auto"""
    auto = insurance_amounts_for_jobs(db, jobs)
    rows = []
    for job in jobs:
        row = PaymentRowResponse.model_validate(job)
        row.approved_amount_auto = auto.get(str(job.id))
        rows.append(row)
    return rows


# Link-preview crawlers (Slack, iMessage, etc.) fetch the page when the URL is
# pasted into a chat. Don't count those as a manager opening the board.
_PREVIEW_BOT_MARKERS = (
    'SimpleWorks-OG', 'Slackbot', 'facebookexternalhit', 'Twitterbot',
    'LinkedInBot', 'Discordbot', 'TelegramBot', 'WhatsApp', 'iMessageBot',
)


def _is_preview_bot(request: Request) -> bool:
    ua = request.headers.get('user-agent', '')
    return any(marker in ua for marker in _PREVIEW_BOT_MARKERS)


# =====================================================
# Public Router (no authentication)
# =====================================================
public_router = APIRouter()


@public_router.get("/{token}", response_model=PublicBoardResponse)
def get_public_board(
    token: str,
    request: Request,
    db: DatabaseSession = Depends(get_db_session),
):
    """Board rows for a manager link. Returns valid=False on a dead token."""
    try:
        service = WMPaymentBoardService(db)
        jobs = service.get_board_by_token(token, count_view=not _is_preview_bot(request))
        if jobs is None:
            return PublicBoardResponse(valid=False)
        db.commit()
        return PublicBoardResponse(valid=True, items=_rows(db, jobs))
    except Exception as e:
        logger.error(f"Failed to load public payment board: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@public_router.patch("/{token}/jobs/{job_id}/received", response_model=PaymentRowResponse)
def set_public_received(
    token: str,
    job_id: UUID,
    payload: PublicReceivedUpdate,
    db: DatabaseSession = Depends(get_db_session),
):
    """Mark a job's payment received / not received from the manager link."""
    try:
        service = WMPaymentBoardService(db)
        job = service.set_received_by_token(token, job_id, payload.payment_received)
        if job is None:
            raise HTTPException(status_code=404, detail="Invalid link or job not found")
        db.commit()
        return _rows(db, [job])[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set payment_received via public link: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@public_router.patch("/{token}/jobs/{job_id}/note", response_model=PaymentRowResponse)
def set_public_note(
    token: str,
    job_id: UUID,
    payload: PublicNoteUpdate,
    db: DatabaseSession = Depends(get_db_session),
):
    """Save a manager note for a job (also visible on the WM job and its claim)."""
    try:
        service = WMPaymentBoardService(db)
        job = service.set_note_by_token(token, job_id, payload.payment_note)
        if job is None:
            raise HTTPException(status_code=404, detail="Invalid link or job not found")
        db.commit()
        return _rows(db, [job])[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set payment note via public link: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================
# Admin Router (authentication required)
# =====================================================
admin_router = APIRouter()


@admin_router.get("/token", response_model=BoardTokenResponse)
def get_board_token(
    current_staff=Depends(get_current_staff),
    db: DatabaseSession = Depends(get_db_session),
):
    """Current active manager link (created on first request)."""
    try:
        service = WMPaymentBoardService(db)
        token = service.get_or_create_token(staff_id=current_staff.id)
        db.commit()
        return BoardTokenResponse.model_validate(token)
    except Exception as e:
        logger.error(f"Failed to get payment board token: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@admin_router.post("/token/regenerate", response_model=BoardTokenResponse)
def regenerate_board_token(
    current_staff=Depends(get_current_staff),
    db: DatabaseSession = Depends(get_db_session),
):
    """Retire the current link and issue a new one. The old URL stops working."""
    try:
        service = WMPaymentBoardService(db)
        token = service.regenerate_token(staff_id=current_staff.id)
        db.commit()
        return BoardTokenResponse.model_validate(token)
    except Exception as e:
        logger.error(f"Failed to regenerate payment board token: {e}")
        raise HTTPException(status_code=500, detail=str(e))
