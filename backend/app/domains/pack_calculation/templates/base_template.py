"""
Base Room Template Data Structures
"""

from enum import Enum
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


class RoomType(str, Enum):
    """Predefined room types with standard configurations"""
    KITCHEN = "kitchen"
    BEDROOM = "bedroom"
    LIVING_ROOM = "living_room"
    BATHROOM = "bathroom"
    GARAGE = "garage"
    OFFICE = "office"
    DINING_ROOM = "dining_room"
    BASEMENT = "basement"
    ATTIC = "attic"
    CLOSET = "closet"
    LAUNDRY = "laundry"


class DensityLevel(str, Enum):
    """Room density/fullness levels"""
    MINIMAL = "minimal"      # 20% capacity - recently moved in, sparse
    MODERATE = "moderate"    # 60% capacity - typical lived-in home (frontend: "moderate")
    FULL = "full"            # 80% capacity - well-furnished, many belongings (frontend: "full")
    PACKED = "packed"        # 100%+ capacity - heavily furnished, maximum utilization (frontend: "packed")


class TemplateItem(BaseModel):
    """Individual item in a room template"""
    category: str = Field(..., description="Item category (e.g., 'Kitchen Items', 'Clothing')")
    subcategory: Optional[str] = Field(None, description="Item subcategory (e.g., 'Pots & Pans')")
    base_quantity: int = Field(..., description="Base quantity at MODERATE density")
    variance_range: Tuple[int, int] = Field(..., description="Min/max quantity range (min, max)")
    pack_size: int = Field(1, description="How many items pack into one box")
    is_optional: bool = Field(False, description="Can be omitted for minimal density")
    storage_type: Optional[str] = Field(None, description="Where stored: visible|cabinet|closet|drawer")

    class Config:
        json_schema_extra = {
            "example": {
                "category": "Kitchen Items",
                "subcategory": "Pots & Pans",
                "base_quantity": 8,
                "variance_range": [5, 15],
                "pack_size": 1,
                "is_optional": False,
                "storage_type": "cabinet"
            }
        }


class StorageMultiplier(BaseModel):
    """Multiplier for storage units (cabinets, closets, drawers)"""
    storage_type: str = Field(..., description="Type of storage (kitchen_cabinets, bedroom_closet, etc.)")
    base_count: int = Field(..., description="Typical count of this storage type in the room")
    items_per_unit: int = Field(..., description="Average items stored per unit")
    density_impact: Dict[DensityLevel, float] = Field(..., description="Multiplier per density level")

    class Config:
        json_schema_extra = {
            "example": {
                "storage_type": "kitchen_cabinets",
                "base_count": 10,
                "items_per_unit": 12,
                "density_impact": {
                    "minimal": 0.3,
                    "light": 0.5,
                    "medium": 0.75,
                    "heavy": 1.0,
                    "extreme": 1.3
                }
            }
        }


class DensityModifier(BaseModel):
    """How density level affects item quantities"""
    density_level: DensityLevel = Field(..., description="Density level this modifier applies to")
    quantity_multiplier: float = Field(..., description="Multiplier for base quantities (0.0-2.0)")
    additional_categories: List[str] = Field(default_factory=list, description="Categories that appear at this density")

    class Config:
        json_schema_extra = {
            "example": {
                "density_level": "heavy",
                "quantity_multiplier": 1.3,
                "additional_categories": ["Specialty Appliances", "Extra Dishes"]
            }
        }


class RoomTemplate(BaseModel):
    """Complete room template with all configuration"""
    id: str = Field(..., description="Unique template identifier")
    room_type: RoomType = Field(..., description="Type of room")
    name: str = Field(..., description="Display name")
    description: str = Field(..., description="Template description")
    base_items: List[TemplateItem] = Field(default_factory=list, description="Base items in this room")
    storage_multipliers: List[StorageMultiplier] = Field(default_factory=list, description="Storage unit multipliers")
    density_modifiers: List[DensityModifier] = Field(default_factory=list, description="Density-based modifiers")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "kitchen_standard",
                "room_type": "kitchen",
                "name": "Standard Kitchen",
                "description": "Typical residential kitchen with cabinets, appliances, and pantry",
                "base_items": [],
                "storage_multipliers": [],
                "density_modifiers": []
            }
        }
