"""
Cabinet Estimate pricing constants for DMV area.
All rates are baseline values that get adjusted by material, finish, and labor multipliers.
"""

# Per-LF base rates by tier (supply only, before labor multiplier)
# Validated against real DMV contractor quotes (2025-2026)
# 2026-08 update: tiered increase reflecting Section 232 cabinet tariffs
# (25% on imports, effective 2025-10-14) plus manufacturer list-price
# increases (2.7%-5.5% avg, effective Feb-Mar 2026). Stock/RTA lines have
# the highest import exposure (Vietnam/China), Custom is mostly
# domestic-built and only sees lumber-tariff/labor pass-through.
# Stock +5%, Semi-Custom +3%, Custom +1%.
#
# 2026-08-26 follow-up increase (user feedback: base prices still low vs.
# market even after the 2026-08-25 tariff-exposure pass). Fresh research:
# Section 232 cabinet tariffs stable at 25% through 2026/2027 (planned
# escalation delayed — no new tariff spike). But DMV market comparison
# shows real gaps: Stock $284/LF already near top of $100-300 market
# range (small bump only); Semi-Custom $414/LF sits mid a wide $150-650
# range (meaningful room); Custom $676/LF sits low-mid its $500-1200+
# range (biggest gap, plus mild lumber-tariff pressure on domestic-built
# tier). Tier-differentiated: Stock +5-8%, Semi-Custom +12-16%,
# Custom +15-20%, applied across BASE_RATES/TALL_CABINET_TYPES/
# GLASS_DOOR_PREMIUM/island & prefab pricing/crown molding. Ancillary
# SCOPE_ITEMS/backsplash/appliance R&R (never adjusted before) get a
# flat +8-12% catch-up. Countertop pricing left untouched — already
# matches 2026 market ($50-150/SF quartz, $40-175/SF granite).
BASE_RATES = {
    "Stock": {
        "base_lf": 200,      # $/LF for base cabinets (market $180-$280), +6%
        "wall_lf": 166,      # $/LF for wall cabinets (market $140-$220), +5%
        "tall_each": 539,    # $/EA for pantry cabinet (market $450-$650), +7%
    },
    "Semi-Custom": {
        "base_lf": 364,      # market $280-$400, +14%
        "wall_lf": 320,      # market $240-$350, +13%
        "tall_each": 889,    # market $650-$900, +15%
    },
    "Custom": {
        "base_lf": 686,      # market $500-$700, +18%
        "wall_lf": 586,      # market $450-$600, +16%
        "tall_each": 1637,   # market $1200-$1600, +20%
    },
}

# Wall cabinet height multiplier (applied to wall_lf rate)
# 30"H is the baseline (1.0); shorter/taller scale proportionally
WALL_HEIGHT_MULTIPLIER = {
    "short": 0.55,        # 12"-27"H — above fridge/microwave
    "standard": 1.00,     # 30"H — baseline
    "tall": 1.15,         # 36"H — ~15% more material
    "extra_tall": 1.25,   # 42"H — 20-30% more material
}

# Tall cabinet size multipliers (applied to the per-EA tall supply rate).
# Tall cabinets are quoted per unit, but a 36"W pantry carries twice the
# material of an 18"W one, so the per-EA rate scales with the box size.
# Baseline is the common 24"W x 84"H unit (1.00). The curve is
# 0.4 + 0.6 x (size / baseline) — proportional to material, with a floor for
# the fixed cost every box carries (doors, hardware, top/bottom/back).
TALL_WIDTH_MULTIPLIER = {
    18: 0.85,
    24: 1.00,        # baseline
    30: 1.15,
    33: 1.22,
    36: 1.30,
}

TALL_HEIGHT_MULTIPLIER = {
    84: 1.00,        # baseline
    90: 1.05,
    96: 1.10,
}

# Stock cabinets are built on a 3" grid running 9"-48"; this lineup has been
# the industry standard since the 1950s and is consistent across manufacturers.
# Anything between those steps is a custom order or a factory modification.
STANDARD_WIDTHS = {9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48}

# Supply-cost multiplier for a box whose width is off the 3" grid.
# Market research puts the custom-width premium at 1.25-1.55x ("sticking to
# standard widths saves 20-35%"; modifications add 15-35% to the invoice).
# 1.6 is set from the user's field experience in this market, which runs
# higher than the published ranges - see the 2026-09-10 conversation.
# Applied to cabinet SUPPLY only: a non-standard box costs more to build, but
# hanging it takes the same crew time, so install/hardware are unaffected.
NON_STANDARD_WIDTH_MULTIPLIER = 1.6


