"""
Bathroom Remodel Estimate Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Estimate schemas ──

class BathroomEstimateBase(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None

    # Project meta
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None

    # Bathroom info
    designation: Optional[str] = Field(None, max_length=50)
    bath_function: Optional[str] = Field(None, max_length=50)
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = 8.0
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None

    # Demo flags
    demo_floor: bool = False
    demo_floor_sf: Optional[float] = None
    demo_walls: bool = False
    demo_wall_sf: Optional[float] = None
    demo_ceiling: bool = False
    demo_ceiling_sf: Optional[float] = None
    replace_shower: bool = False
    replace_tub: bool = False
    replace_vanity: bool = False
    replace_toilet: bool = False
    replace_floor: bool = False
    detach_reset_shower: bool = False
    detach_reset_tub: bool = False
    detach_reset_vanity: bool = False
    detach_reset_toilet: bool = False
    water_damage: bool = False
    mold_suspected: bool = False
    existing_tub_material: Optional[str] = None
    demo_cement_board: bool = False
    demo_cement_board_sf: Optional[float] = None
    replace_cement_board: bool = False
    replace_cement_board_sf: Optional[float] = None

    # Component specs (JSONB)
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None

    # Sketch data
    sketch_data: Optional[Dict[str, Any]] = None

    # Overview & O&P
    overview_text: Optional[str] = None
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10
    notes: Optional[str] = None

    # Target total (reverse pricing)
    target_total: Optional[float] = None


class BathroomEstimateCreate(BathroomEstimateBase):
    pass


class BathroomEstimateUpdate(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None
    designation: Optional[str] = Field(None, max_length=50)
    bath_function: Optional[str] = Field(None, max_length=50)
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = None
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None
    demo_floor: Optional[bool] = None
    demo_floor_sf: Optional[float] = None
    demo_walls: Optional[bool] = None
    demo_wall_sf: Optional[float] = None
    demo_ceiling: Optional[bool] = None
    demo_ceiling_sf: Optional[float] = None
    replace_shower: Optional[bool] = None
    replace_tub: Optional[bool] = None
    replace_vanity: Optional[bool] = None
    replace_toilet: Optional[bool] = None
    replace_floor: Optional[bool] = None
    detach_reset_shower: Optional[bool] = None
    detach_reset_tub: Optional[bool] = None
    detach_reset_vanity: Optional[bool] = None
    detach_reset_toilet: Optional[bool] = None
    water_damage: Optional[bool] = None
    mold_suspected: Optional[bool] = None
    existing_tub_material: Optional[str] = None
    demo_cement_board: Optional[bool] = None
    demo_cement_board_sf: Optional[float] = None
    replace_cement_board: Optional[bool] = None
    replace_cement_board_sf: Optional[float] = None
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    sketch_data: Optional[Dict[str, Any]] = None
    overview_text: Optional[str] = None
    include_overhead_profit: Optional[bool] = None
    overhead_pct: Optional[float] = None
    profit_pct: Optional[float] = None
    notes: Optional[str] = None
    target_total: Optional[float] = None


# ── Line item schemas ──

class LineItemResponse(BaseModel):
    id: str
    estimate_id: str
    phase: int
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


# ── Response schemas ──

class BathroomEstimateResponse(BaseModel):
    id: str
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    created_by_id: Optional[str] = None
    status: str

    # Project meta
    property_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    building_type: Optional[str] = None
    year_built: Optional[int] = None

    # Bathroom info
    designation: Optional[str] = None
    bath_function: Optional[str] = None
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = 8.0
    floor_sf: Optional[float] = None
    wall_sf: Optional[float] = None

    # Demo flags
    demo_floor: bool = False
    demo_floor_sf: Optional[float] = None
    demo_walls: bool = False
    demo_wall_sf: Optional[float] = None
    demo_ceiling: bool = False
    demo_ceiling_sf: Optional[float] = None
    replace_shower: bool = False
    replace_tub: bool = False
    replace_vanity: bool = False
    replace_toilet: bool = False
    replace_floor: bool = False
    detach_reset_shower: bool = False
    detach_reset_tub: bool = False
    detach_reset_vanity: bool = False
    detach_reset_toilet: bool = False
    water_damage: bool = False
    mold_suspected: bool = False
    existing_tub_material: Optional[str] = None
    demo_cement_board: bool = False
    demo_cement_board_sf: Optional[float] = None
    replace_cement_board: bool = False
    replace_cement_board_sf: Optional[float] = None

    # Component specs
    shower_spec: Optional[Dict[str, Any]] = None
    bathtub_spec: Optional[Dict[str, Any]] = None
    vanity_spec: Optional[Dict[str, Any]] = None
    toilet_spec: Optional[Dict[str, Any]] = None
    floor_spec: Optional[Dict[str, Any]] = None
    walls_spec: Optional[Dict[str, Any]] = None
    accessories_spec: Optional[Dict[str, Any]] = None
    plumbing_spec: Optional[Dict[str, Any]] = None
    electrical_spec: Optional[Dict[str, Any]] = None
    substrate_spec: Optional[Dict[str, Any]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    sketch_data: Optional[Dict[str, Any]] = None

    # Overview & O&P
    overview_text: Optional[str] = None
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10

    # Target total
    target_total: Optional[float] = None
    adjustment_factor: Optional[float] = None

    # Totals
    subtotal: float = 0
    overhead_amount: float = 0
    profit_amount: float = 0
    tax_amount: float = 0
    total: float = 0

    # Documentation
    methodology_notes: Optional[str] = None
    warning_flags: Optional[List[str]] = None
    notes: Optional[str] = None

    # Relations
    line_items: List[LineItemResponse] = []

    # Enriched from claim
    claim_number: Optional[str] = None
    client_name: Optional[str] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BathroomEstimateListResponse(BaseModel):
    items: List[BathroomEstimateResponse]
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


# ── Pricing info (for frontend dropdowns) ──

class PricingInfoResponse(BaseModel):
    building_types: List[str]
    designations: List[str]
    bath_functions: List[str]
    shower_types: List[str]
    enclosure_types: List[str]
    shower_door_types: List[str]
    showerhead_types: List[str]
    trim_grades: List[str]
    bathtub_types: List[str]
    bathtub_materials: List[str]
    vanity_widths: List[int]
    vanity_sources: List[str]
    vanity_top_materials: List[str]
    vanity_mountings: List[str]
    faucet_types: List[str]
    mirror_types: List[str]
    toilet_types: List[str]
    tile_materials: List[str]
    tile_patterns: List[str]
    tile_sizes: List[str]
    waterproof_types: List[str]
    accessory_finishes: List[str]
    accessory_grades: List[str]
    exhaust_fan_cfms: List[int]
    exhaust_fan_switch_types: List[str]
    paint_grades: List[str]
    baseboard_materials: List[str]
