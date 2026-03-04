"""
Standard Scope Item Repository

Repository pattern implementation for managing standard/template scope items.
"""

import logging
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from .models import WMStandardScopeItem, WMScopeItemCategory

logger = logging.getLogger(__name__)


class StandardScopeItemRepository:
    """Repository for standard scope item operations"""

    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, item_id: UUID) -> Optional[WMStandardScopeItem]:
        """Get standard scope item by ID"""
        return self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.material_weight),
            joinedload(WMStandardScopeItem.category_rel),
            joinedload(WMStandardScopeItem.line_item)
        ).filter(WMStandardScopeItem.id == item_id).first()

    def find_by_filters(
        self,
        company_id: Optional[UUID] = None,
        item_type: Optional[str] = None,
        category_id: Optional[UUID] = None,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        include_system: bool = True,
        page: int = 1,
        page_size: int = 50
    ) -> Tuple[List[WMStandardScopeItem], int]:
        """
        Find standard scope items with filters and pagination.

        Args:
            company_id: Filter by specific company
            item_type: Filter by item type (standard, demolition, custom)
            category_id: Filter by category ID
            is_active: Filter by active status (default True)
            search: Search by name
            include_system: Include system-wide items (company_id IS NULL)
            page: Page number (1-indexed)
            page_size: Items per page

        Returns:
            Tuple of (items, total_count)
        """
        query = self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.material_weight),
            joinedload(WMStandardScopeItem.category_rel),
            joinedload(WMStandardScopeItem.line_item)
        )

        conditions = []

        # Company filter logic
        if company_id:
            if include_system:
                conditions.append(
                    or_(
                        WMStandardScopeItem.company_id == company_id,
                        WMStandardScopeItem.company_id.is_(None)
                    )
                )
            else:
                conditions.append(WMStandardScopeItem.company_id == company_id)
        else:
            # No company specified - get only system-wide items
            conditions.append(WMStandardScopeItem.company_id.is_(None))

        # Item type filter
        if item_type:
            conditions.append(WMStandardScopeItem.item_type == item_type)

        # Category filter (now using category_id FK)
        if category_id:
            conditions.append(WMStandardScopeItem.category_id == category_id)

        # Active status filter
        if is_active is not None:
            conditions.append(WMStandardScopeItem.is_active == is_active)

        # Search filter
        if search:
            search_term = f"%{search}%"
            conditions.append(
                or_(
                    WMStandardScopeItem.name.ilike(search_term),
                    WMStandardScopeItem.description.ilike(search_term)
                )
            )

        if conditions:
            query = query.filter(and_(*conditions))

        # Get total count
        total = query.count()

        # Apply ordering
        query = query.order_by(
            WMStandardScopeItem.display_order.asc(),
            WMStandardScopeItem.name.asc()
        )

        # Apply pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        items = query.all()

        return items, total

    def find_by_name(
        self,
        name: str,
        company_id: Optional[UUID] = None,
        active_only: bool = True
    ) -> Optional[WMStandardScopeItem]:
        """Find standard scope item by name (case-insensitive)."""
        query = self.db.query(WMStandardScopeItem).filter(
            func.lower(WMStandardScopeItem.name) == name.lower()
        )

        if company_id:
            query = query.filter(WMStandardScopeItem.company_id == company_id)
        else:
            query = query.filter(WMStandardScopeItem.company_id.is_(None))

        if active_only:
            query = query.filter(WMStandardScopeItem.is_active.is_(True))

        return query.first()

    def create(self, data: dict) -> WMStandardScopeItem:
        """Create a new standard scope item"""
        item = WMStandardScopeItem(**data)
        self.db.add(item)
        self.db.flush()
        return item

    def update(self, item: WMStandardScopeItem, data: dict) -> WMStandardScopeItem:
        """Update a standard scope item"""
        for key, value in data.items():
            if hasattr(item, key):
                setattr(item, key, value)
        self.db.flush()
        return item

    def delete(self, item: WMStandardScopeItem) -> bool:
        """Hard delete a standard scope item"""
        self.db.delete(item)
        self.db.flush()
        return True

    def soft_delete(self, item: WMStandardScopeItem, updated_by_id: Optional[UUID] = None) -> bool:
        """Soft delete a standard scope item (set is_active=False)"""
        item.is_active = False
        if updated_by_id:
            item.updated_by_id = updated_by_id
        self.db.flush()
        return True

    def restore(self, item: WMStandardScopeItem, updated_by_id: Optional[UUID] = None) -> bool:
        """Restore a soft-deleted standard scope item"""
        item.is_active = True
        if updated_by_id:
            item.updated_by_id = updated_by_id
        self.db.flush()
        return True

    def get_next_display_order(self, company_id: Optional[UUID] = None) -> int:
        """Get the next display order for a new item"""
        query = self.db.query(func.max(WMStandardScopeItem.display_order))

        if company_id:
            query = query.filter(WMStandardScopeItem.company_id == company_id)
        else:
            query = query.filter(WMStandardScopeItem.company_id.is_(None))

        max_order = query.scalar()
        return (max_order or 0) + 1

    # =========================================================================
    # Line Item Sync Operations
    # =========================================================================

    def get_items_by_line_item_id(self, line_item_id: UUID) -> List[WMStandardScopeItem]:
        """Get all standard scope items that reference a specific line item"""
        return self.db.query(WMStandardScopeItem).options(
            joinedload(WMStandardScopeItem.material_weight),
            joinedload(WMStandardScopeItem.category_rel)
        ).filter(
            WMStandardScopeItem.line_item_id == line_item_id
        ).all()

    def update_items_from_line_item(
        self,
        line_item_id: UUID,
        updates: dict
    ) -> int:
        """
        Update all standard scope items that reference a specific line item.

        Args:
            line_item_id: The line item ID to find dependent standard scope items
            updates: Dict of field updates (e.g., {'name': 'New Name', 'unit': 'SF'})

        Returns:
            Number of updated items
        """
        items = self.get_items_by_line_item_id(line_item_id)
        updated_count = 0

        for item in items:
            for key, value in updates.items():
                if hasattr(item, key) and value is not None:
                    setattr(item, key, value)
            updated_count += 1

        if updated_count > 0:
            self.db.flush()

        return updated_count