def is_standard_width(width_inches: float) -> bool:
    """True when a box width sits on the standard 3" cabinet grid."""
    return width_inches in STANDARD_WIDTHS


# Sink sized off its base cabinet: the trade rule is sink = cabinet width
# minus ~3" for the rim, rails and clips. A 30" base therefore tops out at
# a 27" sink, and a 42" base takes 39-40" (40" workstation sinks are sold
# as "fits a standard 42-inch sink base"), NOT 36" - quoting 36" there
# under-sizes the sink by 3-4".
# Prices are supply-only and derived from the two figures this table was
# already calibrated on - $305 for a 30" single (Kraus KHU100-30) and $458
# for a 33" double (KHU102-33), which sit at ~76-81% of those models'
# retail ($399.95 / $564.95), i.e. a contractor-supply basis. The other
# widths are scaled from those two anchors on the same basis.
# A 42" CORNER sink base behaves like a 30" cabinet (~27" max), but the
# catalog has no corner sink base, so it is not represented here.
SINK_BY_BASE = {
    #  base:  (sink width, single $, double $)
    30: (27, 265, 395),
    33: (30, 305, 458),
    36: (33, 350, 520),
    42: (39, 430, 640),
}

# Base widths below the smallest entry fall back to the 30" row; anything
# wider than the largest falls back to the 42" row.
SINK_BASE_FALLBACK = (30, 42)


def sink_for_base(base_width: int) -> tuple:
    """Pick (sink_width, single_price, double_price) for a sink base.

    Snaps to the nearest listed base width rather than interpolating -
    sinks are sold in discrete sizes, so an odd base still takes a
    stock sink.
    """
    if not SINK_BY_BASE:
        return 30, 305, 458
    if base_width in SINK_BY_BASE:
        return SINK_BY_BASE[base_width]
    lo, hi = SINK_BASE_FALLBACK
    if base_width < lo:
        return SINK_BY_BASE[lo]
    if base_width > hi:
        return SINK_BY_BASE[hi]
    nearest = min(SINK_BY_BASE, key=lambda k: (abs(k - base_width), k))
    return SINK_BY_BASE[nearest]


# A double bowl needs roughly 30" of sink to be usable; below that the two
# bowls are too narrow to be practical. Warn, never block - the user may
# have a specific model in mind.
DOUBLE_BOWL_MIN_SINK_WIDTH = 30


# Width each TALL_CABINET_TYPES price is calibrated for. Appliance cabinets are
# wide by nature, so their size scaling is applied relative to this rather than
# to the 24" generic baseline - a cabinet at its typical width keeps the quoted
# price instead of picking up a second width premium.
TALL_TYPE_BASE_WIDTH = {
    "oven_cabinet": 33,
    "refrigerator_cabinet": 36,
}

# Material multiplier (applied to cabinet supply cost)
MATERIAL_MULTIPLIER = {
    "Plywood": 1.00,
    "MDF": 0.85,
    "Particle": 0.75,
}

# Finish multiplier
FINISH_MULTIPLIER = {
    "Stained": 1.00,
    "Painted": 1.10,
    "Glazed": 1.25,
    "Laminate": 0.85,
}

# Specialty cabinet premiums (flat $ per box, on top of LF pricing)
SPECIALTY_PREMIUM = {
    "sink_base": 0,           # same construction as regular base
    "lazy_susan": {33: 100, 36: 120},  # by width_inches
    "blind_corner": {36: 40, 39: 50, 42: 60, 45: 70},  # by width_inches
    "drawer_base": {12: 60, 15: 65, 18: 70, 21: 75, 24: 85, 27: 90, 30: 100, 36: 120},
    "diagonal_corner_wall": {24: 100, 27: 120},  # by width_inches
    "oven_cabinet": 0,       # priced via TALL_CABINET_TYPES
    "refrigerator_cabinet": 0,  # priced via TALL_CABINET_TYPES
    # Range bases. A slide-in needs finished end panels on the cabinets
    # flanking the range opening, so its premium is per-panel rather than
    # flat - see RANGE_END_PANEL_EACH and the range_panel_count box field.
    # A drop-in needs the cabinet itself built/cut to carry the unit, which
    # is a one-off carpentry cost that does not scale with panel count.
    "range_base_slide_in": 0,   # priced via RANGE_END_PANEL_EACH x panels
    "range_base_drop_in": 420,  # custom cabinet build + cutout
}

