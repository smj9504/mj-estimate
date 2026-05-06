"""
Material Order schemas.
Supports Roofing and Siding material order lists with PDF export.
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ScopeType(str, Enum):
    roofing = "roofing"
    siding = "siding"


class MaterialCategory(str, Enum):
    main = "main"
    underlayment = "underlayment"
    trim = "trim"
    fastener = "fastener"
    misc = "misc"


class OutputType(str, Enum):
    supply_order = "supply_order"
    internal_estimate = "internal_estimate"


# ── Measurement schemas ──

class RoofingMeasurements(BaseModel):
    total_area_sf: float = 0
    squares: float = 0
    squares_with_waste: float = 0
    eaves_lf: float = 0
    rakes_lf: float = 0
    ridges_lf: float = 0
    hips_lf: float = 0
    valleys_lf: float = 0
    step_flashing_lf: float = 0
    drip_edge_lf: float = 0
    penetration_count: int = 0
    waste_pct: float = 12.0
    structure_complexity: Optional[str] = None


class SidingMeasurements(BaseModel):
    net_siding_sqft: float = 0
    masonry_sqft: float = 0
    wd_perimeter_lf: float = 0
    wd_area_sqft: float = 0
    wd_count: int = 0
    fascia_lf: float = 0
    bottom_wall_lf: float = 0
    top_wall_lf: float = 0
    outside_corner_lf: float = 0
    inside_corner_lf: float = 0
    waste_pct: float = 10.0


# ── Material item ──

class MaterialItem(BaseModel):
    category: MaterialCategory = MaterialCategory.main
    item: str = ""
    qty: float = 0
    unit: str = ""  # BD, RL, PC, BX, EA, TB, CTN
    formula: str = ""
    note: str = ""
    unit_price: Optional[float] = None
    ai_qty: Optional[float] = None  # original AI quantity before user edit


# ── Request / Response ──

class MaterialOrderRequest(BaseModel):
    scope_type: ScopeType
    property_address: str = ""
    report_number: str = ""
    delivery_date: Optional[str] = None
    brand: str = "CertainTeed"
    product: Optional[str] = None
    color: Optional[str] = None
    waste_pct: float = 12.0
    roofing_measurements: Optional[RoofingMeasurements] = None
    siding_measurements: Optional[SidingMeasurements] = None


class MaterialOrderResponse(BaseModel):
    scope_type: ScopeType
    property_address: str = ""
    report_number: str = ""
    delivery_date: Optional[str] = None
    brand: str = ""
    product: Optional[str] = None
    color: Optional[str] = None
    measurements: Dict[str, Any] = {}
    materials: List[MaterialItem] = []
    notes: List[str] = []


class MaterialOrderSaveItem(BaseModel):
    category: str = "misc"
    item: str = ""
    qty: float = 0
    unit: str = "EA"
    formula: Optional[str] = None
    note: Optional[str] = None
    unit_price: Optional[float] = None
    ai_qty: Optional[float] = None


class MaterialOrderSave(BaseModel):
    scope_type: ScopeType
    property_address: str = ""
    report_number: str = ""
    delivery_date: Optional[str] = None
    brand: str = "CertainTeed"
    product: Optional[str] = None
    color: Optional[str] = None
    waste_pct: float = 12.0
    status: str = "draft"
    measurements: Optional[Dict[str, Any]] = None
    notes: Optional[List[str]] = None
    items: List[MaterialOrderSaveItem] = []


class MaterialOrderExportRequest(BaseModel):
    scope_type: ScopeType
    output_type: OutputType
    property_address: str = ""
    report_number: str = ""
    delivery_date: Optional[str] = None
    brand: str = ""
    product: Optional[str] = None
    color: Optional[str] = None
    measurements: Dict[str, Any] = {}
    materials: List[MaterialItem] = []
    notes: List[str] = []
