"""
Material Order repository.
"""

import logging
from typing import List, Optional

from sqlalchemy import desc, or_
from sqlalchemy.orm import selectinload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import MaterialOrder, MaterialOrderItem

logger = logging.getLogger(__name__)


class MaterialOrderRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, MaterialOrder)

    def find_by_id_with_items(self, order_id: str) -> Optional[MaterialOrder]:
        return (
            self.db_session.query(MaterialOrder)
            .options(selectinload(MaterialOrder.items))
            .filter(MaterialOrder.id == order_id)
            .first()
        )

    def find_by_filters(
        self,
        scope_type: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple:
        query = self.db_session.query(MaterialOrder)

        if scope_type:
            query = query.filter(MaterialOrder.scope_type == scope_type)
        if status:
            query = query.filter(MaterialOrder.status == status)
        if search:
            term = f"%{search}%"
            query = query.filter(
                or_(
                    MaterialOrder.property_address.ilike(term),
                    MaterialOrder.report_number.ilike(term),
                    MaterialOrder.brand.ilike(term),
                )
            )

        total = query.count()
        items = (
            query.options(selectinload(MaterialOrder.items))
            .order_by(desc(MaterialOrder.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total


class MaterialOrderItemRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, MaterialOrderItem)

    def find_by_order_id(self, order_id: str) -> List[MaterialOrderItem]:
        return (
            self.db_session.query(MaterialOrderItem)
            .filter(MaterialOrderItem.order_id == order_id)
            .order_by(MaterialOrderItem.display_order)
            .all()
        )

    def delete_by_order_id(self, order_id: str) -> int:
        count = (
            self.db_session.query(MaterialOrderItem)
            .filter(MaterialOrderItem.order_id == order_id)
            .delete()
        )
        return count
