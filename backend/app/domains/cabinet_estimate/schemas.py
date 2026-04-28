"""
Cabinet Estimate Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Enums / Constants ──

class CabinetTier:
    STOCK = "Stock"
    SEMI_CUSTOM = "Semi-Custom"
    CUSTOM = "Custom"

    @classmethod
    def choices(cls):
        return [cls.STOCK, cls.SEMI_CUSTOM, cls.CUSTOM]


class BoxMaterial:
    PLYWOOD = "Plywood"
    MDF = "MDF"
    PARTICLE = "Particle"

    @classmethod
    def choices(cls):
        return [cls.PLYWOOD, cls.MDF, cls.PARTICLE]


class FinishType:
    STAINED = "Stained"
    PAINTED = "Painted"
    GLAZED = "Glazed"
    LAMINATE = "Laminate"

    @classmethod
    def choices(cls):
        return [cls.STAINED, cls.PAINTED, cls.GLAZED, cls.LAMINATE]


class CabType:
    BASE = "base"
    WALL = "wall"
    TALL = "tall"
    SPECIALTY = "specialty"

    @classmethod
    def choices(cls):
        return [cls.BASE, cls.WALL, cls.TALL, cls.SPECIALTY]


class EstimateStatus:
    DRAFT = "draft"
    CALCULATED = "calculated"
    APPROVED = "approved"
    EXPORTED = "exported"

    @classmethod
    def choices(cls):
        return [cls.DRAFT, cls.CALCULATED, cls.APPROVED, cls.EXPORTED]


# ── Box schemas ──

class CabinetBoxBase(BaseModel):
    code: str = Field(..., max_length=20, description="Cabinet code e.g. B30, SB36")
    cab_type: str = Field(..., max_length=20, description="base/wall/tall/specialty")
    width_inches: int = Field(..., ge=6, le=60)
    height_inches: float = Field(..., ge=6, le=120)
    is_specialty: bool = False
    specialty_type: Optional[str] = Field(None, max_length=50)
    qty: int = Field(1, ge=1)
    display_order: int = 0


class CabinetBoxCreate(CabinetBoxBase):
    pass


class CabinetBoxUpdate(BaseModel):
    code: Optional[str] = Field(None, max_length=20)
    cab_type: Optional[str] = Field(None, max_length=20)
    width_inches: Optional[int] = Field(None, ge=6, le=60)
    height_inches: Optional[float] = Field(None, ge=6, le=120)
    is_specialty: Optional[bool] = None
    specialty_type: Optional[str] = Field(None, max_length=50)
    qty: Optional[int] = Field(None, ge=1)
    display_order: Optional[int] = None


class CabinetBoxResponse(CabinetBoxBase):
    id: str
    estimate_id: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Line item schemas ──

class LineItemResponse(BaseModel):
    id: str
    estimate_id: str
    description: str
    quantity: float
    unit: str
    unit_price: float
    total: float
    category: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Estimate schemas ──

class CabinetEstimateBase(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    zip_code: Optional[str] = Field(None, max_length=10)
    layout_type: Optional[str] = Field(None, max_length=50)
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: bool = False
    tier: Optional[str] = Field(None, max_length=50)
    box_material: Optional[str] = Field(None, max_length=50)
    finish: Optional[str] = Field(None, max_length=50)
    door_style: Optional[str] = Field(None, max_length=50)
    include_demo: bool = True
    include_install: bool = True
    include_delivery: bool = True
    include_plumbing: bool = False
    include_countertop_reset: bool = False
    include_hardware: bool = True
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    overhead_pct: float = 0.10
    profit_pct: float = 0.10
    notes: Optional[str] = None


class CabinetEstimateCreate(CabinetEstimateBase):
    boxes: List[CabinetBoxCreate] = []


class CabinetEstimateUpdate(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    zip_code: Optional[str] = Field(None, max_length=10)
    layout_type: Optional[str] = Field(None, max_length=50)
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: Optional[bool] = None
    tier: Optional[str] = Field(None, max_length=50)
    box_material: Optional[str] = Field(None, max_length=50)
    finish: Optional[str] = Field(None, max_length=50)
    door_style: Optional[str] = Field(None, max_length=50)
    include_demo: Optional[bool] = None
    include_install: Optional[bool] = None
    include_delivery: Optional[bool] = None
    include_plumbing: Optional[bool] = None
    include_countertop_reset: Optional[bool] = None
    include_hardware: Optional[bool] = None
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    overhead_pct: Optional[float] = None
    profit_pct: Optional[float] = None
    notes: Optional[str] = None
    boxes: Optional[List[CabinetBoxCreate]] = None


class CabinetEstimateResponse(BaseModel):
    id: str
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    created_by_id: Optional[str] = None
    status: str
    property_address: Optional[str] = None
    zip_code: Optional[str] = None
    layout_type: Optional[str] = None
    kitchen_size_sqft: Optional[float] = None
    ceiling_height: Optional[float] = None
    has_soffit: bool = False
    tier: Optional[str] = None
    box_material: Optional[str] = None
    finish: Optional[str] = None
    door_style: Optional[str] = None
    include_demo: bool = True
    include_install: bool = True
    include_delivery: bool = True
    include_plumbing: bool = False
    include_countertop_reset: bool = False
    include_hardware: bool = True
    countertop_material: Optional[str] = None
    countertop_sqft: Optional[float] = None
    subtotal: float = 0
    overhead_pct: float = 0.10
    overhead_amount: float = 0
    profit_pct: float = 0.10
    profit_amount: float = 0
    total: float = 0
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None
    notes: Optional[str] = None
    boxes: List[CabinetBoxResponse] = []
    line_items: List[LineItemResponse] = []
    # Claim info (populated by service)
    claim_number: Optional[str] = None
    client_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CabinetEstimateListResponse(BaseModel):
    items: List[CabinetEstimateResponse]
    total: int
    page: int
    page_size: int


# ── History schemas ──

class HistoryResponse(BaseModel):
    id: str
    estimate_id: str
    version_number: int
    snapshot_data: Dict[str, Any]
    changed_by_id: Optional[str] = None
    change_description: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Purchase order schemas ──

class PurchaseOrderItem(BaseModel):
    code: str
    description: str
    cab_type: str
    width_inches: int
    height_inches: float
    qty: int


class PurchaseOrderResponse(BaseModel):
    estimate_id: str
    property_address: Optional[str] = None
    items: List[PurchaseOrderItem]
    total_boxes: int


# ── Pricing info (for frontend dropdowns) ──

class PricingInfoResponse(BaseModel):
    tiers: List[str]
    materials: List[str]
    finishes: List[str]
    door_styles: List[str]
    layout_types: List[str]
    cab_types: List[str]
    specialty_types: List[str]
    scope_items: Dict[str, float]
