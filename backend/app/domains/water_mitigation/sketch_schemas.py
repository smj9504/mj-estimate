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
    surface: str = Field(..., max_length=50)
    color: str = Field(..., max_length=7)
    x: float
    y: float
    dimension1_ft: Decimal = Field(..., ge=0)
    dimension2_ft: Decimal = Field(..., ge=0)
    rotation: float = 0.0
    calculated_sqft: Decimal = Field(..., ge=0)
    label: Optional[str] = Field(None, max_length=255)
    display_order: int = 0
    scope_item_id: Optional[UUID] = None


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
    containment_type: str = Field("No zipper", max_length=100)
    x: float
    y: float
    width_ft: Optional[Decimal] = Field(None, ge=0)
    height_ft: Optional[Decimal] = Field(None, ge=0)
    calculated_sqft: Decimal = Field(..., ge=0)
    color: str = Field("#0066FF", max_length=7)
    label: Optional[str] = Field(None, max_length=255)


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
