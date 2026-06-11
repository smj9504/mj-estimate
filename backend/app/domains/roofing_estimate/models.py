"""
Roofing Estimate domain models
Asphalt shingle roof replacement estimates for DMV area.
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


class RoofingEstimate(Base, BaseModel):
    """Asphalt roofing replacement estimate for a claim"""
    __tablename__ = "roofing_estimates"
    __table_args__ = (
        Index("ix_roofing_estimates_claim_id", "claim_id"),
        Index("ix_roofing_estimates_company_id", "company_id"),
        Index("ix_roofing_estimates_status", "status"),
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
    state = Column(String(5))           # MD / VA / DC
    zip_code = Column(String(10))
    building_type = Column(String(50))  # sfh / townhouse / multi
    year_built = Column(Integer)        # pre-1978 -> lead RRP flag
    stories = Column(Integer, default=1)  # 1, 2, 3
    hoa = Column(Boolean, default=False)
    roof_access = Column(String(50))    # easy / moderate / difficult

    # ── Roof Measurement ──
    measurement_source = Column(String(50))  # eagleview / manual / satellite
    total_sf = Column(Float, default=0)
    squares = Column(Float, default=0)       # total_sf / 100
    predominant_pitch = Column(String(10))   # e.g. "6/12"
    pitch_multiplier = Column(Float, default=1.0)
    ridge_lf = Column(Float, default=0)
    hip_lf = Column(Float, default=0)
    valley_lf = Column(Float, default=0)
    eave_lf = Column(Float, default=0)
    rake_lf = Column(Float, default=0)
    step_flashing_lf = Column(Float, default=0)
    penetration_count = Column(Integer, default=0)
    skylight_count = Column(Integer, default=0)
    chimney_count = Column(Integer, default=0)
    waste_factor = Column(Float, default=0.12)  # 10-20%
    roof_complexity = Column(String(50))  # simple_gable / hip / cut_up

    # ── EagleView Data ──
    eagleview_data = Column(JSONB, nullable=True)     # parsed full roof data
    selected_faces = Column(JSONB, nullable=True)     # selected face IDs for partial

    # ── Manual Multi-Structure ──
    manual_structures = Column(JSONB, nullable=True)  # list of manual structure measurements

    # ── Scope Flags ──
    full_tearoff = Column(Boolean, default=True)
    layer_count = Column(Integer, default=1)   # 1, 2, 3
    overlay = Column(Boolean, default=False)
    existing_material = Column(String(50))     # asphalt / cedar_shake
    insurance_job = Column(Boolean, default=False)

    # ── Component Specs (JSONB) ──
    shingle_spec = Column(JSONB, nullable=True)
    # { type, brand, product, color, warranty_years, rate_per_square }

    decking_spec = Column(JSONB, nullable=True)
    # { material, free_sheets_included, rate_per_sheet,
    #   estimated_sheets_needed, re_nail_existing, re_nail_sf }

    underlayment_spec = Column(JSONB, nullable=True)
    # { type, product, rate_per_sf }

    ice_water_spec = Column(JSONB, nullable=True)
    # { product, eaves_coverage_lf, eaves_width_ft,
    #   valley_coverage_lf, around_penetrations, rate_per_sf }

    drip_edge_spec = Column(JSONB, nullable=True)
    # { material, profile, color, rate_per_lf }

    ventilation_spec = Column(JSONB, nullable=True)
    # { ridge_vent, ridge_vent_lf, static_vents, exhaust_vents }

    flashing_spec = Column(JSONB, nullable=True)
    # { step_flashing_lf, apron_flashing, chimney_flashing,
    #   chimney_cricket[], pipe_boots, pipe_boot_type,
    #   skylight_flashing_kits }

    roof_penetrations = Column(JSONB, nullable=True)
    # [ { type, quantity, notes }, ... ]

    ridge_cap_spec = Column(JSONB, nullable=True)
    # { product, rate_per_lf }

    gutter_spec = Column(JSONB, nullable=True)
    # { included, scope, material, style, size, type, color,
    #   total_lf, downspout_count, downspout_lf, downspout_size,
    #   splash_blocks, gutter_guards, guard_type, guard_lf,
    #   remove_existing, remove_existing_lf }

    # ── Skylight Replacement (add-on quotes) ──
    skylight_replacements = Column(JSONB, nullable=True)
    # [ { type, quantity, location }, ... ]

    # ── Hidden Costs ──
    hidden_costs = Column(JSONB, nullable=True)
    # { dumpster, driveway_protection, landscape_protection,
    #   permit, magnetic_sweep, re_nail_decking,
    #   pipe_boots_replace, vent_cap_replace,
    #   lead_rrp, hoa_review, satellite_removal }

    # ── Insurance Info ──
    insurance_info = Column(JSONB, nullable=True)
    # { carrier, claim_number, adjuster_name, policy_type,
    #   o_and_p_approved, code_upgrade_rider, deductible,
    #   xactimate_provided }

    # ── Pricing Config ──
    pricing_method = Column(String(50), default="hybrid")  # per_square / line_item / hybrid
    material_markup_pct = Column(Float, default=0.25)
    labor_markup_pct = Column(Float, default=0.20)
    include_overhead_profit = Column(Boolean, default=False)
    overhead_pct = Column(Float, default=0.10)
    profit_pct = Column(Float, default=0.10)
    contingency_pct = Column(Float, default=0.05)

    # ── Target Total (reverse-engineer pricing) ──
    target_total = Column(Float, nullable=True)         # desired grand total
    adjustment_factor = Column(Float, nullable=True)    # multiplier applied to line items

    # ── Calculated Totals ──
    roofing_subtotal = Column(Float, default=0)
    gutter_subtotal = Column(Float, default=0)
    subtotal = Column(Float, default=0)
    markup_amount = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    permit_fee = Column(Float, default=0)
    total = Column(Float, default=0)

    # ── Add-on Quotes ──
    add_ons = Column(JSONB, nullable=True)
    # [ { description, quantity, unit, unit_price, total, category }, ... ]

    # ── Per-Structure Results ──
    structure_results = Column(JSONB, nullable=True)
    # [ { structure_index, label, included, subtotal, total, line_items: [...] }, ... ]

    # ── Warranty ──
    warranty_info = Column(JSONB, nullable=True)
    # { labor_warranty_years, material_warranty_source,
    #   material_warranty_text, labor_warranty_text,
    #   warranty_exclusions }

    # ── Documentation ──
    overview_text = Column(Text, nullable=True)
    methodology_notes = Column(Text, nullable=True)
    warning_flags = Column(JSONB, nullable=True, default=list)
    notes = Column(Text, nullable=True)

    # Relationships
    claim_ref = relationship("Claim", back_populates="roofing_estimates")
    line_items = relationship(
        "RoofingEstimateLineItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="RoofingEstimateLineItem.display_order",
        lazy="selectin",
    )
    history = relationship(
        "RoofingEstimateHistory",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="RoofingEstimateHistory.version_number.desc()",
        lazy="select",
    )


class RoofingEstimateLineItem(Base, BaseModel):
    """Calculated line item in the roofing estimate (8-phase structure)"""
    __tablename__ = "roofing_estimate_line_items"
    __table_args__ = (
        Index("ix_roof_line_items_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("roofing_estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    structure_index = Column(Integer, default=0)  # which structure (0=main, 1=shed, ...)
    phase = Column(Integer, nullable=False)  # 1-8 matching 8-phase structure
    description = Column(String(500), nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String(10), nullable=False)   # SQ, SF, LF, EA, LS
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    category = Column(String(50), nullable=True)
    # tearoff / decking / underlayment / ice_water / drip_edge /
    # shingle / ridge_cap / ventilation / flashing / gutter / misc
    xactimate_code = Column(String(20), nullable=True)
    notes = Column(String(500), nullable=True)
    display_order = Column(Integer, default=0)

    estimate = relationship("RoofingEstimate", back_populates="line_items")


class RoofingEstimateHistory(Base, BaseModel):
    """Version history snapshot for a roofing estimate"""
    __tablename__ = "roofing_estimate_history"
    __table_args__ = (
        Index("ix_roof_history_estimate_id", "estimate_id"),
        {"extend_existing": True},
    )

    estimate_id = Column(
        UUIDType(),
        ForeignKey("roofing_estimates.id", ondelete="CASCADE"),
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

    estimate = relationship("RoofingEstimate", back_populates="history")
