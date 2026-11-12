"""
Flooring estimate repository
"""

from typing import Any, List, Optional

from sqlalchemy import desc, func, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.auth.company_scope import scoped

from .models import FlooringEstimate, FlooringEstimateHistory, FlooringEstimateLineItem


def _group_key():
    return func.coalesce(FlooringEstimate.group_id, FlooringEstimate.id)


class FlooringEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, FlooringEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[FlooringEstimate]:
        """The estimate with its current line items (read afresh: they are
        replaced through their own repository, which doesn't touch an
        estimate already in the session)."""
        estimate = (
            self.db_session.query(FlooringEstimate)
            .options(selectinload(FlooringEstimate.line_items))
            .filter(FlooringEstimate.id == estimate_id)
            .first()
        )
        if estimate is not None:
            self.db_session.expire(estimate, ["line_items"])
        return estimate

    def find_group_members(self, group_id: str) -> List[FlooringEstimate]:
        return (
            self.db_session.query(FlooringEstimate)
            .filter(_group_key() == group_id)
            .order_by(FlooringEstimate.option_order, FlooringEstimate.created_at)
            .all()
        )

    def find_by_filters(
        self,
        claim_id: Optional[str] = None,
        company_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
        scope: Any = None,
    ) -> tuple:
        query = scoped(self.db_session.query(FlooringEstimate), scope)
        if claim_id:
            query = query.filter(FlooringEstimate.claim_id == claim_id)
        if company_id:
            query = query.filter(FlooringEstimate.company_id == company_id)
        if status:
            query = query.filter(FlooringEstimate.status == status)
        if search:
            term = f"%{search}%"
            query = query.filter(or_(
                FlooringEstimate.property_address.ilike(term),
                FlooringEstimate.zip_code.ilike(term),
                FlooringEstimate.notes.ilike(term),
            ))
        total = query.count()
        items = (
            query.order_by(desc(FlooringEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total


class FlooringLineItemRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, FlooringEstimateLineItem)

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        count = (
            self.db_session.query(FlooringEstimateLineItem)
            .filter(FlooringEstimateLineItem.estimate_id == estimate_id)
            .delete()
        )
        self.db_session.flush()
        return count


class FlooringHistoryRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, FlooringEstimateHistory)

    def find_by_estimate_id(self, estimate_id: str) -> List[FlooringEstimateHistory]:
        return (
            self.db_session.query(FlooringEstimateHistory)
            .filter(FlooringEstimateHistory.estimate_id == estimate_id)
            .order_by(desc(FlooringEstimateHistory.version_number))
            .all()
        )

    def get_latest_version(self, estimate_id: str) -> int:
        result = (
            self.db_session.query(func.max(FlooringEstimateHistory.version_number))
            .filter(FlooringEstimateHistory.estimate_id == estimate_id)
            .scalar()
        )
        return result or 0
