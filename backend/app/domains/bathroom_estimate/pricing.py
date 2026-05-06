"""
Bathroom Remodel Estimate pricing constants for DMV area.
All rates based on 2025-2026 web research:
- Fixr.com, Angi, HomeAdvisor, HomeGuide, HomeWyse, This Old House
- Boss Design Center (DC Metro specific)
- DMV Fix Remodeling (Columbia MD area)
- Modernize, InchCalculator, CountBricks

Rates are mid-range for the DMV region (DC/MD/VA).
Includes material + labor unless otherwise noted.
"""

# ──────────────────────────────────────────────
# Phase 1: Demo & Disposal
# ──────────────────────────────────────────────
# Sources: Angi avg $1,445, Modernize $8-$20/SF, This Old House $658-$2,469
DEMO_RATES = {
    # Per-SF demo rates (labor only)
    "floor_tile_per_sf": 4.50,        # tile removal + haul ($3-$7/SF, Modernize)
    "wall_tile_per_sf": 5.50,         # wall tile removal ($4-$7/SF)
    "ceiling_per_sf": 3.00,           # ceiling demo

    # Per-fixture demo (labor, avg $50-$150 per fixture, Angi)
    "bathtub_standard": 175,          # standard acrylic/fiberglass
    "bathtub_cast_iron": 450,         # cast iron (heavy, needs crew + surcharge)
    "shower_surround": 200,           # prefab surround removal
    "shower_custom_tile": 350,        # custom tile shower tear-out
    "vanity": 125,                    # vanity + top removal
    "toilet": 85,                     # toilet R&R
    "mirror": 45,                     # mirror removal

    # Substrate demo
    "durock_per_sf": 3.00,            # cement board tear-out
    "drywall_per_sf": 2.50,           # drywall tear-out
    "subfloor_per_sf": 5.00,          # subfloor removal/repair

    # Dumpster (DMV area, Angi DC avg $442, range $370-$900)
    "dumpster_10yard": 395,
    "dumpster_15yard": 475,
    "dumpster_20yard": 550,
    "dump_tip_fee": 75,               # tip/disposal fee
}

# ──────────────────────────────────────────────
# Phase 2: Plumbing Rough
# ──────────────────────────────────────────────
# Sources: Angi rough-in avg $6,500 (full new), Fixr $75-$150/hr plumber
# For like-for-like replacement, much less than full rough-in
PLUMBING_RATES = {
    # Per-unit costs (material + labor)
    "shutoff_valve_each": 135,        # quarter-turn ball valve replacement ($80-$200, Angi)
    "supply_line_each": 65,           # braided stainless flex line
    "p_trap_each": 95,                # P-trap replacement
    "drain_modification": 350,        # drain line modification
    "pressure_balance_valve": 425,    # code-required shower valve ($300-$550)
    "rough_inspection_fee": 150,      # county inspection fee

    # Fixture connection labor (per fixture)
    "toilet_set": 375,                # toilet install complete ($275-$480, Angi avg $375)
    "vanity_faucet_install": 285,     # faucet install ($225-$475, Angi)
    "tub_faucet_install": 325,        # tub faucet/valve install
    "shower_valve_trim": 275,         # shower trim kit install (existing valve)
}

# ──────────────────────────────────────────────
# Phase 3: Electrical
# ──────────────────────────────────────────────
# Sources: Angi GFCI $130-$300 avg $210, Exhaust fan $250-$950
ELECTRICAL_RATES = {
    "gfci_outlet_each": 210,          # GFCI outlet install ($130-$300, Angi avg $210)
    "vanity_light_install": 185,      # light fixture install (labor)
    "ceiling_fixture_install": 195,   # ceiling light install
    "exhaust_fan": {                  # fan + install by CFM ($250-$950, Angi/HomeGuide)
        50: 325,
        80: 425,
        110: 550,
        150: 695,
    },
    "exhaust_fan_switch": {           # switch upgrade
        "standard": 35,
        "timer": 75,
        "humidity": 125,
    },
    "heated_floor_per_sf": 12,        # mat + install ($8-$15/SF, Greenwave 2025)
    "heated_floor_thermostat": 175,   # programmable thermostat
    "heated_floor_circuit": 350,      # dedicated 20A circuit
    "electrical_inspection_fee": 125, # county inspection
}

