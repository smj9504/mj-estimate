"""
Water Mitigation Sketch Pydantic schemas.

Provides request/response schemas for floor sketches and all overlay types.
Uses PydanticBaseModel alias to avoid collision with SQLAlchemy BaseModel.
"""

from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel as PydanticBaseModel
from pydantic import Field


# =============================================================================
# Demolition Zone Schemas
# =============================================================================

class WMDemolitionZoneBase(PydanticBaseModel):
    """Shared fields for demolition zone create/update"""
    material_type: str = Field(..., max_length=100)
    sub_type: Optional[str] = Field(
        None,
        max_length=100,
        description="Sub-type within material",
    )
    surface: str = Field(..., max_length=50)
    color: str = Field(..., max_length=7)
    x: float
    y: float
    dimension1_ft: Decimal = Field(..., ge=0)
    dimension2_ft: Decimal = Field(..., ge=0)
    rotation: float = 0.0
    calculated_sqft: Decimal = Field(..., ge=0)
    height_ft: Optional[Decimal] = Field(None, ge=0, description="Wall height in feet for SF calculation")
    include_pad: bool = Field(False, description="Include carpet pad with this carpet zone")
    include_insulation: bool = Field(False, description="Include insulation demo with wall/ceiling zone")
    glue_down: bool = Field(False, description="Floor is glued down to substrate, adds extra removal cost")
    baseboard_type: Optional[str] = Field(None, max_length=50, description="Baseboard/trim type: baseboard, quarter_round, baseboard_quarter_round")
    trim_removal: Optional[str] = Field(None, max_length=20, description="Trim removal extent: full, half, quarter, custom")
    trim_lf: Optional[Decimal] = Field(None, ge=0, description="Custom trim length in LF")
    label: Optional[str] = Field(None, max_length=255)
    display_order: int = 0
    scope_item_id: Optional[UUID] = None
    pixel_width: Optional[float] = None
    pixel_height: Optional[float] = None
    render_mode: Optional[str] = Field(None, max_length=20, description="Visual render mode: area, line, shape, text")
    stroke_style: Optional[str] = Field(None, max_length=20, description="Stroke style: solid, dashed, dotted")
    fill_opacity: Optional[float] = Field(None, ge=0, le=1, description="Fill opacity 0-1")
    polygon_points: Optional[List[Dict[str, float]]] = Field(None, description="Polygon vertices [{x,y}] for irregular shapes")
    combined_from: Optional[List[Any]] = Field(None, description="Snapshot of original zones before combining")
    group_id: Optional[str] = Field(None, max_length=100, description="Group ID for logically linked zones")


class WMDemolitionZoneCreate(WMDemolitionZoneBase):
    """Create a demolition zone"""
    pass


class WMDemolitionZoneSchema(WMDemolitionZoneBase):
    """Full demolition zone representation"""
    id: UUID
    floor_sketch_id: UUID

    class Config:
        from_attributes = True


# =============================================================================
# Equipment Placement Schemas
# =============================================================================

class WMEquipmentPlacementBase(PydanticBaseModel):
    """Shared fields for equipment placement create/update"""
    equipment_type: str = Field(..., max_length=100)
    x: float
    y: float
    icon_shape: str = Field(..., max_length=50)
    color: str = Field(..., max_length=7)
    label: Optional[str] = Field(None, max_length=255)


class WMEquipmentPlacementCreate(WMEquipmentPlacementBase):
    """Create an equipment placement"""
    pass


class WMEquipmentPlacementSchema(WMEquipmentPlacementBase):
    """Full equipment placement representation"""
    id: UUID
    floor_sketch_id: UUID

    class Config:
        from_attributes = True


# =============================================================================
# Containment Zone Schemas
# =============================================================================

class WMContainmentZoneBase(PydanticBaseModel):
    """Shared fields for containment zone create/update"""
    containment_type: str = Field("Containment", max_length=100)
    x: float
    y: float
    length_ft: Optional[Decimal] = Field(None, ge=0)
    height_ft: Optional[Decimal] = Field(None, ge=0)
    rotation: float = 0.0
    width_ft: Optional[Decimal] = Field(None, ge=0)  # legacy
    calculated_sqft: Decimal = Field(..., ge=0)
    color: str = Field("#0066FF", max_length=7)
    label: Optional[str] = Field(None, max_length=255)
    zipper_count: int = Field(0, ge=0, description="Number of zippers (EA)")


