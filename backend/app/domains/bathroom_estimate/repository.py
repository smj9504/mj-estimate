"""
Bathroom Estimate repository
"""

import logging
from typing import List, Optional

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)

logger = logging.getLogger(__name__)


def _group_key():
    """The job an estimate belongs to. One saved without a group (by code
    from before groups existed) is a job of its own."""
    return func.coalesce(BathroomEstimate.group_id, BathroomEstimate.id)


class BathroomEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, BathroomEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[BathroomEstimate]:
        """Find estimate with its current line items.

        Line items are added and deleted through their own repository, which
        doesn't touch an estimate already in the session, so its line_items
        would still be the list from when it was first loaded — totals summed
        from it missed the item just added and kept the one just deleted.
        """
        estimate = (
            self.db_session.query(BathroomEstimate)
            .options(
                selectinload(BathroomEstimate.line_items),
            )
            .filter(BathroomEstimate.id == estimate_id)
            .first()
        )
        if estimate is not None:
            # Read afresh from the database the next time it's used
            self.db_session.expire(estimate, ["line_items"])
        return estimate

    def find_group_members(self, group_id: str) -> List[BathroomEstimate]:
        """Every estimate of a bathroom job, restoration first, then options in order."""
        return (
            self.db_session.query(BathroomEstimate)
            .options(selectinload(BathroomEstimate.line_items))
            .filter(_group_key() == group_id)
            .order_by(BathroomEstimate.option_order, BathroomEstimate.created_at)
            .all()
        )

    def find_member_summaries(self, group_ids: List[str]) -> list:
        """The switcher's view of these jobs' estimates, without loading their line items."""
        if not group_ids:
            return []
        return (
            self.db_session.query(
                _group_key().label("group_id"),
                BathroomEstimate.id,
                BathroomEstimate.kind,
                BathroomEstimate.option_label,
                BathroomEstimate.option_order,
                BathroomEstimate.status,
                BathroomEstimate.total,
                BathroomEstimate.updated_at,
            )
            .filter(_group_key().in_(group_ids))
            .order_by(BathroomEstimate.option_order, BathroomEstimate.created_at)
            .all()
        )

    def find_by_filters(
        self,
        claim_id: Optional[str] = None,
        company_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        kind: Optional[str] = None,
        grouped: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple:
        """Find estimates with filters and pagination.

        grouped: one row per bathroom job — its first member (the
        restoration, or the first option of a remodel).
        """
        query = self.db_session.query(BathroomEstimate)

        if grouped:
            first = (
                self.db_session.query(
                    _group_key().label("group_id"),
                    func.min(BathroomEstimate.option_order).label("option_order"),
                )
                .group_by(_group_key())
                .subquery()
            )
            query = query.join(first, and_(
                _group_key() == first.c.group_id,
                BathroomEstimate.option_order == first.c.option_order,
            ))
        if kind:
            query = query.filter(BathroomEstimate.kind == kind)
        if claim_id:
            query = query.filter(BathroomEstimate.claim_id == claim_id)
        if company_id:
            query = query.filter(BathroomEstimate.company_id == company_id)
        if status:
            query = query.filter(BathroomEstimate.status == status)
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    BathroomEstimate.property_address.ilike(search_term),
                    BathroomEstimate.zip_code.ilike(search_term),
                    BathroomEstimate.notes.ilike(search_term),
                )
            )

        total = query.count()
        items = (
            query.options(
                selectinload(BathroomEstimate.line_items),
            )
            .order_by(desc(BathroomEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def find_by_claim_id(self, claim_id: str) -> List[BathroomEstimate]:
        return (
            self.db_session.query(BathroomEstimate)
            .options(
                selectinload(BathroomEstimate.line_items),
            )
            .filter(BathroomEstimate.claim_id == claim_id)
            .order_by(desc(BathroomEstimate.created_at))
            .all()
        )


class BathroomLineItemRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, BathroomEstimateLineItem)

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        count = (
            self.db_session.query(BathroomEstimateLineItem)
            .filter(BathroomEstimateLineItem.estimate_id == estimate_id)
            .delete()
        )
        self.db_session.flush()
        return count


class BathroomHistoryRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, BathroomEstimateHistory)

    def find_by_estimate_id(self, estimate_id: str) -> List[BathroomEstimateHistory]:
        return (
            self.db_session.query(BathroomEstimateHistory)
            .filter(BathroomEstimateHistory.estimate_id == estimate_id)
            .order_by(desc(BathroomEstimateHistory.version_number))
            .all()
        )

    def get_latest_version(self, estimate_id: str) -> int:
        result = (
            self.db_session.query(func.max(BathroomEstimateHistory.version_number))
            .filter(BathroomEstimateHistory.estimate_id == estimate_id)
            .scalar()
        )
        return result or 0