# ──────────────────────────────────────────────
# Phase 4: Substrate (Durock / Waterproofing)
# ──────────────────────────────────────────────
# Sources: CountBricks $4-$6/SF labor, PRG Contractors, TillerStead
SUBSTRATE_RATES = {
    "durock_per_sf": 6.50,            # 1/2" cement board material + install ($5-$8/SF)
    "durock_floor_per_sf": 5.50,      # 1/4" cement board for floor
    "greenboard_per_sf": 4.50,        # moisture-resistant drywall
    "mold_resistant_drywall_per_sf": 5.25,  # mold-resistant ceiling drywall

    # Waterproofing membrane
    "redgard_per_sf": 2.25,           # paint-on membrane ($1-$3/SF)
    "kerdi_per_sf": 4.50,             # Schluter Kerdi sheet ($3-$6/SF)
    "hydroban_per_sf": 2.75,          # Laticrete HydroBan

    # Subfloor repair
    "subfloor_repair_per_sf": 8.50,   # plywood + install ($6-$12/SF)
}

# ──────────────────────────────────────────────
# Phase 5: Tile & Flooring
# ──────────────────────────────────────────────
# Sources: HomeWyse $17-$21/SF installed, Angi $10-$50/SF, RUBI $12-$35/SF
TILE_MATERIAL_RATES = {
    # Material cost per SF
    "ceramic": 4.00,                  # $2-$5/SF (Angi, HomeAdvisor)
    "porcelain": 7.50,                # $4-$10/SF (Angi)
    "natural_stone": 18.00,           # $10-$30/SF
    "glass_mosaic": 22.00,            # $16-$30/SF
    "lvt_spc": 4.50,                  # $3-$7/SF LVT/SPC plank
}

TILE_LABOR_RATES = {
    # Labor per SF by application
    "floor_per_sf": 10.00,            # $8-$14/SF (Fixr tile installer)
    "wall_per_sf": 12.00,             # $10-$15/SF (vertical work premium)
    "shower_wall_per_sf": 14.00,      # $10-$18/SF (wet area, precision)
}

TILE_PATTERN_MULTIPLIER = {
    "straight": 1.00,
    "diagonal": 1.12,
    "herringbone": 1.28,
    "versailles": 1.35,
}

TILE_EXTRAS = {
    "waste_factor": 0.10,             # 10% waste
    "grout_per_sf": 1.50,             # grout material
    "sealer_per_sf": 0.75,            # sealant for natural stone
    "thinset_per_sf": 0.65,           # thinset mortar
    "tile_demo_per_sf": 4.00,         # old tile removal ($1.50-$4.50/SF)
}

# ──────────────────────────────────────────────
# Phase 6: Fixtures
# ──────────────────────────────────────────────
# Sources: Angi, HomeGuide, Fixr, Boss Design Center DC

# Bathtub (material only, install separate under plumbing)
BATHTUB_PRICES = {
    "alcove": {
        "acrylic": 450,               # most common, $300-$600
        "porcelain_steel": 350,       # cheap but chips, $200-$500
        "cast_iron": 950,             # heavy, premium, $700-$1,200
        "fiberglass": 325,            # budget, $200-$450
    },
    "drop_in": {
        "acrylic": 650,
        "porcelain_steel": 550,
        "cast_iron": 1200,
        "fiberglass": 500,
    },
    "freestanding": {
        "acrylic": 1200,              # $800-$2,000
        "cast_iron": 2500,            # $1,500-$4,000
        "fiberglass": 800,
    },
    "walk_in": {
        "acrylic": 3500,              # ADA/senior, $2,500-$5,000+
    },
}