class WMContainmentZoneCreate(WMContainmentZoneBase):
    """Create a containment zone"""
    pass


class WMContainmentZoneSchema(WMContainmentZoneBase):
    """Full containment zone representation"""
    id: UUID
    floor_sketch_id: UUID

    class Config:
        from_attributes = True


# =============================================================================
# Floor Protection Schemas
# =============================================================================

class WMFloorProtectionBase(PydanticBaseModel):
    """Shared fields for floor protection create/update"""
    protection_type: str = Field("Heavy duty paper & tape", max_length=100)
    paper_width_ft: float = 3.0
    x: float
    y: float
    length_ft: Decimal = Field(..., ge=0)
    rotation: float = 0.0
    calculated_sqft: Decimal = Field(..., ge=0)
    color: str = Field("#FFD700", max_length=7)


class WMFloorProtectionCreate(WMFloorProtectionBase):
    """Create a floor protection strip"""
    pass


class WMFloorProtectionSchema(WMFloorProtectionBase):
    """Full floor protection representation"""
    id: UUID
    floor_sketch_id: UUID

    class Config:
        from_attributes = True


# =============================================================================
# Content Protection Schemas
# =============================================================================

class WMContentProtectionBase(PydanticBaseModel):
    """Shared fields for content protection create/update"""
    protection_type: str = Field("Plastic sheeting", max_length=100)
    x: float
    y: float
    width_ft: Decimal = Field(..., ge=0)
    length_ft: Decimal = Field(..., ge=0)
    rotation: float = 0.0
    calculated_sqft: Decimal = Field(..., ge=0)
    color: str = Field("#8B5CF6", max_length=7)


class WMContentProtectionCreate(WMContentProtectionBase):
    """Create a content protection area"""
    pass


class WMContentProtectionSchema(WMContentProtectionBase):
    """Full content protection representation"""
    id: UUID
    floor_sketch_id: UUID

    class Config:
        from_attributes = True


# =============================================================================
# Text Annotation Schemas
# =============================================================================

class WMTextAnnotationBase(PydanticBaseModel):
    """Shared fields for text annotation create/update"""
    id: Optional[str] = None
    floor_sketch_id: Optional[str] = None
    x: float
    y: float
    text: str = Field(..., max_length=500)
    font_size: float = 16.0
    color: str = Field("#333333", max_length=7)
    bold: bool = False


class WMTextAnnotationCreate(WMTextAnnotationBase):
    """Create a text annotation"""
    pass


# =============================================================================
# Shape Annotation Schemas (doors, cabinets, fixtures, etc.)
# =============================================================================

class WMShapeAnnotationBase(PydanticBaseModel):
    """Shared fields for shape annotation create/update"""
    id: Optional[str] = None
    floor_sketch_id: Optional[str] = None
    preset_id: str = Field(..., max_length=50)
    shape_type: str = Field(..., max_length=20)  # 'rectangle' | 'circle'
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    fill_color: str = Field("#E8E8E8", max_length=20)
    stroke_color: str = Field("#666666", max_length=20)
    stroke_width: float = 2.0
    opacity: float = 0.7
    label: str = Field("", max_length=50)


class WMShapeAnnotationCreate(WMShapeAnnotationBase):
    """Create a shape annotation"""
    pass


# =============================================================================
# Wall & Room Schemas
# =============================================================================

class WMWallCreate(PydanticBaseModel):
    """Wall segment on the floor plan"""
    id: Optional[str] = None
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    thickness: float = 4.0
    color: str = Field("#333333", max_length=20)
    length_ft: float = 0.0


class WMRoomCreate(PydanticBaseModel):
    """Room polygon detected from walls"""
    id: Optional[str] = None
    name: str = Field("Room", max_length=100)
    boundary: List[Dict[str, float]] = Field(default_factory=list)
    color: str = Field("rgba(173, 216, 230, 0.3)", max_length=50)
    height_ft: float = 8.0
    area_sqft: float = 0.0
    wall_ids: List[str] = Field(default_factory=list)


# =============================================================================
# Overlay Data Container
# =============================================================================

