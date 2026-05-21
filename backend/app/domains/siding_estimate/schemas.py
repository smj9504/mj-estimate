"""
Siding Estimate domain Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── EagleView Upload Response ──


class EagleViewPenetration(BaseModel):
    designator: str = ""
    area: float = 0
    perimeter: float = 0
    width: float = 0
    height: float = 0
    sub_type: str = ""
    dimension_raw: str = ""


class EagleViewWall(BaseModel):
    id: str = ""
    designator: str = ""
    orientation: float = 0
    direction: str = ""
    area: float = 0
    siding_area: float = 0
    siding_area_net: float = 0
    masonry_area: float = 0
    window_count: int = 0
    door_count: int = 0
    total_penetration_area: float = 0
    penetrations: List[EagleViewPenetration] = []


class EagleViewParseResponse(BaseModel):
    """Response from EagleView XML upload/parse."""
    report_id: str = ""
    claim_id: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    latitude: float = 0
    longitude: float = 0

    # Summary totals
    total_wall_area: float = 0
    total_wall_area_less_penetrations: float = 0
    total_siding_area: float = 0
    total_siding_area_less_penetrations: float = 0
    total_masonry_area: float = 0
    total_masonry_area_less_penetrations: float = 0
    total_wall_facets: int = 0
    total_windows_and_doors: int = 0
    total_windows_and_doors_area: float = 0
    total_windows_and_doors_perimeter: float = 0
    fascia_lf: float = 0

    # Corners
    inside_corners_lf: float = 0
    outside_corners_lf: float = 0
    obtuse_inside_corners_lf: float = 0
    obtuse_outside_corners_lf: float = 0
    inside_siding_corners_lf: float = 0
    outside_siding_corners_lf: float = 0

    # Siding wall lengths
    top_siding_walls_lf: float = 0
    bottom_siding_walls_lf: float = 0

    # Materials & SubTypes
    materials: Dict[str, str] = {}
    sub_types: Dict[str, str] = {}

    # Wall details
    walls: List[EagleViewWall] = []

    # Raw parsed data for storage
    raw_data: Optional[Dict[str, Any]] = None


# ── Siding Estimate Schemas ──


class SidingEstimateLineItemBase(BaseModel):
    phase: int = 1
    description: str
    quantity: float = 0
    unit: str = "SF"
    unit_price: float = 0
    total: float = 0
    category: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0


class SidingEstimateLineItemCreate(SidingEstimateLineItemBase):
    pass


class SidingEstimateLineItemUpdate(BaseModel):
    phase: Optional[int] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


class SidingEstimateLineItemResponse(SidingEstimateLineItemBase):
    id: UUID
    estimate_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SidingEstimateBase(BaseModel):
    claim_id: Optional[UUID] = None
    company_id: Optional[UUID] = None

    # Project meta
    property_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    building_type: Optional[str] = None
    year_built: Optional[int] = None
    stories: Optional[int] = 1

    # EagleView
    eagleview_report_id: Optional[str] = None
    eagleview_claim_id: Optional[str] = None
    eagleview_data: Optional[Dict[str, Any]] = None

    # Measurements
    total_wall_area: Optional[float] = 0
    total_wall_area_net: Optional[float] = 0
    total_siding_area: Optional[float] = 0
    total_siding_area_net: Optional[float] = 0
    total_masonry_area: Optional[float] = 0
    total_masonry_area_net: Optional[float] = 0
    total_wall_facets: Optional[int] = 0
    total_windows_doors: Optional[int] = 0
    total_windows_doors_area: Optional[float] = 0
    total_windows_doors_perimeter: Optional[float] = 0
    fascia_lf: Optional[float] = 0
    inside_corners_lf: Optional[float] = 0
    outside_corners_lf: Optional[float] = 0
    obtuse_inside_corners_lf: Optional[float] = 0
    obtuse_outside_corners_lf: Optional[float] = 0
    inside_siding_corners_lf: Optional[float] = 0
    outside_siding_corners_lf: Optional[float] = 0
    top_siding_walls_lf: Optional[float] = 0
    bottom_siding_walls_lf: Optional[float] = 0

    # Specs (JSONB)
    siding_spec: Optional[Dict[str, Any]] = None
    trim_spec: Optional[Dict[str, Any]] = None
    soffit_fascia_spec: Optional[Dict[str, Any]] = None
    weather_barrier_spec: Optional[Dict[str, Any]] = None
    demo_spec: Optional[Dict[str, Any]] = None
    repair_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None

    # O&P
    overview_text: Optional[str] = None
    include_overhead_profit: Optional[bool] = True
    overhead_pct: Optional[float] = 10.0
    profit_pct: Optional[float] = 10.0
    target_total: Optional[float] = None

    notes: Optional[str] = None


class SidingEstimateCreate(SidingEstimateBase):
    pass


class SidingEstimateUpdate(SidingEstimateBase):
    pass


class SidingEstimateResponse(SidingEstimateBase):
    id: UUID
    status: str = "draft"
    created_by_id: Optional[UUID] = None

    # Totals
    subtotal: Optional[float] = 0
    overhead_amount: Optional[float] = 0
    profit_amount: Optional[float] = 0
    tax_amount: Optional[float] = 0
    total: Optional[float] = 0
    adjustment_factor: Optional[float] = None
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None

    # Line items
    line_items: List[SidingEstimateLineItemResponse] = []

    # Enriched
    claim_number: Optional[str] = None
    client_name: Optional[str] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SidingEstimateListResponse(BaseModel):
    items: List[SidingEstimateResponse]
    total: int
    page: int
    page_size: int


# Phase labels
SIDING_PHASE_LABELS = {
    1: "Demo & Disposal",
    2: "Sheathing & Structural Repair",
    3: "Weather Barrier & Insulation",
    4: "Siding Installation",
    5: "Trim, Soffit & Fascia",
    6: "Caulking, Paint & Cleanup",
}
