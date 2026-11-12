"""
Flooring estimate domain models
"""

from sqlalchemy import Boolean, Column, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class FlooringEstimate(Base, BaseModel):
    """Flooring estimate for a claim, priced room by room from its sketch"""
    __tablename__ = "flooring_estimates"
    __table_args__ = (
        Index("ix_flooring_estimates_claim_id", "claim_id"),
        Index("ix_flooring_estimates_company_id", "company_id"),
        Index("ix_flooring_estimates_status", "status"),
        Index("ix_flooring_estimates_group_id", "group_id"),
        {"extend_existing": True},
    )

    # ── Estimate group ──
    # As on the bathroom and cabinet estimates: an insurance job is its
    # restoration (the estimate the carrier sees), a remodel job its
    # options. Each estimate starts a job of its own for now.
    group_id = Column(UUIDType(), nullable=True)
    project_type = Column(String(20), default="insurance", nullable=False)  # insurance / remodel
    kind = Column(String(20), default="restore", nullable=False)  # restore / option
    option_label = Column(String(100), nullable=True)
    option_order = Column(Integer, default=0, nullable=False)

    claim_id = Column(UUIDType(), ForeignKey("claims.id", ondelete="SET NULL"), nullable=True)
    company_id = Column(UUIDType(), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    # The prices it is priced with (unit_prices.PriceBook), pinned the first
    # time it is calculated
    price_book_id = Column(UUIDType(), ForeignKey("price_books.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)

    # draft / calculated / approved / exported
    status = Column(String(50), default="draft", nullable=False)

    # ── Project ──
    property_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(5))
    zip_code = Column(String(10))

    # ── Inputs ──
    # The rooms, in feet, interior wall to wall (geometry.py)
    sketch_data = Column(JSONB, nullable=True)
    # Per room id: the floors and what goes with them (calculator.py)
    room_scopes = Column(JSONB, nullable=True)
    # Defaults for every room, and the General items
    job_scope = Column(JSONB, nullable=True)

    overview_text = Column(Text, nullable=True)

    # ── O&P (optional, folded into the unit prices) ──
    include_overhead_profit = Column(Boolean, default=False)
    overhead_pct = Column(Float, default=0.10)
    profit_pct = Column(Float, default=0.10)

    # ── Calculated ──
    # The rooms as measured when it was last calculated, with their totals:
    # what the PDF prints next to each room's sketch
    calculated_rooms = Column(JSONB, nullable=True)
    subtotal = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    total = Column(Float, default=0)

    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    claim_ref = relationship("Claim", back_populates="flooring_estimates")
    line_items = relationship(
        "FlooringEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="FlooringEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "FlooringEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="FlooringEstimateHistory.version_number.desc()",
        lazy="select",
    )


class FlooringEstimateLineItem(Base, BaseModel):
    """A calculated line, under the room it is for (or General)"""
    __tablename__ = "flooring_estimate_line_items"
    __table_args__ = (
        Index("ix_flooring_line_items_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(UUIDType(), ForeignKey("flooring_estimates.id", ondelete="CASCADE"), nullable=False)

    # The sketch room it is for; NULL for the General section
    room_id = Column(String(64), nullable=True)
    room_name = Column(String(200), nullable=False)
    level_name = Column(String(100), nullable=True)
    # contents / detach_reset / removal / prep / install / trim / transition / stairs / general / custom
    category = Column(String(30), nullable=False)
    # The item it came from (items.py, or removal / install / pad), or a custom item's id
    item_key = Column(String(64), nullable=True)
    # auto (the room's own floor) / item (catalog) / custom
    source = Column(String(10), nullable=False, default="item")

    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    estimate = relationship("FlooringEstimate", back_populates="line_items")


class FlooringEstimateHistory(Base, BaseModel):
    """Version history snapshot for a flooring estimate"""
    __tablename__ = "flooring_estimate_history"
    __table_args__ = (
        Index("ix_flooring_history_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(UUIDType(), ForeignKey("flooring_estimates.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)
    changed_by_id = Column(UUIDType(), ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)
    change_description = Column(String(500), nullable=True)

    estimate = relationship("FlooringEstimate", back_populates="history")
