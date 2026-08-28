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
}

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
    # Reconnect includes all hookups: sink drain, P-trap,
    # disposal, DW drain/supply, faucet lines
    "plumbing_reconnect": 500,       # +11%
    # Sink (supply only — install included in reconnect)
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


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return DMV_ZIP3_MULTIPLIERS.get(zip_code[:3], 1.00)
