"""
Pack Calculation domain schemas
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from uuid import UUID


# Enums as strings for API
class FloorLevelEnum(str):
    BASEMENT = "BASEMENT"
    MAIN_LEVEL = "MAIN_LEVEL"
    SECOND_FLOOR = "SECOND_FLOOR"
    THIRD_FLOOR = "THIRD_FLOOR"
    FOURTH_FLOOR = "FOURTH_FLOOR"
    FIFTH_FLOOR_PLUS = "FIFTH_FLOOR_PLUS"


class BuildingTypeEnum(str):
    HOUSE = "HOUSE"
    APARTMENT = "APARTMENT"
    TOWNHOUSE = "TOWNHOUSE"
    CONDO = "CONDO"
    COMMERCIAL = "COMMERCIAL"


class InputMethodEnum(str):
    STRUCTURED = "STRUCTURED"
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    AI_INFERRED = "AI_INFERRED"


# Input schemas
class PackItemInput(BaseModel):
    """Input for a single pack item"""
    item_name: str
    item_category: Optional[str] = None
    quantity: int = 1
    size_category: Optional[str] = None
    floor_level: str
    fragile: bool = False
    requires_disassembly: bool = False
    special_notes: Optional[str] = None


class PackRoomInput(BaseModel):
    """Input for a single room"""
    room_name: str
    floor_level: str
    input_method: str = "structured"
    raw_input: Optional[str] = None  # For text or image description
    image_url: Optional[str] = None
    items: List[PackItemInput] = []


class BuildingInfo(BaseModel):
    """Building information"""
    building_type: str
    total_floors: int
    has_elevator: bool = False
    access_type: Optional[str] = None  # direct, shared_hallway, exterior_stairs
    crew_size: Optional[int] = None  # Number of workers (None = auto-calculate based on job size)


class StrategyOverrides(BaseModel):
    """Optional strategy overrides for advanced users"""
    material: Optional[str] = None  # rule_based, ai_enhanced, hybrid
    labor: Optional[str] = None  # room_based, item_based, time_based
    protection: Optional[str] = None  # estimated, measured, ai_inferred
    debris: Optional[str] = None  # material_based, weight_based


class PackCalculationRequest(BaseModel):
    """Request for pack calculation"""
    calculation_name: Optional[str] = None
    project_address: Optional[str] = None
    notes: Optional[str] = None
    rooms: List[PackRoomInput]
    building_info: BuildingInfo
    strategy_overrides: StrategyOverrides = StrategyOverrides()
    auto_detect_strategies: bool = True


# Response schemas
class XactimateLineItem(BaseModel):
    """Xactimate line item with quantity"""
    code: str
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: float
    category: Optional[str] = None
    ml_used: bool = False
    confidence: Optional[float] = None


class DebrisBreakdown(BaseModel):
    """Debris calculation breakdown"""
    cardboard_recyclable_lb: float
    cardboard_recyclable_ton: float
    plastic_waste_lb: float
    paper_waste_lb: float
    total_debris_lb: float
    total_debris_ton: float


class FuzzyMatch(BaseModel):
    """Details of a fuzzy match"""
    original_name: str
    matched_key: str
    matched_materials: Dict[str, float]
    quantity: int


class StrategiesUsed(BaseModel):
    """Strategies used in calculation"""
    material_estimation: str
    labor_calculation: str
    protection_estimate: str
    debris_calculation: str
    fuzzy_matching_used: bool = False
    fuzzy_matches: List[FuzzyMatch] = []


class RoomBreakdown(BaseModel):
    """Room-level calculation breakdown"""
    room_id: UUID
    room_name: str
    floor_level: str

    # Room-specific line items with descriptions
    materials: List[XactimateLineItem]
    pack_out_labor: List[XactimateLineItem] = []
    pack_out_labor_hours: float
    pack_in_labor_hours: float

    # Item count
    item_count: int

    # Explanations (optional, short natural language)
    explanation_pack_out: Optional[str] = None
    explanation_protection: Optional[str] = None
    explanation_pack_in: Optional[str] = None


class PackCalculationResult(BaseModel):
    """Result of pack calculation"""
    id: UUID
    calculation_name: Optional[str]

    # Xactimate line items (project totals)
    pack_out_materials: List[XactimateLineItem]
    pack_out_labor: List[XactimateLineItem]
    protection: List[XactimateLineItem]
    pack_in_labor: List[XactimateLineItem]

    # Room-by-room breakdown
    rooms: List[RoomBreakdown]

    # Debris
    debris: DebrisBreakdown

    # Summary
    total_pack_out_hours: float
    total_pack_in_hours: float
    total_protection_sf: float
    crew_size: int = 1  # Number of workers

    # Explanations (optional, at calculation level)
    explanation_protection: Optional[str] = None

    # ML metadata
    ml_confidence: float
    needs_review: bool
    strategies_used: StrategiesUsed
    auto_selected: bool

    # Timestamps
    created_at: datetime
    created_by_id: UUID


class PackItemResponse(BaseModel):
    """Response for a single item"""
    id: UUID
    item_name: str
    item_category: Optional[str]
    quantity: int
    floor_level: str
    detected_by: str
    confidence_score: Optional[float]
    xactimate_materials: Dict[str, float]
    fragile: bool = False
    requires_disassembly: bool = False
    special_notes: Optional[str] = None


class PackRoomResponse(BaseModel):
    """Response for a single room"""
    id: UUID
    room_name: str
    floor_level: str
    input_method: str
    ai_confidence: Optional[float]
    items: List[PackItemResponse]
    xactimate_materials: Dict[str, float]
    xactimate_labor: Dict[str, float]
    packing_hours: float
    moving_hours: float


class PackCalculationDetailResponse(PackCalculationResult):
    """Detailed calculation response with room breakdown and original input"""
    # Inherits rooms: List[RoomBreakdown] from PackCalculationResult
    # Additional fields for editing
    building_info: Optional[BuildingInfo] = None
    project_address: Optional[str] = None
    notes: Optional[str] = None
    # Detail rooms with items for editing form
    detail_rooms: Optional[List[PackRoomResponse]] = None


# Correction schemas
class CorrectionInput(BaseModel):
    """Input for correcting a calculation"""
    corrected_materials: Dict[str, float]  # {code: corrected_quantity}
    corrected_labor: Dict[str, float]
    correction_notes: str


class MLMetricsResponse(BaseModel):
    """ML model metrics response"""
    model_config = {"protected_namespaces": ()}

    boxes_mae: float
    labor_mae: float
    avg_confidence: float
    correction_rate: float
    total_calculations: int
    total_corrections: int
    last_training_date: Optional[datetime]
    model_version: Optional[str]


# Item mapping schemas
class ItemMaterialMappingInput(BaseModel):
    """Input for creating/updating item material mapping"""
    item_name: str
    item_category: str
    size_category: Optional[str] = None
    xactimate_materials: Dict[str, float]  # {code: quantity_per_item}
    estimated_weight_lb: Optional[float] = None
    fragile: bool = False
    requires_disassembly: bool = False
    packing_hours_base: Optional[float] = None
    moving_hours_base: Optional[float] = None


class ItemMaterialMappingResponse(BaseModel):
    """Response for item material mapping"""
    id: UUID
    item_name: str
    item_category: str
    size_category: Optional[str]
    xactimate_materials: Dict[str, float]
    estimated_weight_lb: Optional[float]
    fragile: bool
    requires_disassembly: bool
    packing_hours_base: Optional[float]
    moving_hours_base: Optional[float]
    active: bool
    usage_count: int
    last_used_at: Optional[datetime]
    created_at: datetime
