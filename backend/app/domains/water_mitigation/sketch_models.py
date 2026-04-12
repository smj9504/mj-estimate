"""
Water Mitigation Sketch domain models.

Provides floor-level sketch canvases with overlay elements for
demolition zones, equipment placements, containment zones,
and floor protections.
"""

from sqlalchemy import (
    Boolean,
    DECIMAL,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class WMFloorSketch(Base, BaseModel):
    """
    Water Mitigation Floor Sketch.

    One canvas per floor per job. Holds canvas metadata and a denormalized
    JSONB snapshot of all overlay elements for fast single-query reads.
    Child tables (WMDemolitionZone, WMEquipmentPlacement, etc.) are the
    source of truth; overlay_data is kept in sync via save_overlay_data().
    """

    __tablename__ = "wm_floor_sketches"
    __table_args__ = (
        Index("ix_wm_floor_sketches_job_id", "job_id"),
        Index("ix_wm_floor_sketches_job_order", "job_id", "floor_order"),
        {"extend_existing": True},
    )

    job_id = Column(
        UUIDType(),
        ForeignKey("water_mitigation_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Floor identification
    floor_label = Column(String(100), nullable=False)   # e.g. "1st Floor", "Basement"
    floor_order = Column(Integer, default=0, nullable=False)  # for display sorting

    # Display metadata
    address_display = Column(String(500))
    source_type = Column(String(20), default="sketch", nullable=False)  # "sketch" | "image"

    # Optional reference to sketch module
    sketch_id = Column(
        UUIDType(),
        ForeignKey("sketches.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Background image (used when source_type="image")
    background_image_url = Column(String(1000), nullable=True)
    storage_file_id = Column(String(500), nullable=True)      # Provider-specific file ID (e.g. GDrive file ID)
    storage_provider = Column(String(50), nullable=True)       # 'local', 'gdrive', 'gcs', 's3'

    # Canvas configuration
    canvas_width = Column(Integer, default=1200, nullable=False)
    canvas_height = Column(Integer, default=900, nullable=False)
    scale_pixels_per_foot = Column(Float, default=20.0, nullable=False)

    notes = Column(Text, nullable=True)

    # Denormalized JSONB snapshot for fast reads.
    # Structure: {demolition_zones: [...], equipment_placements: [...],
    #             containment_zones: [...], floor_protections: [...]}
    overlay_data = Column(JSONB, default=dict, nullable=False)

    # Relationships
    job = relationship(
        "WaterMitigationJob",
        back_populates="floor_sketches",
    )
    demolition_zones = relationship(
        "WMDemolitionZone",
        back_populates="floor_sketch",
        cascade="all, delete-orphan",
        order_by="WMDemolitionZone.display_order",
    )
    equipment_placements = relationship(
        "WMEquipmentPlacement",
        back_populates="floor_sketch",
        cascade="all, delete-orphan",
    )
    containment_zones = relationship(
        "WMContainmentZone",
        back_populates="floor_sketch",
        cascade="all, delete-orphan",
    )
    floor_protections = relationship(
        "WMFloorProtection",
        back_populates="floor_sketch",
        cascade="all, delete-orphan",
    )
    content_protections = relationship(
        "WMContentProtection",
        back_populates="floor_sketch",
        cascade="all, delete-orphan",
    )


class WMDemolitionZone(Base, BaseModel):
    """
    Demolition Zone overlay element on a floor sketch.

    Represents a rectangular area of material to be demolished,
    drawn on the canvas with position and dimension data.
    """

    __tablename__ = "wm_demolition_zones"
    __table_args__ = (
        Index("ix_wm_demolition_zones_floor_sketch", "floor_sketch_id"),
        {"extend_existing": True},
    )

    floor_sketch_id = Column(
        UUIDType(),
        ForeignKey("wm_floor_sketches.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Material classification
    material_type = Column(String(100), nullable=False)  # "Wood Floor", "Carpet", "Tile", "Ceiling", "Wall/Drywall", "Baseboard"
    surface = Column(String(50), nullable=False)  # "floor", "wall", "ceiling"
    color = Column(String(7), nullable=False)

    # Canvas position
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)

    # Dimensions in decimal feet
    dimension1_ft = Column(DECIMAL(10, 4), nullable=False)  # first dimension
    dimension2_ft = Column(DECIMAL(10, 4), nullable=False)  # second dimension

    rotation = Column(Float, default=0.0, nullable=False)

    # Calculated area
    calculated_sqft = Column(DECIMAL(12, 2), nullable=False)

    label = Column(String(255), nullable=True)
    display_order = Column(Integer, default=0, nullable=False)

    # Wall height in feet (for wall SF calculation: dimension1_ft * height_ft)
    height_ft = Column(DECIMAL(10, 4), nullable=True)

    # Carpet pad — when True, scope generation creates a "Carpet Pad" line item
    include_pad = Column(Boolean, default=False, nullable=False, server_default="false")

    # Optional link to scope item for invoice tracking
    scope_item_id = Column(
        UUIDType(),
        ForeignKey("wm_scope_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    floor_sketch = relationship("WMFloorSketch", back_populates="demolition_zones")
    scope_item = relationship("WMScopeItem")


class WMEquipmentPlacement(Base, BaseModel):
    """
    Equipment Placement overlay element on a floor sketch.

    Represents a piece of drying equipment (air mover, dehumidifier, etc.)
    placed at a specific canvas coordinate.
    """

    __tablename__ = "wm_equipment_placements"
    __table_args__ = (
        Index("ix_wm_equipment_placements_floor_sketch", "floor_sketch_id"),
        {"extend_existing": True},
    )

    floor_sketch_id = Column(
        UUIDType(),
        ForeignKey("wm_floor_sketches.id", ondelete="CASCADE"),
        nullable=False,
    )

    equipment_type = Column(String(100), nullable=False)  # "air_mover", "air_scrubber", "dehumidifier"

    # Canvas position
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)

    # Visual representation
    icon_shape = Column(String(50), nullable=False)  # "circle", "triangle", "cylinder"
    color = Column(String(7), nullable=False)

    label = Column(String(255), nullable=True)

    # Relationships
    floor_sketch = relationship("WMFloorSketch", back_populates="equipment_placements")


class WMContainmentZone(Base, BaseModel):
    """
    Containment Zone overlay element on a floor sketch.

    Represents a poly sheeting barrier drawn as a line on the floor plan.
    length_ft = barrier span on the floor, height_ft = poly height (ceiling).
    calculated_sqft = length_ft * height_ft.
    """

    __tablename__ = "wm_containment_zones"
    __table_args__ = (
        Index("ix_wm_containment_zones_floor_sketch", "floor_sketch_id"),
        {"extend_existing": True},
    )

    floor_sketch_id = Column(
        UUIDType(),
        ForeignKey("wm_floor_sketches.id", ondelete="CASCADE"),
        nullable=False,
    )

    containment_type = Column(String(100), default="Standard", nullable=False)

    # Canvas position
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)

    # Line dimensions
    length_ft = Column(DECIMAL(10, 4), nullable=True)  # barrier span on floor plan
    height_ft = Column(DECIMAL(10, 4), nullable=True)  # poly height (ceiling)
    rotation = Column(Float, default=0.0, nullable=True)  # angle in degrees

    # Legacy rectangle fields (deprecated — use length_ft instead)
    width_ft = Column(DECIMAL(10, 4), nullable=True)

    calculated_sqft = Column(DECIMAL(12, 2), nullable=False)
    color = Column(String(7), default="#0066FF", nullable=False)
    label = Column(String(255), nullable=True)

    # Zipper count (EA) — 0 means no zipper (default)
    zipper_count = Column(Integer, default=0, nullable=False, server_default="0")

    # Relationships
    floor_sketch = relationship("WMFloorSketch", back_populates="containment_zones")


class WMFloorProtection(Base, BaseModel):
    """
    Floor Protection overlay element on a floor sketch.

    Represents a run of floor protection paper (heavy duty paper & tape, etc.)
    drawn as a rotated strip on the canvas.
    """

    __tablename__ = "wm_floor_protections"
    __table_args__ = (
        Index("ix_wm_floor_protections_floor_sketch", "floor_sketch_id"),
        {"extend_existing": True},
    )

    floor_sketch_id = Column(
        UUIDType(),
        ForeignKey("wm_floor_sketches.id", ondelete="CASCADE"),
        nullable=False,
    )

    protection_type = Column(String(100), default="Heavy duty paper & tape", nullable=False)
    paper_width_ft = Column(Float, default=3.0, nullable=False)

    # Canvas position
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)

    length_ft = Column(DECIMAL(10, 4), nullable=False)
    rotation = Column(Float, default=0.0, nullable=False)

    calculated_sqft = Column(DECIMAL(12, 2), nullable=False)
    color = Column(String(7), default="#FFD700", nullable=False)

    # Relationships
    floor_sketch = relationship("WMFloorSketch", back_populates="floor_protections")


class WMContentProtection(Base, BaseModel):
    """
    Content Protection overlay element on a floor sketch.

    Represents an area where contents (furniture etc.) are covered with
    vinyl/plastic sheeting for protection. Drawn as a rectangle on the canvas.
    """

    __tablename__ = "wm_content_protections"
    __table_args__ = (
        Index("ix_wm_content_protections_floor_sketch", "floor_sketch_id"),
        {"extend_existing": True},
    )

    floor_sketch_id = Column(
        UUIDType(),
        ForeignKey("wm_floor_sketches.id", ondelete="CASCADE"),
        nullable=False,
    )

    protection_type = Column(String(100), default="Plastic sheeting", nullable=False)

    # Canvas position
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)

    # Dimensions in decimal feet
    width_ft = Column(DECIMAL(10, 4), nullable=False)
    length_ft = Column(DECIMAL(10, 4), nullable=False)
    rotation = Column(Float, default=0.0, nullable=False)

    calculated_sqft = Column(DECIMAL(12, 2), nullable=False)
    color = Column(String(7), default="#8B5CF6", nullable=False)

    # Relationships
    floor_sketch = relationship("WMFloorSketch", back_populates="content_protections")
