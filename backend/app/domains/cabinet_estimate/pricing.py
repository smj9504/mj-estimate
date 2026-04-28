"""
Cabinet Estimate pricing constants for DMV area.
All rates are baseline values that get adjusted by material, finish, and labor multipliers.
"""

# Per-LF base rates by tier
BASE_RATES = {
    "Stock": {
        "base_lf": 150,      # $/LF for base cabinets
        "wall_lf": 120,      # $/LF for wall cabinets
        "tall_each": 425,    # $/EA for pantry/oven cabinet
    },
    "Semi-Custom": {
        "base_lf": 385,
        "wall_lf": 295,
        "tall_each": 825,
    },
    "Custom": {
        "base_lf": 725,
        "wall_lf": 575,
        "tall_each": 1450,
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
    "lazy_susan": 200,
    "blind_corner": 80,
    "drawer_base": 150,
    "diagonal_corner_wall": 150,
}

# Zip3-based labor multipliers for DMV area
DMV_ZIP3_MULTIPLIERS = {
    # DC
    "200": 1.15,
    "202": 1.05,
    # Maryland
    "206": 1.00,
    "207": 0.95,
    "208": 1.15,  # Montgomery County (Bethesda etc.)
    "209": 1.10,
    "210": 0.95,
    "211": 0.95,
    "212": 0.95,
    "216": 0.95,
    # Northern Virginia
    "220": 1.05,
    "221": 1.15,  # Fairfax, Arlington (McLean etc.)
    "222": 1.05,
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
    "demo_per_lf": 35,
    "demo_min": 450,
    "install_base_per_lf": 95,
    "install_wall_per_lf": 75,
    "install_tall_per_each": 165,
    # Delivery: base fee + per-LF surcharge for larger kitchens
    "delivery_base": 175,
    "delivery_per_lf": 3,           # additional per total LF
    "delivery_min": 175,
    # Plumbing
    "plumbing_disconnect": 275,
    "plumbing_reconnect": 625,      # full reconnect (sink, DW, disposal)
    # Countertop
    "countertop_reset": 775,
    # Site protection & cleanup: scale with kitchen size (total LF)
    "site_protection_base": 125,
    "site_protection_per_lf": 4,
    "cleanup_base": 150,
    "cleanup_per_lf": 5,
    # Cabinet hardware (knobs/pulls) — supply + install per opening
    "hardware_per_opening": 12,     # mid-grade knob/pull supply
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


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.20
    return DMV_ZIP3_MULTIPLIERS.get(zip_code[:3], 1.00)
