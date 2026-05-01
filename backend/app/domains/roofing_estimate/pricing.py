"""
Roofing Estimate pricing constants for DMV area.
All rates based on 2026 Q2 market research:
- HomeGuide, Angi, Modernize, Homewyse, Instant Roofer
- This Old House, RoofInstallation.com
Rates are mid-range installed prices for DC/MD/VA region.
"""

# ── Dropdown Options ──

BUILDING_TYPES = ["sfh", "townhouse", "multi"]
ROOF_COMPLEXITIES = ["simple_gable", "hip", "cut_up"]
EXISTING_MATERIALS = ["asphalt", "cedar_shake"]

SHINGLE_TYPES = [
    "three_tab",
    "architectural_std",
    "architectural_premium",
    "designer",
    "impact_resistant",
]
SHINGLE_BRANDS = ["gaf", "certainteed", "owens_corning", "iko", "malarkey"]

DECKING_MATERIALS = ["osb_716", "osb_12", "cdx_12", "cdx_58"]

UNDERLAYMENT_TYPES = ["felt_15", "felt_30", "synthetic"]

PIPE_BOOT_TYPES = ["rubber", "lead", "lifetime"]

GUTTER_MATERIALS = ["aluminum", "copper", "steel", "vinyl"]
GUTTER_STYLES = ["k_style", "half_round"]
GUTTER_SIZES = [5, 6]
GUTTER_TYPES = ["seamless", "sectional"]
DOWNSPOUT_SIZES = ["2x3", "3x4"]
GUTTER_GUARD_TYPES = ["mesh", "micro_mesh", "foam", "reverse_curve"]

GUTTER_SCOPES = ["full_replace", "partial", "new_install", "remove_only"]

# ── Phase 1: Setup & Tear-off ──

TEAROFF_RATES = {
    "1_layer_per_sq": 60.0,
    "2_layer_per_sq": 110.0,
    "3_layer_per_sq": 150.0,
    "cedar_shake_per_sq": 155.0,
    "dumpster_20yard": 575.0,
}

# ── Phase 2: Decking ──

DECKING_RATES = {
    "osb_716": 90.0,    # per 4x8 sheet installed
    "osb_12": 102.0,
    "cdx_12": 110.0,
    "cdx_58": 127.0,
    "re_nail_per_sf": 0.18,
}

# ── Phase 3: Underlayment & Ice Barrier ──

UNDERLAYMENT_RATES = {
    "felt_15": 0.35,     # per SF installed
    "felt_30": 0.45,
    "synthetic": 0.65,
}

ICE_WATER_SHIELD_RATE = 2.00   # per SF installed

# ── Phase 4: Drip Edge & Flashing ──

DRIP_EDGE_RATE = 2.75          # per LF installed

FLASHING_RATES = {
    "step_flashing_per_lf": 11.0,
    "chimney_small": 550.0,      # per chimney (< 30" wide)
    "chimney_large": 800.0,      # per chimney (>= 30", includes cricket)
    "apron_flashing": 175.0,     # per unit
    "skylight_flashing_kit": 325.0,  # per skylight
}

PIPE_BOOT_RATES = {
    "rubber": 35.0,
    "lead": 90.0,
    "lifetime": 65.0,
}

# ── Phase 5: Shingle Install ──

SHINGLE_RATES = {
    "three_tab": 425.0,              # per square installed
    "architectural_std": 550.0,
    "architectural_premium": 675.0,
    "designer": 950.0,
    "impact_resistant": 775.0,
}

RIDGE_CAP_RATE = 11.0   # per LF installed

# ── Phase 6: Ventilation ──

VENTILATION_RATES = {
    "ridge_vent_per_lf": 11.0,
    "static_vent_each": 70.0,
    "exhaust_vent_cap_each": 55.0,
}

# ── Phase 7: Gutter ──

GUTTER_RATES = {
    # K-style aluminum seamless (installed)
    "k_style_5": 12.0,
    "k_style_6": 14.5,
    "half_round_5": 16.0,
    "half_round_6": 19.0,
    # Copper
    "copper_k_style_5": 32.0,
    "copper_k_style_6": 38.0,
    # Downspouts
    "downspout_2x3": 6.5,
    "downspout_3x4": 8.5,
    "splash_block": 10.0,
    # Removal
    "removal_per_lf": 1.50,
    # Guards
    "guard_mesh": 11.0,
    "guard_micro_mesh": 20.0,
    "guard_foam": 8.0,
    "guard_reverse_curve": 18.0,
}

# ── Phase 8: Cleanup & Misc ──

MISC_RATES = {
    "magnetic_sweep": 75.0,
    "driveway_protection": 225.0,
    "landscape_protection": 200.0,
    "lead_rrp": 350.0,
    "vent_cap_replace_each": 55.0,
    "satellite_removal": 125.0,
    "hoa_review_fee": 150.0,
}

# ── Permit Fees (approximate by jurisdiction) ──

PERMIT_FEES = {
    "MD": 275.0,
    "VA": 250.0,
    "DC": 350.0,
}

# ── Pitch / Slope Multipliers ──

PITCH_MULTIPLIERS = {
    "0/12": 1.20, "1/12": 1.20, "2/12": 1.20,     # low slope
    "3/12": 1.00, "4/12": 1.00, "5/12": 1.00, "6/12": 1.00,  # walkable
    "7/12": 1.25, "8/12": 1.25, "9/12": 1.25,      # steep
    "10/12": 1.50, "11/12": 1.50, "12/12": 1.50,   # very steep
    "13/12": 1.75, "14/12": 2.00, "15/12": 2.00,   # extreme
}

# ── Story Multiplier ──

STORY_MULTIPLIERS = {
    1: 1.00,
    2: 1.12,
    3: 1.25,
}

# ── Waste Factor by Complexity ──

WASTE_FACTORS = {
    "simple_gable": 0.10,
    "hip": 0.13,
    "cut_up": 0.18,
}

# ── Sales Tax (material portion only) ──

SALES_TAX_RATES = {
    "MD": 0.06,
    "VA": 0.053,   # NOVA can be 0.06
    "DC": 0.06,
}

# Material portion estimate (for tax calculation)
MATERIAL_PORTION = 0.50  # approximately 50% of installed price is material


def get_pitch_multiplier(pitch: str) -> float:
    """Get labor multiplier from pitch string like '6/12'."""
    if not pitch:
        return 1.0
    return PITCH_MULTIPLIERS.get(pitch, 1.0)


def get_story_multiplier(stories: int) -> float:
    """Get height surcharge multiplier."""
    return STORY_MULTIPLIERS.get(stories, 1.0)


def get_waste_factor(complexity: str) -> float:
    """Get waste factor by roof complexity."""
    return WASTE_FACTORS.get(complexity, 0.12)


def get_sales_tax_rate(state: str) -> float:
    """Get sales tax rate by state."""
    return SALES_TAX_RATES.get(state, 0.06)


def get_permit_fee(state: str) -> float:
    """Get estimated permit fee by state."""
    return PERMIT_FEES.get(state, 250.0)


def get_gutter_rate(style: str, size: int, material: str = "aluminum") -> float:
    """Get gutter installed rate per LF."""
    if material == "copper":
        key = f"copper_{style}_{size}"
    else:
        key = f"{style}_{size}"
    return GUTTER_RATES.get(key, 12.0)


def get_guard_rate(guard_type: str) -> float:
    """Get gutter guard rate per LF."""
    return GUTTER_RATES.get(f"guard_{guard_type}", 11.0)
