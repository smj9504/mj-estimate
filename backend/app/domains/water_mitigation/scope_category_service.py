"""
Scope Item Category Service

Business logic for managing scope item categories.
"""

from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from .models import WMScopeItemCategory
from .scope_category_repository import ScopeItemCategoryRepository
from .schemas import ScopeItemCategoryCreate, ScopeItemCategoryUpdate


# Default categories to seed
DEFAULT_CATEGORIES = [
    {"name": "Equipment", "color": "#1890ff", "icon": "tool", "display_order": 1},
    {"name": "Protection", "color": "#52c41a", "icon": "safety", "display_order": 2},
    {"name": "Demolition", "color": "#fa8c16", "icon": "delete", "display_order": 3},
    {"name": "Flooring", "color": "#722ed1", "icon": "appstore", "display_order": 4},
    {"name": "Wall", "color": "#eb2f96", "icon": "layout", "display_order": 5},
    {"name": "Cleanup", "color": "#13c2c2", "icon": "clear", "display_order": 6},
]


class ScopeItemCategoryService:
    """Service for scope item category operations"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = ScopeItemCategoryRepository(db)

    def list_categories(
        self,
        company_id: Optional[UUID] = None,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        include_system: bool = True,
        page: int = 1,
        page_size: int = 50
    ) -> Tuple[List[WMScopeItemCategory], int]:
        """List categories with filters and pagination"""
        return self.repository.list_categories(
            company_id=company_id,
            is_active=is_active,
            search=search,
            include_system=include_system,
            page=page,
            page_size=page_size
        )

    def get_category(self, category_id: UUID) -> Optional[WMScopeItemCategory]:
        """Get a category by ID"""
        return self.repository.get_by_id(category_id)

    def create_category(
        self,
        data: ScopeItemCategoryCreate,
        created_by_id: Optional[UUID] = None
    ) -> WMScopeItemCategory:
        """Create a new category"""
        # Check for duplicate name
        existing = self.repository.get_by_name(data.name, data.company_id)
        if existing and existing.is_active:
            raise ValueError(f"Category with name '{data.name}' already exists")

        # If duplicate exists but is inactive, we can reactivate or create new
        # For simplicity, create new

        # Get next display order if not specified
        if data.display_order == 0:
            max_order = self.repository.get_max_display_order(data.company_id)
            data_dict = data.model_dump()
            data_dict['display_order'] = max_order + 1
        else:
            data_dict = data.model_dump()

        # Add audit field
        data_dict['created_by_id'] = created_by_id

        return self.repository.create(**data_dict)

    def update_category(
        self,
        category_id: UUID,
        data: ScopeItemCategoryUpdate,
        updated_by_id: Optional[UUID] = None
    ) -> WMScopeItemCategory:
        """Update a category"""
        category = self.repository.get_by_id(category_id)
        if not category:
            raise ValueError("Category not found")

        # Check for duplicate name if name is being changed
        if data.name and data.name != category.name:
            existing = self.repository.get_by_name(data.name, category.company_id)
            if existing and existing.id != category_id and existing.is_active:
                raise ValueError(f"Category with name '{data.name}' already exists")

        update_data = data.model_dump(exclude_unset=True)
        update_data['updated_by_id'] = updated_by_id

        return self.repository.update(category, **update_data)

    def delete_category(
        self,
        category_id: UUID,
        hard_delete: bool = False,
        deleted_by_id: Optional[UUID] = None
    ) -> None:
        """Delete a category (soft or hard)"""
        category = self.repository.get_by_id(category_id)
        if not category:
            raise ValueError("Category not found")

        if hard_delete:
            self.repository.hard_delete(category)
        else:
            category.updated_by_id = deleted_by_id
            self.repository.soft_delete(category)

    def restore_category(
        self,
        category_id: UUID,
        restored_by_id: Optional[UUID] = None
    ) -> WMScopeItemCategory:
        """Restore a soft-deleted category"""
        category = self.repository.get_by_id(category_id)
        if not category:
            raise ValueError("Category not found")

        if category.is_active:
            raise ValueError("Category is already active")

        category.updated_by_id = restored_by_id
        return self.repository.restore(category)

    def duplicate_category(
        self,
        category_id: UUID,
        new_name: Optional[str] = None,
        target_company_id: Optional[UUID] = None,
        created_by_id: Optional[UUID] = None
    ) -> WMScopeItemCategory:
        """Create a copy of an existing category"""
        original = self.repository.get_by_id(category_id)
        if not original:
            raise ValueError("Category not found")

        # Generate new name
        name = new_name or f"{original.name} (Copy)"

        # Check for duplicate name
        existing = self.repository.get_by_name(name, target_company_id)
        if existing and existing.is_active:
            raise ValueError(f"Category with name '{name}' already exists")

        # Get next display order
        max_order = self.repository.get_max_display_order(target_company_id)

        return self.repository.create(
            company_id=target_company_id,
            name=name,
            description=original.description,
            color=original.color,
            icon=original.icon,
            display_order=max_order + 1,
            is_active=True,
            created_by_id=created_by_id
        )

    def reorder_categories(
        self,
        category_orders: List[dict],
        updated_by_id: Optional[UUID] = None
    ) -> List[WMScopeItemCategory]:
        """Reorder multiple categories"""
        categories = self.repository.reorder_categories(category_orders)

        # Update audit field for all
        for category in categories:
            category.updated_by_id = updated_by_id

        return categories

    def seed_default_categories(
        self,
        company_id: Optional[UUID] = None,
        created_by_id: Optional[UUID] = None
    ) -> List[WMScopeItemCategory]:
        """
        Seed default categories.

        Only creates categories that don't already exist.

        Args:
            company_id: Target company (NULL for system-wide)
            created_by_id: User creating the categories

        Returns:
            List of newly created categories
        """
        created = []

        for cat_data in DEFAULT_CATEGORIES:
            # Check if already exists
            existing = self.repository.get_by_name(cat_data['name'], company_id)
            if existing:
                continue

            category = self.repository.create(
                company_id=company_id,
                name=cat_data['name'],
                description=f"Default category: {cat_data['name']}",
                color=cat_data['color'],
                icon=cat_data.get('icon'),
                display_order=cat_data['display_order'],
                is_active=True,
                created_by_id=created_by_id
            )
            created.append(category)

        return created
