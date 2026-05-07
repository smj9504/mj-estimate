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


class PackEstimateMode(enum.Enum):
    """Estimation mode"""
    QUICK = "quick"
    PHOTO_AI = "photo_ai"


class PackEstimateStatus(enum.Enum):
    """Estimate status"""
    DRAFT = "draft"
    COMPLETED = "completed"
    APPROVED = "approved"


class Density(enum.Enum):
    """Room content density"""
    LIGHT = "light"
    NORMAL = "normal"
    DENSE = "dense"
    HEAVY = "heavy"
    EXTREME = "extreme"


class ContaminationLevel(enum.Enum):
    """Contamination level per IICRC S500"""
    CLEAN = "clean"
    GRAY_WATER = "gray_water"
    BLACK_WATER = "black_water"


class PackCalculation(Base, BaseModel):
    """Pack calculation / packing estimate record"""
    __tablename__ = "pack_calculations"
    __table_args__ = (
        Index('ix_pack_calculations_user', 'created_by_id'),
        Index('ix_pack_calculations_date', 'created_at'),
        Index('ix_pack_calculations_client', 'client_id'),
        Index('ix_pack_calculations_company', 'company_id'),
        Index('ix_pack_calculations_status', 'status'),
        {'extend_existing': True}
    )

    # Calculation metadata
    calculation_name = Column(String(255))
    project_address = Column(String(500))
    notes = Column(Text)

    # Client & Company linkage
    client_id = Column(UUIDType(), ForeignKey("clients.id"), nullable=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    claim_id = Column(UUIDType(), ForeignKey("claims.id"), nullable=True)

    # Estimate mode & status
    mode = Column(SQLEnum(PackEstimateMode), default=PackEstimateMode.PHOTO_AI)
    status = Column(SQLEnum(PackEstimateStatus), default=PackEstimateStatus.DRAFT)

    # Building information
    building_type = Column(SQLEnum(BuildingType))
    total_floors = Column(Integer)
    has_elevator = Column(Boolean, default=False)

    # Estimation settings (from packing_tool_export)
    crew_size = Column(Integer, default=4)
    region = Column(String(50), default="mid_atlantic")
    staging_type = Column(String(20), default="off_site")
    include_packback = Column(Boolean, default=True)
    storage_months = Column(Integer, default=1)

    # O&P and Contingency
    include_op = Column(Boolean, default=True)
    op_rate = Column(Integer, default=20)
    include_contingency = Column(Boolean, default=False)
    contingency_rate = Column(Integer, default=0)

    # Xactimate integration (legacy, kept for backward compat)
    xactimate_pack_out_materials = Column(JSONB)
    xactimate_pack_out_labor = Column(JSONB)
    xactimate_protection = Column(JSONB)
    xactimate_debris = Column(JSONB)
    xactimate_pack_in_labor = Column(JSONB)

    # Section-level results (from packing_tool_export)
    sections = Column(JSONB)  # {"Pack-Out Labor": 1200, "Materials": 800, ...}
    section_details = Column(JSONB)  # {"Pack-Out Labor": {"lines": [...]}, ...}
    materials_summary = Column(JSONB)  # {"box_small": 10, "blanket": 5, ...}
    material_details = Column(JSONB)  # [{code, name, qty, unit, unit_price, total}]
    supplements = Column(JSONB)  # [{key, name, amount, triggered, enabled}]

    # Financial totals
    subtotal = Column(Float)
    op_amount = Column(Float)
    contingency_amount = Column(Float)
    supplements_total = Column(Float, default=0)
    grand_total = Column(Float)
    storage_sf = Column(Integer, default=0)

    # ML metadata
    ml_confidence = Column(Float)
    ml_used = Column(Boolean, default=False)
    needs_review = Column(Boolean, default=False)
    strategies_used = Column(JSONB)

    # Correction tracking
    was_corrected = Column(Boolean, default=False)
    corrected_at = Column(DateTime)
    corrected_by_user_id = Column(UUIDType(), ForeignKey("staff.id"))
    correction_notes = Column(Text)
    correction_magnitude = Column(Float)
    approved_for_training = Column(Boolean, default=True)

    # Store both original and corrected
    original_calculation = Column(JSONB)
    corrected_calculation = Column(JSONB)

    # Summary results (legacy)
    total_pack_out_hours = Column(Float)
    total_pack_in_hours = Column(Float)
    total_protection_sf = Column(Float)
    total_debris_lb = Column(Float)
    total_hours = Column(Float)
    total_items = Column(Integer)

    # Special items (global level)
    special_items = Column(JSONB)  # ["piano", "pool_table"]
    custom_special_items = Column(JSONB)  # [{"name": "...", "price": 100}]

    # Room summaries for display
    room_summaries = Column(JSONB)  # [{room_name, notable_items, categories_present, ...}]

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    rooms = relationship("PackRoom", back_populates="calculation", cascade="all, delete-orphan")
    client = relationship("Client", foreign_keys=[client_id], lazy="select")
    company = relationship("Company", foreign_keys=[company_id], lazy="select")
    claim = relationship("Claim", foreign_keys=[claim_id], lazy="select")


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

    # Preset & density (from packing_tool_export)
    preset_key = Column(String(100))  # e.g., "bedroom_standard"
    density = Column(SQLEnum(Density), default=Density.NORMAL)
    contamination = Column(SQLEnum(ContaminationLevel), default=ContaminationLevel.CLEAN)

    # Content hints for quick estimate mode
    hints = Column(JSONB)  # ["clothing_hanging", "furniture", ...]
    hint_volume = Column(JSONB)  # {"books": 2, "electronics": 1}
    hint_qty = Column(JSONB)  # {"sofa": 1, "bed_large": 1}

    # Special items per room
    room_special_items = Column(JSONB)  # ["piano", "pool_table"]
    custom_special_items = Column(JSONB)  # [{"name": "...", "price": 100}]

    # Photos (for Photo AI mode)
    photos = Column(JSONB)  # ["url1", "url2", ...]

    # Input method tracking
    input_method = Column(SQLEnum(InputMethod), default=InputMethod.STRUCTURED)
    raw_input = Column(Text)
    image_url = Column(String)
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
    item_category = Column(String(100))
    quantity = Column(Integer, default=1, nullable=False)
    size_category = Column(String(50))

    # AI metadata
    detected_by = Column(SQLEnum(DetectedBy), default=DetectedBy.MANUAL)
    confidence_score = Column(Float)

    # Floor & handling
    floor_level = Column(SQLEnum(FloorLevel))
    estimated_weight_lb = Column(Float)
    fragile = Column(Boolean, default=False)
    requires_disassembly = Column(Boolean, default=False)
    is_high_value = Column(Boolean, default=False)
    special_notes = Column(Text)

    # Packing method details (from AI analysis)
    packing_method = Column(String(100))
    required_materials = Column(JSONB)  # ["wardrobe_box", "bubble_wrap_12"]
    base_labor_hours = Column(Float)
    per_unit_labor_hours = Column(Float)
    estimated_labor_hours = Column(Float)
    estimator_flags = Column(JSONB)  # ["HEAVY", "FRAGILE", "DISASSEMBLY"]

    # Calculated materials for this item
    xactimate_materials = Column(JSONB)

    # Cached labor hours
    cached_packing_hours = Column(Float)
    cached_moving_hours = Column(Float)

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
    xactimate_materials = Column(JSONB, nullable=False)

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
    boxes_mae = Column(Float)
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

    # Notes (MLTrainingMetadata)
    notes = Column(Text)


class PackingPrice(Base, BaseModel):
    """
    Packing/moving line item prices.
    Tool-specific price table separate from general LineItems.
    """
    __tablename__ = "packing_prices"
    __table_args__ = (
        Index('ix_packing_prices_company', 'company_id'),
        Index('ix_packing_prices_code', 'code'),
        Index('ix_packing_prices_category', 'category'),
        {'extend_existing': True}
    )

    code = Column(String(50), nullable=False)  # e.g., "2825", "3026"
    name = Column(String(255), nullable=False)
    unit = Column(String(50))  # EA, HR, SF, RL, BN, BX, MO
    unit_price = Column(Float, nullable=False, default=0)
    category = Column(String(100))  # "Moving - Labor", "Moving - Boxes", etc.
    is_taxable = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)

    # Company ownership
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=True)