BATHTUB_INSTALL = {
    "alcove": 425,                    # standard install
    "drop_in": 650,                   # deck mount, more plumber time
    "freestanding": 750,              # floor mount + filler
    "walk_in": 1200,                  # complex install + electrical
}

BATHTUB_EXTRAS = {
    "whirlpool_upgrade": 800,         # jets + pump + dedicated circuit
    "air_jet_upgrade": 600,
}

# Shower enclosure
SHOWER_ENCLOSURE_PRICES = {
    "curtain": 45,                    # rod + curtain
    "sliding": 350,                   # sliding bypass door ($250-$500)
    "pivot": 550,                     # pivot door ($400-$800)
    "frameless": 1650,                # frameless glass ($1,000-$2,500, Angi avg $1,400)
    "half_wall_glass": 1200,          # half wall + fixed glass panel
}

SHOWER_INSERT_PRICES = {
    # Prefab shower units (material only)
    "one_piece": 650,                 # fiberglass one-piece ($400-$1,000)
    "multi_piece_kit": 950,           # multi-piece kit ($600-$1,500)
}

SHOWER_CUSTOM_EXTRAS = {
    "niche_each": 185,                # recessed niche (material + labor)
    "bench": 450,                     # tiled bench (material + labor)
    "curb": 225,                      # standard curb build
    "curbless_drain": 650,            # linear drain + slope work
}

# Shower head/valve
SHOWERHEAD_PRICES = {
    "standard": 65,
    "rain": 175,
    "handheld": 95,
    "combo": 225,                     # rain + handheld
    "body_spray": 350,                # per set
}

SHOWER_VALVE_PRICES = {
    "pressure_balance": 275,          # code-required basic
    "thermostatic": 550,              # premium
}

TRIM_BRAND_MULTIPLIER = {
    "delta": 1.00,
    "moen": 1.05,
    "kohler": 1.15,
    "pfister": 0.95,
    "grohe": 1.35,
    "other": 1.00,
}

TRIM_GRADE_MULTIPLIER = {
    "builder": 0.80,
    "mid": 1.00,
    "premium": 1.45,
}

# Vanity
VANITY_PRICES = {
    # By width (material only, mid-range stock)
    "stock_rta": {24: 350, 30: 425, 36: 500, 48: 700, 60: 950, 72: 1200},
    "semi_custom": {24: 650, 30: 800, 36: 950, 48: 1350, 60: 1800, 72: 2400},
    "custom": {24: 1200, 30: 1500, 36: 1800, 48: 2600, 60: 3500, 72: 4500},
}

VANITY_TOP_PRICES = {
    # Per linear inch of width
    "cultured_marble": 8,             # integrated bowl, cheapest
    "quartz": 18,                     # most popular
    "granite": 16,
    "marble": 25,                     # premium, sealing required
    "laminate": 5,
}

VANITY_INSTALL = 225                  # labor to install vanity ($100-$350)

VANITY_EXTRAS = {
    "wall_mount_blocking": 185,       # wood blocking for floating vanity
    "faucet_single_hole": 195,        # faucet supply + install
    "faucet_centerset": 225,
    "faucet_widespread": 295,
    "faucet_wall_mount": 425,         # wall-mount requires rough valve
}

# Mirror / Medicine Cabinet
MIRROR_PRICES = {
    "plain": 85,
    "framed": 175,
    "medicine_cabinet": 275,          # surface mount
    "medicine_cabinet_recessed": 375, # recessed (requires wall work)
    "led_backlit": 425,               # + electrical
}

MIRROR_INSTALL = 85                   # labor to hang

