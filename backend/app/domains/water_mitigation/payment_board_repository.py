"""
WM Payment Board repository - token lookups and the job rows the board shows
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, desc
from sqlalchemy.sql import func

from app.core.interfaces import DatabaseSession

from .models import WaterMitigationJob
from .payment_board_models import WMPaymentBoardToken


class WMPaymentBoardTokenRepository:
    def __init__(self, session: DatabaseSession):
        self.db_session = session

    def get_active_by_token(self, token: str) -> Optional[WMPaymentBoardToken]:
        """Token + is_active in one where-clause so no caller can skip the check"""
        return self.db_session.query(WMPaymentBoardToken).filter(
            and_(
                WMPaymentBoardToken.token == token,
                WMPaymentBoardToken.is_active.is_(True),
            )
        ).first()

    def get_active(self) -> Optional[WMPaymentBoardToken]:
        return self.db_session.query(WMPaymentBoardToken).filter(
            WMPaymentBoardToken.is_active.is_(True)
        ).order_by(desc(WMPaymentBoardToken.created_at)).first()

    def create(self, created_by_id: UUID, label: Optional[str] = None) -> WMPaymentBoardToken:
        token = WMPaymentBoardToken(created_by_id=created_by_id, label=label)
        self.db_session.add(token)
        self.db_session.flush()
        return token

    def deactivate_all(self) -> int:
        return self.db_session.query(WMPaymentBoardToken).filter(
            WMPaymentBoardToken.is_active.is_(True)
        ).update({'is_active': False}, synchronize_session=False)

    def touch_access(self, token: WMPaymentBoardToken, is_confirm: bool = False) -> None:
        token.last_accessed_at = func.now()
        if is_confirm:
            token.confirm_count = (token.confirm_count or 0) + 1
        else:
            token.view_count = (token.view_count or 0) + 1

    # Board rows - same population AND order as the WM list page
    # (WaterMitigationJobRepository.find_by_filters: active jobs, newest first)
    def list_active_jobs(self) -> List[WaterMitigationJob]:
        return self.db_session.query(WaterMitigationJob).filter(
            WaterMitigationJob.active.is_(True)
        ).order_by(
            desc(WaterMitigationJob.created_at),
        ).all()

    def get_active_job(self, job_id: UUID) -> Optional[WaterMitigationJob]:
        return self.db_session.query(WaterMitigationJob).filter(
            and_(
                WaterMitigationJob.id == job_id,
                WaterMitigationJob.active.is_(True),
            )
        ).first()
