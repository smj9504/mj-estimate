"""
Sketch domain Pydantic schemas
"""

from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field, validator, ConfigDict
from datetime import datetime
from uuid import UUID
from decimal import Decimal


# ===== MEASUREMENT SCHEMAS =====

class MeasurementBase(BaseModel):
    """Base schema for measurements"""
    name: Optional[str] = None
    measurement_type: str = Field(default="linear", pattern="^(linear|area|angle|radius)$")
    value: float = Field(ge=0)
    unit: str = Field(default="ft", pattern="^(ft|in|m|cm|sq_ft|sq_m|degrees)$")
    precision: int = Field(default=2, ge=0, le=6)

    start_point: Optional[Dict[str, float]] = None
    end_point: Optional[Dict[str, float]] = None
    geometry: Optional[Dict[str, Any]] = None

    label_position: Optional[Dict[str, float]] = None
    label_text: Optional[str] = None
    line_color: str = Field(default="#FF0000", pattern="^#[0-9A-Fa-f]{6}$")
    line_width: int = Field(default=1, ge=1, le=10)
    line_style: str = Field(default="solid", pattern="^(solid|dashed|dotted)$")

    show_arrows: bool = True
    show_label: bool = True
    arrow_style: str = Field(default="arrow", pattern="^(arrow|tick|dot|none)$")

    associated_entity_type: Optional[str] = Field(None, pattern="^(room|wall|fixture)$")
    associated_entity_id: Optional[UUID] = None

    sort_order: int = 0
    is_visible: bool = True
    is_locked: bool = False
    notes: Optional[str] = None

    @validator('start_point', 'end_point', 'label_position', pre=True)
    def validate_point(cls, v):
        if v is not None and not isinstance(v, dict):
            raise ValueError("Point must be a dictionary with 'x' and 'y' keys")
        if v is not None:
            if 'x' not in v or 'y' not in v:
                raise ValueError("Point must have 'x' and 'y' coordinates")
            if not isinstance(v['x'], (int, float)) or not isinstance(v['y'], (int, float)):
                raise ValueError("Point coordinates must be numbers")
        return v


class MeasurementCreate(MeasurementBase):
    """Schema for creating measurements"""
    sketch_id: UUID


class MeasurementUpdate(BaseModel):
    """Schema for updating measurements"""
    name: Optional[str] = None
    measurement_type: Optional[str] = None
    value: Optional[float] = Field(None, ge=0)
    unit: Optional[str] = None
    precision: Optional[int] = Field(None, ge=0, le=6)

    start_point: Optional[Dict[str, float]] = None
    end_point: Optional[Dict[str, float]] = None
    geometry: Optional[Dict[str, Any]] = None

    label_position: Optional[Dict[str, float]] = None
    label_text: Optional[str] = None
    line_color: Optional[str] = None
    line_width: Optional[int] = Field(None, ge=1, le=10)
    line_style: Optional[str] = None

    show_arrows: Optional[bool] = None
    show_label: Optional[bool] = None
    arrow_style: Optional[str] = None

    associated_entity_type: Optional[str] = None
    associated_entity_id: Optional[UUID] = None

    sort_order: Optional[int] = None
    is_visible: Optional[bool] = None
    is_locked: Optional[bool] = None
    notes: Optional[str] = None


class MeasurementResponse(MeasurementBase):
    """Response schema for measurements"""
    id: UUID
    sketch_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== FIXTURE SCHEMAS =====

