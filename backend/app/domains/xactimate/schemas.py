"""
Xactimate domain schemas
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from decimal import Decimal
from datetime import datetime


class XactimateComponentBase(BaseModel):
    """Base schema for Xactimate components"""
    component_type: str = Field(..., pattern="^(lab|mat|equ|burden|market)$")
    component_code: Optional[str] = Field(None, max_length=50)
    cost: Optional[Decimal] = Field(None, ge=0)
    direct_yield: Optional[Decimal] = Field(None, ge=0)
    yield_unit: Optional[str] = Field(None, max_length=20)
    spt_event_percent: Optional[Decimal] = Field(None, ge=0)
    yield_value: Optional[Decimal] = Field(None, ge=0)
    unit_price: Optional[Decimal] = Field(None, ge=0)


class XactimateComponentCreate(XactimateComponentBase):
    """Schema for creating Xactimate components"""
    pass


class XactimateComponentUpdate(BaseModel):
    """Schema for updating Xactimate components"""
    component_type: Optional[str] = Field(None, pattern="^(lab|mat|equ|burden|market)$")
    component_code: Optional[str] = Field(None, max_length=50)
    cost: Optional[Decimal] = Field(None, ge=0)
    direct_yield: Optional[Decimal] = Field(None, ge=0)
    yield_unit: Optional[str] = Field(None, max_length=20)
    spt_event_percent: Optional[Decimal] = Field(None, ge=0)
    yield_value: Optional[Decimal] = Field(None, ge=0)
    unit_price: Optional[Decimal] = Field(None, ge=0)


class XactimateComponentResponse(XactimateComponentBase):
    """Schema for Xactimate component responses"""
    id: int
    item_id: int
    
    class Config:
        from_attributes = True


class XactimateCategoryBase(BaseModel):
    """Base schema for Xactimate categories"""
    category_code: str = Field(..., max_length=3, min_length=3)
    category_name: str = Field(..., max_length=100)
    description: Optional[str] = None


class XactimateCategoryCreate(XactimateCategoryBase):
    """Schema for creating Xactimate categories"""
    pass


class XactimateCategoryUpdate(BaseModel):
    """Schema for updating Xactimate categories"""
    category_name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None


class XactimateCategoryResponse(XactimateCategoryBase):
    """Schema for Xactimate category responses"""
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class XactimateItemBase(BaseModel):
    """Base schema for Xactimate items"""
    item_code: str = Field(..., max_length=50)
    category_code: str = Field(..., max_length=3)
    description: str = Field(..., min_length=1)
    price_year: int = Field(..., ge=2020, le=2100)
    price_month: int = Field(..., ge=1, le=12)
    labor_cost: Optional[Decimal] = Field(None, ge=0)
    material_cost: Optional[Decimal] = Field(None, ge=0)
    equipment_cost: Optional[Decimal] = Field(None, ge=0)
    labor_burden: Optional[Decimal] = Field(None, ge=0)
    market_conditions: Optional[Decimal] = Field(None, ge=0)
    life_expectancy_years: Optional[int] = Field(None, ge=0)
    depreciation_rate: Optional[Decimal] = Field(None, ge=0, le=100)
    max_depreciation: Optional[Decimal] = Field(None, ge=0, le=100)
    includes_description: Optional[str] = None
    excludes_description: Optional[str] = None
    note_description: Optional[str] = None
    quality_description: Optional[str] = None
    reference_description: Optional[str] = None
    has_life_expectancy_data: bool = False


class XactimateItemCreate(XactimateItemBase):
    """Schema for creating Xactimate items"""
    components: Optional[List[XactimateComponentCreate]] = []


class XactimateItemUpdate(BaseModel):
    """Schema for updating Xactimate items"""
    item_code: Optional[str] = Field(None, max_length=50)
    category_code: Optional[str] = Field(None, max_length=3)
    description: Optional[str] = Field(None, min_length=1)
    price_year: Optional[int] = Field(None, ge=2020, le=2100)
    price_month: Optional[int] = Field(None, ge=1, le=12)
    labor_cost: Optional[Decimal] = Field(None, ge=0)
    material_cost: Optional[Decimal] = Field(None, ge=0)
    equipment_cost: Optional[Decimal] = Field(None, ge=0)
    labor_burden: Optional[Decimal] = Field(None, ge=0)
    market_conditions: Optional[Decimal] = Field(None, ge=0)
    life_expectancy_years: Optional[int] = Field(None, ge=0)
    depreciation_rate: Optional[Decimal] = Field(None, ge=0, le=100)
    max_depreciation: Optional[Decimal] = Field(None, ge=0, le=100)
    includes_description: Optional[str] = None
    excludes_description: Optional[str] = None
    note_description: Optional[str] = None
    quality_description: Optional[str] = None
    reference_description: Optional[str] = None
    has_life_expectancy_data: Optional[bool] = None


class XactimateItemResponse(XactimateItemBase):
    """Schema for Xactimate item responses"""
    id: int
    untaxed_unit_price: Decimal
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    components: Optional[List[XactimateComponentResponse]] = []
    category: Optional[XactimateCategoryResponse] = None
    
    class Config:
        from_attributes = True


class XactimateSearchRequest(BaseModel):
    """Schema for Xactimate search requests"""
    search_term: Optional[str] = Field(None, max_length=200)
    category_code: Optional[str] = Field(None, max_length=3)
    item_code: Optional[str] = Field(None, max_length=50)
    price_year: Optional[int] = Field(None, ge=2020, le=2100)
    price_month: Optional[int] = Field(None, ge=1, le=12)
    min_price: Optional[Decimal] = Field(None, ge=0)
    max_price: Optional[Decimal] = Field(None, ge=0)
    has_components: Optional[bool] = None
    include_components: bool = False
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=500)


class XactimateSearchResponse(BaseModel):
    """Schema for Xactimate search responses"""
    items: List[XactimateItemResponse]
    total_count: int
    page: int
    page_size: int
    total_pages: int


class XactimateCategoryStatsResponse(BaseModel):
    """Schema for Xactimate category statistics"""
    category_code: str
    category_name: str
    item_count: int
    avg_price: Optional[Decimal] = None
    min_price: Optional[Decimal] = None
    max_price: Optional[Decimal] = None
    latest_update: Optional[datetime] = None


class XactimateStatsResponse(BaseModel):
    """Schema for overall Xactimate statistics"""
    total_categories: int
    total_items: int
    total_components: int
    categories: List[XactimateCategoryStatsResponse]
    price_range: Dict[str, Optional[Decimal]]
    last_updated: Optional[datetime] = None


# Unified schemas for compatibility with existing line_items
class UnifiedLineItemResponse(BaseModel):
    """Unified schema for both Xactimate and Custom line items"""
    id: str
    type: str  # 'XACTIMATE' or 'CUSTOM'
    cat: Optional[str] = None
    item: Optional[str] = None
    description: str
    includes: Optional[str] = None
    unit: Optional[str] = None
    untaxed_unit_price: Decimal
    lab: Optional[Decimal] = None
    mat: Optional[Decimal] = None
    equ: Optional[Decimal] = None
    labor_burden: Optional[Decimal] = None
    market_condition: Optional[Decimal] = None
    is_active: bool = True
    version: int = 1
    company_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class UnifiedSearchRequest(BaseModel):
    """Unified search request for both Xactimate and Custom line items"""
    search_term: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(None, max_length=50)
    item_type: Optional[str] = Field(None, pattern="^(XACTIMATE|CUSTOM|ALL)$")
    company_id: Optional[str] = None
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=500)


class UnifiedSearchResponse(BaseModel):
    """Unified search response for both types"""
    items: List[UnifiedLineItemResponse]
    total_count: int
    page: int
    page_size: int
    total_pages: int
    xactimate_count: int
    custom_count: int