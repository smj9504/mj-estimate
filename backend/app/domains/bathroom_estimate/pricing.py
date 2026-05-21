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
    # Per-SF demo rates (labor only — unskilled labor, straightforward removal)
    "floor_tile_per_sf": 3.00,        # tile removal + haul ($2-$4/SF avg)
    "wall_tile_per_sf": 3.75,         # wall tile removal ($3-$5/SF)
    "ceiling_per_sf": 2.00,           # ceiling demo

    # Per-fixture demo (labor, disconnect + remove + haul)
    "bathtub_standard": 125,          # standard acrylic/fiberglass
    "bathtub_cast_iron": 325,         # cast iron (heavy, needs crew)
    "shower_surround": 150,           # prefab surround removal
    "shower_custom_tile": 250,        # custom tile shower tear-out
    "vanity": 85,                     # vanity + top removal
    "toilet": 60,                     # toilet disconnect + remove
    "mirror": 35,                     # mirror removal

    # Substrate demo
    "durock_per_sf": 2.00,            # cement board tear-out
    "drywall_per_sf": 1.75,           # drywall tear-out
    "subfloor_per_sf": 4.00,          # subfloor removal/repair

    # Dumpster (DMV area, Angi DC avg $442, range $370-$900)
    "dumpster_10yard": 395,
    "dumpster_15yard": 475,
    "dumpster_20yard": 550,
    "dump_tip_fee": 75,               # tip/disposal fee
    "debris_bag": 25,                 # per bag: heavy-duty bag + haul-away labor
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

    # Fixture connection labor (licensed plumber, per fixture)
    "toilet_set": 295,                # toilet install (set, wax ring, bolt, connect, test; $225-$375 Angi 2026)
    "vanity_faucet_install": 350,     # faucet install (connect supply, drain, test for leaks)
    "tub_faucet_install": 400,        # tub faucet/valve install (access panel, connect, test)
    "shower_valve_trim": 325,         # shower trim kit install (existing valve)
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
    "shower_floor_per_sf": 12.00,     # $10-$15/SF (slope to drain, wet area, small area = more cuts)
}

TILE_PATTERN_MULTIPLIER = {
    "straight": 1.00,
    "diagonal": 1.12,
    "herringbone": 1.28,
    "versailles": 1.35,
}

# Tile size labor multiplier
# Standard (12x12, 12x24) = 1.0 baseline
# Mosaic = more cuts, more grout lines → +30-40% labor
# Large format = leveling systems, 2-person handling → +20-30% labor
# Sources: HomeGuide 2026, Apollo Tile, Fixr
TILE_SIZE_MULTIPLIER = {
    "1x1_mosaic": 1.40,       # mosaic sheets, $12-14/SF labor
    "2x2_mosaic": 1.35,       # mosaic sheets
    "4x4": 1.15,              # small format, more grout lines
    "6x6": 1.10,              # small format
    "12x12": 1.00,            # standard baseline
    "12x24": 1.00,            # standard, most common
    "6x24": 1.05,             # plank style, slightly more cuts
    "24x24": 1.10,            # large, needs leveling
    "24x48": 1.25,            # large format, 2-person install
    "4x12_subway": 1.05,      # subway tile, many joints
    "3x6_subway": 1.10,       # classic subway, more joints
}

TILE_SIZES = list(TILE_SIZE_MULTIPLIER.keys())

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
    "alcove": 575,                    # standard install (set, level, seal, connect)
    "drop_in": 850,                   # deck mount, more plumber time + framing
    "freestanding": 975,              # floor mount, filler, drain alignment
    "walk_in": 1500,                  # complex install + electrical + ADA compliance
}

BATHTUB_EXTRAS = {
    "whirlpool_upgrade": 800,         # jets + pump + dedicated circuit
    "air_jet_upgrade": 600,
    "surround_tile_labor_per_sf": 13.00,  # surround tile install ($10-$16/SF)
}

# Shower door / enclosure
# Material price by type × opening width (inches)
# Sources: Angi 2026, HomeGuide 2026, ThisOldHouse 2026
SHOWER_DOOR_PRICES = {
    # Curtain - flat rate
    "curtain": {"any": 45},
    # Framed sliding/bypass - budget ($400-$900 installed)
    "framed_sliding": {
        48: 280, 60: 350, 72: 420,
    },
    # Semi-frameless sliding ($700-$1,500 installed)
    "semi_frameless_sliding": {
        48: 450, 60: 550, 72: 650,
    },
    # Frameless sliding ($800-$1,600 installed)
    "frameless_sliding": {
        48: 700, 60: 850, 72: 1000,
    },
    # Framed pivot ($400-$1,100 installed)
    "framed_pivot": {
        28: 250, 32: 300, 36: 350,
    },
    # Semi-frameless pivot
    "semi_frameless_pivot": {
        28: 400, 32: 475, 36: 550,
    },
    # Frameless pivot ($600-$1,900 installed)
    "frameless_pivot": {
        28: 650, 32: 800, 36: 950,
    },
    # Fixed panel / half wall glass
    "fixed_panel": {
        24: 400, 30: 550, 36: 700,
    },
}

