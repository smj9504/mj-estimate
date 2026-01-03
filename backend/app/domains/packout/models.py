"""
Packout domain database models for Xactimate integration and content analysis.
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from enum import Enum
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime,
    ForeignKey, Text, JSON, Enum as SQLAlchemyEnum, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class XactimateCategory(str, Enum):
    """Xactimate code categories"""
    CON = "CON"  # Content manipulation
    CPS = "CPS"  # Content processing and packing
    TMC = "TMC"  # Temporary moving and cleaning


class ItemSize(str, Enum):
    """Standard size categories for items"""
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    OVERSIZED = "oversized"


class FragilityLevel(str, Enum):
    """Fragility levels for packing requirements"""
    FRAGILE = "fragile"
    NORMAL = "normal"
    DURABLE = "durable"


class XactimateCode(Base):
    """Xactimate code reference table"""
    __tablename__ = "xactimate_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True)
    category = Column(SQLAlchemyEnum(XactimateCategory), nullable=False, index=True)
    description = Column(Text, nullable=False)
    unit = Column(String(10))  # EA, HR, SF, etc.
    unit_price = Column(Float, default=0.0)

    # Additional metadata from JSON
    subcategory = Column(String(100))  # e.g., "Boxes", "Labor", "Packing Materials"
    size_range = Column(String(100))  # e.g., "1.5 CF", "3.0 CF", etc.
    material_type = Column(String(100))  # e.g., "Corrugated", "Bubble Wrap", etc.

    # Relationships
    packing_rules = relationship("PackingRule", back_populates="xactimate_code")
    item_mappings = relationship("ItemXactimateMapping", back_populates="xactimate_code")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('idx_xactimate_category_subcategory', 'category', 'subcategory'),
    )


class PackingRule(Base):
    """Rules for packing different types of items"""
    __tablename__ = "packing_rules"

    id = Column(Integer, primary_key=True, index=True)
    item_category = Column(String(100), nullable=False, index=True)
    item_subcategory = Column(String(100), index=True)
    fragility_level = Column(SQLAlchemyEnum(FragilityLevel), nullable=False)
    size = Column(SQLAlchemyEnum(ItemSize), nullable=False)

    # Packing requirements
    box_type_code_id = Column(Integer, ForeignKey("xactimate_codes.id"))
    bubble_wrap_required = Column(Boolean, default=False)
    bubble_wrap_layers = Column(Integer, default=1)
    paper_sheets_required = Column(Integer, default=0)
    special_handling = Column(Boolean, default=False)
    handling_notes = Column(Text)

    # Labor estimates (in minutes per item)
    packing_time_minutes = Column(Float, default=5.0)
    inventory_time_minutes = Column(Float, default=2.0)

    # Relationships
    xactimate_code = relationship("XactimateCode", back_populates="packing_rules")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('item_category', 'item_subcategory', 'fragility_level', 'size',
                        name='uq_packing_rule'),
        Index('idx_packing_rule_item', 'item_category', 'item_subcategory'),
    )


class ItemXactimateMapping(Base):
    """Mapping between detected items and Xactimate codes"""
    __tablename__ = "item_xactimate_mappings"

    id = Column(Integer, primary_key=True, index=True)
    item_name = Column(String(200), nullable=False, index=True)
    item_category = Column(String(100), nullable=False)
    item_subcategory = Column(String(100))

    # Primary Xactimate code for this item
    primary_code_id = Column(Integer, ForeignKey("xactimate_codes.id"), nullable=False)

    # Additional codes that may apply
    additional_codes = Column(JSON)  # List of code IDs

    # Default characteristics
    default_fragility = Column(SQLAlchemyEnum(FragilityLevel), default=FragilityLevel.NORMAL)
    default_size = Column(SQLAlchemyEnum(ItemSize), default=ItemSize.MEDIUM)

    # Packing specifications
    items_per_box = Column(Integer, default=1)
    requires_disassembly = Column(Boolean, default=False)

    # Relationships
    xactimate_code = relationship("XactimateCode", back_populates="item_mappings")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('idx_item_mapping_category', 'item_category', 'item_subcategory'),
    )


class PhotoAnalysisPackout(Base):
    """Packout analysis results from photo analysis"""
    __tablename__ = "photo_analysis_packouts"

    id = Column(Integer, primary_key=True, index=True)
    photo_analysis_id = Column(Integer, ForeignKey("photo_analyses.id"), nullable=False)
    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    job_id = Column(String(100), index=True)  # External job reference
    room_name = Column(String(100))

    # Analysis results
    total_items_detected = Column(Integer, default=0)
    unique_items_count = Column(Integer, default=0)
    duplicate_items_removed = Column(Integer, default=0)

    # Detected items with details
    items_inventory = Column(JSON)  # List of detected items with quantities and characteristics

    # Material calculations
    material_requirements = Column(JSON)  # Detailed material needs with Xactimate codes
    total_boxes_needed = Column(Integer, default=0)
    total_bubble_wrap_rolls = Column(Integer, default=0)
    total_paper_pounds = Column(Integer, default=0)
    total_tape_rolls = Column(Integer, default=0)

    # Labor calculations
    labor_requirements = Column(JSON)  # Detailed labor breakdown with Xactimate codes
    total_packing_hours = Column(Float, default=0.0)
    total_inventory_hours = Column(Float, default=0.0)
    total_moving_hours = Column(Float, default=0.0)
    total_supervision_hours = Column(Float, default=0.0)

    # Xactimate summary
    xactimate_line_items = Column(JSON)  # Complete Xactimate line items with codes and quantities
    estimated_material_cost = Column(Float, default=0.0)  # Internal use only
    estimated_labor_cost = Column(Float, default=0.0)  # Internal use only
    estimated_total_cost = Column(Float, default=0.0)  # Internal use only

    # Cross-reference data
    existing_inventory_reference = Column(JSON)  # Reference to existing inventory if provided
    confidence_scores = Column(JSON)  # Confidence scores for various detections

    # Metadata
    analysis_version = Column(String(20), default="1.0")
    processing_time_seconds = Column(Float)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships - lazy="noload" to avoid circular import issues during standalone scripts
    # NOTE: Use import_xactimate_data_sql.py script for standalone imports (avoids circular dependency errors)
    photo_analysis = relationship("PhotoAnalysis", back_populates="packout_analysis", lazy="noload")
    company = relationship("Company", back_populates="packout_analyses", lazy="noload")

    __table_args__ = (
        Index('idx_packout_job', 'job_id', 'room_name'),
        Index('idx_packout_company', 'company_id', 'created_at'),
    )


class PackoutTemplate(Base):
    """Predefined packout templates for common scenarios"""
    __tablename__ = "packout_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, unique=True)
    description = Column(Text)
    room_type = Column(String(100))  # Kitchen, Bedroom, Office, etc.

    # Template specifications
    typical_items = Column(JSON)  # List of typical items with default quantities
    material_multipliers = Column(JSON)  # Multipliers for materials based on room size
    labor_multipliers = Column(JSON)  # Multipliers for labor based on complexity

    # Default Xactimate codes
    default_codes = Column(JSON)  # List of commonly used codes for this template

    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)