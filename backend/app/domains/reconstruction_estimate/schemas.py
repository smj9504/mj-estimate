"""
Reconstruction Estimate schemas
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict
from datetime import datetime
from decimal import Decimal
from enum import Enum


class MoistureLevelEnum(str, Enum):
    """Moisture condition levels"""
    DRY = "dry"
    DAMP = "damp"
    WET = "wet"
    SATURATED = "saturated"


class UnitTypeEnum(str, Enum):
    """Measurement unit types"""
    SF = "SF"
    LF = "LF"
    EA = "EA"


# Material Category Schemas
class MaterialCategoryBase(BaseModel):
    category_name: str = Field(..., max_length=100)
    display_order: int = Field(default=0)
    active: bool = Field(default=True)
    description: Optional[str] = None


class MaterialCategoryCreate(MaterialCategoryBase):
    pass


class MaterialCategoryUpdate(BaseModel):
    category_name: Optional[str] = Field(None, max_length=100)
    display_order: Optional[int] = None
    active: Optional[bool] = None
    description: Optional[str] = None


class MaterialCategoryResponse(MaterialCategoryBase):
    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Material Weight Schemas
class MaterialWeightBase(BaseModel):
    material_type: str = Field(..., max_length=100)
    category_id: str
    description: Optional[str] = None
    dry_weight_per_unit: Decimal = Field(..., gt=0)
    unit: UnitTypeEnum
    damp_multiplier: Decimal = Field(default=Decimal("1.2"), gt=0)
    wet_multiplier: Decimal = Field(default=Decimal("1.5"), gt=0)
    saturated_multiplier: Decimal = Field(default=Decimal("2.0"), gt=0)
    active: bool = Field(default=True)


class MaterialWeightCreate(MaterialWeightBase):
    pass


class MaterialWeightUpdate(BaseModel):
    material_type: Optional[str] = Field(None, max_length=100)
    category_id: Optional[str] = None
    description: Optional[str] = None
    dry_weight_per_unit: Optional[Decimal] = Field(None, gt=0)
    unit: Optional[UnitTypeEnum] = None
    damp_multiplier: Optional[Decimal] = Field(None, gt=0)
    wet_multiplier: Optional[Decimal] = Field(None, gt=0)
    saturated_multiplier: Optional[Decimal] = Field(None, gt=0)
    active: Optional[bool] = None


class MaterialWeightResponse(MaterialWeightBase):
    id: str
    category_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by_id: Optional[str] = None
    updated_by_id: Optional[str] = None

    class Config:
        from_attributes = True


class MaterialWeightListResponse(BaseModel):
    """List of materials with category information"""
    materials: List[MaterialWeightResponse]
    total: int


# Debris Item Schemas
class DebrisItemInput(BaseModel):
    """Input for a debris item calculation"""
    material_id: str
    quantity: Decimal = Field(..., gt=0)
    moisture_level: MoistureLevelEnum = Field(default=MoistureLevelEnum.DRY)
    description: Optional[str] = None

    @field_validator('quantity')
    @classmethod
    def validate_quantity(cls, v):
        if v <= 0:
            raise ValueError('Quantity must be positive')
        return v


class DebrisItemResponse(BaseModel):
    """Calculated debris item with results"""
    id: Optional[str] = None
    material_id: str
    material_type: str
    quantity: Decimal
    unit: UnitTypeEnum
    moisture_level: MoistureLevelEnum
    unit_weight_lb: Decimal
    moisture_multiplier: Decimal
    total_weight_lb: Decimal
    total_weight_ton: Decimal
    description: Optional[str] = None

    class Config:
        from_attributes = True


# Debris Calculation Schemas
class DebrisCalculationInput(BaseModel):
    """Input for debris calculation"""
    calculation_name: Optional[str] = Field(None, max_length=255)
    project_address: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None
    items: List[DebrisItemInput] = Field(..., min_length=1)


class DebrisCalculationCreate(DebrisCalculationInput):
    """Create a saved debris calculation"""
    pass


class DebrisCalculationUpdate(BaseModel):
    """Update a saved debris calculation"""
    calculation_name: Optional[str] = Field(None, max_length=255)
    project_address: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None
    items: Optional[List[DebrisItemInput]] = None


class DumpsterRecommendation(BaseModel):
    """Dumpster size recommendation"""
    size: str
    capacity_ton: Decimal
    capacity_lb: Decimal
    multiple_loads: bool
    load_count: int


class CategoryBreakdown(BaseModel):
    """Weight breakdown by category"""
    category_name: str
    weight_lb: Decimal
    weight_ton: Decimal
    item_count: int
    percentage: Decimal


class DebrisCalculationResult(BaseModel):
    """Result of debris calculation (not saved)"""
    items: List[DebrisItemResponse]
    total_weight_lb: Decimal
    total_weight_ton: Decimal
    category_breakdown: List[CategoryBreakdown]
    dumpster_recommendation: DumpsterRecommendation


class DebrisCalculationResponse(BaseModel):
    """Saved debris calculation with results"""
    id: str
    calculation_name: Optional[str] = None
    project_address: Optional[str] = None
    notes: Optional[str] = None
    total_weight_lb: Decimal
    total_weight_ton: Decimal
    category_breakdown: Dict[str, Decimal]
    dumpster_recommendation: Dict
    items: List[DebrisItemResponse]
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by_id: str

    class Config:
        from_attributes = True


class DebrisCalculationListResponse(BaseModel):
    """List of saved calculations"""
    calculations: List[DebrisCalculationResponse]
    total: int


# Quick calculation (no save)
class QuickCalculationRequest(BaseModel):
    """Quick calculation without saving"""
    items: List[DebrisItemInput] = Field(..., min_length=1)
