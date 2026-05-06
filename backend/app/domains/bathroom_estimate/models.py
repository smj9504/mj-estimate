"""
Bathroom Remodel Estimate domain models
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


class BathroomEstimate(Base, BaseModel):
    """Bathroom remodel estimate for a claim"""
    __tablename__ = "bathroom_estimates"
    __table_args__ = (
        Index("ix_bathroom_estimates_claim_id", "claim_id"),
        Index("ix_bathroom_estimates_company_id", "company_id"),
        Index("ix_bathroom_estimates_status", "status"),
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

    # Status: draft / calculated / approved / exported
    status = Column(String(50), default="draft", nullable=False)

    # ── Project Meta ──
    property_address = Column(String(500))
    city = Column(String(100))
    state = Column(String(5))          # MD / VA / DC
    zip_code = Column(String(10))
    building_type = Column(String(50)) # sfh / townhouse / condo
    year_built = Column(Integer)       # pre-1978 → lead RRP flag

    # ── Bathroom Info ──
    designation = Column(String(50))   # master / hall / powder / three_quarter / jack_jill
    bath_function = Column(String(50)) # full / three_quarter / half
    length_ft = Column(Float)
    width_ft = Column(Float)
    height_ft = Column(Float, default=8.0)
    floor_sf = Column(Float)           # computed or manual
    wall_sf = Column(Float)            # computed (minus door/vanity/tub area)

    # ── Demo Scope Flags ──
    demo_scope = Column(String(50))    # full_gut / floor_only / walls_only / etc.
    demo_floor = Column(Boolean, default=False)
    demo_floor_sf = Column(Float, nullable=True)      # override: actual demo floor area
    demo_walls = Column(Boolean, default=False)
    demo_wall_sf = Column(Float, nullable=True)        # override: actual demo wall area
    demo_ceiling = Column(Boolean, default=False)
    demo_ceiling_sf = Column(Float, nullable=True)     # override: actual demo ceiling area
    replace_shower = Column(Boolean, default=False)
    replace_tub = Column(Boolean, default=False)
    replace_vanity = Column(Boolean, default=False)
    replace_toilet = Column(Boolean, default=False)
    replace_floor = Column(Boolean, default=False)
    water_damage = Column(Boolean, default=False)
    mold_suspected = Column(Boolean, default=False)
    existing_tub_material = Column(String(50))  # for cast iron surcharge

    # ── Shower Spec (JSONB for flexibility) ──
    shower_spec = Column(JSONB, nullable=True)
    # { type, size{w,d,h}, enclosure, niches, bench, showerhead_type,
    #   valve_replace, trim_brand, trim_grade, tile_spec{...} }

    # ── Bathtub Spec ──
    bathtub_spec = Column(JSONB, nullable=True)
    # { type, material, size{l,w}, drain_location, jetted, spout_type }

    # ── Vanity Spec ──
    vanity_spec = Column(JSONB, nullable=True)
    # { width, sinks, source, top_material, mounting, faucet_type, mirror_type }

    # ── Toilet Spec ──
    toilet_spec = Column(JSONB, nullable=True)
    # { type, bidet_seat, wax_ring, flange_repair }

    # ── Floor Spec ──
    floor_spec = Column(JSONB, nullable=True)
    # { material, size, pattern, heated_floor }

    # ── Walls/Paint Spec ──
    walls_spec = Column(JSONB, nullable=True)
    # { paint_grade, baseboard_material, colors }

    # ── Accessories ──
    accessories_spec = Column(JSONB, nullable=True)
    # { towel_bars, hand_towel_rings, tp_holders, robe_hooks,
    #   grab_bars, corner_shelves, finish, grade }

    # ── Plumbing Rough ──
    plumbing_spec = Column(JSONB, nullable=True)
    # { valve_replace_count, supply_line_count, drain_modification,
    #   pressure_balance_valve, rough_inspection }

    # ── Electrical ──
    electrical_spec = Column(JSONB, nullable=True)
    # { gfci_count, vanity_lights, ceiling_fixture, exhaust_fan_cfm,
    #   exhaust_fan_switch, heated_floor, inspection }

    # ── Substrate ──
    substrate_spec = Column(JSONB, nullable=True)
    # { durock_sf, greenboard_sf, waterproof_type, waterproof_sf,
    #   subfloor_repair, subfloor_repair_sf }

    # ── Hidden Costs Flags ──
    hidden_costs = Column(JSONB, nullable=True)
    # { dumpster, floor_protection, caulk, final_clean, punch_list,
    #   mobilization, drywall_patch, trim_paint, lead_rrp }

    # ── Overview note for PDF ──
    overview_text = Column(Text, nullable=True)

    # ── O&P (optional) ──
    include_overhead_profit = Column(Boolean, default=False)
    overhead_pct = Column(Float, default=0.10)
    profit_pct = Column(Float, default=0.10)

    # ── Calculated totals ──
    subtotal = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    total = Column(Float, default=0)

    # ── Documentation ──
    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    # Relationships
    claim_ref = relationship("Claim", back_populates="bathroom_estimates")
    line_items = relationship(
        "BathroomEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="BathroomEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "BathroomEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="BathroomEstimateHistory.version_number.desc()",
        lazy="select",
    )


class BathroomEstimateLineItem(Base, BaseModel):
    """Calculated line item in the estimate output"""
    __tablename__ = "bathroom_estimate_line_items"
    __table_args__ = (
        Index("ix_bath_line_items_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("bathroom_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    phase = Column(Integer, nullable=False)  # 1-7 matching the 7-phase structure
    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)  # SF, EA, LF, HR, LS
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    category = Column(String(50), nullable=True)
    # demo / plumbing / electrical / substrate / tile / fixture / finish / misc
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    # Relationship
    estimate = relationship(
        "BathroomEstimate", back_populates="line_items",
    )


class BathroomEstimateHistory(Base, BaseModel):
    """Version history snapshot for a bathroom estimate"""
    __tablename__ = "bathroom_estimate_history"
    __table_args__ = (
        Index("ix_bath_history_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("bathroom_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number = Column(Integer, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)
    changed_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )
    change_description = Column(String(500), nullable=True)

    # Relationship
    estimate = relationship("BathroomEstimate", back_populates="history")