class FixtureBase(BaseModel):
    """Base schema for fixtures"""
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(min_length=1, max_length=255)
    fixture_type: str = Field(min_length=1, max_length=100)

    width: float = Field(default=0, ge=0)
    height: float = Field(default=0, ge=0)
    depth: float = Field(default=0, ge=0)

    position: Dict[str, float] = Field(...)
    rotation: float = Field(default=0, ge=-360, le=360)
    wall_offset: float = Field(default=0, ge=0)
    height_from_floor: float = Field(default=0, ge=0)

    symbol: Optional[str] = None
    fill_color: str = Field(default="#CCCCCC", pattern="^#[0-9A-Fa-f]{6}$")
    stroke_color: str = Field(default="#666666", pattern="^#[0-9A-Fa-f]{6}$")
    stroke_width: int = Field(default=1, ge=1, le=10)

    model_number: Optional[str] = Field(None, max_length=100)
    manufacturer: Optional[str] = Field(None, max_length=100)
    specifications: Optional[Dict[str, Any]] = None

    # Electrical properties
    voltage: Optional[int] = Field(None, gt=0)
    amperage: Optional[float] = Field(None, gt=0)
    wattage: Optional[int] = Field(None, gt=0)
    circuit_number: Optional[str] = Field(None, max_length=50)

    # Plumbing properties
    water_supply: Optional[str] = Field(None, pattern="^(hot|cold|mixed)$")
    drain_size: Optional[float] = Field(None, gt=0)
    fixture_units: Optional[float] = Field(None, gt=0)

    # Cost properties
    unit_cost: float = Field(default=0, ge=0)
    installation_cost: float = Field(default=0, ge=0)
    total_cost: float = Field(default=0, ge=0)

    status: str = Field(default="planned", pattern="^(planned|installed|removed|replaced)$")
    installation_date: Optional[datetime] = None

    sort_order: int = 0
    is_visible: bool = True
    is_locked: bool = False
    notes: Optional[str] = None

    @validator('position', pre=True)
    def validate_position(cls, v):
        if not isinstance(v, dict):
            raise ValueError("Position must be a dictionary with 'x' and 'y' keys")
        if 'x' not in v or 'y' not in v:
            raise ValueError("Position must have 'x' and 'y' coordinates")
        if not isinstance(v['x'], (int, float)) or not isinstance(v['y'], (int, float)):
            raise ValueError("Position coordinates must be numbers")
        return v

    @validator('total_cost', pre=True, always=True)
    def calculate_total_cost(cls, v, values):
        if v == 0 and 'unit_cost' in values and 'installation_cost' in values:
            return values['unit_cost'] + values['installation_cost']
        return v


class FixtureCreate(FixtureBase):
    """Schema for creating fixtures"""
    room_id: UUID
    wall_id: Optional[UUID] = None


class FixtureUpdate(BaseModel):
    """Schema for updating fixtures"""
    model_config = ConfigDict(protected_namespaces=())

    wall_id: Optional[UUID] = None
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    fixture_type: Optional[str] = Field(None, min_length=1, max_length=100)

    width: Optional[float] = Field(None, ge=0)
    height: Optional[float] = Field(None, ge=0)
    depth: Optional[float] = Field(None, ge=0)

    position: Optional[Dict[str, float]] = None
    rotation: Optional[float] = Field(None, ge=-360, le=360)
    wall_offset: Optional[float] = Field(None, ge=0)
    height_from_floor: Optional[float] = Field(None, ge=0)

    symbol: Optional[str] = None
    fill_color: Optional[str] = None
    stroke_color: Optional[str] = None
    stroke_width: Optional[int] = Field(None, ge=1, le=10)

    model_number: Optional[str] = Field(None, max_length=100)
    manufacturer: Optional[str] = Field(None, max_length=100)
    specifications: Optional[Dict[str, Any]] = None

    voltage: Optional[int] = Field(None, gt=0)
    amperage: Optional[float] = Field(None, gt=0)
    wattage: Optional[int] = Field(None, gt=0)
    circuit_number: Optional[str] = Field(None, max_length=50)

    water_supply: Optional[str] = None
    drain_size: Optional[float] = Field(None, gt=0)
    fixture_units: Optional[float] = Field(None, gt=0)

    unit_cost: Optional[float] = Field(None, ge=0)
    installation_cost: Optional[float] = Field(None, ge=0)
    total_cost: Optional[float] = Field(None, ge=0)

    status: Optional[str] = None
    installation_date: Optional[datetime] = None

    sort_order: Optional[int] = None
    is_visible: Optional[bool] = None
    is_locked: Optional[bool] = None
    notes: Optional[str] = None


class FixtureResponse(FixtureBase):
    """Response schema for fixtures"""
    model_config = ConfigDict(protected_namespaces=(), from_attributes=True)

    id: UUID
    room_id: UUID
    wall_id: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


