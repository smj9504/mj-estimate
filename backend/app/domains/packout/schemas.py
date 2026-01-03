"""
Pydantic schemas for packout domain API requests and responses.
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict


class XactimateCategory(str, Enum):
    """Xactimate code categories"""
    CON = "CON"
    CPS = "CPS"
    TMC = "TMC"


class ItemSize(str, Enum):
    """Item size categories"""
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    OVERSIZED = "oversized"


class FragilityLevel(str, Enum):
    """Fragility levels"""
    FRAGILE = "fragile"
    NORMAL = "normal"
    DURABLE = "durable"


class DetectedItem(BaseModel):
    """Item detected in photo analysis"""
    name: str
    category: str
    subcategory: Optional[str] = None
    quantity: int = 1
    size: ItemSize = ItemSize.MEDIUM
    fragility: FragilityLevel = FragilityLevel.NORMAL
    room_location: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0, default=0.8)
    requires_special_handling: bool = False
    notes: Optional[str] = None
    photo_references: List[str] = []  # List of photo IDs where item was detected


class XactimateLineItem(BaseModel):
    """Xactimate line item for estimate"""
    code: str
    category: XactimateCategory
    description: str
    quantity: float
    unit: str
    unit_price: Optional[float] = None  # Internal use only
    total_price: Optional[float] = None  # Internal use only
    notes: Optional[str] = None


class MaterialRequirement(BaseModel):
    """Material requirement calculation"""
    material_type: str  # "Boxes", "Bubble Wrap", "Packing Paper", "Tape"
    xactimate_codes: List[XactimateLineItem]
    total_quantity_needed: float
    unit_of_measure: str
    calculation_notes: str


class LaborRequirement(BaseModel):
    """Labor requirement calculation"""
    labor_type: str  # "Packing", "Inventory", "Moving", "Supervision"
    xactimate_code: str
    description: str
    hours_required: float
    hourly_rate: Optional[float] = None  # Internal use only
    total_cost: Optional[float] = None  # Internal use only
    workers_needed: int = 1
    notes: Optional[str] = None


class PackoutAnalysisRequest(BaseModel):
    """Request for packout analysis"""
    photo_analysis_id: Optional[int] = None
    photo_urls: Optional[List[str]] = None
    room_name: Optional[str] = None
    room_type: Optional[str] = None  # Kitchen, Bedroom, Office, etc.
    job_id: Optional[str] = None
    existing_inventory: Optional[List[DetectedItem]] = None
    include_pricing: bool = False  # Whether to include pricing in response
    use_template: Optional[str] = None  # Template name to use as base
    custom_items: Optional[List[DetectedItem]] = None  # Manually added items


class PackoutItemSummary(BaseModel):
    """Summary of a packout item"""
    item_name: str
    quantity: int
    category: str
    subcategory: Optional[str] = None
    size: ItemSize
    fragility: FragilityLevel
    box_type_needed: str
    packing_materials: Dict[str, float]  # Material type -> quantity
    packing_time_minutes: float
    special_handling_notes: Optional[str] = None


class PackoutAnalysisResponse(BaseModel):
    """Response for packout analysis"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: Optional[str] = None
    room_name: Optional[str] = None
    analysis_timestamp: datetime

    # Item inventory
    items_detected: List[PackoutItemSummary]
    total_items: int
    unique_items: int
    duplicates_removed: int

    # Material requirements
    materials: List[MaterialRequirement]
    material_summary: Dict[str, Any] = Field(default_factory=dict)

    # Labor requirements
    labor: List[LaborRequirement]
    labor_summary: Dict[str, float] = Field(default_factory=dict)

    # Xactimate estimate
    xactimate_line_items: List[XactimateLineItem]

    # Cost summary (if pricing included)
    estimated_material_cost: Optional[float] = None
    estimated_labor_cost: Optional[float] = None
    estimated_total_cost: Optional[float] = None

    # Metadata
    confidence_score: float = Field(ge=0.0, le=1.0)
    processing_time_seconds: Optional[float] = None
    analysis_version: str = "1.0"


class XactimateCodeCreate(BaseModel):
    """Create a new Xactimate code"""
    code: str
    category: XactimateCategory
    description: str
    unit: str
    unit_price: Optional[float] = 0.0
    subcategory: Optional[str] = None
    size_range: Optional[str] = None
    material_type: Optional[str] = None


class XactimateCodeResponse(BaseModel):
    """Xactimate code response"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    category: XactimateCategory
    description: str
    unit: str
    unit_price: float
    subcategory: Optional[str] = None
    size_range: Optional[str] = None
    material_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PackingRuleCreate(BaseModel):
    """Create a packing rule"""
    item_category: str
    item_subcategory: Optional[str] = None
    fragility_level: FragilityLevel
    size: ItemSize
    box_type_code_id: int
    bubble_wrap_required: bool = False
    bubble_wrap_layers: int = 1
    paper_sheets_required: int = 0
    special_handling: bool = False
    handling_notes: Optional[str] = None
    packing_time_minutes: float = 5.0
    inventory_time_minutes: float = 2.0


class PackingRuleResponse(BaseModel):
    """Packing rule response"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_category: str
    item_subcategory: Optional[str] = None
    fragility_level: FragilityLevel
    size: ItemSize
    box_type_code_id: int
    bubble_wrap_required: bool
    bubble_wrap_layers: int
    paper_sheets_required: int
    special_handling: bool
    handling_notes: Optional[str] = None
    packing_time_minutes: float
    inventory_time_minutes: float
    created_at: datetime


class ItemMappingCreate(BaseModel):
    """Create item to Xactimate mapping"""
    item_name: str
    item_category: str
    item_subcategory: Optional[str] = None
    primary_code_id: int
    additional_codes: Optional[List[int]] = []
    default_fragility: FragilityLevel = FragilityLevel.NORMAL
    default_size: ItemSize = ItemSize.MEDIUM
    items_per_box: int = 1
    requires_disassembly: bool = False


class ItemMappingResponse(BaseModel):
    """Item mapping response"""
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_name: str
    item_category: str
    item_subcategory: Optional[str] = None
    primary_code_id: int
    additional_codes: List[int]
    default_fragility: FragilityLevel
    default_size: ItemSize
    items_per_box: int
    requires_disassembly: bool
    created_at: datetime


class XactimateImportRequest(BaseModel):
    """Request to import Xactimate data"""
    file_path: Optional[str] = None
    category: XactimateCategory
    overwrite_existing: bool = False


class XactimateImportResponse(BaseModel):
    """Response from Xactimate import"""
    codes_imported: int
    codes_updated: int
    codes_skipped: int
    errors: List[str] = []
    success: bool


class PackoutSearchRequest(BaseModel):
    """Search for packout analyses"""
    job_id: Optional[str] = None
    company_id: Optional[int] = None
    room_name: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    limit: int = Field(default=20, le=100)
    offset: int = Field(default=0, ge=0)