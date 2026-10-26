"""
Cabinet Estimate repository
"""

import logging
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
)

logger = logging.getLogger(__name__)


def _group_key():
    """The job an estimate belongs to. One saved without a group (before
    groups existed) is a job of its own."""
    return func.coalesce(CabinetEstimate.group_id, CabinetEstimate.id)


class CabinetEstimateRepository(SQLAlchemyRepository[CabinetEstimate, UUID]):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, CabinetEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[CabinetEstimate]:
        """Find estimate with its current boxes and line items.

        Boxes and line items are replaced through their own repositories
        (bulk deletes and new rows), which don't touch an estimate already in
        the session, so its lists would still be the ones from when it was
        first loaded - calculate() handed back no line items at all.
        """
        estimate = (
            self.db_session.query(CabinetEstimate)
            .options(
                selectinload(CabinetEstimate.boxes),
                selectinload(CabinetEstimate.line_items),
            )
            .filter(CabinetEstimate.id == estimate_id)
            .first()
        )
        if estimate is not None:
            # Read afresh from the database the next time they're used
            self.db_session.expire(estimate, ["boxes", "line_items"])
        return estimate

    def find_group_members(self, group_id: str) -> List[CabinetEstimate]:
        """Every estimate of a kitchen job, restoration first, then options in order."""
        return (
            self.db_session.query(CabinetEstimate)
            .options(
                selectinload(CabinetEstimate.boxes),
                selectinload(CabinetEstimate.line_items),
            )
            .filter(_group_key() == group_id)
            .order_by(CabinetEstimate.option_order, CabinetEstimate.created_at)
            .all()
        )

    def find_member_summaries(self, group_ids: List[str]) -> list:
        """The switcher's view of these jobs' estimates, without loading their line items."""
        if not group_ids:
            return []
        return (
            self.db_session.query(
                _group_key().label("group_id"),
                CabinetEstimate.id,
                CabinetEstimate.kind,
                CabinetEstimate.option_label,
                CabinetEstimate.option_order,
                CabinetEstimate.status,
                CabinetEstimate.total,
                CabinetEstimate.updated_at,
            )
            .filter(_group_key().in_(group_ids))
            .order_by(CabinetEstimate.option_order, CabinetEstimate.created_at)
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
    ) -> tuple[List[CabinetEstimate], int]:
        """Find estimates with filters and pagination.

        grouped: one row per kitchen job - its first member (the
        restoration, or the first option of a remodel).
        """
        query = self.db_session.query(CabinetEstimate)

        if grouped:
            first = (
                self.db_session.query(
                    _group_key().label("group_id"),
                    func.min(CabinetEstimate.option_order).label("option_order"),
                )
                .group_by(_group_key())
                .subquery()
            )
            query = query.join(first, and_(
                _group_key() == first.c.group_id,
                CabinetEstimate.option_order == first.c.option_order,
            ))
        if kind:
            query = query.filter(CabinetEstimate.kind == kind)

        if claim_id:
            query = query.filter(CabinetEstimate.claim_id == claim_id)
        if company_id:
            query = query.filter(CabinetEstimate.company_id == company_id)
        if status:
            query = query.filter(CabinetEstimate.status == status)
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    CabinetEstimate.property_address.ilike(search_term),
                    CabinetEstimate.zip_code.ilike(search_term),
                    CabinetEstimate.notes.ilike(search_term),
                )
            )

        total = query.count()
        items = (
            query.options(
                selectinload(CabinetEstimate.boxes),
                selectinload(CabinetEstimate.line_items),
            )
            .order_by(desc(CabinetEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def find_by_claim_id(self, claim_id: str) -> List[CabinetEstimate]:
        return (
            self.db_session.query(CabinetEstimate)
            .options(
                selectinload(CabinetEstimate.boxes),
                selectinload(CabinetEstimate.line_items),
            )
            .filter(CabinetEstimate.claim_id == claim_id)
            .order_by(desc(CabinetEstimate.created_at))
            .all()
        )


class CabinetBoxRepository(SQLAlchemyRepository[CabinetBox, UUID]):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, CabinetBox)

    def find_by_estimate_id(self, estimate_id: str) -> List[CabinetBox]:
        return (
            self.db_session.query(CabinetBox)
            .filter(CabinetBox.estimate_id == estimate_id)
            .order_by(CabinetBox.display_order)
            .all()
        )

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        count = (
            self.db_session.query(CabinetBox)
            .filter(CabinetBox.estimate_id == estimate_id)
            .delete()
        )
        self.db_session.flush()
        return count


class CabinetLineItemRepository(SQLAlchemyRepository[CabinetEstimateLineItem, UUID]):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, CabinetEstimateLineItem)

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        count = (
            self.db_session.query(CabinetEstimateLineItem)
            .filter(CabinetEstimateLineItem.estimate_id == estimate_id)
            .delete()
        )
        self.db_session.flush()
        return count


class CabinetHistoryRepository(SQLAlchemyRepository[CabinetEstimateHistory, UUID]):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, CabinetEstimateHistory)

    def find_by_estimate_id(self, estimate_id: str) -> List[CabinetEstimateHistory]:
        return (
            self.db_session.query(CabinetEstimateHistory)
            .filter(CabinetEstimateHistory.estimate_id == estimate_id)
            .order_by(desc(CabinetEstimateHistory.version_number))
            .all()
        )

    def get_latest_version(self, estimate_id: str) -> int:
        result = (
            self.db_session.query(func.max(CabinetEstimateHistory.version_number))
            .filter(CabinetEstimateHistory.estimate_id == estimate_id)
            .scalar()
        )
        return result or 0
