"""
Roofing Estimate Pydantic schemas
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Estimate schemas ──

class RoofingEstimateBase(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None

    # Project meta
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None
    stories: int = 1
    hoa: bool = False
    roof_access: Optional[str] = Field(None, max_length=50)

    # Roof measurement
    measurement_source: Optional[str] = Field(None, max_length=50)
    total_sf: float = 0
    squares: float = 0
    predominant_pitch: Optional[str] = Field(None, max_length=10)
    pitch_multiplier: float = 1.0
    ridge_lf: float = 0
    hip_lf: float = 0
    valley_lf: float = 0
    eave_lf: float = 0
    rake_lf: float = 0
    step_flashing_lf: float = 0
    penetration_count: int = 0
    skylight_count: int = 0
    chimney_count: int = 0
    waste_factor: float = 0.12
    roof_complexity: Optional[str] = Field(None, max_length=50)

    # EagleView
    eagleview_data: Optional[Dict[str, Any]] = None
    selected_faces: Optional[List[str]] = None
    manual_structures: Optional[List[Dict[str, Any]]] = None

    # Scope
    full_tearoff: bool = True
    layer_count: int = 1
    overlay: bool = False
    existing_material: Optional[str] = None
    insurance_job: bool = False

    # Component specs (JSONB)
    shingle_spec: Optional[Dict[str, Any]] = None
    decking_spec: Optional[Dict[str, Any]] = None
    underlayment_spec: Optional[Dict[str, Any]] = None
    ice_water_spec: Optional[Dict[str, Any]] = None
    drip_edge_spec: Optional[Dict[str, Any]] = None
    ventilation_spec: Optional[Dict[str, Any]] = None
    flashing_spec: Optional[Dict[str, Any]] = None
    ridge_cap_spec: Optional[Dict[str, Any]] = None
    gutter_spec: Optional[Dict[str, Any]] = None
    roof_penetrations: Optional[List[Dict[str, Any]]] = None
    skylight_replacements: Optional[List[Dict[str, Any]]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    insurance_info: Optional[Dict[str, Any]] = None

    # Warranty
    warranty_info: Optional[Dict[str, Any]] = None

    # Target total (reverse pricing)
    target_total: Optional[float] = None

    # Pricing config
    pricing_method: str = "hybrid"
    material_markup_pct: float = 0.25
    labor_markup_pct: float = 0.20
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10
    contingency_pct: float = 0.05
    # None -> per-category material ratios; a value overrides them all.
    material_portion_pct: Optional[float] = Field(None, ge=0, le=1)
    # Crew labor + debris disposal, for the internal profit panel.
    job_cost_inputs: Optional[Dict[str, Any]] = None

    # Documentation
    overview_text: Optional[str] = None
    notes: Optional[str] = None


class RoofingEstimateCreate(RoofingEstimateBase):
    pass


class RoofingEstimateUpdate(BaseModel):
    claim_id: Optional[str] = None
    company_id: Optional[str] = None
    property_address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=5)
    zip_code: Optional[str] = Field(None, max_length=10)
    building_type: Optional[str] = Field(None, max_length=50)
    year_built: Optional[int] = None
    stories: Optional[int] = None
    hoa: Optional[bool] = None
    roof_access: Optional[str] = Field(None, max_length=50)

    measurement_source: Optional[str] = Field(None, max_length=50)
    total_sf: Optional[float] = None
    squares: Optional[float] = None
    predominant_pitch: Optional[str] = Field(None, max_length=10)
    pitch_multiplier: Optional[float] = None
    ridge_lf: Optional[float] = None
    hip_lf: Optional[float] = None
    valley_lf: Optional[float] = None
    eave_lf: Optional[float] = None
    rake_lf: Optional[float] = None
    step_flashing_lf: Optional[float] = None
    penetration_count: Optional[int] = None
    skylight_count: Optional[int] = None
    chimney_count: Optional[int] = None
    waste_factor: Optional[float] = None
    roof_complexity: Optional[str] = Field(None, max_length=50)

    eagleview_data: Optional[Dict[str, Any]] = None
    selected_faces: Optional[List[str]] = None
    manual_structures: Optional[List[Dict[str, Any]]] = None

    full_tearoff: Optional[bool] = None
    layer_count: Optional[int] = None
    overlay: Optional[bool] = None
    existing_material: Optional[str] = None
    insurance_job: Optional[bool] = None

    shingle_spec: Optional[Dict[str, Any]] = None
    decking_spec: Optional[Dict[str, Any]] = None
    underlayment_spec: Optional[Dict[str, Any]] = None
    ice_water_spec: Optional[Dict[str, Any]] = None
    drip_edge_spec: Optional[Dict[str, Any]] = None
    ventilation_spec: Optional[Dict[str, Any]] = None
    flashing_spec: Optional[Dict[str, Any]] = None
    ridge_cap_spec: Optional[Dict[str, Any]] = None
    gutter_spec: Optional[Dict[str, Any]] = None
    roof_penetrations: Optional[List[Dict[str, Any]]] = None
    skylight_replacements: Optional[List[Dict[str, Any]]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    insurance_info: Optional[Dict[str, Any]] = None

    warranty_info: Optional[Dict[str, Any]] = None

    target_total: Optional[float] = None

    pricing_method: Optional[str] = None
    material_markup_pct: Optional[float] = None
    labor_markup_pct: Optional[float] = None
    include_overhead_profit: Optional[bool] = None
    overhead_pct: Optional[float] = None
    profit_pct: Optional[float] = None
    contingency_pct: Optional[float] = None
    material_portion_pct: Optional[float] = Field(None, ge=0, le=1)
    # Crew labor + debris disposal, for the internal profit panel.
    job_cost_inputs: Optional[Dict[str, Any]] = None

    overview_text: Optional[str] = None
    notes: Optional[str] = None


# ── Line item schemas ──

class LineItemResponse(BaseModel):
    id: str
    estimate_id: str
    structure_index: int = 0
    phase: int
    description: str
    quantity: float
    unit: str
    unit_price: float
    total: float
    # Material/labor split of `total`, driving markup and sales tax.
    material_portion: Optional[float] = None
    material_cost: Optional[float] = None
    labor_cost: Optional[float] = None
    category: Optional[str] = None
    xactimate_code: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Response schemas ──

class RoofingEstimateResponse(BaseModel):
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
    stories: int = 1
    hoa: bool = False
    roof_access: Optional[str] = None

    # Measurement
    measurement_source: Optional[str] = None
    total_sf: float = 0
    squares: float = 0
    predominant_pitch: Optional[str] = None
    pitch_multiplier: float = 1.0
    ridge_lf: float = 0
    hip_lf: float = 0
    valley_lf: float = 0
    eave_lf: float = 0
    rake_lf: float = 0
    step_flashing_lf: float = 0
    penetration_count: int = 0
    skylight_count: int = 0
    chimney_count: int = 0
    waste_factor: float = 0.12
    roof_complexity: Optional[str] = None

    # EagleView
    eagleview_data: Optional[Dict[str, Any]] = None
    selected_faces: Optional[List[str]] = None
    manual_structures: Optional[List[Dict[str, Any]]] = None

    # Scope
    full_tearoff: bool = True
    layer_count: int = 1
    overlay: bool = False
    existing_material: Optional[str] = None
    insurance_job: bool = False

    # Component specs
    shingle_spec: Optional[Dict[str, Any]] = None
    decking_spec: Optional[Dict[str, Any]] = None
    underlayment_spec: Optional[Dict[str, Any]] = None
    ice_water_spec: Optional[Dict[str, Any]] = None
    drip_edge_spec: Optional[Dict[str, Any]] = None
    ventilation_spec: Optional[Dict[str, Any]] = None
    flashing_spec: Optional[Dict[str, Any]] = None
    ridge_cap_spec: Optional[Dict[str, Any]] = None
    gutter_spec: Optional[Dict[str, Any]] = None
    roof_penetrations: Optional[List[Dict[str, Any]]] = None
    skylight_replacements: Optional[List[Dict[str, Any]]] = None
    hidden_costs: Optional[Dict[str, Any]] = None
    insurance_info: Optional[Dict[str, Any]] = None

    # Warranty
    warranty_info: Optional[Dict[str, Any]] = None

    # Pricing
    pricing_method: str = "hybrid"
    material_markup_pct: float = 0.25
    labor_markup_pct: float = 0.20
    include_overhead_profit: bool = False
    overhead_pct: float = 0.10
    profit_pct: float = 0.10
    contingency_pct: float = 0.05
    material_portion_pct: Optional[float] = None
    # Crew labor + debris disposal, for the internal profit panel.
    job_cost_inputs: Optional[Dict[str, Any]] = None
    # Computed, not user-supplied: how the billed area was stepped up to
    # whole bundles. Drives the explanatory note on the quote.
    square_rounding: Optional[Dict[str, Any]] = None

    # Target total
    target_total: Optional[float] = None
    adjustment_factor: Optional[float] = None

    # Totals
    roofing_subtotal: float = 0
    gutter_subtotal: float = 0
    subtotal: float = 0
    material_cost_total: float = 0
    labor_cost_total: float = 0
    markup_amount: float = 0
    overhead_amount: float = 0
    profit_amount: float = 0
    contingency_amount: float = 0
    tax_amount: float = 0
    permit_fee: float = 0
    total: float = 0

    # Add-on quotes
    add_ons: Optional[List[Dict[str, Any]]] = None

    # Per-structure results
    structure_results: Optional[List[Dict[str, Any]]] = None

    # Documentation
    overview_text: Optional[str] = None
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


class RoofingEstimateListResponse(BaseModel):
    items: List[RoofingEstimateResponse]
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


# ── EagleView parsing schemas ──

class EagleViewFace(BaseModel):
    id: str
    designator: str
    area: float
    pitch: str
    is_accessory: bool = False
    structure_index: int = 0


class EagleViewLineSegment(BaseModel):
    id: str
    type: str
    length: float
    structure_index: int = 0


class EagleViewStructure(BaseModel):
    index: int
    label: str
    total_sf: float
    facet_count: int
    predominant_pitch: str
    complexity: str


class EagleViewParseResult(BaseModel):
    faces: List[EagleViewFace]
    all_faces: List[EagleViewFace]
    lines: List[EagleViewLineSegment]
    structures: List[EagleViewStructure]
    total_sf: float
    squares: float
    ridge_lf: float
    hip_lf: float
    valley_lf: float
    eave_lf: float
    rake_lf: float
    step_flashing_lf: float
    penetration_count: int = 0
    predominant_pitch: Optional[str] = None


# ── Pricing info (for frontend dropdowns) ──

class PricingInfoResponse(BaseModel):
    building_types: List[str]
    roof_complexities: List[str]
    existing_materials: List[str]
    shingle_types: List[str]
    shingle_brands: List[str]
    decking_materials: List[str]
    underlayment_types: List[str]
    pipe_boot_types: List[str]
    gutter_materials: List[str]
    gutter_styles: List[str]
    gutter_sizes: List[int]
    gutter_types: List[str]
    gutter_scopes: List[str]
    downspout_sizes: List[str]
    gutter_guard_types: List[str]
    shingle_rates: Dict[str, float]
    decking_rates: Dict[str, float]
    pitch_multipliers: Dict[str, float]
    waste_factors: Dict[str, float]
    # Building permit allowance by state
    permit_fees: Dict[str, float]


# ── Internal material cost (never exported to the customer) ──

class MaterialCostOverride(BaseModel):
    """Per-estimate correction to a material's default supplier cost."""
    unit_cost: Optional[float] = Field(None, ge=0)
    taxable: bool = True
    note: Optional[str] = None


