"""
Pack Calculation repository
"""

from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, and_, or_, func, desc
from typing import List, Optional, Dict
from uuid import UUID
from datetime import datetime, timedelta

from app.common.base_repository import SQLAlchemyRepository
from .models import (
    PackCalculation,
    PackRoom,
    PackItem,
    ItemMaterialMapping,
    MLTrainingMetadata
)


class PackCalculationRepository(SQLAlchemyRepository):
    """Repository for pack calculations"""

    def __init__(self, db: Session):
        super().__init__(db, PackCalculation)
        self.db = db

    def get_by_id_with_rooms(self, calculation_id: UUID) -> Optional[PackCalculation]:
        """Get calculation with all rooms and items"""
        result = self.db.execute(
            select(PackCalculation)
            .where(PackCalculation.id == calculation_id)
            .options(
                selectinload(PackCalculation.rooms).selectinload(PackRoom.items)
            )
        )
        return result.scalar_one_or_none()

    def get_all_completed(self, limit: int = 1000) -> List[PackCalculation]:
        """Get all completed calculations for ML training"""
        result = self.db.execute(
            select(PackCalculation)
            .where(PackCalculation.approved_for_training == True)
            .order_by(desc(PackCalculation.created_at))
            .limit(limit)
        )
        return result.scalars().all()

    def count_new_corrections_since_last_training(self) -> int:
        """Count corrections since last ML training"""
        # Get last training date
        last_training = self.db.execute(
            select(MLTrainingMetadata)
            .where(MLTrainingMetadata.deployed == True)
            .order_by(desc(MLTrainingMetadata.trained_at))
            .limit(1)
        )
        last_training_record = last_training.scalar_one_or_none()

        if not last_training_record:
            cutoff_date = datetime.now() - timedelta(days=365)
        else:
            cutoff_date = last_training_record.trained_at

        # Count corrections since then
        result = self.db.execute(
            select(func.count(PackCalculation.id))
            .where(
                and_(
                    PackCalculation.was_corrected == True,
                    PackCalculation.corrected_at >= cutoff_date,
                    PackCalculation.approved_for_training == True
                )
            )
        )
        return result.scalar()

    def get_recent_corrections(self, limit: int = 50) -> List[PackCalculation]:
        """Get recent corrections for display"""
        result = self.db.execute(
            select(PackCalculation)
            .where(PackCalculation.was_corrected == True)
            .order_by(desc(PackCalculation.corrected_at))
            .limit(limit)
        )
        return result.scalars().all()


class PackRoomRepository(SQLAlchemyRepository):
    """Repository for pack rooms"""

    def __init__(self, db: Session):
        super().__init__(db, PackRoom)
        self.db = db

    def delete_by_calculation_id(self, calculation_id):
        """Delete all rooms (and their items) for a calculation"""
        rooms = self.db.query(PackRoom).filter(PackRoom.calculation_id == calculation_id).all()
        for room in rooms:
            # Delete items first (cascade should handle this, but explicit is better)
            self.db.query(PackItem).filter(PackItem.room_id == room.id).delete()
            self.db.delete(room)
        self.db.flush()  # Flush changes but don't commit - let the caller handle transaction


class PackItemRepository(SQLAlchemyRepository):
    """Repository for pack items"""

    def __init__(self, db: Session):
        super().__init__(db, PackItem)
        self.db = db


class ItemMaterialMappingRepository(SQLAlchemyRepository):
    """Repository for item-material mappings"""

    def __init__(self, db: Session):
        super().__init__(db, ItemMaterialMapping)
        self.db = db

    def get_by_item_name(self, item_name: str) -> Optional[ItemMaterialMapping]:
        """Get mapping by item name"""
        result = self.db.execute(
            select(ItemMaterialMapping)
            .where(
                and_(
                    ItemMaterialMapping.item_name == item_name,
                    ItemMaterialMapping.active == True
                )
            )
        )
        return result.scalar_one_or_none()

    def has_mapping(self, item_name: str) -> bool:
        """Check if mapping exists for item"""
        result = self.db.execute(
            select(func.count(ItemMaterialMapping.id))
            .where(
                and_(
                    ItemMaterialMapping.item_name == item_name,
                    ItemMaterialMapping.active == True
                )
            )
        )
        return result.scalar() > 0

    def get_by_category(self, category: str) -> List[ItemMaterialMapping]:
        """Get all mappings in a category"""
        result = self.db.execute(
            select(ItemMaterialMapping)
            .where(
                and_(
                    ItemMaterialMapping.item_category == category,
                    ItemMaterialMapping.active == True
                )
            )
        )
        return result.scalars().all()

    def search_similar_items(self, item_name: str, category: Optional[str] = None) -> List[ItemMaterialMapping]:
        """Search for similar items (fuzzy match)"""
        query = select(ItemMaterialMapping).where(ItemMaterialMapping.active == True)

        # Simple similarity: ILIKE search
        query = query.where(
            or_(
                ItemMaterialMapping.item_name.ilike(f"%{item_name}%"),
                ItemMaterialMapping.item_name.ilike(f"{item_name}%")
            )
        )

        if category:
            query = query.where(ItemMaterialMapping.item_category == category)

        result = self.db.execute(query.limit(10))
        return result.scalars().all()

    def increment_usage(self, mapping_id: UUID):
        """Increment usage count and update last used"""
        mapping = self.get_by_id(mapping_id)
        if mapping:
            update_data = {
                "usage_count": mapping.get("usage_count", 0) + 1,
                "last_used_at": datetime.now(),
            }
            self.update(mapping_id, update_data)

    def count_similar_calculations(self, item_name: str, category: Optional[str] = None) -> int:
        """Count how many times similar items were calculated"""
        mapping = self.get_by_item_name(item_name)
        if mapping:
            return mapping.get("usage_count", 0)

        # Try similar items
        similar_items = self.search_similar_items(item_name, category)
        if similar_items:
            return sum(item.get("usage_count", 0) for item in similar_items)

        return 0


class MLTrainingMetadataRepository(SQLAlchemyRepository):
    """Repository for ML training metadata"""

    def __init__(self, db: Session):
        super().__init__(db, MLTrainingMetadata)
        self.db = db

    def get_latest_deployed(self) -> Optional[MLTrainingMetadata]:
        """Get latest deployed model metadata"""
        result = self.db.execute(
            select(MLTrainingMetadata)
            .where(MLTrainingMetadata.deployed == True)
            .order_by(desc(MLTrainingMetadata.deployed_at))
            .limit(1)
        )
        return result.scalar_one_or_none()

    def get_training_history(self, limit: int = 20) -> List[MLTrainingMetadata]:
        """Get training history"""
        result = self.db.execute(
            select(MLTrainingMetadata)
            .order_by(desc(MLTrainingMetadata.trained_at))
            .limit(limit)
        )
        return result.scalars().all()
