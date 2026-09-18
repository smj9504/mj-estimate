"""
WM Payment Board service

Public side: resolve a manager token, list the board, flip payment_received.
Admin side: issue / regenerate the single active token.

Like the rest of the domain, this service never commits - the API route does.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.interfaces import DatabaseSession

from .models import WaterMitigationJob
from .payment_board_models import WMPaymentBoardToken
from .payment_board_repository import WMPaymentBoardTokenRepository
from .service import WaterMitigationService

PUBLIC_ACTOR = 'public_link'


class WMPaymentBoardService:
    def __init__(self, session: DatabaseSession):
        self.session = session
        self.token_repo = WMPaymentBoardTokenRepository(session)

    # ------------------------------------------------------------------
    # Public (token) side
    # ------------------------------------------------------------------
    def resolve_token(self, token: str) -> Optional[WMPaymentBoardToken]:
        return self.token_repo.get_active_by_token(token)

    def get_board_by_token(
        self, token: str, count_view: bool = True
    ) -> Optional[List[WaterMitigationJob]]:
        board_token = self.resolve_token(token)
        if not board_token:
            return None
        if count_view:
            self.token_repo.touch_access(board_token, is_confirm=False)
        return self.token_repo.list_active_jobs()

    def set_received_by_token(
        self, token: str, job_id: UUID, received: bool
    ) -> Optional[WaterMitigationJob]:
        """Flip payment_received for one job via the manager link.

        Writes payment_received and its two audit columns and nothing else -
        in particular it never nudges payment_status, so the link can't
        overwrite a lost/reissued lifecycle state.
        """
        board_token = self.resolve_token(token)
        if not board_token:
            return None
        job = self.token_repo.get_active_job(job_id)
        if not job:
            return None

        update_data: Dict[str, Any] = {'payment_received': received}
        WaterMitigationService._apply_payment_received_transition(
            job, update_data, actor=PUBLIC_ACTOR, nudge_status=False
        )
        for key, value in update_data.items():
            setattr(job, key, value)
        if 'payment_received' in update_data:
            self.token_repo.touch_access(board_token, is_confirm=True)
        self.session.flush()
        return job

    def set_note_by_token(
        self, token: str, job_id: UUID, note: Optional[str]
    ) -> Optional[WaterMitigationJob]:
        """Save a manager note on the job and mirror it to the linked claim."""
        board_token = self.resolve_token(token)
        if not board_token:
            return None
        job = self.token_repo.get_active_job(job_id)
        if not job:
            return None

        from .payment_note_mirror import mirror_payment_note_to_claim
        text = (note or '').strip() or None
        job.payment_note = text
        mirror_payment_note_to_claim(
            self.session, job.claim_id, job.property_address or '', text
        )
        self.session.flush()
        return job

    # ------------------------------------------------------------------
    # Admin side
    # ------------------------------------------------------------------
    def get_or_create_token(self, staff_id: UUID) -> WMPaymentBoardToken:
        existing = self.token_repo.get_active()
        if existing:
            return existing
        return self.token_repo.create(created_by_id=staff_id)

    def regenerate_token(self, staff_id: UUID) -> WMPaymentBoardToken:
        """Retire every active link and issue a fresh one. Old URLs stop working."""
        self.token_repo.deactivate_all()
        return self.token_repo.create(created_by_id=staff_id)