class MaterialCostUpdate(BaseModel):
    overrides: Optional[Dict[str, MaterialCostOverride]] = None
    tax_rate: Optional[float] = Field(None, ge=0, le=1)


class MaterialCostItem(BaseModel):
    key: str
    price_key: Optional[str] = None
    category: str
    category_label: str
    description: str
    quantity: float
    unit: str
    unit_cost: float
    default_unit_cost: float
    is_overridden: bool
    taxable: bool
    subtotal: float
    note: str = ""


class MaterialCostCategory(BaseModel):
    category: str
    label: str
    items: List[MaterialCostItem]
    subtotal: float
    tax_amount: float
    total_with_tax: float
    pct_of_material: float


class MaterialPriceEntry(BaseModel):
    id: Optional[str] = None
    material_key: str
    label: str
    category: str
    unit: str
    unit_cost: float
    is_taxable: bool = True
    is_active: bool = True
    notes: str = ""
    company_id: Optional[str] = None

    # What the material actually is. Null on rows that predate this and
    # only name a grade.
    manufacturer: Optional[str] = None
    product_name: Optional[str] = None
    color: Optional[str] = None
    size_spec: Optional[str] = None
    supplier: Optional[str] = None
    sku: Optional[str] = None
    qty_formula: Optional[str] = None
    qty_basis: Optional[str] = None
    coverage_per_unit: Optional[float] = None
    coverage_unit: Optional[str] = None
    qty_minimum: Optional[float] = None
    is_custom: bool = False