# ===== WALL SCHEMAS =====

class WallBase(BaseModel):
    """Base schema for walls"""
    name: Optional[str] = Field(None, max_length=255)
    wall_type: str = Field(default="interior", pattern="^(interior|exterior|load_bearing)$")

    length: float = Field(gt=0)
    height: float = Field(default=8.0, gt=0)
    thickness: float = Field(default=4.0, gt=0)
    area: float = Field(default=0, ge=0)

    start_point: Dict[str, float] = Field(...)
    end_point: Dict[str, float] = Field(...)
    angle: float = Field(default=0, ge=-180, le=180)

    stroke_color: str = Field(default="#000000", pattern="^#[0-9A-Fa-f]{6}$")
    stroke_width: int = Field(default=3, ge=1, le=10)
    stroke_style: str = Field(default="solid", pattern="^(solid|dashed|dotted)$")

    material_type: Optional[str] = Field(None, max_length=100)
    finish_type: Optional[str] = Field(None, max_length=100)
    insulation_type: Optional[str] = Field(None, max_length=100)

    is_load_bearing: bool = False
    is_removable: bool = True
    structural_notes: Optional[str] = None

    cost_per_sq_unit: float = Field(default=0, ge=0)
    estimated_cost: float = Field(default=0, ge=0)

    sort_order: int = 0
    is_visible: bool = True
    is_locked: bool = False

    @validator('start_point', 'end_point', pre=True)
    def validate_point(cls, v):
        if not isinstance(v, dict):
            raise ValueError("Point must be a dictionary with 'x' and 'y' keys")
        if 'x' not in v or 'y' not in v:
            raise ValueError("Point must have 'x' and 'y' coordinates")
        if not isinstance(v['x'], (int, float)) or not isinstance(v['y'], (int, float)):
            raise ValueError("Point coordinates must be numbers")
        return v

    @validator('area', pre=True, always=True)
    def calculate_area(cls, v, values):
        if v == 0 and 'length' in values and 'height' in values:
            return values['length'] * values['height']
        return v

    @validator('estimated_cost', pre=True, always=True)
    def calculate_estimated_cost(cls, v, values):
        if v == 0 and 'area' in values and 'cost_per_sq_unit' in values:
            area = values['area'] if values['area'] > 0 else (values.get('length', 0) * values.get('height', 0))
            return area * values['cost_per_sq_unit']
        return v


class WallCreate(WallBase):
    """Schema for creating walls"""
    room_id: UUID


class WallUpdate(BaseModel):
    """Schema for updating walls"""
    name: Optional[str] = Field(None, max_length=255)
    wall_type: Optional[str] = None

    length: Optional[float] = Field(None, gt=0)
    height: Optional[float] = Field(None, gt=0)
    thickness: Optional[float] = Field(None, gt=0)
    area: Optional[float] = Field(None, ge=0)

    start_point: Optional[Dict[str, float]] = None
    end_point: Optional[Dict[str, float]] = None
    angle: Optional[float] = Field(None, ge=-180, le=180)

    stroke_color: Optional[str] = None
    stroke_width: Optional[int] = Field(None, ge=1, le=10)
    stroke_style: Optional[str] = None

    material_type: Optional[str] = Field(None, max_length=100)
    finish_type: Optional[str] = Field(None, max_length=100)
    insulation_type: Optional[str] = Field(None, max_length=100)

    is_load_bearing: Optional[bool] = None
    is_removable: Optional[bool] = None
    structural_notes: Optional[str] = None

    cost_per_sq_unit: Optional[float] = Field(None, ge=0)
    estimated_cost: Optional[float] = Field(None, ge=0)

    sort_order: Optional[int] = None
    is_visible: Optional[bool] = None
    is_locked: Optional[bool] = None


class WallResponse(WallBase):
    """Response schema for walls"""
    id: UUID
    room_id: UUID
    fixtures: List[FixtureResponse] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== ROOM SCHEMAS =====

