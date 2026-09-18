"""
Mirror a WM job's payment_note into the linked claim's notes.

The note lives on water_mitigation_jobs.payment_note (shown on the WM job
detail). So the client side sees it too, the same text is kept as ONE
ClaimNote on the linked claim, identified by a marker line that carries the
job's address. Re-saving updates that note instead of adding another; an
empty note removes it.
"""

import logging
from typing import Any, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

MARKER_PREFIX = '[WM Payment]'
MIRROR_AUTHOR = 'WM payment board'


def _marker(address: str) -> str:
    return f"{MARKER_PREFIX} {address or ''}".strip()


def mirror_payment_note_to_claim(
    session: Any,
    claim_id: Optional[UUID],
    address: str,
    note: Optional[str],
    author: str = MIRROR_AUTHOR,
) -> None:
    """Upsert (or delete, when note is blank) the mirrored ClaimNote. Never raises."""
    if not claim_id:
        return
    try:
        from app.domains.client.models import ClaimNote

        marker = _marker(address)
        existing = (
            session.query(ClaimNote)
            .filter(
                ClaimNote.claim_id == claim_id,
                ClaimNote.content.like(f"{marker}%"),
            )
            .order_by(ClaimNote.created_at.desc())
            .first()
        )
        text = (note or '').strip()

        if not text:
            if existing:
                session.delete(existing)
            return

        content = f"{marker}\n{text}"
        if existing:
            existing.content = content
        else:
            session.add(ClaimNote(
                claim_id=claim_id,
                content=content,
                created_by_name=author,
                pinned=False,
            ))
    except Exception as e:  # a mirroring failure must not block the note itself
        logger.warning(f"Failed to mirror WM payment note to claim {claim_id}: {e}")
