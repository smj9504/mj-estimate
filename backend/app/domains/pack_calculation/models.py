"""
Pack Calculation domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, Float, Enum as SQLEnum, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType
import enum


class FloorLevel(enum.Enum):
    """Floor level types"""
    BASEMENT = "BASEMENT"
    MAIN_LEVEL = "MAIN_LEVEL"
    SECOND_FLOOR = "SECOND_FLOOR"
    THIRD_FLOOR = "THIRD_FLOOR"
    FOURTH_FLOOR = "FOURTH_FLOOR"
    FIFTH_FLOOR_PLUS = "FIFTH_FLOOR_PLUS"


class BuildingType(enum.Enum):
    """Building type classification"""
    HOUSE = "HOUSE"
    APARTMENT = "APARTMENT"
    TOWNHOUSE = "TOWNHOUSE"
    CONDO = "CONDO"
    COMMERCIAL = "COMMERCIAL"


class InputMethod(enum.Enum):
    """Input method for items"""
    STRUCTURED = "STRUCTURED"
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    AI_INFERRED = "AI_INFERRED"


class DetectedBy(enum.Enum):
    """Source of item detection"""
    MANUAL = "MANUAL"
    AI_VISION = "AI_VISION"
    AI_NLP = "AI_NLP"
    AI_INFERRED = "AI_INFERRED"


class PackCalculation(Base, BaseModel):
    """Pack calculation record"""
    __tablename__ = "pack_calculations"
    __table_args__ = (
        Index('ix_pack_calculations_user', 'created_by_id'),
        Index('ix_pack_calculations_date', 'created_at'),
        {'extend_existing': True}
    )

    # Calculation metadata
    calculation_name = Column(String(255))
    project_address = Column(String(500))
    notes = Column(Text)

    # Building information
    building_type = Column(SQLEnum(BuildingType))
    total_floors = Column(Integer)
    has_elevator = Column(Boolean, default=False)

    # Xactimate integration
    xactimate_pack_out_materials = Column(JSONB)  # {line_item_code: quantity}
    xactimate_pack_out_labor = Column(JSONB)
    xactimate_protection = Column(JSONB)
    xactimate_debris = Column(JSONB)
    xactimate_pack_in_labor = Column(JSONB)

    # ML metadata
    ml_confidence = Column(Float)
    ml_used = Column(Boolean, default=False)
    needs_review = Column(Boolean, default=False)
    strategies_used = Column(JSONB)  # {material: "rule_based", labor: "item_based", ...}

    # Correction tracking
    was_corrected = Column(Boolean, default=False)
    corrected_at = Column(DateTime)
    corrected_by_user_id = Column(UUIDType(), ForeignKey("staff.id"))
    correction_notes = Column(Text)
    correction_magnitude = Column(Float)  # % difference
    approved_for_training = Column(Boolean, default=True)

    # Store both original and corrected
    original_calculation = Column(JSONB)  # AI/rule prediction
    corrected_calculation = Column(JSONB)  # Human-corrected values

    # Summary results
    total_pack_out_hours = Column(Float)
    total_pack_in_hours = Column(Float)
    total_protection_sf = Column(Float)
    total_debris_lb = Column(Float)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    rooms = relationship("PackRoom", back_populates="calculation", cascade="all, delete-orphan")


class PackRoom(Base, BaseModel):
    """Room/Location within a pack calculation"""
    __tablename__ = "pack_rooms"
    __table_args__ = (
        Index('ix_pack_rooms_calculation', 'calculation_id'),
        Index('ix_pack_rooms_floor', 'floor_level'),
        {'extend_existing': True}
    )

    # Parent calculation
    calculation_id = Column(UUIDType(), ForeignKey("pack_calculations.id"), nullable=False)

    # Location
    room_name = Column(String(255), nullable=False)
    floor_level = Column(SQLEnum(FloorLevel), nullable=False)

    # Input method tracking
    input_method = Column(SQLEnum(InputMethod), default=InputMethod.STRUCTURED)
    raw_input = Column(Text)  # Original text or image reference
    image_url = Column(String)  # For image inputs
    ai_confidence = Column(Float)

    # Calculated results for this room
    xactimate_materials = Column(JSONB)
    xactimate_labor = Column(JSONB)
    packing_hours = Column(Float)
    moving_hours = Column(Float)
    floor_multiplier = Column(Float)

    # Relationships
    calculation = relationship("PackCalculation", back_populates="rooms")
    items = relationship("PackItem", back_populates="room", cascade="all, delete-orphan")


class PackItem(Base, BaseModel):
    """Individual item in a pack calculation"""
    __tablename__ = "pack_items"
    __table_args__ = (
        Index('ix_pack_items_room', 'room_id'),
        Index('ix_pack_items_category', 'item_category'),
        {'extend_existing': True}
    )

    # Parent room
    room_id = Column(UUIDType(), ForeignKey("pack_rooms.id"), nullable=False)

    # Item details
    item_name = Column(String(255), nullable=False)
    item_category = Column(String(100))  # furniture, appliance, boxes, etc.
    quantity = Column(Integer, default=1, nullable=False)
    size_category = Column(String(50))  # small, medium, large, xl

    # AI metadata
    detected_by = Column(SQLEnum(DetectedBy), default=DetectedBy.MANUAL)
    confidence_score = Column(Float)

    # Floor & handling
    floor_level = Column(SQLEnum(FloorLevel))
    estimated_weight_lb = Column(Float)
    fragile = Column(Boolean, default=False)
    requires_disassembly = Column(Boolean, default=False)
    special_notes = Column(Text)

    # Calculated materials for this item
    xactimate_materials = Column(JSONB)  # {line_item_code: quantity}

    # Relationships
    room = relationship("PackRoom", back_populates="items")


class ItemMaterialMapping(Base, BaseModel):
    """
    Mapping of items to required Xactimate materials
    Used for rule-based calculation
    """
    __tablename__ = "item_material_mappings"
    __table_args__ = (
        Index('ix_item_mappings_item_name', 'item_name'),
        Index('ix_item_mappings_category', 'item_category'),
        Index('ix_item_mappings_active', 'active'),
        {'extend_existing': True}
    )

    # Item identification
    item_name = Column(String(255), nullable=False, unique=True, index=True)
    item_category = Column(String(100), nullable=False)
    size_category = Column(String(50))

    # Material mapping (Xactimate line items)
    xactimate_materials = Column(JSONB, nullable=False)  # {code: quantity_per_item}

    # Item properties
    estimated_weight_lb = Column(Float)
    fragile = Column(Boolean, default=False)
    requires_disassembly = Column(Boolean, default=False)

    # Packing time estimates (base hours)
    packing_hours_base = Column(Float)
    moving_hours_base = Column(Float)

    # Status
    active = Column(Boolean, default=True, nullable=False)

    # Usage tracking for ML
    usage_count = Column(Integer, default=0)
    last_used_at = Column(DateTime)

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))


class MLTrainingMetadata(Base, BaseModel):
    """
    Metadata for ML model training sessions
    """
    __tablename__ = "ml_training_metadata"
    __table_args__ = (
        Index('ix_ml_training_date', 'trained_at'),
        {'extend_existing': True}
    )

    # Training session info
    model_version = Column(String(50), nullable=False)
    trained_at = Column(DateTime, default=func.now(), nullable=False)
    training_samples_count = Column(Integer, nullable=False)

    # Model performance metrics
    boxes_mae = Column(Float)  # Mean Absolute Error for boxes
    bubble_wrap_mae = Column(Float)
    pads_mae = Column(Float)
    labor_mae = Column(Float)
    avg_confidence = Column(Float)

    # Deployment info
    deployed = Column(Boolean, default=False)
    deployed_at = Column(DateTime)

    # Model artifacts
    model_path = Column(String(500))
    feature_importances = Column(JSONB)

    # Notes
    notes = Column(Text)
