"""
Cabinet Estimate pricing constants for DMV area.
All rates are baseline values that get adjusted by material, finish, and labor multipliers.
"""

# Per-LF base rates by tier (supply only, before labor multiplier)
# Validated against real DMV contractor quotes (2025-2026)
BASE_RATES = {
    "Stock": {
        "base_lf": 180,      # $/LF for base cabinets (market $180-$280)
        "wall_lf": 150,      # $/LF for wall cabinets (market $140-$220)
        "tall_each": 480,    # $/EA for pantry cabinet (market $450-$650)
    },
    "Semi-Custom": {
        "base_lf": 310,      # market $280-$400
        "wall_lf": 275,      # market $240-$350
        "tall_each": 750,    # market $650-$900
    },
    "Custom": {
        "base_lf": 575,      # market $500-$700
        "wall_lf": 500,      # market $450-$600
        "tall_each": 1350,   # market $1200-$1600
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
        "Stock": 450,
        "Semi-Custom": 850,
        "Custom": 1600,
    },
    "refrigerator_cabinet": {
        "Stock": 380,
        "Semi-Custom": 750,
        "Custom": 1400,
    },
}

# Glass door upgrade premium (per door, added on top of standard door pricing)
GLASS_DOOR_PREMIUM = {
    "Stock": 75,        # tempered glass insert for stock doors
    "Semi-Custom": 150,  # mullion frame + tempered glass
    "Custom": 275,       # custom glass panel with detailed mullion
}

# Island end panel / back panel pricing (per SF, finished to match cabinets)
# Typical sizes: base end panel ~5.75 SF (24"x34.5"), tall ~14 SF (24"x84")
# Back panel varies by island length: e.g. 60"x34.5" = ~14.4 SF
ISLAND_PANEL_PRICING = {
    "end_panel_per_sf": {
        "Stock": 18,         # 3/4" matching laminate/veneer
        "Semi-Custom": 32,   # 3/4" plywood with finish match
        "Custom": 55,        # solid wood or premium veneer
    },
    "back_panel_per_sf": {
        "Stock": 15,
        "Semi-Custom": 28,
        "Custom": 48,
    },
    "install_per_sf": 8,     # labor per SF
}

# Prefab island pricing (EA, supply only — by size x tier)
# Based on market data: Home Depot, Lowe's, Wayfair (2025-2026)
PREFAB_ISLAND_PRICING = {
    "small": {   # ≤40" length
        "label": "Small (≤40\")",
        "Stock": 600,
        "Semi-Custom": 1200,
        "Custom": 2500,
    },
    "medium": {  # 41"-54"
        "label": "Medium (41\"-54\")",
        "Stock": 900,
        "Semi-Custom": 1800,
        "Custom": 3500,
    },
    "large": {   # 55"-72"
        "label": "Large (55\"-72\")",
        "Stock": 1400,
        "Semi-Custom": 2800,
        "Custom": 5000,
    },
    "xl": {      # 73"+
        "label": "X-Large (73\"+)",
        "Stock": 2000,
        "Semi-Custom": 3800,
        "Custom": 7000,
    },
}

PREFAB_ISLAND_INSTALL = {
    "small": 300,
    "medium": 350,
    "large": 400,
    "xl": 500,
}

# Crown molding for wall cabinets (per LF, material + install)
CROWN_MOLDING_PRICING = {
    "Stock": 12,         # basic MDF crown, per LF material
    "Semi-Custom": 22,   # solid wood crown, per LF material
    "Custom": 38,        # decorative multi-piece crown, per LF material
    "install_per_lf": 10,  # labor per LF (market $6-$12)
}

