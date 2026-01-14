"""
Water Mitigation Scope of Work Repository

Data access layer for scope locations and scope items.
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload, joinedload

from app.domains.water_mitigation.models import (
    WMScopeLocation,
    WMScopeItem,
    WMDebrisCalculation,
)
from app.domains.reconstruction_estimate.models import MaterialWeight


class ScopeRepository:
    """Repository for Scope of Work operations"""

    def __init__(self, db: Session):
        self.db = db

    # =========================================================================
    # Scope Location Operations
    # =========================================================================

    def get_locations_by_job(
        self,
        job_id: UUID,
        include_items: bool = True
    ) -> List[WMScopeLocation]:
        """Get all scope locations for a job"""
        query = select(WMScopeLocation).where(
            WMScopeLocation.job_id == job_id
        )

        if include_items:
            query = query.options(
                selectinload(WMScopeLocation.scope_items)
            )

        query = query.order_by(WMScopeLocation.display_order)

        result = self.db.execute(query)
        return list(result.scalars().all())

    def get_location_by_id(
        self,
        location_id: UUID,
        include_items: bool = True
    ) -> Optional[WMScopeLocation]:
        """Get scope location by ID"""
        query = select(WMScopeLocation).where(
            WMScopeLocation.id == location_id
        )

        if include_items:
            query = query.options(
                selectinload(WMScopeLocation.scope_items)
            )

        result = self.db.execute(query)
        return result.scalar_one_or_none()

    def create_location(self, data: dict) -> WMScopeLocation:
        """Create a new scope location"""
        location = WMScopeLocation(**data)
        self.db.add(location)
        self.db.flush()
        return location

    def update_location(
        self, location: WMScopeLocation, data: dict
    ) -> WMScopeLocation:
        """Update a scope location"""
        for key, value in data.items():
            if hasattr(location, key):
                setattr(location, key, value)
        self.db.flush()
        return location

    def delete_location(self, location: WMScopeLocation) -> bool:
        """Delete a scope location and all its items (cascade)"""
        self.db.delete(location)
        self.db.flush()
        return True

    def get_next_location_order(self, job_id: UUID) -> int:
        """Get the next display order for a location"""
        query = select(func.max(WMScopeLocation.display_order)).where(
            WMScopeLocation.job_id == job_id
        )
        result = self.db.execute(query)
        max_order = result.scalar()
        return (max_order or 0) + 1

    # =========================================================================
    # Scope Item Operations
    # =========================================================================

    def get_items_by_location(
        self, location_id: UUID
    ) -> List[WMScopeItem]:
        """Get all scope items for a location"""
        query = (
            select(WMScopeItem)
            .where(WMScopeItem.location_id == location_id)
            .order_by(WMScopeItem.display_order)
        )

        result = self.db.execute(query)
        return list(result.scalars().all())

    def get_item_by_id(
        self, item_id: UUID
    ) -> Optional[WMScopeItem]:
        """Get scope item by ID"""
        query = (
            select(WMScopeItem)
            .where(WMScopeItem.id == item_id)
        )

        result = self.db.execute(query)
        return result.scalar_one_or_none()

    def create_item(self, data: dict) -> WMScopeItem:
        """Create a new scope item"""
        item = WMScopeItem(**data)
        self.db.add(item)
        self.db.flush()
        return item

    def create_items_bulk(self, items_data: List[dict]) -> List[WMScopeItem]:
        """Create multiple scope items at once"""
        items = []
        for data in items_data:
            item = WMScopeItem(**data)
            self.db.add(item)
            items.append(item)
        self.db.flush()
        return items

    def update_item(
        self, item: WMScopeItem, data: dict
    ) -> WMScopeItem:
        """Update a scope item"""
        for key, value in data.items():
            if hasattr(item, key):
                setattr(item, key, value)
        self.db.flush()
        return item

    def delete_item(self, item: WMScopeItem) -> bool:
        """Delete a scope item"""
        self.db.delete(item)
        self.db.flush()
        return True

    def get_next_item_order(self, location_id: UUID) -> int:
        """Get the next display order for an item"""
        query = select(func.max(WMScopeItem.display_order)).where(
            WMScopeItem.location_id == location_id
        )
        result = self.db.execute(query)
        max_order = result.scalar()
        return (max_order or 0) + 1

    def get_demolition_items_for_job(
        self, job_id: UUID
    ) -> List[WMScopeItem]:
        """Get all demolition items for a job (for debris calculation)"""
        query = (
            select(WMScopeItem)
            .join(WMScopeLocation)
            .where(
                WMScopeLocation.job_id == job_id,
                WMScopeItem.item_type == 'demolition',
                WMScopeItem.include_in_debris.is_(True)
            )
            .options(
                joinedload(WMScopeItem.material_weight),
                joinedload(WMScopeItem.location)
            )
        )

        result = self.db.execute(query)
        return list(result.scalars().all())

    # =========================================================================
    # Debris Calculation Operations
    # =========================================================================

    def get_debris_calculation_by_job(
        self, job_id: UUID
    ) -> Optional[WMDebrisCalculation]:
        """Get debris calculation for a job"""
        query = select(WMDebrisCalculation).where(
            WMDebrisCalculation.job_id == job_id
        )
        result = self.db.execute(query)
        return result.scalar_one_or_none()

    def create_or_update_debris_calculation(
        self,
        job_id: UUID,
        data: dict,
        user_id: Optional[UUID] = None
    ) -> WMDebrisCalculation:
        """Create or update debris calculation for a job"""
        existing = self.get_debris_calculation_by_job(job_id)

        if existing:
            for key, value in data.items():
                if hasattr(existing, key):
                    setattr(existing, key, value)
            if user_id:
                existing.calculated_by_id = user_id
            self.db.flush()
            return existing
        else:
            calculation = WMDebrisCalculation(job_id=job_id, **data)
            if user_id:
                calculation.calculated_by_id = user_id
            self.db.add(calculation)
            self.db.flush()
            return calculation

    def delete_debris_calculation(self, job_id: UUID) -> bool:
        """Delete debris calculation for a job"""
        calc = self.get_debris_calculation_by_job(job_id)
        if calc:
            self.db.delete(calc)
            self.db.flush()
            return True
        return False

    # =========================================================================
    # Material Weight Operations (for debris calculation)
    # =========================================================================

    def get_material_weight_by_id(
        self, material_id: UUID
    ) -> Optional[MaterialWeight]:
        """Get material weight by ID"""
        query = select(MaterialWeight).where(
            MaterialWeight.id == material_id
        )
        result = self.db.execute(query)
        return result.scalar_one_or_none()

    def get_all_materials_with_categories(
        self, active_only: bool = True
    ) -> List[MaterialWeight]:
        """Get all materials with their categories"""
        query = (
            select(MaterialWeight)
            .options(joinedload(MaterialWeight.category))
        )

        if active_only:
            query = query.where(MaterialWeight.active.is_(True))

        query = query.order_by(MaterialWeight.material_type)

        result = self.db.execute(query)
        return list(result.scalars().all())
