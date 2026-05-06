"""
Bathroom Estimate repository
"""

import logging
from typing import List, Optional

from sqlalchemy import desc, func, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import (
    BathroomEstimate,
    BathroomEstimateHistory,
    BathroomEstimateLineItem,
)

logger = logging.getLogger(__name__)


class BathroomEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, BathroomEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[BathroomEstimate]:
        """Find estimate with line_items eagerly loaded."""
        return (
            self.db_session.query(BathroomEstimate)
            .options(
                selectinload(BathroomEstimate.line_items),
            )
            .filter(BathroomEstimate.id == estimate_id)
            .first()
        )

    def find_by_filters(
        self,
        claim_id: Optional[str] = None,
        company_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple:
        """Find estimates with filters and pagination."""
        query = self.db_session.query(BathroomEstimate)

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