# Finished end panel for a slide-in range opening, per panel.
# Market: Hampton Bay BEP1.5 (24"W x 34.5"H base end panel) $75-$105
# depending on finish; $95 sits mid-range and covers install handling.
# A typical opening is flanked on both sides (2 panels); an opening at a
# wall end exposes only one.
RANGE_END_PANEL_EACH = 95

# Tall cabinet type-specific pricing (replaces generic tall_each when specified)
# These are per-EA prices by tier, reflecting actual appliance cabinet costs
TALL_CABINET_TYPES = {
    "oven_cabinet": {
        "Stock": 477,        # +6%
        "Semi-Custom": 969,  # +14%
        "Custom": 1888,      # +18%
    },
    "refrigerator_cabinet": {
        "Stock": 407,        # +7%
        "Semi-Custom": 862,  # +15%
        "Custom": 1666,      # +19%
    },
}

# Glass door upgrade premium (per door, added on top of standard door pricing)
GLASS_DOOR_PREMIUM = {
    "Stock": 80,         # tempered glass insert for stock doors, +6%
    "Semi-Custom": 171,  # mullion frame + tempered glass, +14%
    "Custom": 322,        # custom glass panel with detailed mullion, +17%
}

# Island end panel / back panel pricing (per SF, finished to match cabinets)
# Typical sizes: base end panel ~5.75 SF (24"x34.5"), tall ~14 SF (24"x84")
# Back panel varies by island length: e.g. 60"x34.5" = ~14.4 SF
ISLAND_PANEL_PRICING = {
    "end_panel_per_sf": {
        "Stock": 19,         # 3/4" matching laminate/veneer, +6%
        "Semi-Custom": 36,   # 3/4" plywood with finish match, +14%
        "Custom": 65,        # solid wood or premium veneer, +18%
    },
    "back_panel_per_sf": {
        "Stock": 16,         # +7%
        "Semi-Custom": 32,   # +13%
        "Custom": 56,        # +16%
    },
    "install_per_sf": 9,     # labor per SF, +10%
}

# Prefab island pricing (EA, supply only — by size x tier)
# Based on market data: Home Depot, Lowe's, Wayfair (2025-2026)
PREFAB_ISLAND_PRICING = {
    "small": {   # ≤40" length
        "label": "Small (≤40\")",
        "Stock": 636,         # +6%
        "Semi-Custom": 1368,  # +14%
        "Custom": 2950,       # +18%
    },
    "medium": {  # 41"-54"
        "label": "Medium (41\"-54\")",
        "Stock": 963,         # +7%
        "Semi-Custom": 2070,  # +15%
        "Custom": 4165,       # +19%
    },
    "large": {   # 55"-72"
        "label": "Large (55\"-72\")",
        "Stock": 1484,        # +6%
        "Semi-Custom": 3164,  # +13%
        "Custom": 5850,       # +17%
    },
    "xl": {      # 73"+
        "label": "X-Large (73\"+)",
        "Stock": 2160,        # +8%
        "Semi-Custom": 4408,  # +16%
        "Custom": 8400,       # +20%
    },
}

PREFAB_ISLAND_INSTALL = {
    "small": 324,   # +8%
    "medium": 385,  # +10%
    "large": 436,   # +9%
    "xl": 560,      # +12%
}

# Crown molding for wall cabinets (per LF, material + install)
CROWN_MOLDING_PRICING = {
    "Stock": 13,         # basic MDF crown, per LF material, +8%
    "Semi-Custom": 25,   # solid wood crown, per LF material, +14%
    "Custom": 45,        # decorative multi-piece crown, per LF material, +18%
    "install_per_lf": 11,  # labor per LF (market $6-$12), +10%
}

# Backsplash pricing (per SF, material + install)
BACKSPLASH_TYPES = {
    "ceramic_tile": {
        "label": "Ceramic Tile",
        "material_per_sf": 9,    # +9%
        "install_per_sf": 13,    # +10%
    },
    "subway_tile": {
        "label": "Subway Tile",
        "material_per_sf": 11,   # +9%
        "install_per_sf": 15,    # +10%
    },
    "glass_tile": {
        "label": "Glass Tile",
        "material_per_sf": 28,   # +10%
        "install_per_sf": 19,    # +8%
    },
    "stone_marble": {
        "label": "Stone / Marble",
        "material_per_sf": 39,   # +11%
        "install_per_sf": 24,    # +9%
    },
}

