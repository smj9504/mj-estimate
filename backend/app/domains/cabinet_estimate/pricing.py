"""
Cabinet Estimate pricing constants for DMV area.
All rates are baseline values that get adjusted by material, finish, and labor multipliers.
"""

# Per-LF base rates by tier (supply only, before labor multiplier)
# Validated against real DMV contractor quotes (2025-2026)
BASE_RATES = {
    "Stock": {
        "base_lf": 120,      # $/LF for base cabinets
        "wall_lf": 95,       # $/LF for wall cabinets
        "tall_each": 350,    # $/EA for pantry cabinet
    },
    "Semi-Custom": {
        "base_lf": 260,
        "wall_lf": 240,
        "tall_each": 650,
    },
    "Custom": {
        "base_lf": 525,
        "wall_lf": 450,
        "tall_each": 1200,
    },
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
    "sink_base": 0,
    "lazy_susan": 120,
    "blind_corner": 60,
    "drawer_base": 85,
    "diagonal_corner_wall": 100,
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

# Crown molding for wall cabinets (per LF, material + install)
CROWN_MOLDING_PRICING = {
    "Stock": 12,         # basic MDF crown, per LF material
    "Semi-Custom": 22,   # solid wood crown, per LF material
    "Custom": 38,        # decorative multi-piece crown, per LF material
    "install_per_lf": 15,  # installation labor per LF
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
    "install_base_per_lf": 75,
    "install_wall_per_lf": 60,
    "install_tall_per_each": 145,
    # Delivery: base fee + per-LF surcharge for larger kitchens
    "delivery_base": 150,
    "delivery_per_lf": 3,           # additional per total LF
    "delivery_min": 150,
    # Plumbing
    "plumbing_disconnect": 225,
    "plumbing_reconnect": 450,      # reconnect (sink, DW, disposal)
    # Countertop
    "countertop_reset": 775,
    # Toe kick (runs along base cabinets)
    "toe_kick_per_lf": 21,
    # Countertop supply+install (per SF, by material)
    "countertop_laminate_per_sf": 45,
    "countertop_granite_per_sf": 85,
    "countertop_quartz_per_sf": 95,
    "countertop_marble_per_sf": 120,
    "countertop_butcher_block_per_sf": 55,
    # Drywall repair (behind cabinets)
    "drywall_rr_per_sf": 4.50,
    # Painting (prep + prime + paint)
    "paint_prep_per_sf": 2.50,
    "paint_primer_paint_per_sf": 3.95,
    # Backsplash misc materials (grout, tape, etc.)
    "backsplash_misc_materials": 155,
    # Appliance R&R (disconnect + reconnect cooktop, DW,
    # disposal, oven, fridge)
    "appliance_rr": 725,
    # Dumpster / trash disposal (by size)
    "dumpster_10yard": 350,
    "dumpster_15yard": 425,
    "dumpster_20yard": 495,
    "dumpster_30yard": 595,
    # Site protection & cleanup: scale with kitchen size (total LF)
    "site_protection_base": 75,
    "site_protection_per_lf": 3,
    "cleanup_base": 100,
    "cleanup_per_lf": 4,
    # Cabinet hardware (knobs/pulls) — supply + install per opening
    "hardware_per_opening": 15,     # mid-grade knob/pull supply
    "hardware_install_per_opening": 8,
}

# Default O&P percentages
DEFAULT_OVERHEAD_PCT = 0.10
DEFAULT_PROFIT_PCT = 0.10

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
    "Solid Surface": {"rate": 75, "label": "Solid Surface (Corian)"},
    "Butcher Block": {"rate": 70, "label": "Butcher Block"},
    "Granite": {"rate": 95, "label": "Granite"},
    "Quartz": {"rate": 110, "label": "Quartz"},
    "Quartzite": {"rate": 130, "label": "Quartzite"},
    "Marble": {"rate": 160, "label": "Marble"},
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
