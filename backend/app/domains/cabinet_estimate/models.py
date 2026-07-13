"""
Cabinet Estimate domain models
"""

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class CabinetEstimate(Base, BaseModel):
    """Cabinet estimate for a claim"""
    __tablename__ = "cabinet_estimates"
    __table_args__ = (
        Index("ix_cabinet_estimates_claim_id", "claim_id"),
        Index("ix_cabinet_estimates_company_id", "company_id"),
        Index("ix_cabinet_estimates_status", "status"),
        {"extend_existing": True},
    )

    # Relationships to client system
    claim_id = Column(
        UUIDType(),
        ForeignKey("claims.id", ondelete="SET NULL"),
        nullable=True,
    )
    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Status
    status = Column(String(50), default="draft", nullable=False)
    # draft / calculated / approved / exported

    # Project info
    property_address = Column(String(500))
    zip_code = Column(String(10))

    # Kitchen layout
    layout_type = Column(String(50))
    kitchen_size_sqft = Column(Float)
    ceiling_height = Column(Float)
    has_soffit = Column(Boolean, default=False)

    # Specifications
    tier = Column(String(50))          # Stock / Semi-Custom / Custom
    box_material = Column(String(50))  # Plywood / MDF / Particle
    finish = Column(String(50))        # Painted / Stained / Glazed / Laminate
    door_style = Column(String(50))    # Shaker / Raised Panel / Slab / Glass

    # Scope of work flags
    include_demo = Column(Boolean, default=True)
    include_install = Column(Boolean, default=True)
    include_delivery = Column(Boolean, default=True)
    include_plumbing = Column(Boolean, default=False)
    sink_type = Column(String(20), default="single")  # single / double
    include_countertop_reset = Column(Boolean, default=False)
    include_hardware = Column(Boolean, default=True)

    # Additional scope flags
    include_crown_molding = Column(Boolean, default=False)
    include_backsplash = Column(Boolean, default=False)
    backsplash_type = Column(String(50), nullable=True)
    backsplash_sqft = Column(Float, nullable=True)
    include_toe_kick = Column(Boolean, default=True)
    include_countertop = Column(Boolean, default=False)
    include_drywall_repair = Column(Boolean, default=False)
    drywall_repair_type = Column(
        String(20), default="patch", nullable=True,
    )  # patch / rr
    drywall_repair_sqft = Column(Float, nullable=True)
    include_painting = Column(Boolean, default=False)
    painting_sqft = Column(Float, nullable=True)
    include_appliance_rr = Column(Boolean, default=False)
    appliance_list = Column(JSON, nullable=True)  # [{type, qty}]
    include_dumpster = Column(Boolean, default=True)
    include_electrical = Column(Boolean, default=False)
    include_permit = Column(Boolean, default=False)
    outlet_relocation_count = Column(Integer, default=0)
    delivery_floor = Column(
        Integer, default=1,
    )  # 1, 2, 3+

    # Island type: "custom" (LF-based) or "prefab" (EA-based)
    island_type = Column(
        String(20), default="custom", nullable=False,
    )
    # Prefab island fields
    island_prefab_size = Column(
        String(20), nullable=True,
    )  # small / medium / large / xl
    island_prefab_price = Column(
        Float, nullable=True,
    )  # user-overridable supply price

    # Island panels (SF = square feet) — custom build only
    island_end_panel_sqft = Column(Float, default=0)
    island_back_panel_sqft = Column(Float, default=0)

    # Countertop (perimeter)
    countertop_material = Column(String(100), nullable=True)
    countertop_sqft = Column(Float, nullable=True)
    # 4" countertop backsplash (matching piece)
    include_countertop_backsplash = Column(
        Boolean, default=False,
    )
    countertop_backsplash_lf = Column(
        Float, nullable=True,
    )

    # Island countertop
    island_countertop_material = Column(
        String(100), nullable=True,
    )
    island_countertop_sqft = Column(
        Float, nullable=True,
    )

    # Overview text for PDF
    overview_text = Column(Text, nullable=True)

    # Target total (reverse pricing)
    target_total = Column(Float, nullable=True)

    # Calculated totals
    subtotal = Column(Float, default=0)
    overhead_pct = Column(Float, default=0.10)
    overhead_amount = Column(Float, default=0)
    profit_pct = Column(Float, default=0.10)
    profit_amount = Column(Float, default=0)
    adjustment_factor = Column(Float, nullable=True)
    total = Column(Float, default=0)

    # Documentation
    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    # Relationships
    claim_ref = relationship("Claim", back_populates="cabinet_estimates")
    boxes = relationship(
        "CabinetBox",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetBox.display_order",
        lazy="selectin",
    )
    line_items = relationship(
        "CabinetEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "CabinetEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CabinetEstimateHistory.version_number.desc()",
        lazy="select",
    )


class CabinetBox(Base, BaseModel):
    """Individual cabinet box within an estimate"""
    __tablename__ = "cabinet_boxes"
    __table_args__ = (
        Index("ix_cabinet_boxes_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("cabinet_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    code = Column(String(20), nullable=False)        # "B30", "SB36", "BBC36"
    cab_type = Column(String(20), nullable=False)     # base / wall / tall / specialty
    location = Column(
        String(20), default="perimeter", nullable=False,
    )  # perimeter / island
    width_inches = Column(Integer, nullable=False)
    height_inches = Column(Float, nullable=False)
    is_specialty = Column(Boolean, default=False)
    specialty_type = Column(String(50), nullable=True)
    # sink_base / lazy_susan / blind_corner / drawer_base / diagonal_corner_wall
    # / oven_cabinet / refrigerator_cabinet
    has_glass_door = Column(Boolean, default=False)
    qty = Column(Integer, default=1, nullable=False)
    display_order = Column(Integer, default=0)

    # Relationship
    estimate = relationship("CabinetEstimate", back_populates="boxes")


class CabinetEstimateLineItem(Base, BaseModel):
    """Calculated line item in the estimate output"""
    __tablename__ = "cabinet_estimate_line_items"
    __table_args__ = (
        Index("ix_cabinet_line_items_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("cabinet_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)  # LF, EA, SF, HR
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    category = Column(
        String(50), nullable=True,
    )  # supply / labor / scope / premium
    location = Column(
        String(20), default="perimeter", nullable=False,
    )  # perimeter / island / shared
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    # Relationship
    estimate = relationship(
        "CabinetEstimate", back_populates="line_items",
    )


class CabinetEstimateHistory(Base, BaseModel):
    """Version history snapshot for an estimate"""
    __tablename__ = "cabinet_estimate_history"
    __table_args__ = (
        Index("ix_cabinet_history_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("cabinet_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number = Column(Integer, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)  # full estimate + boxes + line_items
    changed_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )
    change_description = Column(String(500), nullable=True)

    # Relationship
    estimate = relationship("CabinetEstimate", back_populates="history")