# Toilet
TOILET_PRICES = {
    # Material only (install under plumbing)
    "two_piece_standard": 225,        # basic two-piece ($130-$250)
    "two_piece_comfort": 295,         # comfort height
    "one_piece_standard": 375,        # one-piece ($250-$450)
    "one_piece_comfort": 425,
    "bidet_seat": 350,                # bidet seat add-on (needs GFCI)
    "smart_toilet": 1200,             # integrated bidet ($800-$2,000)
}

TOILET_EXTRAS = {
    "wax_ring": 15,
    "flange_repair": 95,              # if slab condition requires
    "soft_close_seat": 45,            # if not included
}

# ──────────────────────────────────────────────
# Phase 7: Finish (Paint, Trim, Accessories)
# ──────────────────────────────────────────────
# Sources: Fixr painter $2-$7/SF, HomeGuide baseboard $1-$3.50/LF
PAINT_RATES = {
    "wall_per_sf": 3.25,              # paint walls (prep + 2 coats, $2-$6/SF)
    "ceiling_per_sf": 3.50,           # ceiling paint (overhead premium)
    "trim_per_lf": 3.75,              # baseboard/trim paint ($2.30-$4.88/LF, HomeWyse)
}

PAINT_GRADE_MULTIPLIER = {
    "builder": 0.85,
    "mid": 1.00,
    "premium": 1.30,                  # Sherwin Cashmere, BM Aura
}

BASEBOARD_PRICES = {
    # Material + install per LF
    "pvc": 6.50,                      # PVC (recommended for bath)
    "mdf": 5.00,
    "wood": 8.50,
}

# Accessories (material + install per piece)
# Sources: HomeWyse towel bar $61-$134, grab bar $100-$350
ACCESSORY_PRICES = {
    "towel_bar": 95,                  # supply + install ($61-$134)
    "hand_towel_ring": 75,
    "tp_holder": 55,
    "robe_hook": 50,
    "corner_shelf": 65,
    "grab_bar": 225,                  # + blocking ($100-$350, HomeGuide)
    "toilet_brush_holder": 45,
    "soap_dispenser": 65,
}

ACCESSORY_FINISH_MULTIPLIER = {
    "chrome": 1.00,
    "brushed_nickel": 1.10,
    "matte_black": 1.15,
    "brass": 1.25,
    "mixed": 1.10,
}

ACCESSORY_GRADE_MULTIPLIER = {
    "builder": 0.75,
    "mid": 1.00,
    "premium": 1.50,
}

# ──────────────────────────────────────────────
# Hidden / Commonly Missed Costs
# ──────────────────────────────────────────────
HIDDEN_COSTS = {
    "floor_protection": 125,          # Ram board, plastic, tape
    "mobilization": 175,              # tool/equipment transport
    "final_clean": 225,               # move-in ready cleaning
    "punch_list": 200,                # 1-2 follow-up visits
    "caulk_day": 275,                 # silicone/latex caulking (1 day labor)
    "drywall_patch_per_sf": 5.50,     # patching around tile edges
    "trim_paint_per_lf": 4.50,        # post-install trim paint
    "lead_rrp": 375,                  # EPA RRP surcharge (pre-1978)
    "cast_iron_disposal": 175,        # weight surcharge for CI tub
}

# ──────────────────────────────────────────────
# DMV Region: Zip-based labor multipliers
# ──────────────────────────────────────────────
DMV_ZIP3_MULTIPLIERS = {
    # DC
    "200": 1.05,
    "202": 1.00,
    # Maryland
    "206": 1.00,
    "207": 0.95,
    "208": 1.05,  # Montgomery County
    "209": 1.00,
    "210": 0.95,
    "211": 0.95,
    "212": 0.95,
    "216": 0.95,
    # Northern Virginia
    "220": 1.00,
    "221": 1.05,  # Fairfax, Arlington
    "222": 1.00,
    "223": 1.00,
}