# Zip3-based labor multipliers for DMV area
DMV_ZIP3_MULTIPLIERS = {
    # DC
    "200": 1.05,
    "202": 1.00,
    # Maryland
    "206": 1.00,
    "207": 0.95,
    "208": 1.05,  # Montgomery County (Bethesda etc.)
    "209": 1.00,
    "210": 0.95,
    "211": 0.95,
    "212": 0.95,
    "216": 0.95,
    # Northern Virginia
    "220": 1.00,
    "221": 1.05,  # Fairfax, Arlington (McLean etc.)
    "222": 1.00,
    "223": 1.00,
}

# Premium zip code overrides (Bethesda, McLean, Great Falls, Georgetown etc.)
PREMIUM_ZIP_OVERRIDES = {
    "20815", "20816", "20817", "20854",  # Bethesda/Potomac
    "22101", "22102", "22066",           # McLean/Great Falls
    "20007", "20008", "20015",           # Georgetown/NW DC
}

# Scope items (labor and ancillary charges)
SCOPE_ITEMS = {
    "demo_per_lf": 31,               # +9%
    "demo_min": 440,                 # +10%
    # Install labor — tier-keyed (2026-08-26): custom installs take
    # meaningfully more skilled labor time than stock RTA installs.
    # Stock anchored to the prior flat value (+5-8%), Semi-Custom/Custom
    # scaled up from the new Stock value (+20-30% / +45-60%) to reflect
    # real labor-hour differences, not just a market-comparison nudge.
    "install_base_per_lf": {         # market $90-$150/LF
        "Stock": 100,
        "Semi-Custom": 125,
        "Custom": 150,
    },
    "install_wall_per_lf": {         # market $75-$120/LF
        "Stock": 86,
        "Semi-Custom": 105,
        "Custom": 131,
    },
    "install_tall_per_each": {       # market $145-$225/EA
        "Stock": 189,
        "Semi-Custom": 242,
        "Custom": 299,
    },
    # Delivery: base fee + per-LF surcharge for larger kitchens
    "delivery_base": 162,            # +8%
    "delivery_per_lf": 3.3,          # additional per total LF, +10%
    "delivery_min": 162,             # +8%
    # Floor surcharge: $75/floor above ground level
    "delivery_floor_surcharge": 82,  # +9%
    # Plumbing
    "plumbing_disconnect": 248,      # +10%
    # Reconnect = trip/setup + the core sink hookup (drain + supply).
    # Market: a simple drop-in reconnect at the same hole/drain runs
    # $150-$250, and the minimum service fee ($100-$175) already covers
    # 1-2 hours. Everything else that happens under that same sink is
    # itemized below at MARGINAL labor - the crew is already on site, so
    # a part is not re-charged the standalone installed rate (a P-trap is
    # $313-$393 installed alone but only $25-$65 in parts).
    # Was a $500 catch-all covering P-trap/disposal/DW/faucet; those are
    # now their own lines, so this was re-based to avoid double-charging.
    "plumbing_reconnect": 225,
    # Each sink beyond the first. The trip is already paid on the first
    # one, so this is the hookup alone: a simple reconnect at an existing
    # hole/drain is $150-$250 all-in, less the trip portion it no longer
    # carries. (The $400-$1,500 island rough-in figures do NOT apply -
    # that is running new supply/drain to a new fixture location, not
    # reconnecting plumbing that is already there.)
    "plumbing_reconnect_additional_sink": 110,
    # ── Under-sink components (material + marginal labor, 1 sink) ──
    # No published figure exists for marginal add-on labor, so it is
    # derived: residential plumbers run $80-$130/hr, and these parts take
    # 15-25 min each for a crew already under the sink -> ~$25-$45.
    "p_trap_assembly": 80,           # $45 part + $35 labor; 1 per sink
    "supply_line_each": 43,          # $18 braided riser + $25; 2 per sink
    "angle_stop_each": 65,           # $25 valve + $40; 2 per sink
    "aav_vent": 80,                  # $35 AAV + $45; when vented that way
    "air_gap": 62,                   # $22 fitting + $40 (market $80-$150)
    "soap_dispenser": 65,            # $30 + $35 (market $25-$50 install)
    # Instant hot: unit $286-$1,178 (mid ~$340); install is a 2-3 hr job
    # at $45-$200/hr, so ~$200 at a mid-market rate.
    "instant_hot_dispenser": 540,    # $340 unit + $200 labor
    # DW hookup parts. The dishwasher's own detach/reset is NOT here -
    # it lives in APPLIANCE_RR_PRICING["dishwasher"], and so does the
    # disposer, so plumbing must not re-charge either one.
    "dw_supply_line": 43,            # $18 line + $25
    "dw_angle_stop": 65,             # $25 valve + $40
    # Sink (supply only — install included in reconnect).
    # Kept as the 30" single / 33" double baseline for compatibility;
    # the actual sink is sized off the sink base width via SINK_BY_BASE.
    # Single 30": Kraus KHU100-30
    "sink_single_supply": 305,       # +9%
    # Double 33": Kraus KHU102-33
    "sink_double_supply": 458,       # +9%
    # Faucet: Moen/Delta pull-down (supply only)
    "faucet_supply": 231,            # +10%
    # Garbage Disposal: InSinkErator 3/4HP (supply only)
    "disposal_supply": 178,          # +8%
    # Countertop reset (market $400-$600)
    "countertop_reset": 610,         # +11%
    # Toe kick (runs along base cabinets, market $3-$10/LF)
    "toe_kick_per_lf": 13,           # +10%
    # Countertop supply+install rates live in COUNTERTOP_MATERIALS,
    # the only table the calculator reads - do not duplicate them here.
    # Drywall - Patch & Repair (nail holes, screw holes, minor damage)
    "drywall_patch_per_sf": 2.75,    # +10%
    # Drywall - R&R (remove & replace sheetrock behind cabinets)
    "drywall_rr_per_sf": 5.00,       # +11%
    # Painting (prep + prime + paint)
    "paint_prep_per_sf": 2.73,       # +9%
    "paint_primer_paint_per_sf": 4.35,  # +10%
    # Backsplash misc materials (grout, thinset, tape)
    # Per SF instead of flat fee
    "backsplash_misc_per_sf": 4.91,  # +9%
    # Appliance detach & reset costs live in APPLIANCE_RR_PRICING.
    # Dumpster / trash disposal (by size)
    "dumpster_10yard": 382,          # +9%
    "dumpster_15yard": 468,          # +10%
    "dumpster_20yard": 544,          # +10%
    "dumpster_30yard": 660,          # +11%
    # Site protection & cleanup: scale with kitchen size (total LF)
    "site_protection_base": 82,      # +9%
    "site_protection_per_lf": 3.3,   # +10%
    "cleanup_base": 82,              # +9%
    "cleanup_per_lf": 3.3,           # +10%
    # Cabinet hardware (knobs/pulls) — supply + install per opening
    "hardware_per_opening": 16,      # mid-grade knob/pull supply, +7%
    "hardware_install_per_opening": 9,  # +12%
    # Electrical disconnect/reconnect (disposal, DW, under-cab light, range)
    "electrical_disconnect_reconnect": 358,  # market $200-$400, +10%
    # Permit allowance (Fairfax/DMV — plumbing+electrical work)
    "permit_allowance": 270,                 # market $150-$400, +8%
    # Outlet relocation (cabinet layout change often misaligns outlets)
    "outlet_relocation_each": 245,           # market $150-$300 per outlet, +9%
}