class MaterialPriceCreate(BaseModel):
    """A material the seed catalog does not have."""
    label: str = Field(..., min_length=1, max_length=255)
    category: str = Field(..., min_length=1, max_length=50)
    unit: str = Field(..., min_length=1, max_length=10)
    unit_cost: float = Field(0, ge=0)
    is_taxable: bool = True
    notes: Optional[str] = Field(None, max_length=500)

    manufacturer: Optional[str] = Field(None, max_length=100)
    product_name: Optional[str] = Field(None, max_length=200)
    color: Optional[str] = Field(None, max_length=100)
    size_spec: Optional[str] = Field(None, max_length=100)
    supplier: Optional[str] = Field(None, max_length=150)
    sku: Optional[str] = Field(None, max_length=100)
    qty_formula: Optional[str] = Field(None, max_length=500)
    qty_basis: Optional[str] = Field(None, max_length=40)
    coverage_per_unit: Optional[float] = Field(None, gt=0)
    coverage_unit: Optional[str] = Field(None, max_length=10)
    qty_minimum: Optional[float] = Field(None, ge=0)
    # Optional: derived from the label when omitted.
    material_key: Optional[str] = Field(None, max_length=100)


class MaterialCostResponse(BaseModel):
    items: List[MaterialCostItem]
    categories: List[MaterialCostCategory]
    tax_rate: float
    subtotal_before_tax: float
    taxable_subtotal: float
    tax_amount: float
    total_with_tax: float
    estimate_total: Optional[float] = None
    # Both None: material alone is not profit. See job_cost.
    gross_profit: Optional[float] = None
    margin_pct: Optional[float] = None
    # Share of the sale price that materials consume.
    material_pct_of_sale: Optional[float] = None
    # Labor + disposal + material, and the profit actually left over.
    # `complete` False means labor was not entered, and the screen must
    # say so rather than show a margin computed without it.
    job_cost: Optional[Dict[str, Any]] = None
    # Editable defaults, so the screen can offer "save as default".
    price_book: List[MaterialPriceEntry] = []
    snapshot_taken: bool = False