class WMOverlayData(PydanticBaseModel):
    """
    Container for all overlay elements on a floor sketch.

    Used as the payload for PUT /floors/{id}/overlay and as the
    parsed representation of the overlay_data JSONB column.
    """
    demolition_zones: List[WMDemolitionZoneCreate] = Field(default_factory=list)
    equipment_placements: List[WMEquipmentPlacementCreate] = Field(default_factory=list)
    containment_zones: List[WMContainmentZoneCreate] = Field(default_factory=list)
    floor_protections: List[WMFloorProtectionCreate] = Field(default_factory=list)
    content_protections: List[WMContentProtectionCreate] = Field(default_factory=list)
    text_annotations: List[WMTextAnnotationCreate] = Field(default_factory=list)
    shapes: List[WMShapeAnnotationCreate] = Field(default_factory=list)
    walls: List[WMWallCreate] = Field(default_factory=list)
    rooms: List[WMRoomCreate] = Field(default_factory=list)
    element_order: Optional[List[str]] = Field(None, description="Z-order of overlay element IDs")


# =============================================================================
# Floor Sketch Schemas
# =============================================================================

class WMFloorSketchCreate(PydanticBaseModel):
    """Create a new floor sketch (job_id comes from URL path, not body)"""
    floor_label: str = Field(..., max_length=100)
    floor_order: int = 0
    address_display: Optional[str] = Field(None, max_length=500)
    source_type: str = Field("sketch", max_length=20)
    canvas_width: int = 1200
    canvas_height: int = 900
    scale_pixels_per_foot: float = 20.0
    notes: Optional[str] = None


class WMFloorSketchUpdate(PydanticBaseModel):
    """Partial update for a floor sketch (all fields optional)"""
    floor_label: Optional[str] = Field(None, max_length=100)
    floor_order: Optional[int] = None
    address_display: Optional[str] = Field(None, max_length=500)
    source_type: Optional[str] = Field(None, max_length=20)
    canvas_width: Optional[int] = None
    canvas_height: Optional[int] = None
    scale_pixels_per_foot: Optional[float] = None
    notes: Optional[str] = None


class WMFloorSketchResponse(PydanticBaseModel):
    """Summary floor sketch response (without parsed overlay objects)"""
    id: UUID
    job_id: UUID
    floor_label: str
    floor_order: int
    address_display: Optional[str]
    source_type: str
    sketch_id: Optional[UUID]
    background_image_url: Optional[str]
    canvas_width: int
    canvas_height: int
    scale_pixels_per_foot: float
    notes: Optional[str]
    overlay_data: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class WMFloorSketchDetailResponse(PydanticBaseModel):
    """
    Detailed floor sketch response with overlay_data parsed into typed objects.

    Returns the same metadata as WMFloorSketchResponse plus strongly-typed
    overlay lists built from the child tables (via the JSONB snapshot).
    """
    id: UUID
    job_id: UUID
    floor_label: str
    floor_order: int
    address_display: Optional[str]
    source_type: str
    sketch_id: Optional[UUID]
    background_image_url: Optional[str]
    canvas_width: int
    canvas_height: int
    scale_pixels_per_foot: float
    notes: Optional[str]

    # Parsed overlay objects
    demolition_zones: List[WMDemolitionZoneSchema] = Field(default_factory=list)
    equipment_placements: List[WMEquipmentPlacementSchema] = Field(default_factory=list)
    containment_zones: List[WMContainmentZoneSchema] = Field(default_factory=list)
    floor_protections: List[WMFloorProtectionSchema] = Field(default_factory=list)

    # Complete overlay_data including JSONB-only fields
    # (text_annotations, shapes, walls, rooms)
    overlay_data: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class WMFloorSketchListResponse(PydanticBaseModel):
    """List of floor sketches for a job"""
    items: List[WMFloorSketchResponse]
    total: int


# =============================================================================
# Background Image Response
# =============================================================================

class WMBackgroundImageResponse(PydanticBaseModel):
    """Response after uploading or removing a background image"""
    floor_sketch_id: UUID
    background_image_url: Optional[str]
    message: str


# =============================================================================
# Generate Scope of Work from Sketch
# =============================================================================

class GenerateScopeRequest(PydanticBaseModel):
    """Request options for generating Scope of Work from sketch data"""
    clear_existing: bool = Field(
        False,
        description="If true, delete all existing scope locations/items before generating"
    )


class GeneratedScopeItemSummary(PydanticBaseModel):
    """Summary of a single generated scope item"""
    name: str
    item_type: str
    quantity: float
    unit: str
    floor_label: str


class GenerateScopeResponse(PydanticBaseModel):
    """Response after generating Scope of Work from sketch data"""
    success: bool
    message: str
    locations_created: int = 0
    items_created: int = 0
    items: List[GeneratedScopeItemSummary] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