# Installation labor by door category (precision leveling, drilling, sealing)
SHOWER_DOOR_INSTALL = {
    "curtain": 0,
    "framed_sliding": 275,
    "semi_frameless_sliding": 375,
    "frameless_sliding": 475,
    "framed_pivot": 275,
    "semi_frameless_pivot": 375,
    "frameless_pivot": 475,
    "fixed_panel": 350,
}

SHOWER_DOOR_TYPES = [
    "curtain",
    "framed_sliding", "semi_frameless_sliding", "frameless_sliding",
    "framed_pivot", "semi_frameless_pivot", "frameless_pivot",
    "fixed_panel",
]

# Legacy compat — still referenced by enclosure dropdown
SHOWER_ENCLOSURE_PRICES = {
    "curtain": 45,
    "sliding": 350,
    "pivot": 550,
    "frameless": 1650,
    "half_wall_glass": 1200,
}

SHOWER_INSERT_PRICES = {
    # Prefab shower units (material only)
    "one_piece": 650,                 # fiberglass one-piece ($400-$1,000)
    "multi_piece_kit": 950,           # multi-piece kit ($600-$1,500)
}

SHOWER_INSERT_INSTALL = 575           # prefab shower unit install (set, level, seal, connect)

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
    "quartz": 14,                     # most popular (36"=$504)
    "granite": 13,                    # (36"=$468)
    "marble": 22,                     # premium, sealing required
    "laminate": 5,
}

VANITY_INSTALL = 350                  # labor to install vanity (set, level, secure, cutouts)

VANITY_EXTRAS = {
    "wall_mount_blocking": 225,       # wood blocking for floating vanity (framing work)
    "faucet_single_hole": 245,        # faucet supply + install
    "faucet_centerset": 275,
    "faucet_widespread": 350,
    "faucet_wall_mount": 525,         # wall-mount requires rough valve + access
}

# Mirror / Medicine Cabinet
MIRROR_PRICES = {
    "plain": 85,
    "framed": 175,
    "medicine_cabinet": 275,          # surface mount
    "medicine_cabinet_recessed": 375, # recessed (requires wall work)
    "led_backlit": 425,               # + electrical
}

MIRROR_INSTALL = 125                  # labor to hang (anchoring, leveling)

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
    "wall_per_sf": 3.25,              # paint walls (prep + 2 coats, sub-contractor rate on remodel)
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
    "tile": 12.00,
}

# Tile baseboard pricing by tile material (material + labor per LF)
# Sources: HomeAdvisor 2025, Angi 2026, FlooringClarity
TILE_BASEBOARD_PRICES = {
    "ceramic": 9.00,                  # $8-$12/LF installed
    "porcelain": 12.00,               # $10-$15/LF installed
    "natural_stone": 18.00,           # $15-$25/LF installed
    "glass_mosaic": 20.00,            # $16-$25/LF installed
}

