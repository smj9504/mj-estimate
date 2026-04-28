"""
Cabinet Estimate repository
"""

import logging
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import joinedload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import (
    CabinetBox,
    CabinetEstimate,
    CabinetEstimateHistory,
    CabinetEstimateLineItem,
)

logger = logging.getLogger(__name__)


class CabinetEstimateRepository(SQLAlchemyRepository[CabinetEstimate, UUID]):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, CabinetEstimate)

    def find_by_id_with_relations(self, estimate_id: str) -> Optional[CabinetEstimate]:
        """Find estimate with boxes and line_items eagerly loaded."""
        return (
            self.db_session.query(CabinetEstimate)
            .options(
                joinedload(CabinetEstimate.boxes),
                joinedload(CabinetEstimate.line_items),
            )
            .filter(CabinetEstimate.id == estimate_id)
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
    ) -> tuple[List[CabinetEstimate], int]:
        """Find estimates with filters and pagination."""
        query = self.db_session.query(CabinetEstimate)

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
                joinedload(CabinetEstimate.boxes),
                joinedload(CabinetEstimate.line_items),
            )
            .order_by(desc(CabinetEstimate.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        # Deduplicate (joinedload can cause duplicates with pagination)
        seen = set()
        unique_items = []
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                unique_items.append(item)
        return unique_items, total

    def find_by_claim_id(self, claim_id: str) -> List[CabinetEstimate]:
        return (
            self.db_session.query(CabinetEstimate)
            .options(
                joinedload(CabinetEstimate.boxes),
                joinedload(CabinetEstimate.line_items),
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
