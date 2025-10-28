"""
Reconstruction Estimate domain models
"""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, Index, DECIMAL, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database_factory import Base
from app.core.base_models import BaseModel
from app.core.database_types import UUIDType
import enum


class MoistureLevel(enum.Enum):
    """Moisture condition levels for construction debris"""
    DRY = "dry"
    DAMP = "damp"
    WET = "wet"
    SATURATED = "saturated"


class UnitType(enum.Enum):
    """Measurement unit types"""
    SF = "SF"  # Square Feet
    LF = "LF"  # Linear Feet
    EA = "EA"  # Each


class MaterialCategory(Base, BaseModel):
    """Material categories for organizing materials"""
    __tablename__ = "material_categories"
    __table_args__ = (
        Index('ix_material_categories_active', 'active'),
        {'extend_existing': True}
    )

    category_name = Column(String(100), nullable=False, unique=True)
    display_order = Column(Integer, default=0)
    active = Column(Boolean, default=True, nullable=False)
    description = Column(Text)

    # Relationships
    materials = relationship("MaterialWeight", back_populates="category", cascade="all, delete-orphan")


class MaterialWeight(Base, BaseModel):
    """Material weight reference database"""
    __tablename__ = "material_weights"
    __table_args__ = (
        Index('ix_material_weights_type', 'material_type'),
        Index('ix_material_weights_category', 'category_id'),
        Index('ix_material_weights_active', 'active'),
        {'extend_existing': True}
    )

    # Basic information
    material_type = Column(String(100), nullable=False, unique=True, index=True)
    category_id = Column(UUIDType(), ForeignKey("material_categories.id"), nullable=False)
    description = Column(Text)

    # Weight properties
    dry_weight_per_unit = Column(DECIMAL(10, 2), nullable=False)
    unit = Column(SQLEnum(UnitType), nullable=False)

    # Moisture multipliers
    damp_multiplier = Column(DECIMAL(5, 2), default=1.2)
    wet_multiplier = Column(DECIMAL(5, 2), default=1.5)
    saturated_multiplier = Column(DECIMAL(5, 2), default=2.0)

    # Status
    active = Column(Boolean, default=True, nullable=False)

    # Audit fields
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"))
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    category = relationship("MaterialCategory", back_populates="materials")
    debris_items = relationship("DebrisItem", back_populates="material")


class DebrisCalculation(Base, BaseModel):
    """Debris calculation record"""
    __tablename__ = "debris_calculations"
    __table_args__ = (
        Index('ix_debris_calculations_user', 'created_by_id'),
        Index('ix_debris_calculations_date', 'created_at'),
        {'extend_existing': True}
    )

    # Calculation metadata
    calculation_name = Column(String(255))
    project_address = Column(String(500))
    notes = Column(Text)

    # Results (stored for quick access)
    total_weight_lb = Column(DECIMAL(12, 2))
    total_weight_ton = Column(DECIMAL(10, 4))
    category_breakdown = Column(JSONB)  # {category_name: weight_in_tons}
    dumpster_recommendation = Column(JSONB)  # {size, capacity, count}

    # Audit
    created_by_id = Column(UUIDType(), ForeignKey("staff.id"), nullable=False)
    updated_by_id = Column(UUIDType(), ForeignKey("staff.id"))

    # Relationships
    items = relationship("DebrisItem", back_populates="calculation", cascade="all, delete-orphan")


class DebrisItem(Base, BaseModel):
    """Individual debris item in a calculation"""
    __tablename__ = "debris_items"
    __table_args__ = (
        Index('ix_debris_items_calculation', 'calculation_id'),
        Index('ix_debris_items_material', 'material_id'),
        {'extend_existing': True}
    )

    # Parent calculation
    calculation_id = Column(UUIDType(), ForeignKey("debris_calculations.id"), nullable=False)

    # Material reference
    material_id = Column(UUIDType(), ForeignKey("material_weights.id"), nullable=False)
    material_type = Column(String(100), nullable=False)  # Denormalized for historical data

    # Input values
    quantity = Column(DECIMAL(10, 2), nullable=False)
    unit = Column(SQLEnum(UnitType), nullable=False)
    moisture_level = Column(SQLEnum(MoistureLevel), nullable=False, default=MoistureLevel.DRY)

    # Calculated values
    unit_weight_lb = Column(DECIMAL(10, 2))
    moisture_multiplier = Column(DECIMAL(5, 2))
    total_weight_lb = Column(DECIMAL(12, 2))
    total_weight_ton = Column(DECIMAL(10, 4))

    # Optional metadata
    description = Column(Text)

    # Relationships
    calculation = relationship("DebrisCalculation", back_populates="items")
    material = relationship("MaterialWeight", back_populates="debris_items")