# Appliance detach & reset pricing (per unit)
# Reference: Xactimate RCV pricing (2025-2026)
APPLIANCE_RR_PRICING = {
    "dishwasher": {"label": "Dishwasher", "cost": 449},
    "refrigerator": {"label": "Refrigerator", "cost": 165},
    "range_gas": {"label": "Range (Gas) - Freestanding", "cost": 307},
    "range_electric": {"label": "Range (Electric) - Freestanding", "cost": 138},
    "range_gas_slide": {"label": "Range (Gas) - Slide-in", "cost": 305},
    "range_electric_slide": {"label": "Range (Electric) - Slide-in", "cost": 139},
    "range_dropin": {"label": "Range - Drop-in", "cost": 300},
    "cooktop_gas": {"label": "Cooktop (Gas)", "cost": 165},
    "cooktop_electric": {"label": "Cooktop (Electric)", "cost": 136},
    "wall_oven": {"label": "Wall Oven", "cost": 167},
    "microwave_otr": {"label": "Microwave (Over-the-Range)", "cost": 94},
    "hood_vent": {"label": "Range Hood", "cost": 202},
    "hood_wood_42": {"label": "Wood Range Hood (42\"+)", "cost": 526},
    "garbage_disposal": {"label": "Garbage Disposal", "cost": 305},
}