PREMIUM_ZIP_OVERRIDES = {
    "20815", "20816", "20817", "20854",  # Bethesda/Potomac
    "22101", "22102", "22066",           # McLean/Great Falls
    "20007", "20008", "20015",           # Georgetown/NW DC
}

# ──────────────────────────────────────────────
# Sales Tax by State (material portion only)
# ──────────────────────────────────────────────
SALES_TAX_RATES = {
    "MD": 0.06,
    "VA": 0.053,     # NOVA can be 0.06
    "DC": 0.06,
}

NOVA_ZIP3 = {"220", "221", "222", "223"}  # NOVA region → 6%

# ──────────────────────────────────────────────
# O&P (optional)
# ──────────────────────────────────────────────
DEFAULT_OVERHEAD_PCT = 0.10
DEFAULT_PROFIT_PCT = 0.10

# ──────────────────────────────────────────────
# Dropdown / Enum options
# ──────────────────────────────────────────────
BUILDING_TYPES = ["sfh", "townhouse", "condo"]
BATHROOM_DESIGNATIONS = ["master", "hall", "powder", "three_quarter", "jack_jill"]
BATHROOM_FUNCTIONS = ["full", "three_quarter", "half"]

SHOWER_TYPES = ["tub_combo", "one_piece", "multi_piece_kit", "custom_tile", "curbless"]
ENCLOSURE_TYPES = ["curtain", "sliding", "pivot", "frameless", "half_wall_glass"]
SHOWERHEAD_TYPES = ["standard", "rain", "handheld", "combo", "body_spray"]
TRIM_BRANDS = ["delta", "moen", "kohler", "pfister", "grohe", "other"]
TRIM_GRADES = ["builder", "mid", "premium"]

BATHTUB_TYPES = ["alcove", "drop_in", "freestanding", "walk_in", "none"]
BATHTUB_MATERIALS = ["acrylic", "porcelain_steel", "cast_iron", "fiberglass"]

VANITY_WIDTHS = [24, 30, 36, 48, 60, 72]
VANITY_SOURCES = ["stock_rta", "semi_custom", "custom"]
VANITY_TOP_MATERIALS = ["cultured_marble", "quartz", "granite", "marble", "laminate"]
VANITY_MOUNTINGS = ["freestanding", "wall_mount"]
FAUCET_TYPES = ["single_hole", "centerset", "widespread", "wall_mount"]
MIRROR_TYPES = ["plain", "framed", "medicine_cabinet", "medicine_cabinet_recessed", "led_backlit"]

TOILET_TYPES = ["two_piece_standard", "two_piece_comfort", "one_piece_standard", "one_piece_comfort"]

TILE_MATERIALS = ["ceramic", "porcelain", "natural_stone", "glass_mosaic", "lvt_spc"]
TILE_PATTERNS = ["straight", "diagonal", "herringbone", "versailles"]

WATERPROOF_TYPES = ["redgard", "kerdi", "hydroban", "none"]

DEMO_SCOPES = ["full_gut", "floor_only", "walls_only", "tub_shower_only", "vanity_only", "toilet_only"]

ACCESSORY_FINISHES = ["chrome", "brushed_nickel", "matte_black", "brass", "mixed"]
ACCESSORY_GRADES = ["builder", "mid", "premium"]

EXHAUST_FAN_CFMS = [50, 80, 110, 150]
EXHAUST_FAN_SWITCH_TYPES = ["standard", "timer", "humidity"]

PAINT_GRADES = ["builder", "mid", "premium"]
BASEBOARD_MATERIALS = ["pvc", "mdf", "wood"]


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return DMV_ZIP3_MULTIPLIERS.get(zip_code[:3], 1.00)


def get_sales_tax_rate(state: str, zip_code: str = "") -> float:
    """Get sales tax rate. NOVA region gets VA 6% instead of 5.3%."""
    if state == "VA" and zip_code and zip_code[:3] in NOVA_ZIP3:
        return 0.06
    return SALES_TAX_RATES.get(state, 0.06)
