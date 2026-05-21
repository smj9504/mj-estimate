"""
Siding Estimate repository
"""

import logging
from typing import List, Optional

from sqlalchemy import desc, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import SidingEstimate, SidingEstimateLineItem

logger = logging.getLogger(__name__)


class SidingEstimateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, SidingEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[SidingEstimate]:
        """Find estimate with line_items eagerly loaded."""
        return (
            self.db_session.query(SidingEstimate)
            .options(selectinload(SidingEstimate.line_items))
            .filter(SidingEstimate.id == estimate_id)
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
        query = self.db_session.query(SidingEstimate)

        if claim_id:
            query = query.filter(SidingEstimate.claim_id == claim_id)
        if company_id:
            query = query.filter(SidingEstimate.company_id == company_id)
        if status:
            query = query.filter(SidingEstimate.status == status)
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    SidingEstimate.property_address.ilike(search_term),
                    SidingEstimate.city.ilike(search_term),
                    SidingEstimate.eagleview_report_id.ilike(search_term),
                )
            )

        total = query.count()
        items = (
            query.options(selectinload(SidingEstimate.line_items))
            .order_by(desc(SidingEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total


class SidingEstimateLineItemRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, SidingEstimateLineItem)

    def find_by_estimate_id(self, estimate_id: str) -> List[SidingEstimateLineItem]:
        return (
            self.db_session.query(SidingEstimateLineItem)
            .filter(SidingEstimateLineItem.estimate_id == estimate_id)
            .order_by(
                SidingEstimateLineItem.phase,
                SidingEstimateLineItem.display_order,
            )
            .all()
        )

    def delete_by_estimate_id(self, estimate_id: str) -> int:
        """Delete all line items for an estimate. Returns count deleted."""
        count = (
            self.db_session.query(SidingEstimateLineItem)
            .filter(SidingEstimateLineItem.estimate_id == estimate_id)
            .delete()
        )
        return count

    def delete_by_phase(self, estimate_id: str, phase: int) -> int:
        """Delete all line items in a specific phase."""
        count = (
            self.db_session.query(SidingEstimateLineItem)
            .filter(
                SidingEstimateLineItem.estimate_id == estimate_id,
                SidingEstimateLineItem.phase == phase,
            )
            .delete()
        )
        return count
