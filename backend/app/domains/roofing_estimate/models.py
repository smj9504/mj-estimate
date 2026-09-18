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
    #   lead_rrp, hoa_review, satellite_removal,
    #   wet_debris }
    # wet_debris: tear-off expected to be waterlogged (rain, or cedar
    # that has been holding damp). Raises the estimated debris weight,
    # which is what sizes the dumpster — see dumpster.py.

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

    # ── Internal Material Cost (never exported to the customer) ──
    material_cost_overrides = Column(JSONB, nullable=True)
    # { <material key>: { unit_cost, taxable, note }, ... }
    # Only materials whose actual supplier price differs from the
    # default appear here; the rest fall back to material_cost.py.
    material_tax_rate = Column(Float, nullable=True)
    # null -> derive from state (MD/DC 6%, VA 5.3%)

    # How the billed roof area was stepped up to whole bundles, so the
    # quote can explain why 9.41 SQ is billed as 9.67.
    # { measured_squares, waste_pct, squares_with_waste,
    #   billed_squares, bundles }
    square_rounding = Column(JSONB, nullable=True)

    # ── Internal job cost (labor + disposal), never shown to customers ──
    #
    # What the job actually costs to run, so "예상 이익" means something.
    # Material cost alone counted the crew and the dumpster as profit.
    #
    # { labor_per_sq, tearoff_per_sq, crew_name, crew_note,
    #   disposal_method: "dumpster" | "truck",
    #   tipping_fee_per_ton, haul_trips, haul_cost_per_trip }
    #
    # Crew rates differ per crew and are entered per estimate; nothing is
    # assumed when this is empty — the analysis says what is missing
    # rather than reporting a profit that ignores labor.
    job_cost_inputs = Column(JSONB, nullable=True)

    # Share of each line item's installed price treated as material, for
    # markup and sales tax. Null -> per-category ratios in pricing.py;
    # a value here overrides every category for this estimate.
    material_portion_pct = Column(Float, nullable=True)

    # ── Calculated Totals ──
    roofing_subtotal = Column(Float, default=0)
    gutter_subtotal = Column(Float, default=0)
    subtotal = Column(Float, default=0)
    material_cost_total = Column(Float, default=0)
    labor_cost_total = Column(Float, default=0)
    markup_amount = Column(Float, default=0)
    overhead_amount = Column(Float, default=0)
    profit_amount = Column(Float, default=0)
    contingency_amount = Column(Float, default=0)
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
    # Material/labor split of `total`, used for markup and sales tax.
    material_portion = Column(Float, nullable=True)
    material_cost = Column(Float, nullable=True)
    labor_cost = Column(Float, nullable=True)
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


class RoofingMaterialPrice(Base, BaseModel):
    """Editable default supplier cost for one roofing material.

    Seeded from the constants in material_cost.py, then maintained from
    the UI as real supplier pricing changes. This is the *default* only:
    each estimate snapshots the costs in force when it was created, so
    editing a price here never rewrites the profit already recorded on
    past jobs.
    """
    __tablename__ = "roofing_material_prices"
    __table_args__ = (
        Index("ix_roof_mat_prices_company", "company_id"),
        Index("ix_roof_mat_prices_key", "material_key"),
        {"extend_existing": True},
    )

    # Matches the row key produced by material_cost.py (e.g. "shingle",
    # "underlayment"). Variant-bearing materials are suffixed with the
    # spec that selects them, e.g. "shingle:architectural_std".
    material_key = Column(String(100), nullable=False)
    label = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False)
    unit = Column(String(10), nullable=False)
    unit_cost = Column(Float, nullable=False, default=0)
    is_taxable = Column(Boolean, default=True)
    # Soft delete: a retired material stays here so estimates that were
    # priced with it keep resolving, it just leaves the pick lists.
    is_active = Column(Boolean, default=True)
    notes = Column(String(500), nullable=True)

    # ── What this material actually is ──
    # Grade alone ("architectural") does not price a roof: GAF Timberline
    # HDZ and CertainTeed Landmark Pro are both architectural and cost
    # different amounts, so the specific product is what gets quoted.
    manufacturer = Column(String(100), nullable=True)   # GAF, CertainTeed
    product_name = Column(String(200), nullable=True)   # "Timberline HDZ"
    color = Column(String(100), nullable=True)
    size_spec = Column(String(100), nullable=True)      # 'D-style 2"x2"'
    supplier = Column(String(150), nullable=True)       # ABC Supply
    sku = Column(String(100), nullable=True)            # supplier part no.
    # ── Quantity formula ──
    # Resolution order, most expressive first:
    #   1. qty_formula  — spreadsheet expression, e.g.
    #      "IF(valley_lf > 15, ROUNDUP(roof_area_waste*3.15),
    #          ROUNDUP(roof_area_waste*3))"
    #   2. qty_basis / coverage_per_unit / qty_minimum — the simple
    #      "measurement ÷ coverage, rounded up" rule
    #   3. the built-in packaging rule in material_cost.py
    qty_formula = Column(Text, nullable=True)
    qty_basis = Column(String(40), nullable=True)       # see material_basis
    coverage_per_unit = Column(Float, nullable=True)    # measured per pack
    coverage_unit = Column(String(10), nullable=True)   # SQ / LF / SF
    qty_minimum = Column(Float, nullable=True)          # floor, e.g. 2 tubes
    # Set when a user created this row rather than the seed catalog.
    is_custom = Column(Boolean, default=False)

    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
    )
    updated_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )


class RoofingPricingSetting(Base, BaseModel):
    """One editable number used by the estimate calculation.

    The companion to RoofingMaterialPrice, for everything that is NOT a
    supplier material cost: installed rates, pitch and story multipliers,
    waste factors, sales tax, permit fees, and the fallback material
    portions. Those all lived as constants in pricing.py, so changing one
    meant a code deploy.

    Rows are keyed by group + setting_key, matching the constant they
    override (e.g. group "shingle_rate", key "architectural_std" ->
    SHINGLE_RATES["architectural_std"]). A missing row falls through to
    the pricing.py constant, so this table only ever holds deliberate
    edits and an empty table changes nothing.

    Scope, most specific first:
      1. company_id = this company
      2. company_id = NULL (global default)
      3. the pricing.py constant

    Material costs are deliberately absent: those belong to the price
    book, which carries supplier, SKU and packaging that make no sense
    here.
    """
    __tablename__ = "roofing_pricing_settings"
    __table_args__ = (
        Index("ix_roof_pricing_company", "company_id"),
        Index("ix_roof_pricing_group", "setting_group"),
        {"extend_existing": True},
    )

    setting_group = Column(String(50), nullable=False)
    setting_key = Column(String(100), nullable=False)
    value = Column(Float, nullable=False)
    # Frozen copy of the pricing.py constant this row overrides, so the
    # screen can show "was 750, now 800" and offer a reset without
    # importing the module into the response.
    default_value = Column(Float, nullable=True)
    notes = Column(String(500), nullable=True)

    company_id = Column(
        UUIDType(),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
    )
    updated_by_id = Column(
        UUIDType(),
        ForeignKey("staff.id", ondelete="SET NULL"),
        nullable=True,
    )