# ── Material / labor split ──
# Share of a line item that is NON-LABOR cost - material, equipment, and hard
# fees. The remainder is crew time. Lines whose rate table already separates
# supply from install (hardware, crown molding, island panels, backsplash,
# plumbing) derive their own share from the real components and ignore this
# table; the values here are for rates quoted as a single supply-and-install
# number, so they are working assumptions. Adjust them here if they do not
# match how you bid - nothing else needs to change.
MATERIAL_SHARE = {
    "cabinet_supply": 1.00,      # boxes, doors, panels, prefab island
    "cabinet_install": 0.00,     # install labor only
    "demo": 0.00,
    "dumpster": 1.00,            # haul-off/disposal fee, no crew time in it
    "delivery": 0.00,            # freight/handling, billed as labor time
    "toe_kick": 0.35,            # trim stock vs. cut, fit and paint
    "countertop": 0.55,          # slab + fabrication vs. template and install
    "countertop_reset": 0.00,
    "drywall_patch": 0.20,       # compound and tape vs. labor
    "drywall_rr": 0.30,          # sheetrock + compound vs. labor
    "paint_prep": 0.15,
    "paint_finish": 0.30,        # primer and paint vs. labor
    "site_protection": 0.40,     # ram board, plastic, tape vs. labor
    "cleanup": 0.05,
    "appliance_rr": 0.00,        # detach and reset is crew time
    "electrical": 0.20,
    "outlet_relocation": 0.25,
    "permit": 1.00,              # a fee, not crew time
}

# Default O&P percentages (mixed material+labor project standard: 25-35%)
DEFAULT_OVERHEAD_PCT = 0.15
DEFAULT_PROFIT_PCT = 0.15

# Layout type options
LAYOUT_TYPES = [
    "L-shape",
    "U-shape",
    "Galley",
    "Single Wall",
    "Island",
    "Peninsula",
    "Other",
]

# Door style options
DOOR_STYLES = [
    "Shaker",
    "Raised Panel",
    "Slab",
    "Glass",
]

# Backsplash type labels for frontend dropdown
BACKSPLASH_TYPE_OPTIONS = list(BACKSPLASH_TYPES.keys())

# Countertop material options with per-SF installed rates (DMV mid-range)
# Sources: TruVine Renovations, GraniteASAP, Angi (2025-2026)
COUNTERTOP_MATERIALS = {
    "Laminate": {"rate": 35, "label": "Laminate"},
    "Solid Surface": {"rate": 95, "label": "Solid Surface (Corian)"},
    "Butcher Block": {"rate": 70, "label": "Butcher Block"},
    "Granite": {"rate": 95, "label": "Granite"},
    "Quartz": {"rate": 110, "label": "Quartz"},
    "Quartzite": {"rate": 130, "label": "Quartzite"},
    "Marble": {"rate": 160, "label": "Marble"},
}

# 4" countertop backsplash (matching piece, per LF installed)
# Cut from same material as countertop, silicone adhesive
COUNTERTOP_BACKSPLASH_PER_LF = {
    "Laminate": 12,
    "Solid Surface": 22,
    "Butcher Block": 18,
    "Granite": 28,
    "Quartz": 32,
    "Quartzite": 38,
    "Marble": 45,
}

# Default overview text for PDF
DEFAULT_OVERVIEW = (
    "All cabinets will feature matching industrial-grade "
    "cabinet board surfaces on exposed fronts and sides, "
    "wall cabinet tops and bottoms (in most cases), "
    "toe-kick boards, and cabinet interiors. Unless "
    "otherwise specified, new drawer boxes will be "
    "provided with soft-closing undermount drawer tracks "
    "and hinges."
)


def size_tier_value(table: dict, size: float) -> tuple:
    """Look up a size-keyed price/multiplier table.

    Returns (value, matched_size). matched_size is None on an exact hit;
    otherwise it is the nearest size actually present, so the caller can warn
    that the quote is an approximation. Falling back to the nearest tier keeps
    an odd size close to its real cost - taking the table maximum, as this
    used to, overcharged every size below the largest one.
    """
    if not table:
        return 0, None
    if size in table:
        return table[size], None
    # On an exact tie, round up to the larger size rather than under-quote.
    nearest = min(table, key=lambda k: (abs(k - size), -k))
    return table[nearest], nearest


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return DMV_ZIP3_MULTIPLIERS.get(zip_code[:3], 1.00)