class RoomBase(BaseModel):
    """Base schema for rooms"""
    name: str = Field(min_length=1, max_length=255)
    room_type: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None

    area: float = Field(default=0, ge=0)
    perimeter: float = Field(default=0, ge=0)
    ceiling_height: float = Field(default=8.0, gt=0)
    floor_level: int = Field(default=1, ge=1)

    fill_color: str = Field(default="#E6F3FF", pattern="^#[0-9A-Fa-f]{6}$")
    stroke_color: str = Field(default="#2E5BBA", pattern="^#[0-9A-Fa-f]{6}$")
    stroke_width: int = Field(default=2, ge=1, le=10)
    opacity: float = Field(default=0.3, ge=0, le=1)

    geometry: Dict[str, Any] = Field(...)

    sort_order: int = 0
    is_visible: bool = True
    is_locked: bool = False

    cost_category: Optional[str] = Field(None, max_length=100)
    estimated_cost: float = Field(default=0, ge=0)

    @validator('geometry', pre=True)
    def validate_geometry(cls, v):
        if not isinstance(v, dict):
            raise ValueError("Geometry must be a dictionary")
        # Basic validation - could be extended with specific geometric validations
        return v


class RoomCreate(RoomBase):
    """Schema for creating rooms"""
    sketch_id: UUID


class RoomUpdate(BaseModel):
    """Schema for updating rooms"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    room_type: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None

    area: Optional[float] = Field(None, ge=0)
    perimeter: Optional[float] = Field(None, ge=0)
    ceiling_height: Optional[float] = Field(None, gt=0)
    floor_level: Optional[int] = Field(None, ge=1)

    fill_color: Optional[str] = None
    stroke_color: Optional[str] = None
    stroke_width: Optional[int] = Field(None, ge=1, le=10)
    opacity: Optional[float] = Field(None, ge=0, le=1)

    geometry: Optional[Dict[str, Any]] = None

    sort_order: Optional[int] = None
    is_visible: Optional[bool] = None
    is_locked: Optional[bool] = None

    cost_category: Optional[str] = Field(None, max_length=100)
    estimated_cost: Optional[float] = Field(None, ge=0)


class RoomResponse(RoomBase):
    """Response schema for rooms"""
    id: UUID
    sketch_id: UUID
    walls: List[WallResponse] = []
    fixtures: List[FixtureResponse] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== SKETCH SCHEMAS =====

class SketchBase(BaseModel):
    """Base schema for sketches"""
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    project_type: str = Field(default="interior", pattern="^(interior|exterior|mixed)$")
    status: str = Field(default="draft", pattern="^(draft|in_progress|completed|archived)$")

    # Canvas properties
    canvas_width: int = Field(default=800, gt=0)
    canvas_height: int = Field(default=600, gt=0)
    scale_factor: float = Field(default=1.0, gt=0)
    scale_unit: str = Field(default="ft", pattern="^(ft|m|in|cm)$")

    # Calculated properties (usually computed)
    total_area: float = Field(default=0, ge=0)
    total_perimeter: float = Field(default=0, ge=0)
    total_wall_area: float = Field(default=0, ge=0)

    # Display settings
    grid_enabled: bool = True
    grid_size: int = Field(default=20, gt=0)
    snap_to_grid: bool = True
    background_color: str = Field(default="#FFFFFF", pattern="^#[0-9A-Fa-f]{6}$")

    # File & export
    thumbnail_url: Optional[str] = Field(None, max_length=500)
    export_settings: Optional[Dict[str, Any]] = None

    # Versioning
    version: int = Field(default=1, ge=1)
    is_template: bool = False
    template_category: Optional[str] = Field(None, max_length=100)


class SketchCreate(SketchBase):
    """Schema for creating sketches"""
    company_id: UUID
    created_by_user_id: Optional[UUID] = None
    estimate_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    work_order_id: Optional[UUID] = None


class SketchUpdate(BaseModel):
    """Schema for updating sketches"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None

    estimate_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    work_order_id: Optional[UUID] = None

    canvas_width: Optional[int] = Field(None, gt=0)
    canvas_height: Optional[int] = Field(None, gt=0)
    scale_factor: Optional[float] = Field(None, gt=0)
    scale_unit: Optional[str] = None

    total_area: Optional[float] = Field(None, ge=0)
    total_perimeter: Optional[float] = Field(None, ge=0)
    total_wall_area: Optional[float] = Field(None, ge=0)

    grid_enabled: Optional[bool] = None
    grid_size: Optional[int] = Field(None, gt=0)
    snap_to_grid: Optional[bool] = None
    background_color: Optional[str] = None

    thumbnail_url: Optional[str] = Field(None, max_length=500)
    export_settings: Optional[Dict[str, Any]] = None

    version: Optional[int] = Field(None, ge=1)
    is_template: Optional[bool] = None
    template_category: Optional[str] = Field(None, max_length=100)


