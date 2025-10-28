"""
Reconstruction Estimate repository
"""

from typing import List, Optional, Dict
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func

from .models import MaterialCategory, MaterialWeight, DebrisCalculation, DebrisItem
from app.common.base_repository import BaseRepository


class MaterialCategoryRepository:
    """Repository for material categories"""

    def __init__(self, db: Session):
        self.db = db
        self.model_class = MaterialCategory

    def get(self, id: str) -> Optional[MaterialCategory]:
        """Get category by ID"""
        return self.db.query(MaterialCategory).filter(MaterialCategory.id == id).first()

    def create(self, category: MaterialCategory) -> MaterialCategory:
        """Create new category"""
        self.db.add(category)
        self.db.commit()
        self.db.refresh(category)
        return category

    def update(self, id: str, data: Dict) -> Optional[MaterialCategory]:
        """Update category"""
        category = self.get(id)
        if category:
            for key, value in data.items():
                if hasattr(category, key):
                    setattr(category, key, value)
            self.db.commit()
            self.db.refresh(category)
        return category

    def get_active_categories(self) -> List[MaterialCategory]:
        """Get all active categories ordered by display_order"""
        return (
            self.db.query(MaterialCategory)
            .filter(MaterialCategory.active == True)
            .order_by(MaterialCategory.display_order, MaterialCategory.category_name)
            .all()
        )

    def get_by_name(self, name: str) -> Optional[MaterialCategory]:
        """Get category by name"""
        return (
            self.db.query(MaterialCategory)
            .filter(MaterialCategory.category_name == name)
            .first()
        )


class MaterialWeightRepository:
    """Repository for material weights"""

    def __init__(self, db: Session):
        self.db = db
        self.model_class = MaterialWeight

    def get(self, id: str) -> Optional[MaterialWeight]:
        """Get material by ID"""
        return self.db.query(MaterialWeight).filter(MaterialWeight.id == id).first()

    def create(self, material: MaterialWeight) -> MaterialWeight:
        """Create new material"""
        self.db.add(material)
        self.db.commit()
        self.db.refresh(material)
        return material

    def update(self, id: str, data: Dict) -> Optional[MaterialWeight]:
        """Update material"""
        material = self.get(id)
        if material:
            for key, value in data.items():
                if hasattr(material, key):
                    setattr(material, key, value)
            self.db.commit()
            self.db.refresh(material)
        return material

    def get_all_with_category(
        self,
        category_id: Optional[str] = None,
        active_only: bool = True,
        search: Optional[str] = None
    ) -> List[MaterialWeight]:
        """Get all materials with category information"""
        query = (
            self.db.query(MaterialWeight)
            .join(MaterialCategory)
            .options(joinedload(MaterialWeight.category))
        )

        if active_only:
            query = query.filter(MaterialWeight.active == True)

        if category_id:
            query = query.filter(MaterialWeight.category_id == category_id)

        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    MaterialWeight.material_type.ilike(search_term),
                    MaterialWeight.description.ilike(search_term)
                )
            )

        return query.order_by(
            MaterialCategory.display_order,
            MaterialWeight.material_type
        ).all()

    def get_by_material_type(self, material_type: str) -> Optional[MaterialWeight]:
        """Get material by type"""
        return (
            self.db.query(MaterialWeight)
            .options(joinedload(MaterialWeight.category))
            .filter(MaterialWeight.material_type == material_type)
            .first()
        )

    def get_by_category(self, category_id: str, active_only: bool = True) -> List[MaterialWeight]:
        """Get all materials in a category"""
        query = (
            self.db.query(MaterialWeight)
            .filter(MaterialWeight.category_id == category_id)
        )

        if active_only:
            query = query.filter(MaterialWeight.active == True)

        return query.order_by(MaterialWeight.material_type).all()

    def bulk_create(self, materials: List[MaterialWeight]) -> List[MaterialWeight]:
        """Create multiple materials at once"""
        self.db.add_all(materials)
        self.db.commit()
        for material in materials:
            self.db.refresh(material)
        return materials


class DebrisCalculationRepository:
    """Repository for debris calculations"""

    def __init__(self, db: Session):
        self.db = db
        self.model_class = DebrisCalculation

    def get(self, id: str) -> Optional[DebrisCalculation]:
        """Get calculation by ID"""
        return self.db.query(DebrisCalculation).filter(DebrisCalculation.id == id).first()

    def create(self, calculation: DebrisCalculation) -> DebrisCalculation:
        """Create new calculation"""
        self.db.add(calculation)
        self.db.commit()
        self.db.refresh(calculation)
        return calculation

    def update(self, id: str, data: Dict) -> Optional[DebrisCalculation]:
        """Update calculation"""
        calculation = self.get(id)
        if calculation:
            for key, value in data.items():
                if hasattr(calculation, key):
                    setattr(calculation, key, value)
            self.db.commit()
            self.db.refresh(calculation)
        return calculation

    def delete(self, id: str) -> bool:
        """Delete calculation"""
        calculation = self.get(id)
        if calculation:
            self.db.delete(calculation)
            self.db.commit()
            return True
        return False

    def get_by_user(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0
    ) -> tuple[List[DebrisCalculation], int]:
        """Get calculations by user with pagination"""
        query = (
            self.db.query(DebrisCalculation)
            .filter(DebrisCalculation.created_by_id == user_id)
            .options(joinedload(DebrisCalculation.items))
            .order_by(DebrisCalculation.created_at.desc())
        )

        total = query.count()
        calculations = query.offset(offset).limit(limit).all()

        return calculations, total

    def get_with_items(self, calculation_id: str) -> Optional[DebrisCalculation]:
        """Get calculation with all items"""
        return (
            self.db.query(DebrisCalculation)
            .options(
                joinedload(DebrisCalculation.items)
                .joinedload(DebrisItem.material)
                .joinedload(MaterialWeight.category)
            )
            .filter(DebrisCalculation.id == calculation_id)
            .first()
        )

    def get_recent_by_user(self, user_id: str, limit: int = 10) -> List[DebrisCalculation]:
        """Get recent calculations by user"""
        return (
            self.db.query(DebrisCalculation)
            .filter(DebrisCalculation.created_by_id == user_id)
            .order_by(DebrisCalculation.created_at.desc())
            .limit(limit)
            .all()
        )


class DebrisItemRepository:
    """Repository for debris items"""

    def __init__(self, db: Session):
        self.db = db
        self.model_class = DebrisItem

    def get_by_calculation(self, calculation_id: str) -> List[DebrisItem]:
        """Get all items for a calculation"""
        return (
            self.db.query(DebrisItem)
            .options(
                joinedload(DebrisItem.material)
                .joinedload(MaterialWeight.category)
            )
            .filter(DebrisItem.calculation_id == calculation_id)
            .all()
        )

    def bulk_create(self, items: List[DebrisItem]) -> List[DebrisItem]:
        """Create multiple items at once"""
        self.db.add_all(items)
        self.db.commit()
        for item in items:
            self.db.refresh(item)
        return items

    def delete_by_calculation(self, calculation_id: str) -> int:
        """Delete all items for a calculation"""
        deleted = (
            self.db.query(DebrisItem)
            .filter(DebrisItem.calculation_id == calculation_id)
            .delete()
        )
        self.db.commit()
        return deleted