# Backsplash pricing (per SF, material + install)
BACKSPLASH_TYPES = {
    "ceramic_tile": {
        "label": "Ceramic Tile",
        "material_per_sf": 8,
        "install_per_sf": 12,
    },
    "subway_tile": {
        "label": "Subway Tile",
        "material_per_sf": 10,
        "install_per_sf": 14,
    },
    "glass_tile": {
        "label": "Glass Tile",
        "material_per_sf": 25,
        "install_per_sf": 18,
    },
    "stone_marble": {
        "label": "Stone / Marble",
        "material_per_sf": 35,
        "install_per_sf": 22,
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
    "demo_per_lf": 28,
    "demo_min": 400,
    "install_base_per_lf": 95,       # market $90-$150/LF
    "install_wall_per_lf": 80,       # market $75-$120/LF
    "install_tall_per_each": 175,    # market $145-$225/EA
    # Delivery: base fee + per-LF surcharge for larger kitchens
    "delivery_base": 150,
    "delivery_per_lf": 3,           # additional per total LF
    "delivery_min": 150,
    # Floor surcharge: $75/floor above ground level
    "delivery_floor_surcharge": 75,
    # Plumbing
    "plumbing_disconnect": 225,
    # Reconnect includes all hookups: sink drain, P-trap,
    # disposal, DW drain/supply, faucet lines
    "plumbing_reconnect": 450,
    # Sink (supply only — install included in reconnect)
    # Single 30": Kraus KHU100-30
    "sink_single_supply": 280,
    # Double 33": Kraus KHU102-33
    "sink_double_supply": 420,
    # Faucet: Moen/Delta pull-down (supply only)
    "faucet_supply": 210,
    # Garbage Disposal: InSinkErator 3/4HP (supply only)
    "disposal_supply": 165,
    # Countertop reset (market $400-$600)
    "countertop_reset": 550,
    # Toe kick (runs along base cabinets, market $3-$10/LF)
    "toe_kick_per_lf": 12,
    # Countertop supply+install (per SF, by material)
    "countertop_laminate_per_sf": 45,
    "countertop_granite_per_sf": 85,
    "countertop_quartz_per_sf": 95,
    "countertop_marble_per_sf": 120,
    "countertop_butcher_block_per_sf": 55,
    # Drywall - Patch & Repair (nail holes, screw holes, minor damage)
    "drywall_patch_per_sf": 2.50,
    # Drywall - R&R (remove & replace sheetrock behind cabinets)
    "drywall_rr_per_sf": 4.50,
    # Painting (prep + prime + paint)
    "paint_prep_per_sf": 2.50,
    "paint_primer_paint_per_sf": 3.95,
    # Backsplash misc materials (grout, thinset, tape)
    # Per SF instead of flat fee
    "backsplash_misc_per_sf": 4.50,
    # Appliance R&R — per-unit detach & reset costs
    # (disconnect, move out, move back, reconnect)
    # Dumpster / trash disposal (by size)
    "dumpster_10yard": 350,
    "dumpster_15yard": 425,
    "dumpster_20yard": 495,
    "dumpster_30yard": 595,
    # Site protection & cleanup: scale with kitchen size (total LF)
    "site_protection_base": 75,
    "site_protection_per_lf": 3,
    "cleanup_base": 75,
    "cleanup_per_lf": 3,
    # Cabinet hardware (knobs/pulls) — supply + install per opening
    "hardware_per_opening": 15,     # mid-grade knob/pull supply
    "hardware_install_per_opening": 8,
    # Electrical disconnect/reconnect (disposal, DW, under-cab light, range)
    "electrical_disconnect_reconnect": 325,  # market $200-$400
    # Permit allowance (Fairfax/DMV — plumbing+electrical work)
    "permit_allowance": 250,                 # market $150-$400
    # Outlet relocation (cabinet layout change often misaligns outlets)
    "outlet_relocation_each": 225,           # market $150-$300 per outlet
}

# Appliance detach & reset pricing (per unit)
# Reference: Xactimate RCV pricing (2025-2026)
APPLIANCE_RR_PRICING = {
    "dishwasher": {"label": "Dishwasher", "cost": 412},
    "refrigerator": {"label": "Refrigerator", "cost": 150},
    "range_gas": {"label": "Range (Gas) - Freestanding", "cost": 282},
    "range_electric": {"label": "Range (Electric) - Freestanding", "cost": 125},
    "range_gas_slide": {"label": "Range (Gas) - Slide-in", "cost": 282},
    "range_electric_slide": {"label": "Range (Electric) - Slide-in", "cost": 125},
    "range_dropin": {"label": "Range - Drop-in", "cost": 275},
    "cooktop_gas": {"label": "Cooktop (Gas)", "cost": 150},
    "cooktop_electric": {"label": "Cooktop (Electric)", "cost": 125},
    "wall_oven": {"label": "Wall Oven", "cost": 150},
    "microwave_otr": {"label": "Microwave (Over-the-Range)", "cost": 85},
    "hood_vent": {"label": "Range Hood", "cost": 185},
    "hood_wood_42": {"label": "Wood Range Hood (42\"+)", "cost": 478},
    "garbage_disposal": {"label": "Garbage Disposal", "cost": 282},
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
