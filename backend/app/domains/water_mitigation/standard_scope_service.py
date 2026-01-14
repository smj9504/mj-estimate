"""
Standard Scope Item Service

Business logic layer for managing standard/template scope items.
"""

import logging
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from .models import WMStandardScopeItem
from .standard_scope_repository import StandardScopeItemRepository
from .schemas import (
    StandardScopeItemCreate,
    StandardScopeItemUpdate,
    STANDARD_SCOPE_ITEMS,
)

logger = logging.getLogger(__name__)


class StandardScopeItemService:
    """Service for standard scope item business logic"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = StandardScopeItemRepository(db)

    def get_item(self, item_id: UUID) -> Optional[WMStandardScopeItem]:
        """Get a standard scope item by ID"""
        return self.repository.get_by_id(item_id)

    def list_items(
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
        List standard scope items with filters and pagination.

        Args:
            company_id: Filter by company (None = system-wide only)
            item_type: Filter by type (standard, demolition, custom)
            category_id: Filter by category ID
            is_active: Filter by active status
            search: Search by name
            include_system: Include system-wide items when company_id is set
            page: Page number (1-indexed)
            page_size: Items per page

        Returns:
            Tuple of (items, total_count)
        """
        return self.repository.find_by_filters(
            company_id=company_id,
            item_type=item_type,
            category_id=category_id,
            is_active=is_active,
            search=search,
            include_system=include_system,
            page=page,
            page_size=page_size
        )

    def create_item(
        self,
        data: StandardScopeItemCreate,
        created_by_id: Optional[UUID] = None
    ) -> WMStandardScopeItem:
        """
        Create a new standard scope item.

        Args:
            data: Item creation data
            created_by_id: ID of user creating the item

        Returns:
            Created item

        Raises:
            ValueError: If item with same name exists for company
        """
        # Check for duplicate name
        existing = self.repository.find_by_name(
            name=data.name,
            company_id=data.company_id
        )
        if existing:
            raise ValueError(f"Item with name '{data.name}' already exists")

        # Get next display order if not specified
        item_data = data.model_dump()
        if item_data.get('display_order', 0) == 0:
            item_data['display_order'] = self.repository.get_next_display_order(
                data.company_id
            )

        if created_by_id:
            item_data['created_by_id'] = created_by_id

        return self.repository.create(item_data)

    def update_item(
        self,
        item_id: UUID,
        data: StandardScopeItemUpdate,
        updated_by_id: Optional[UUID] = None
    ) -> WMStandardScopeItem:
        """
        Update a standard scope item.

        Args:
            item_id: ID of item to update
            data: Update data
            updated_by_id: ID of user making the update

        Returns:
            Updated item

        Raises:
            ValueError: If item not found or name conflict
        """
        item = self.repository.get_by_id(item_id)
        if not item:
            raise ValueError(f"Item with ID {item_id} not found")

        # Check for name conflict if name is being changed
        update_data = data.model_dump(exclude_unset=True)
        if 'name' in update_data and update_data['name'] != item.name:
            existing = self.repository.find_by_name(
                name=update_data['name'],
                company_id=item.company_id
            )
            if existing and existing.id != item_id:
                raise ValueError(f"Item with name '{update_data['name']}' already exists")

        if updated_by_id:
            update_data['updated_by_id'] = updated_by_id

        return self.repository.update(item, update_data)

    def delete_item(
        self,
        item_id: UUID,
        hard_delete: bool = False,
        deleted_by_id: Optional[UUID] = None
    ) -> bool:
        """
        Delete a standard scope item.

        Args:
            item_id: ID of item to delete
            hard_delete: If True, permanently delete; otherwise soft delete
            deleted_by_id: ID of user deleting the item

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If item not found
        """
        item = self.repository.get_by_id(item_id)
        if not item:
            raise ValueError(f"Item with ID {item_id} not found")

        if hard_delete:
            return self.repository.delete(item)
        else:
            return self.repository.soft_delete(item, deleted_by_id)

    def restore_item(
        self,
        item_id: UUID,
        restored_by_id: Optional[UUID] = None
    ) -> WMStandardScopeItem:
        """
        Restore a soft-deleted standard scope item.

        Args:
            item_id: ID of item to restore
            restored_by_id: ID of user restoring the item

        Returns:
            Restored item

        Raises:
            ValueError: If item not found
        """
        item = self.repository.get_by_id(item_id)
        if not item:
            raise ValueError(f"Item with ID {item_id} not found")

        self.repository.restore(item, restored_by_id)
        return item

    def seed_default_items(
        self,
        company_id: Optional[UUID] = None,
        created_by_id: Optional[UUID] = None
    ) -> List[WMStandardScopeItem]:
        """
        Seed database with default standard scope items.

        This migrates the hardcoded STANDARD_SCOPE_ITEMS to the database.
        Items are created as system-wide (company_id=None) unless specified.

        Args:
            company_id: Optional company to create items for
            created_by_id: ID of user seeding the items

        Returns:
            List of created items
        """
        created_items = []

        for index, item_config in enumerate(STANDARD_SCOPE_ITEMS):
            # Check if item already exists
            existing = self.repository.find_by_name(
                name=item_config['name'],
                company_id=company_id,
                active_only=False
            )

            if existing:
                logger.info(f"Skipping existing item: {item_config['name']}")
                continue

            # Prepare item data
            item_data = {
                'name': item_config['name'],
                'description': item_config.get('description'),
                'item_type': item_config.get('item_type', 'standard'),
                'category_id': item_config.get('category_id'),  # Now using FK
                'unit': item_config.get('unit', 'SF'),
                'default_quantity': item_config.get('default_quantity'),
                'default_include_in_debris': item_config.get('include_in_debris', False),
                'display_order': index + 1,
                'company_id': company_id,
                'is_active': True,
            }

            if created_by_id:
                item_data['created_by_id'] = created_by_id

            try:
                item = self.repository.create(item_data)
                created_items.append(item)
                logger.info(f"Created standard scope item: {item.name}")
            except Exception as e:
                logger.error(f"Failed to create item {item_config['name']}: {e}")

        return created_items

    def reorder_items(
        self,
        item_orders: List[dict],
        updated_by_id: Optional[UUID] = None
    ) -> List[WMStandardScopeItem]:
        """
        Reorder multiple items at once.

        Args:
            item_orders: List of {'id': UUID, 'display_order': int}
            updated_by_id: ID of user making the update

        Returns:
            List of updated items
        """
        updated_items = []

        for order_data in item_orders:
            item_id = order_data.get('id')
            display_order = order_data.get('display_order')

            if item_id is None or display_order is None:
                continue

            item = self.repository.get_by_id(item_id)
            if item:
                update_data = {'display_order': display_order}
                if updated_by_id:
                    update_data['updated_by_id'] = updated_by_id
                self.repository.update(item, update_data)
                updated_items.append(item)

        return updated_items

    def duplicate_item(
        self,
        item_id: UUID,
        new_name: Optional[str] = None,
        target_company_id: Optional[UUID] = None,
        created_by_id: Optional[UUID] = None
    ) -> WMStandardScopeItem:
        """
        Duplicate an existing standard scope item.

        Args:
            item_id: ID of item to duplicate
            new_name: Name for the new item (defaults to "Copy of {original}")
            target_company_id: Company for the new item (defaults to same)
            created_by_id: ID of user creating the duplicate

        Returns:
            New duplicated item

        Raises:
            ValueError: If source item not found
        """
        source_item = self.repository.get_by_id(item_id)
        if not source_item:
            raise ValueError(f"Item with ID {item_id} not found")

        # Prepare new item data
        new_data = {
            'name': new_name or f"Copy of {source_item.name}",
            'description': source_item.description,
            'item_type': source_item.item_type,
            'category_id': source_item.category_id,  # Now using FK
            'unit': source_item.unit,
            'default_quantity': float(source_item.default_quantity) if source_item.default_quantity else None,
            'material_weight_id': source_item.material_weight_id,
            'default_include_in_debris': source_item.default_include_in_debris,
            'display_order': self.repository.get_next_display_order(target_company_id),
            'company_id': target_company_id if target_company_id is not None else source_item.company_id,
            'is_active': True,
        }

        if created_by_id:
            new_data['created_by_id'] = created_by_id

        # Check for name conflict
        existing = self.repository.find_by_name(
            name=new_data['name'],
            company_id=new_data['company_id']
        )
        if existing:
            # Add number suffix
            base_name = new_data['name']
            counter = 1
            while existing:
                new_data['name'] = f"{base_name} ({counter})"
                existing = self.repository.find_by_name(
                    name=new_data['name'],
                    company_id=new_data['company_id']
                )
                counter += 1

        return self.repository.create(new_data)
