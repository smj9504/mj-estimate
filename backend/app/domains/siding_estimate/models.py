"""
Siding Estimate domain models
"""

from sqlalchemy import (
    Boolean,
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


class SidingEstimate(Base, BaseModel):
    """Siding estimate for a property"""
    __tablename__ = "siding_estimates"
    __table_args__ = (
        Index("ix_siding_estimates_claim_id", "claim_id"),
        Index("ix_siding_estimates_company_id", "company_id"),
        Index("ix_siding_estimates_status", "status"),
        {"extend_existing": True},
    )

    # Relationships
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

    # Status: draft / calculated / approved / exported
    status = Column(String(50), default="draft", nullable=False)

    # ── Project Meta ──
    property_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(5))
    zip_code = Column(String(10))
    building_type = Column(String(50))   # sfh / townhouse / condo / commercial
    year_built = Column(Integer)
    stories = Column(Integer, default=1)

    # ── EagleView Report Data ──
    eagleview_report_id = Column(String(50))
    eagleview_claim_id = Column(String(100))
    eagleview_data = Column(JSONB)        # Full parsed EV data (to_dict())

    # ── Measurements (from EV, user-editable) ──
    # Wall areas (SF)
    total_wall_area = Column(Float, default=0)
    total_wall_area_net = Column(Float, default=0)      # less penetrations
    total_siding_area = Column(Float, default=0)
    total_siding_area_net = Column(Float, default=0)    # KEY: siding less penetrations
    total_masonry_area = Column(Float, default=0)
    total_masonry_area_net = Column(Float, default=0)

    # Openings
    total_wall_facets = Column(Integer, default=0)
    total_windows_doors = Column(Integer, default=0)
    total_windows_doors_area = Column(Float, default=0)   # SF
    total_windows_doors_perimeter = Column(Float, default=0)  # LF (J-channel)

    # Fascia
    fascia_lf = Column(Float, default=0)

    # Corner lengths (LF)
    inside_corners_lf = Column(Float, default=0)
    outside_corners_lf = Column(Float, default=0)
    obtuse_inside_corners_lf = Column(Float, default=0)
    obtuse_outside_corners_lf = Column(Float, default=0)
    inside_siding_corners_lf = Column(Float, default=0)
    outside_siding_corners_lf = Column(Float, default=0)

    # Siding wall lengths (LF)
    top_siding_walls_lf = Column(Float, default=0)
    bottom_siding_walls_lf = Column(Float, default=0)

    # ── Siding Specs (JSONB) ──
    siding_spec = Column(JSONB)           # type, profile, brand, color, insulated
    trim_spec = Column(JSONB)             # window_trim, door_trim, corners, j_channel
    soffit_fascia_spec = Column(JSONB)    # replace_soffit, soffit_type, replace_fascia
    weather_barrier_spec = Column(JSONB)  # house_wrap, brand, rigid_insulation
    demo_spec = Column(JSONB)             # existing_type, layers, remove flags
    repair_spec = Column(JSONB)           # sheathing, fascia board, structural
    hidden_costs = Column(JSONB)          # dumpster, scaffolding, permits, etc.

    # ── Overview & O&P ──
    overview_text = Column(Text)
    include_overhead_profit = Column(Boolean, default=True)
    overhead_pct = Column(Float, default=10.0)
    profit_pct = Column(Float, default=10.0)

    # ── Target Total ──
    target_total = Column(Float, nullable=True)
    adjustment_factor = Column(Float, nullable=True)

    # ── Totals ──
    subtotal = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    total = Column(Float, default=0)

    # ── Documentation ──
    methodology_notes = Column(Text)
    warning_flags = Column(JSONB)
    notes = Column(Text)

    # ── Relationships ──
    line_items = relationship(
        "SidingEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="SidingEstimateLineItem.phase, SidingEstimateLineItem.display_order",
    )
    company = relationship("Company", foreign_keys=[company_id], lazy="select")
    claim = relationship("Claim", foreign_keys=[claim_id], lazy="select")


class SidingEstimateLineItem(Base, BaseModel):
    """Individual line item in a siding estimate"""
    __tablename__ = "siding_estimate_line_items"
    __table_args__ = (
        Index("ix_siding_li_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("siding_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Phase grouping
    phase = Column(Integer, default=1)    # 1-6

    # Item details
    description = Column(String(500), nullable=False)
    quantity = Column(Float, default=0)
    unit = Column(String(20), default="SF")  # SF, LF, EA, LS
    unit_price = Column(Float, default=0)
    total = Column(Float, default=0)         # quantity * unit_price

    # Categorization
    category = Column(String(100))           # labor, material, equipment
    notes = Column(Text)
    display_order = Column(Integer, default=0)

    # Relationship
    estimate = relationship("SidingEstimate", back_populates="line_items")
