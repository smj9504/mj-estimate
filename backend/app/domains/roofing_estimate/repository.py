"""
Roofing Estimate repository
"""

import logging
from typing import List, Optional

from sqlalchemy import desc, func, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import (
    RoofingEstimate,
    RoofingEstimateHistory,
    RoofingEstimateLineItem,
)

logger = logging.getLogger(__name__)


class RoofingEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RoofingEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[RoofingEstimate]:
        """Find estimate with line_items eagerly loaded."""
        return (
            self.db_session.query(RoofingEstimate)
            .options(
                selectinload(RoofingEstimate.line_items),
            )
            .filter(RoofingEstimate.id == estimate_id)
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
        query = self.db_session.query(RoofingEstimate)

        if claim_id:
            query = query.filter(RoofingEstimate.claim_id == claim_id)
        if company_id:
            query = query.filter(RoofingEstimate.company_id == company_id)
        if status:
            query = query.filter(RoofingEstimate.status == status)
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    RoofingEstimate.property_address.ilike(search_term),
                    RoofingEstimate.zip_code.ilike(search_term),
                    RoofingEstimate.notes.ilike(search_term),
                )
            )

        total = query.count()
        items = (
            query.options(
                selectinload(RoofingEstimate.line_items),
            )
            .order_by(desc(RoofingEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def find_by_claim_id(self, claim_id: str) -> List[RoofingEstimate]:
        return (
            self.db_session.query(RoofingEstimate)
            .options(
                selectinload(RoofingEstimate.line_items),
            )
            .filter(RoofingEstimate.claim_id == claim_id)
            .order_by(desc(RoofingEstimate.created_at))
            .all()
        )


class RoofingLineItemRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RoofingEstimateLineItem)

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        count = (
            self.db_session.query(RoofingEstimateLineItem)
            .filter(RoofingEstimateLineItem.estimate_id == estimate_id)
            .delete()
        )
        self.db_session.flush()
        return count


class RoofingHistoryRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RoofingEstimateHistory)

    def find_by_estimate_id(self, estimate_id: str) -> List[RoofingEstimateHistory]:
        return (
            self.db_session.query(RoofingEstimateHistory)
            .filter(RoofingEstimateHistory.estimate_id == estimate_id)
            .order_by(desc(RoofingEstimateHistory.version_number))
            .all()
        )

    def get_latest_version(self, estimate_id: str) -> int:
        result = (
            self.db_session.query(func.max(RoofingEstimateHistory.version_number))
            .filter(RoofingEstimateHistory.estimate_id == estimate_id)
            .scalar()
        )
        return result or 0
