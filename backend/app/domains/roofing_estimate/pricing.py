"""
Roofing Estimate pricing constants for DMV area.

Rates are COST-BASIS installed rates: material (at the supplier cost in
the price book, converted to the rate's unit) plus the labor to install
it. They are not retail quotes — markup, overhead, profit and
contingency are applied on top of these in calculator.py.

That distinction matters. These used to be turnkey retail rates, and
running the markup stack over an already-retail number put the final
estimate at roughly 2.7x the DMV market. See the 2026-09-18 price
validation report.

Calibration target: a straightforward 25 SQ architectural tear-off lands
at $6-8/SF all-in, against a DMV market of $5.50-7.20/SF.

Sources: 4Seasons Home (DMV, 2026-06), RoofVista 2026, JobNimbus 2026,
ProMatcher DC field rates, supplier list pricing 2026-09.
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
    # Labor and disposal only; the dumpster is billed separately below.
    "1_layer_per_sq": 100.0,
    "2_layer_per_sq": 150.0,
    "3_layer_per_sq": 200.0,
    "cedar_shake_per_sq": 200.0,
    # Roll-off haul rates by can size. Priced per can delivered and
    # hauled, including the roofing weight allowance in dumpster.py;
    # tonnage past that allowance is billed by the hauler as overage.
    "dumpster_10yard": 475.0,
    "dumpster_15yard": 550.0,
    "dumpster_20yard": 650.0,
    "dumpster_30yard": 800.0,
}

# Per-ton charge when a can goes over its weight allowance. Ordering a
# second can for a few hundred pounds costs far more than the overage,
# so the sizing logic compares the two (see dumpster.py).
DUMPSTER_OVERAGE_PER_TON = 95.0

# ── Phase 2: Decking ──

DECKING_RATES = {
    # Sheet cost + ~$25/sheet to cut out and replace. Sheet costs were
    # 1.6-3x supplier list; corrected against 2026-09 list pricing.
    "osb_716": 40.0,     # per 4x8 sheet installed
    "osb_12": 53.0,
    "cdx_12": 55.0,
    "cdx_58": 65.0,
    "re_nail_per_sf": 0.25,
}

# ── Phase 3: Underlayment & Ice Barrier ──

UNDERLAYMENT_RATES = {
    # Roll cost per SF + ~$0.16/SF labor; underlayment rolls out fast.
    "felt_15": 0.22,     # per SF installed
    "felt_30": 0.26,
    "synthetic": 0.29,
}

# Roll is 200 SF (36" x 66.7 ft), so $134/RL is $0.67/SF of material.
ICE_WATER_SHIELD_RATE = 1.30   # per SF installed

# ── Phase 4: Drip Edge & Flashing ──

DRIP_EDGE_RATE = 3.10          # per LF installed

FLASHING_RATES = {
    "step_flashing_per_lf": 9.0,
    "chimney_small": 550.0,      # per chimney (< 30" wide)
    # A cricket is fabricated framing on top of the base flashing, so
    # the large-chimney rate carries a real premium over the small one.
    "chimney_large": 1450.0,     # per chimney (>= 30", includes cricket)
    "apron_flashing": 185.0,     # per unit
    "skylight_flashing_kit": 340.0,  # per skylight
}

PIPE_BOOT_RATES = {
    "rubber": 45.0,
    "lead": 95.0,
    "lifetime": 75.0,
}

# ── Roof Penetration Rates (per unit, installed) ──

PENETRATION_RATES = {
    "pipe_boot_rubber": 45.0,
    "pipe_boot_lead": 95.0,
    "pipe_boot_lifetime": 75.0,
    "pipe_jack": 95.0,
    "turtle_vent": 85.0,
    "turbine_vent": 165.0,
    # Exhaust penetrations include the roof cap and the duct connection.
    "kitchen_exhaust": 165.0,
    "bath_exhaust": 145.0,
    "dryer_vent": 135.0,
    "radon_pipe": 90.0,
    "satellite_mount": 60.0,
    "other": 85.0,
}

PENETRATION_TYPES = list(PENETRATION_RATES.keys())

# ── Skylight Replacement (add-on, not included in base estimate) ──

# Unit + flashing kit + install. These were priced below the cost of the
# skylight itself — a 14" Sun Tunnel kit alone is more than the old $650.
SKYLIGHT_REPLACEMENT_RATES = {
    "small_fixed": 950.0,        # 14x14 ~ 21x26 fixed
    "medium_fixed": 1150.0,      # 21x38 ~ 30x38 fixed
    "large_fixed": 1450.0,       # 30x46 ~ 44x46 fixed
    "small_venting": 1750.0,     # 21x26 ~ 21x38 venting
    "medium_venting": 2050.0,    # 30x38 venting
    "large_venting": 2400.0,     # 30x46 ~ 44x46 venting
    "tube_10": 850.0,            # 10" tubular
    "tube_14": 1050.0,           # 14" tubular
}

# ── Phase 5: Shingle Install ──

SHINGLE_RATES = {
    # Bundle cost x 3 BD/SQ + ~$135/SQ to lay it (two-man crew at
    # roughly 1.25 hr/SQ). Designer profiles run 4-5 BD/SQ on some
    # products (Camelot II, Grand Sequoia); the price-book coverage
    # decides the material, not this rate.
    "three_tab": 240.0,              # per square installed
    "architectural_std": 270.0,
    "architectural_premium": 310.0,
    "designer": 425.0,
    "impact_resistant": 310.0,
}

RIDGE_CAP_RATE = 8.25   # per LF installed

# ── Phase 6: Ventilation ──

VENTILATION_RATES = {
    "ridge_vent_shingle_over_per_lf": 10.0,
    "ridge_vent_aluminum_per_lf": 12.0,
    # Cutting in a box vent is more work than the old rate allowed.
    "static_vent_each": 155.0,
    "exhaust_vent_cap_each": 70.0,
}

RIDGE_VENT_TYPES = ["shingle_over", "aluminum"]

# ── Phase 7: Gutter ──

GUTTER_RATES = {
    # K-style aluminum seamless (material + labor, ref +8%)
    "k_style_5": 5.70,
    "k_style_6": 6.80,
    "half_round_5": 13.50,
    "half_round_6": 16.50,
    # Copper
    "copper_k_style_5": 28.00,
    "copper_k_style_6": 34.00,
    # Downspouts (ref $5.15 +8%)
    "downspout_2x3": 6.50,
    "downspout_3x4": 7.00,
    # Hidden hanger (ref $0.35 +10%, included per LF)
    "hidden_hanger": 0.40,
    "splash_block": 12.0,
    # Removal
    "removal_per_lf": 2.50,
    # Guards / Screens (ref drop-in $2.45 +10%)
    "guard_mesh": 4.50,
    "guard_micro_mesh": 11.00,
    "guard_foam": 3.75,
    "guard_reverse_curve": 9.00,
}

# ── Phase 8: Cleanup & Misc ──

MISC_RATES = {
    "magnetic_sweep": 100.0,
    "driveway_protection": 300.0,
    "landscape_protection": 250.0,
    "lead_rrp": 450.0,
    "vent_cap_replace_each": 70.0,
    "satellite_removal": 175.0,
    "hoa_review_fee": 200.0,
}

# ── Permit Fees (approximate by jurisdiction) ──

# Fallback flat fees, used only when the jurisdiction is unknown.
# Most DMV jurisdictions do not require a permit for a like-for-like
# shingle replacement at all, and those that do price by roof area
# rather than a flat fee — see PERMIT_RULES and get_permit_fee().
PERMIT_FEES = {
    "MD": 350.0,
    "VA": 300.0,
    "DC": 425.0,
}

# Per-jurisdiction permit rules.
#   exempt_like_for_like: a shingle-only replacement needs no permit
#   per_sf / minimum / flat: how the fee is computed when one is needed
#
# The VA and DC exemptions come from the statewide 256 SF threshold
# (VUSBC) and DC's in-kind replacement rule; Maryland is set by county.
PERMIT_RULES = {
    "montgomery": {
        "state": "MD", "exempt_like_for_like": False,
        "per_sf": 0.783545, "minimum": 329.59,
        "label": "Montgomery County, MD",
    },
    "prince georges": {
        "state": "MD", "exempt_like_for_like": False,
        "flat": 350.0, "label": "Prince George's County, MD",
    },
    "baltimore": {
        "state": "MD", "exempt_like_for_like": True,
        "flat": 0.0, "label": "Baltimore County, MD",
    },
    "fairfax": {
        "state": "VA", "exempt_like_for_like": True,
        "minimum": 135.0, "label": "Fairfax County, VA",
    },
    "arlington": {
        "state": "VA", "exempt_like_for_like": True,
        "per_sf": 0.63, "minimum": 135.0, "label": "Arlington County, VA",
    },
    "loudoun": {
        "state": "VA", "exempt_like_for_like": True,
        "flat": 150.0, "label": "Loudoun County, VA",
    },
    "dc": {
        "state": "DC", "exempt_like_for_like": True,
        "flat": 150.0, "label": "Washington, DC",
    },
}

# ── Pitch / Slope Multipliers ──

# Low slope (under 3/12) is NOT a labor surcharge — it is easier to walk.
# It needs a different system (membrane/TPO) entirely, which is a
# material decision the estimate makes elsewhere, so the multiplier here
# stays neutral rather than silently inflating shingle labor.
PITCH_MULTIPLIERS = {
    "0/12": 1.00, "1/12": 1.00, "2/12": 1.00,     # low slope
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

# Applied to the MATERIAL cost the company pays its supplier, never
# billed to the customer as a separate line: in MD and VA a roofing
# contractor is the final consumer of materials it affixes to real
# property, so it pays the tax at purchase and may not pass it through
# as tax. See calculator.py for how it is folded into the price.
SALES_TAX_RATES = {
    "MD": 0.06,
    "VA": 0.053,
    # Northern Virginia carries a 0.7% regional add-on on top of the
    # 4.3% state + 1.0% local rate.
    "VA_NOVA": 0.060,
    # DC rises to 7.0% on 2026-10-01.
    "DC": 0.06,
    "DC_2026Q4": 0.07,
}

# Localities in the Northern Virginia transportation district, where the
# regional add-on applies.
NOVA_LOCALITIES = {
    "alexandria", "arlington", "fairfax", "fairfax city",
    "fairfax county", "falls church", "loudoun", "manassas",
    "manassas park", "prince william",
}

# ── Material vs Labor Split ──
#
# Line items are priced at *installed* rates, where material and labor are
# one number. Sales tax applies only to the material half, and material and
# labor carry different markups, so that number has to be split back apart.
#
# A single blended ratio across the whole estimate gets this wrong in both
# directions: tear-off is pure labor and gets taxed as if it were half
# material, while decking is mostly lumber and gets under-taxed. These are
# per-category ratios of installed price that is material.
#
# Resolution order, most specific first:
#   1. line item's own material_portion (set from real supplier costs)
#   2. estimate.material_portion_pct  (user override for the whole job)
#   3. MATERIAL_PORTIONS[category]    (the table below)
#   4. DEFAULT_MATERIAL_PORTION

# Measured against the price book at the cost-basis rates above, rather
# than estimated. Used only where the price book has no cost for the
# category; anything it does cover resolves from the real cost.
MATERIAL_PORTIONS = {
    "tearoff": 0.00,        # labor + disposal only; dumpster is a service
    "decking": 0.38,        # sheet goods over sheet-plus-labor
    "underlayment": 0.31,
    "ice_water": 0.39,
    "drip_edge": 0.35,
    "flashing": 0.30,
    "penetration": 0.31,
    "shingle": 0.44,        # $135 material on a $310/SQ installed rate
    "ridge_cap": 0.28,
    "ventilation": 0.48,
    "gutter": 0.33,
    "misc": 0.10,           # permits, RRP, HOA fees — almost entirely service
}

DEFAULT_MATERIAL_PORTION = 0.50

# Kept as the historical name so older callers keep working; prefer
# get_material_portion() so the category is taken into account.
MATERIAL_PORTION = DEFAULT_MATERIAL_PORTION


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


def get_sales_tax_rate(state: str, locality: str = None,
                       as_of: str = None) -> float:
    """Sales tax the company pays on materials, by jurisdiction.

    `locality` picks up the Northern Virginia regional add-on; `as_of`
    is an ISO date used only to apply DC's 2026-10-01 increase, so a
    re-render of an older estimate keeps the rate it was priced at.
    """
    st = (state or "").upper()
    if st == "VA" and locality:
        key = str(locality).strip().lower().replace(" county", "")
        if key in NOVA_LOCALITIES:
            return SALES_TAX_RATES["VA_NOVA"]
    if st == "DC" and as_of and str(as_of) >= "2026-10-01":
        return SALES_TAX_RATES["DC_2026Q4"]
    return SALES_TAX_RATES.get(st, 0.06)


def get_permit_fee(state: str, locality: str = None,
                   like_for_like: bool = True,
                   roof_sf: float = 0) -> float:
    """Permit fee for this job.

    Most DMV jurisdictions exempt a like-for-like shingle replacement,
    and those that charge price by roof area. A flat $300-425 was both
    over-billing the exempt majority and under-billing the jurisdictions
    that meter by the square foot.

    `like_for_like` False means decking or structural work is involved,
    which removes the exemption everywhere.
    """
    rule = None
    if locality:
        key = str(locality).strip().lower().replace(" county", "")
        rule = PERMIT_RULES.get(key)
    if rule is None:
        return PERMIT_FEES.get((state or "").upper(), 250.0)

    if like_for_like and rule.get("exempt_like_for_like"):
        return 0.0
    if rule.get("per_sf"):
        fee = float(roof_sf or 0) * rule["per_sf"]
        return round(max(fee, rule.get("minimum", 0.0)), 2)
    if rule.get("flat") is not None:
        return float(rule["flat"])
    return float(rule.get("minimum", 0.0))


def permit_jurisdictions() -> list:
    """Jurisdictions the estimate form can offer, for the dropdown."""
    return [
        {"key": k, "label": v["label"], "state": v["state"],
         "exempt_like_for_like": v.get("exempt_like_for_like", False)}
        for k, v in sorted(PERMIT_RULES.items(),
                           key=lambda kv: kv[1]["label"])
    ]


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


def get_material_portion(
    category: str, override: float = None,
) -> float:
    """Fraction of a line item's installed price that is material.

    `override` is the estimate-level setting; when present it applies to
    every category, which is what a user asking for "60% material on this
    job" means. Otherwise the category table decides.
    """
    if override is not None:
        return max(0.0, min(1.0, float(override)))
    return MATERIAL_PORTIONS.get(category, DEFAULT_MATERIAL_PORTION)
