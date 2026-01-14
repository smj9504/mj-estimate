"""
Scope Item Category Repository

Data access layer for WMScopeItemCategory.
"""

from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .models import WMScopeItemCategory


class ScopeItemCategoryRepository:
    """Repository for WMScopeItemCategory operations"""

    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> WMScopeItemCategory:
        """Create a new category"""
        category = WMScopeItemCategory(**kwargs)
        self.db.add(category)
        self.db.flush()
        return category

    def get_by_id(self, category_id: UUID) -> Optional[WMScopeItemCategory]:
        """Get a category by ID"""
        return self.db.query(WMScopeItemCategory).filter(
            WMScopeItemCategory.id == category_id
        ).first()

    def get_by_name(
        self,
        name: str,
        company_id: Optional[UUID] = None
    ) -> Optional[WMScopeItemCategory]:
        """Get a category by name (within company or system-wide)"""
        query = self.db.query(WMScopeItemCategory).filter(
            WMScopeItemCategory.name == name
        )

        if company_id:
            query = query.filter(
                or_(
                    WMScopeItemCategory.company_id == company_id,
                    WMScopeItemCategory.company_id.is_(None)
                )
            )
        else:
            query = query.filter(WMScopeItemCategory.company_id.is_(None))

        return query.first()

    def list_categories(
        self,
        company_id: Optional[UUID] = None,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        include_system: bool = True,
        page: int = 1,
        page_size: int = 50
    ) -> Tuple[List[WMScopeItemCategory], int]:
        """
        List categories with filters and pagination.

        Args:
            company_id: Filter by company ID
            is_active: Filter by active status (None = all)
            search: Search by name
            include_system: Include system-wide categories (company_id=NULL)
            page: Page number (1-indexed)
            page_size: Items per page

        Returns:
            Tuple of (items, total_count)
        """
        query = self.db.query(WMScopeItemCategory)

        # Company filter
        if company_id:
            if include_system:
                query = query.filter(
                    or_(
                        WMScopeItemCategory.company_id == company_id,
                        WMScopeItemCategory.company_id.is_(None)
                    )
                )
            else:
                query = query.filter(WMScopeItemCategory.company_id == company_id)
        else:
            # System-wide categories only
            query = query.filter(WMScopeItemCategory.company_id.is_(None))

        # Active filter
        if is_active is not None:
            query = query.filter(WMScopeItemCategory.is_active == is_active)

        # Search filter
        if search:
            query = query.filter(
                WMScopeItemCategory.name.ilike(f"%{search}%")
            )

        # Get total count
        total = query.count()

        # Pagination
        offset = (page - 1) * page_size
        items = query.order_by(
            WMScopeItemCategory.display_order,
            WMScopeItemCategory.name
        ).offset(offset).limit(page_size).all()

        return items, total

    def update(
        self,
        category: WMScopeItemCategory,
        **kwargs
    ) -> WMScopeItemCategory:
        """Update a category"""
        for key, value in kwargs.items():
            if hasattr(category, key):
                setattr(category, key, value)
        self.db.flush()
        return category

    def soft_delete(self, category: WMScopeItemCategory) -> WMScopeItemCategory:
        """Soft delete a category (set is_active=False)"""
        category.is_active = False
        self.db.flush()
        return category

    def restore(self, category: WMScopeItemCategory) -> WMScopeItemCategory:
        """Restore a soft-deleted category"""
        category.is_active = True
        self.db.flush()
        return category

    def hard_delete(self, category: WMScopeItemCategory) -> None:
        """Permanently delete a category"""
        self.db.delete(category)
        self.db.flush()

    def get_max_display_order(
        self,
        company_id: Optional[UUID] = None
    ) -> int:
        """Get the maximum display order for ordering new categories"""
        from sqlalchemy import func

        query = self.db.query(func.max(WMScopeItemCategory.display_order))

        if company_id:
            query = query.filter(
                or_(
                    WMScopeItemCategory.company_id == company_id,
                    WMScopeItemCategory.company_id.is_(None)
                )
            )
        else:
            query = query.filter(WMScopeItemCategory.company_id.is_(None))

        result = query.scalar()
        return result or 0

    def reorder_categories(
        self,
        category_orders: List[dict]
    ) -> List[WMScopeItemCategory]:
        """
        Update display_order for multiple categories.

        Args:
            category_orders: List of {id: UUID, display_order: int}

        Returns:
            List of updated categories
        """
        updated = []
        for order_info in category_orders:
            category_id = order_info.get('id')
            display_order = order_info.get('display_order')

            if category_id and display_order is not None:
                category = self.get_by_id(UUID(str(category_id)))
                if category:
                    category.display_order = display_order
                    updated.append(category)

        self.db.flush()
        return updated
