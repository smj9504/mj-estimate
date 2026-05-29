"""
Supplement domain repository implementations.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.supplement.models import (
    BidItemEstimate,
    SupplementFollowUp,
    SupplementRequest,
)

logger = logging.getLogger(__name__)


class SupplementRequestRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, SupplementRequest)

    def get_with_filters(
        self,
        status: Optional[str] = None,
        claim_id: Optional[str] = None,
        priority: Optional[str] = None,
        request_type: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Dict[str, Any]], int]:
        query = self.db_session.query(SupplementRequest)

        if status:
            query = query.filter(SupplementRequest.status == status)
        if claim_id:
            query = query.filter(SupplementRequest.claim_id == claim_id)
        if priority:
            query = query.filter(SupplementRequest.priority == priority)
        if request_type:
            query = query.filter(
                SupplementRequest.request_type == request_type
            )

        total = query.count()

        # Active items first, then by priority, then date
        query = query.order_by(
            SupplementRequest.created_at.desc()
        )

        offset = (page - 1) * page_size
        items = query.offset(offset).limit(page_size).all()
        return [self._convert_to_dict(s) for s in items], total

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        items = self.db_session.query(SupplementRequest).filter(
            SupplementRequest.claim_id == claim_id
        ).order_by(SupplementRequest.created_at.desc()).all()
        return [self._convert_to_dict(s) for s in items]

    def get_dashboard_stats(self) -> Dict[str, Any]:
        active_statuses = ['identified', 'in_progress', 'submitted', 'under_review']

        total = self.db_session.query(func.count(SupplementRequest.id)).scalar() or 0

        status_counts = self.db_session.query(
            SupplementRequest.status,
            func.count(SupplementRequest.id)
        ).group_by(SupplementRequest.status).all()

        total_supplement = self.db_session.query(
            func.sum(SupplementRequest.supplement_amount)
        ).filter(SupplementRequest.status.in_(active_statuses)).scalar() or 0

        total_diff = self.db_session.query(
            func.sum(SupplementRequest.difference)
        ).filter(SupplementRequest.status.in_(active_statuses)).scalar() or 0

        counts = {s: c for s, c in status_counts}
        return {
            "total": total,
            "identified": counts.get('identified', 0),
            "in_progress": counts.get('in_progress', 0),
            "submitted": counts.get('submitted', 0),
            "under_review": counts.get('under_review', 0),
            "approved": counts.get('approved', 0),
            "denied": counts.get('denied', 0),
            "total_supplement_amount": float(total_supplement),
            "total_difference": float(total_diff),
        }


class BidItemEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, BidItemEstimate)

    def get_by_supplement(self, supplement_id: str) -> List[Dict[str, Any]]:
        items = self.db_session.query(BidItemEstimate).filter(
            BidItemEstimate.supplement_id == supplement_id
        ).order_by(BidItemEstimate.created_at).all()
        return [self._convert_to_dict(i) for i in items]


class SupplementFollowUpRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, SupplementFollowUp)

    def get_by_supplement(self, supplement_id: str) -> List[Dict[str, Any]]:
        items = self.db_session.query(SupplementFollowUp).filter(
            SupplementFollowUp.supplement_id == supplement_id
        ).order_by(SupplementFollowUp.created_at.desc()).all()
        return [self._convert_to_dict(i) for i in items]


def get_supplement_request_repository(session):
    return SupplementRequestRepository(session)

def get_bid_item_estimate_repository(session):
    return BidItemEstimateRepository(session)

def get_supplement_followup_repository(session):
    return SupplementFollowUpRepository(session)