# Quarter round molding pricing (material + labor per LF)
# Add-on to standard baseboard install; matches baseboard material
# Sources: Angi 2026 ($3-$7/LF installed), HomeGuide 2026, CountBricks 2026
# DMV mid-range: thin pin-nailer install, slightly faster than baseboard
QUARTER_ROUND_PRICES = {
    "pvc": 3.75,                      # PVC quarter round (moisture-resistant, bath)
    "mdf": 3.25,                      # MDF quarter round (budget, paintable)
    "wood": 4.50,                     # Paint-grade pine quarter round
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
# Detach & Reset (D&R) - Labor Only
# ──────────────────────────────────────────────
# For water mitigation / restoration work: fixture is carefully removed,
# stored, then reinstalled after wall/floor work is completed.
# All costs are LABOR ONLY (no new material).
# Sources: Xactimate D&R codes, Angi, CountBricks, HomeWyse 2025-2026
DETACH_RESET_COSTS = {
    # Toilet: disconnect water, remove wax ring, store, reinstall w/ new wax ring
    "toilet": 185,                    # ~1.5 hrs plumber ($125-$250)
    # Vanity + sink: disconnect plumbing, remove, store, reinstall & reconnect
    "vanity": 275,                    # ~2.5 hrs ($200-$350)
    # Bathtub: disconnect plumbing, remove, store, reinstall
    "bathtub_standard": 450,          # ~4 hrs ($350-$550)
    "bathtub_cast_iron": 650,         # ~6 hrs, heavy ($500-$800)
    # Shower door/enclosure: careful glass removal, store, reinstall
    "shower_door": 275,               # ~2.5 hrs ($200-$350)
    # Shower surround (prefab): remove panels, store, reinstall
    "shower_surround": 350,           # ~3 hrs ($275-$425)
    # Mirror: careful removal, store, reinstall
    "mirror": 95,                     # ~0.75 hrs ($65-$125)
    # Vanity light: disconnect, remove, store, reinstall
    "vanity_light": 85,              # ~0.5-0.75 hrs ($65-$110)
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
    "drywall_skim_coat_per_sf": 4.25, # skim coat after tile removal ($3-$6/SF)
    "trim_paint_per_lf": 4.50,        # post-install trim paint
    "lead_rrp": 375,                  # EPA RRP surcharge (pre-1978)
    "cast_iron_disposal": 175,        # weight surcharge for CI tub
    "permit_fee": 250,                # building permit (varies by county, $150-$400)
}

# ──────────────────────────────────────────────
# Shower Pan / Pre-slope (custom tile showers)
# ──────────────────────────────────────────────
# Sources: HomeGuide 2025, Angi 2026, Fixr
SHOWER_PAN_COSTS = {
    "mortar_preslope_per_sf": 8.50,   # mud bed pre-slope ($6-$12/SF)
    "pan_liner": 185,                 # PVC liner + drain assembly
    "curb_waterproof": 75,            # curb membrane wrap
}

# ──────────────────────────────────────────────
# Regional: Zip-based labor multipliers
# ──────────────────────────────────────────────
# Base pricing is calibrated to national mid-range.
# Multipliers adjust for regional labor cost differences.
ZIP3_LABOR_MULTIPLIERS = {
    # DC Metro (DMV)
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
    # Florida — Central/East Coast
    "320": 0.90,  # Jacksonville area
    "321": 0.88,  # Daytona Beach / New Smyrna Beach / Volusia County
    "322": 0.88,  # Gainesville area
    "323": 0.90,  # Tallahassee area
    "324": 0.88,  # Panama City area
    "325": 0.88,  # Pensacola area
    "326": 0.88,  # Ocala / Gainesville
    "327": 0.92,  # Orlando area
    "328": 0.92,  # Orlando metro
    "329": 0.90,  # Melbourne / Space Coast
    "330": 0.95,  # Miami
    "331": 0.95,  # Miami / Coral Gables
    "332": 0.95,  # Ft. Lauderdale
    "333": 0.95,  # Ft. Lauderdale / Hollywood
    "334": 0.92,  # West Palm Beach
    "335": 0.92,  # Tampa area
    "336": 0.92,  # Tampa / St. Petersburg
    "337": 0.90,  # St. Petersburg
    "338": 0.90,  # Lakeland
    "339": 0.92,  # Fort Myers
    "340": 0.90,  # Naples (seasonal premium)
    "341": 0.90,  # Naples / Marco Island
    "342": 0.88,  # Sarasota / Bradenton
    "344": 0.88,  # Sarasota
    "346": 0.92,  # Tampa metro
}

PREMIUM_ZIP_OVERRIDES = {
    # DMV premium zips
    "20815", "20816", "20817", "20854",  # Bethesda/Potomac
    "22101", "22102", "22066",           # McLean/Great Falls
    "20007", "20008", "20015",           # Georgetown/NW DC
    # Florida premium zips
    "33139", "33140", "33141",           # Miami Beach
    "34102", "34103", "34108",           # Naples
}

# ──────────────────────────────────────────────
# Sales Tax by State (material portion only)
# ──────────────────────────────────────────────
SALES_TAX_RATES = {
    "MD": 0.06,
    "VA": 0.053,     # NOVA can be 0.06
    "DC": 0.06,
    "FL": 0.06,      # FL base 6%, some counties add 0.5-1.5% discretionary
}

NOVA_ZIP3 = {"220", "221", "222", "223"}  # NOVA region → 6%
# Florida counties with surtax (6% + 1% = 7%)
FL_SURTAX_ZIP3 = {
    "321",           # Volusia County (New Smyrna Beach) +0.5%
    "327", "328",    # Orange County (Orlando) +0.5%
    "330", "331",    # Miami-Dade +1%
    "332", "333",    # Broward +1%
}

# ──────────────────────────────────────────────
# County / State Permit Matrix
# ──────────────────────────────────────────────
# Group A: Like-for-like exempt (VA USBC)
# Group B: Stricter — trade permits for fixture replacement (MD)
# Group C: Always recommend permit (DC, FL varies by county)
PERMIT_MATRIX = {
    # Virginia — Group A (VA USBC, like-for-like cosmetic exempt)
    "VA": {
        "group": "A",
        "like_for_like_exempt": True,
        "label": "VA USBC",
        "note_exempt": (
            "Like-for-like fixture replacement — cosmetic remodel "
            "exempt from building permit per VA Uniform Statewide "
            "Building Code (VA USBC). No structural or rough-in "
            "changes."
        ),
        "note_required": (
            "Permit required: scope includes plumbing/electrical "
            "rough-in changes per VA USBC. Contact local Building "
            "Official for application."
        ),
    },
    # Maryland — Group B (more strict, trade permits common)
    "MD": {
        "group": "B",
        "like_for_like_exempt": False,
        "label": "MD Code",
        "note_exempt": (
            "Cosmetic remodel — plumbing/electrical trade permits "
            "may still be required per county code. Verify with "
            "local Department of Permitting Services."
        ),
        "note_required": (
            "Permit required: plumbing/electrical rough-in changes "
            "in scope. Montgomery/PG County requires trade permits "
            "for fixture replacement in some cases."
        ),
    },
    # DC — Group C (always recommend)
    "DC": {
        "group": "C",
        "like_for_like_exempt": False,
        "label": "DCRA",
        "note_exempt": (
            "DC recommends permits for most bathroom work. "
            "Contact DCRA (Department of Consumer and Regulatory "
            "Affairs) to confirm requirements."
        ),
        "note_required": (
            "Permit required per DCRA. Plumbing/electrical work "
            "requires licensed trade contractors with active DC "
            "permits."
        ),
    },
    # Florida — varies by county, generally stricter
    "FL": {
        "group": "C",
        "like_for_like_exempt": False,
        "label": "FL Statute",
        "note_exempt": (
            "Florida counties vary on permit requirements for "
            "cosmetic remodels. Verify with local Building "
            "Department."
        ),
        "note_required": (
            "Permit required: plumbing/electrical changes in scope. "
            "Florida requires licensed contractors for permitted "
            "work (FL Statute 489)."
        ),
    },
}


def get_permit_info(state: str, has_rough_change: bool) -> dict:
    """Return permit note and whether permit is required.

    Returns dict with keys: required (bool), note (str), group (str).
    """
    matrix = PERMIT_MATRIX.get(state)
    if not matrix:
        # Default: conservative — recommend permit
        return {
            "required": has_rough_change,
            "note": (
                "Verify local permit requirements with county/city "
                "building department."
            ),
            "group": "?",
        }

    if has_rough_change:
        return {
            "required": True,
            "note": matrix["note_required"],
            "group": matrix["group"],
        }

    if matrix["like_for_like_exempt"]:
        return {
            "required": False,
            "note": matrix["note_exempt"],
            "group": matrix["group"],
        }

    # Group B/C: even like-for-like may need permit
    return {
        "required": False,
        "note": matrix["note_exempt"],
        "group": matrix["group"],
    }


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

ACCESSORY_FINISHES = ["chrome", "brushed_nickel", "matte_black", "brass", "mixed"]
ACCESSORY_GRADES = ["builder", "mid", "premium"]

EXHAUST_FAN_CFMS = [50, 80, 110, 150]
EXHAUST_FAN_SWITCH_TYPES = ["standard", "timer", "humidity"]

PAINT_GRADES = ["builder", "mid", "premium"]
BASEBOARD_MATERIALS = ["pvc", "mdf", "wood", "tile"]


def get_labor_multiplier(zip_code: str) -> float:
    """Get labor cost multiplier based on zip code."""
    if not zip_code:
        return 1.00
    if zip_code in PREMIUM_ZIP_OVERRIDES:
        return 1.10
    return ZIP3_LABOR_MULTIPLIERS.get(zip_code[:3], 1.00)


def get_sales_tax_rate(state: str, zip_code: str = "") -> float:
    """Get sales tax rate with regional surtax support."""
    if state == "VA" and zip_code and zip_code[:3] in NOVA_ZIP3:
        return 0.06
    if state == "FL" and zip_code and zip_code[:3] in FL_SURTAX_ZIP3:
        surtax = 0.01 if zip_code[:3] in {"330", "331", "332", "333"} else 0.005
        return 0.06 + surtax
    return SALES_TAX_RATES.get(state, 0.06)
