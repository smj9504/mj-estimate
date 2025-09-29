"""
Sketch domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, DECIMAL, JSON, Boolean, Index, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType


class Sketch(Base, BaseModel):
    """
    Main sketch entity containing overall sketch metadata and properties
    """
    __tablename__ = "sketches"
    __table_args__ = (
        Index('ix_sketch_name_company', 'name', 'company_id'),
        Index('ix_sketch_project_type', 'project_type', 'status'),
        {'extend_existing': True}
    )

    # Basic Information
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    project_type = Column(String(100), default="interior", nullable=False)  # interior, exterior, mixed
    status = Column(String(50), default="draft", nullable=False)  # draft, in_progress, completed, archived

    # Ownership & Context
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    created_by_user_id = Column(UUIDType(), nullable=True)  # References users table

    # Project Integration
    estimate_id = Column(UUIDType(), ForeignKey("estimates.id"), nullable=True)
    invoice_id = Column(UUIDType(), ForeignKey("invoices.id"), nullable=True)
    work_order_id = Column(UUIDType(), ForeignKey("work_orders.id"), nullable=True)

    # Canvas Properties
    canvas_width = Column(Integer, default=800, nullable=False)
    canvas_height = Column(Integer, default=600, nullable=False)
    scale_factor = Column(Float, default=1.0, nullable=False)  # pixels per unit (e.g., pixels per foot)
    scale_unit = Column(String(20), default="ft", nullable=False)  # ft, m, in, cm

    # Calculated Properties (auto-calculated from rooms/walls)
    total_area = Column(DECIMAL(12, 2), default=0)  # Total floor area in square units
    total_perimeter = Column(DECIMAL(12, 2), default=0)  # Total perimeter in linear units
    total_wall_area = Column(DECIMAL(12, 2), default=0)  # Total wall surface area

    # Metadata
    grid_enabled = Column(Boolean, default=True, nullable=False)
    grid_size = Column(Integer, default=20, nullable=False)  # Grid size in pixels
    snap_to_grid = Column(Boolean, default=True, nullable=False)
    background_color = Column(String(7), default="#FFFFFF", nullable=False)  # Hex color

    # File & Export
    thumbnail_url = Column(String(500))  # URL to thumbnail image
    export_settings = Column(JSON)  # Export preferences and settings

    # Versioning
    version = Column(Integer, default=1, nullable=False)
    is_template = Column(Boolean, default=False, nullable=False)
    template_category = Column(String(100))  # e.g., "residential", "commercial", "bathroom"

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="sketches")
    estimate = relationship("Estimate", backref="sketches")
    # invoice = relationship("Invoice", backref="sketches")  # Uncomment when Invoice model supports this
    # work_order = relationship("WorkOrder", backref="sketches")  # Uncomment when WorkOrder model supports this

    rooms = relationship("Room", back_populates="sketch", cascade="all, delete-orphan")
    measurements = relationship("Measurement", back_populates="sketch", cascade="all, delete-orphan")


class Room(Base, BaseModel):
    """
    Room entity representing distinct spaces within a sketch
    """
    __tablename__ = "rooms"
    __table_args__ = (
        Index('ix_room_sketch_name', 'sketch_id', 'name'),
        Index('ix_room_type', 'room_type'),
        {'extend_existing': True}
    )

    # Basic Information
    sketch_id = Column(UUIDType(), ForeignKey("sketches.id"), nullable=False)
    name = Column(String(255), nullable=False)
    room_type = Column(String(100), nullable=False)  # living_room, bedroom, kitchen, bathroom, etc.
    description = Column(Text)

    # Physical Properties
    area = Column(DECIMAL(12, 2), default=0)  # Floor area in square units
    perimeter = Column(DECIMAL(12, 2), default=0)  # Room perimeter in linear units
    ceiling_height = Column(DECIMAL(8, 2), default=8.0)  # Height in linear units
    floor_level = Column(Integer, default=1)  # Floor number (1=ground floor, 2=second floor, etc.)

    # Visual Properties
    fill_color = Column(String(7), default="#E6F3FF")  # Hex color for room fill
    stroke_color = Column(String(7), default="#2E5BBA")  # Hex color for room outline
    stroke_width = Column(Integer, default=2)  # Outline thickness in pixels
    opacity = Column(Float, default=0.3)  # Fill opacity (0.0 - 1.0)

    # Geometry Data (stored as JSON for flexibility)
    geometry = Column(JSON, nullable=False)  # Polygon coordinates, bezier curves, etc.

    # Layout Properties
    sort_order = Column(Integer, default=0)  # Display order
    is_visible = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)

    # Cost Integration
    cost_category = Column(String(100))  # Maps to estimate/invoice line item categories
    estimated_cost = Column(DECIMAL(15, 2), default=0)  # Cost estimate for this room

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    sketch = relationship("Sketch", back_populates="rooms")
    walls = relationship("Wall", back_populates="room", cascade="all, delete-orphan")
    fixtures = relationship("Fixture", back_populates="room", cascade="all, delete-orphan")


class Wall(Base, BaseModel):
    """
    Wall entity representing individual walls within rooms
    """
    __tablename__ = "walls"
    __table_args__ = (
        Index('ix_wall_room', 'room_id'),
        Index('ix_wall_type', 'wall_type'),
        {'extend_existing': True}
    )

    # Basic Information
    room_id = Column(UUIDType(), ForeignKey("rooms.id"), nullable=False)
    name = Column(String(255))  # Optional wall identifier
    wall_type = Column(String(100), default="interior", nullable=False)  # interior, exterior, load_bearing

    # Physical Properties
    length = Column(DECIMAL(10, 2), nullable=False)  # Length in linear units
    height = Column(DECIMAL(8, 2), default=8.0)  # Height in linear units
    thickness = Column(DECIMAL(6, 2), default=4.0)  # Thickness in inches/cm
    area = Column(DECIMAL(12, 2), default=0)  # Wall surface area (length × height)

    # Geometry
    start_point = Column(JSON, nullable=False)  # {"x": float, "y": float}
    end_point = Column(JSON, nullable=False)    # {"x": float, "y": float}
    angle = Column(DECIMAL(6, 2), default=0)    # Angle in degrees

    # Visual Properties
    stroke_color = Column(String(7), default="#000000")  # Hex color
    stroke_width = Column(Integer, default=3)            # Thickness in pixels
    stroke_style = Column(String(20), default="solid")   # solid, dashed, dotted

    # Material Properties
    material_type = Column(String(100))         # drywall, brick, concrete, etc.
    finish_type = Column(String(100))          # paint, wallpaper, tile, etc.
    insulation_type = Column(String(100))      # R-value, material type

    # Structural Properties
    is_load_bearing = Column(Boolean, default=False, nullable=False)
    is_removable = Column(Boolean, default=True, nullable=False)
    structural_notes = Column(Text)

    # Cost Integration
    cost_per_sq_unit = Column(DECIMAL(10, 2), default=0)  # Cost per square foot/meter
    estimated_cost = Column(DECIMAL(15, 2), default=0)    # Total estimated cost

    # Layout
    sort_order = Column(Integer, default=0)
    is_visible = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    room = relationship("Room", back_populates="walls")
    fixtures = relationship("Fixture", back_populates="wall", cascade="all, delete-orphan")


class Fixture(Base, BaseModel):
    """
    Fixture entity representing doors, windows, outlets, and other fixtures
    """
    __tablename__ = "fixtures"
    __table_args__ = (
        Index('ix_fixture_room_type', 'room_id', 'fixture_type'),
        Index('ix_fixture_wall', 'wall_id'),
        {'extend_existing': True}
    )

    # Basic Information
    room_id = Column(UUIDType(), ForeignKey("rooms.id"), nullable=False)
    wall_id = Column(UUIDType(), ForeignKey("walls.id"), nullable=True)  # Some fixtures may be freestanding
    name = Column(String(255), nullable=False)
    fixture_type = Column(String(100), nullable=False)  # door, window, outlet, switch, appliance, etc.

    # Physical Properties
    width = Column(DECIMAL(8, 2), default=0)    # Width in linear units
    height = Column(DECIMAL(8, 2), default=0)   # Height in linear units
    depth = Column(DECIMAL(8, 2), default=0)    # Depth in linear units (for 3D fixtures)

    # Position & Orientation
    position = Column(JSON, nullable=False)      # {"x": float, "y": float} - center point
    rotation = Column(DECIMAL(6, 2), default=0)  # Rotation in degrees
    wall_offset = Column(DECIMAL(8, 2), default=0)  # Distance from wall start point
    height_from_floor = Column(DECIMAL(8, 2), default=0)  # Height from floor level

    # Visual Properties
    symbol = Column(String(100))                 # Symbol identifier for rendering
    fill_color = Column(String(7), default="#CCCCCC")
    stroke_color = Column(String(7), default="#666666")
    stroke_width = Column(Integer, default=1)

    # Technical Properties
    model_number = Column(String(100))           # Manufacturer model number
    manufacturer = Column(String(100))          # Manufacturer name
    specifications = Column(JSON)               # Technical specifications

    # Electrical Properties (for electrical fixtures)
    voltage = Column(Integer)                    # 110, 220, etc.
    amperage = Column(DECIMAL(6, 2))            # Current rating
    wattage = Column(Integer)                   # Power consumption
    circuit_number = Column(String(50))         # Electrical circuit identifier

    # Plumbing Properties (for plumbing fixtures)
    water_supply = Column(String(50))           # hot, cold, mixed
    drain_size = Column(DECIMAL(4, 1))          # Drain diameter in inches
    fixture_units = Column(DECIMAL(4, 1))       # Plumbing fixture units

    # Cost Integration
    unit_cost = Column(DECIMAL(15, 2), default=0)      # Cost per fixture
    installation_cost = Column(DECIMAL(15, 2), default=0)  # Installation labor cost
    total_cost = Column(DECIMAL(15, 2), default=0)     # Total cost

    # Status
    status = Column(String(50), default="planned")      # planned, installed, removed, replaced
    installation_date = Column(DateTime(timezone=True))

    # Layout
    sort_order = Column(Integer, default=0)
    is_visible = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)

    # Notes
    notes = Column(Text)                        # Installation notes, requirements, etc.

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    room = relationship("Room", back_populates="fixtures")
    wall = relationship("Wall", back_populates="fixtures")


class Measurement(Base, BaseModel):
    """
    Measurement entity for storing dimension lines and annotations
    """
    __tablename__ = "measurements"
    __table_args__ = (
        Index('ix_measurement_sketch_type', 'sketch_id', 'measurement_type'),
        {'extend_existing': True}
    )

    # Basic Information
    sketch_id = Column(UUIDType(), ForeignKey("sketches.id"), nullable=False)
    name = Column(String(255))                  # Optional measurement label
    measurement_type = Column(String(100), default="linear", nullable=False)  # linear, area, angle, radius

    # Measurement Data
    value = Column(DECIMAL(12, 4), nullable=False)  # Measured value
    unit = Column(String(20), default="ft", nullable=False)  # ft, in, m, cm, sq_ft, degrees, etc.
    precision = Column(Integer, default=2)          # Decimal places to display

    # Geometry
    start_point = Column(JSON)                      # {"x": float, "y": float} for linear measurements
    end_point = Column(JSON)                        # {"x": float, "y": float} for linear measurements
    geometry = Column(JSON)                         # Complex geometry for area/angle measurements

    # Visual Properties
    label_position = Column(JSON)                   # {"x": float, "y": float} - label placement
    label_text = Column(String(255))               # Custom label text
    line_color = Column(String(7), default="#FF0000")
    line_width = Column(Integer, default=1)
    line_style = Column(String(20), default="solid")  # solid, dashed, dotted

    # Display Properties
    show_arrows = Column(Boolean, default=True, nullable=False)
    show_label = Column(Boolean, default=True, nullable=False)
    arrow_style = Column(String(20), default="arrow")  # arrow, tick, dot, none

    # Context
    associated_entity_type = Column(String(50))     # room, wall, fixture
    associated_entity_id = Column(UUIDType())       # ID of the associated entity

    # Layout
    sort_order = Column(Integer, default=0)
    is_visible = Column(Boolean, default=True, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)

    # Notes
    notes = Column(Text)                            # Additional notes about the measurement

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    sketch = relationship("Sketch", back_populates="measurements")