class SketchListResponse(BaseModel):
    """Response schema for sketch list"""
    id: UUID
    name: str
    description: Optional[str] = None
    project_type: str
    status: str
    company_id: UUID
    total_area: float
    canvas_width: int
    canvas_height: int
    thumbnail_url: Optional[str] = None
    version: int
    is_template: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SketchResponse(SketchBase):
    """Full response schema for sketches"""
    id: UUID
    company_id: UUID
    created_by_user_id: Optional[UUID] = None
    estimate_id: Optional[UUID] = None
    invoice_id: Optional[UUID] = None
    work_order_id: Optional[UUID] = None

    rooms: List[RoomResponse] = []
    measurements: List[MeasurementResponse] = []

    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== BULK OPERATIONS SCHEMAS =====

class BulkRoomCreate(BaseModel):
    """Schema for creating multiple rooms at once"""
    sketch_id: UUID
    rooms: List[RoomCreate]


class BulkWallCreate(BaseModel):
    """Schema for creating multiple walls at once"""
    walls: List[WallCreate]


class BulkFixtureCreate(BaseModel):
    """Schema for creating multiple fixtures at once"""
    fixtures: List[FixtureCreate]


class BulkDeleteRequest(BaseModel):
    """Schema for bulk delete operations"""
    ids: List[UUID] = Field(min_items=1)


class BulkUpdateOrder(BaseModel):
    """Schema for bulk updating sort order"""
    updates: List[Dict[str, Union[UUID, int]]] = Field(min_items=1)
    # Format: [{"id": "uuid", "sort_order": 1}, ...]


# ===== CALCULATION SCHEMAS =====

class AreaCalculationRequest(BaseModel):
    """Request schema for area calculations"""
    geometry: Dict[str, Any]
    scale_factor: float = 1.0
    unit: str = Field(default="ft", pattern="^(ft|m|in|cm)$")


class AreaCalculationResponse(BaseModel):
    """Response schema for area calculations"""
    area: float
    perimeter: float
    unit: str
    scale_factor: float


class CostCalculationRequest(BaseModel):
    """Request schema for cost calculations"""
    sketch_id: UUID
    include_labor: bool = True
    include_materials: bool = True
    markup_percentage: float = Field(default=0, ge=0, le=100)


class CostCalculationResponse(BaseModel):
    """Response schema for cost calculations"""
    sketch_id: UUID
    total_material_cost: float
    total_labor_cost: float
    markup_amount: float
    total_cost: float
    room_costs: List[Dict[str, Any]]
    fixture_costs: List[Dict[str, Any]]


# ===== EXPORT/IMPORT SCHEMAS =====

class SketchExportRequest(BaseModel):
    """Request schema for sketch export"""
    format: str = Field(pattern="^(json|svg|pdf|png|jpg)$")
    include_measurements: bool = True
    include_fixtures: bool = True
    scale_to_fit: bool = False
    width: Optional[int] = Field(None, gt=0)
    height: Optional[int] = Field(None, gt=0)


class SketchImportRequest(BaseModel):
    """Request schema for sketch import"""
    company_id: UUID
    format: str = Field(pattern="^(json|dxf|dwg)$")
    data: Union[Dict[str, Any], str]  # JSON data or file content
    name: Optional[str] = None
    merge_with_existing: bool = False
    existing_sketch_id: Optional[UUID] = None


class SketchImportResponse(BaseModel):
    """Response schema for sketch import"""
    sketch_id: UUID
    imported_rooms: int
    imported_walls: int
    imported_fixtures: int
    imported_measurements: int
    warnings: List[str] = []
    errors: List[str] = []