# ── Default material price book ──

class MaterialPricePatch(BaseModel):
    unit_cost: Optional[float] = Field(None, ge=0)
    is_taxable: Optional[bool] = None
    notes: Optional[str] = None

    label: Optional[str] = Field(None, max_length=255)
    category: Optional[str] = Field(None, max_length=50)
    unit: Optional[str] = Field(None, max_length=10)
    manufacturer: Optional[str] = Field(None, max_length=100)
    product_name: Optional[str] = Field(None, max_length=200)
    color: Optional[str] = Field(None, max_length=100)
    size_spec: Optional[str] = Field(None, max_length=100)
    supplier: Optional[str] = Field(None, max_length=150)
    sku: Optional[str] = Field(None, max_length=100)
    qty_formula: Optional[str] = Field(None, max_length=500)
    qty_basis: Optional[str] = Field(None, max_length=40)
    coverage_per_unit: Optional[float] = Field(None, gt=0)
    coverage_unit: Optional[str] = Field(None, max_length=10)
    qty_minimum: Optional[float] = Field(None, ge=0)
    # Retire a material without deleting it: estimates priced with it
    # keep resolving, it just leaves the pick lists.
    is_active: Optional[bool] = None


class MaterialPriceUpdate(BaseModel):
    """Default cost changes, keyed by material_key."""
    prices: Dict[str, MaterialPricePatch]


# ── Pricing Settings (calculation rates, NOT material costs) ──

class PricingSettingEntry(BaseModel):
    """One editable calculation rate, with the default behind it."""
    setting_group: str
    setting_key: str
    group_label: str
    label: str
    kind: str                 # money | rate | pct
    unit: Optional[str] = None
    help: Optional[str] = None
    value: float
    default_value: Optional[float] = None
    is_overridden: bool = False
    notes: Optional[str] = None
    id: Optional[str] = None
    company_id: Optional[str] = None

    # What the main material behind this rate costs, restated in the
    # rate's own unit so the two are directly comparable. Absent on
    # rates with no single dominant material (tear-off, permits, misc).
    material_cost: Optional[float] = None
    material_label: Optional[str] = None
    material_unit_cost: Optional[float] = None
    material_purchase_unit: Optional[str] = None
    material_key: Optional[str] = None
    material_per_rate_unit: Optional[float] = None


class PricingSettingPatch(BaseModel):
    """An edit to one setting.

    `value` None resets the setting to its pricing.py default by
    deleting the stored row, which is how the screen's reset works.
    """
    setting_group: str = Field(..., min_length=1, max_length=50)
    setting_key: str = Field(..., min_length=1, max_length=100)
    value: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=500)


class PricingSettingsResponse(BaseModel):
    settings: List[PricingSettingEntry]
    groups: List[dict]
    overridden_count: int


class PricingSettingsUpdate(BaseModel):
    settings: List[PricingSettingPatch]
