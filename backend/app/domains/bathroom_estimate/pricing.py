"""
Bathroom Remodel Estimate pricing constants for DMV area.
All rates based on 2025-2026 web research:
- Fixr.com, Angi, HomeAdvisor, HomeGuide, HomeWyse, This Old House
- Boss Design Center (DC Metro specific)
- DMV Fix Remodeling (Columbia MD area)
- Modernize, InchCalculator, CountBricks

Rates are mid-range for the DMV region (DC/MD/VA).
Includes material + labor unless otherwise noted.

2026-08 price update (research: FloorDaily Ceramic Tile Report 2026,
CountBricks labor rates Feb 2026, Depo Homes "Bathroom Remodel Costs
Increase 15-20% in 2026", felixdeco tariff tracker):
- Import tariffs (China/India/Vietnam/Brazil Section 301+122) are pushing
  tile and vanity/cabinet costs up sharply (tile ceramic ~+15%, vanity
  tariff exposure ~20-28%) — categories most exposed to tariffs capped
  at the top of our 1-5% adjustment range.
- Skilled trade labor (plumber/electrician) up ~8-10% YoY on tight
  labor supply — plumbing/electrical nudged up accordingly.
- Fixtures (toilets, sinks, tub/shower units) showed milder +2-3%
  supplier increases.
- Paint, trim, demo/disposal remained comparatively stable (+1-2%).
Applied per-category: tile/substrate/vanity +5%, plumbing/electrical
+3-4%, fixtures/tub/shower +2-3%, paint/trim/accessories/demo +1-2%,
rounded to natural price points.
"""

# ──────────────────────────────────────────────
# Phase 1: Demo & Disposal
# ──────────────────────────────────────────────
# Sources: Angi avg $1,445, Modernize $8-$20/SF, This Old House $658-$2,469
DEMO_RATES = {
    # Per-SF demo rates (labor only — unskilled labor, straightforward removal)
    # 2026-08: +1-2% (stable category, minor labor cost drift)
    "floor_tile_per_sf": 3.05,        # tile removal + haul ($2-$4/SF avg)
    "wall_tile_per_sf": 3.80,         # wall tile removal ($3-$5/SF)
    "ceiling_per_sf": 2.05,           # ceiling demo

    # Per-fixture demo (labor, disconnect + remove + haul)
    "bathtub_standard": 205,          # standard acrylic/fiberglass ($200-$500, HomeGuide 2026)
    "bathtub_cast_iron": 330,         # cast iron (heavy, needs crew)
    "shower_surround": 153,           # prefab surround removal
    "shower_custom_tile": 255,        # custom tile shower tear-out
    "vanity": 153,                    # vanity + top removal + haul ($150-$500, Angi 2026)
    "pedestal_sink": 56,              # pedestal sink disconnect + remove
    "wall_mount_sink": 51,            # wall-mount sink disconnect + remove
    "toilet": 61,                     # toilet disconnect + remove
    "mirror": 36,                     # mirror removal

    # Substrate demo
    "durock_per_sf": 2.05,            # cement board tear-out
    "drywall_per_sf": 1.80,           # drywall tear-out
    "subfloor_per_sf": 4.10,          # subfloor removal/repair

    # Dumpster (DMV area, Angi DC avg $442, range $370-$900)
    "dumpster_10yard": 400,
    "dumpster_15yard": 480,
    "dumpster_20yard": 560,
    "dump_tip_fee": 76,               # tip/disposal fee
    "debris_bag": 25.50,               # per bag: heavy-duty bag + haul-away labor
}

# ──────────────────────────────────────────────
# Phase 2: Plumbing Rough
# ──────────────────────────────────────────────
# Sources: Angi rough-in avg $6,500 (full new), Fixr $75-$150/hr plumber
# For like-for-like replacement, much less than full rough-in
PLUMBING_RATES = {
    # Per-unit costs (material + labor)
    # 2026-08: +3-4% (licensed plumber hourly rates up ~8-10% YoY, CountBricks Feb 2026)
    "shutoff_valve_each": 192,        # quarter-turn ball valve replacement ($150-$335, HomeWyse 2026)
    "supply_line_each": 67,           # braided stainless flex line
    "p_trap_each": 182,               # P-trap replacement ($200-$325, HomeAdvisor 2026; on-site discount)
    "drain_modification": 364,        # drain line modification
    "pressure_balance_valve": 440,    # code-required shower valve ($300-$550)
    "rough_inspection_fee": 155,      # county inspection fee

    # Fixture connection labor (licensed plumber, per fixture)
    "toilet_set": 365,                # toilet install (set, wax ring, bolt, connect, test; $275-$530 HomeWyse 2026)
    "vanity_faucet_install": 233,     # faucet install ($200-$250; simplest plumbing task)
    "tub_faucet_install": 415,        # tub faucet/valve install (access panel, connect, test)
    "shower_valve_trim": 338,         # shower trim kit install (existing valve)
}

# ──────────────────────────────────────────────
# Phase 3: Electrical
# ──────────────────────────────────────────────
# Sources: Angi GFCI $130-$300 avg $210, Exhaust fan $250-$950
ELECTRICAL_RATES = {
    # 2026-08: +3-4% (electrician hourly rates up on tight skilled-labor supply)
    # 1st outlet ~$210 incl. service call; add'l same visit ~$100
    "gfci_outlet_each": 171,          # blended avg (1-3 outlets per bath)
    "vanity_light_install": 192,      # light fixture install (labor)
    "ceiling_fixture_install": 202,   # standard ceiling light install
    "recessed_light_install": 233,    # recessed can light (cut hole + housing + trim + wire)
    "recessed_light_multi": 181,      # per-can when installing multiple (reduced per-unit)
    "exhaust_fan": {                  # fan + install by CFM ($250-$950, Angi/HomeGuide)
        50: 337,
        80: 440,
        110: 570,
        150: 720,
    },
    "exhaust_fan_switch": {           # switch upgrade
        "standard": 36,
        "timer": 78,
        "humidity": 130,
    },
    "heated_floor_per_sf": 12.50,     # mat + install ($8-$15/SF, Greenwave 2025)
    "heated_floor_thermostat": 182,   # programmable thermostat
    "heated_floor_circuit": 363,      # dedicated 20A circuit
    "electrical_inspection_fee": 130, # county inspection
    "megohmmeter_check": 155,         # insulation resistance test on circuits
}

# ──────────────────────────────────────────────
# Phase 4: Substrate (Durock / Waterproofing)
# ──────────────────────────────────────────────
# Sources: CountBricks $4-$6/SF labor, PRG Contractors, TillerStead
SUBSTRATE_RATES = {
    # 2026-08: +5% (cement board/membrane material costs tracking tariff-driven building material inflation)
    "durock_per_sf": 6.80,            # 1/2" cement board material + install ($5-$8/SF)
    "durock_floor_per_sf": 5.75,      # 1/4" cement board for floor
    "greenboard_per_sf": 4.70,        # moisture-resistant drywall
    "mold_resistant_drywall_per_sf": 5.50,  # mold-resistant ceiling drywall

    # Waterproofing membrane
    "paint_on_per_sf": 2.35,          # paint-on membrane: RedGard, HydroBan ($1-$3/SF)
    # Sheet membrane: Schluter Kerdi — material ~$2.25/SF + thinset + labor → $7-$12/SF
    "sheet_per_sf": 9.45,

    # Subfloor repair
    "subfloor_repair_per_sf": 8.90,   # plywood + install ($6-$12/SF)
    "self_leveling_per_sf": 4.98,     # self-leveling compound + pour ($3-$7/SF, Angi 2026)

    # Drywall repair (full replacement: hang + tape + mud + sand + prime)
    "drywall_replace_per_sf": 6.03,   # standard 1/2" drywall ($4-$7/SF installed)
    "drywall_replace_moisture_per_sf": 6.80,  # greenboard/moisture-resistant ($5-$8/SF)

    # Insulation (demo + install)
    "insulation_demo_per_sf": 1.55,             # tear-out existing insulation ($1-$2/SF)
    "insulation_fiberglass_batt_per_sf": 2.60,  # R-13 fiberglass batt supply + install ($1.50-$3.50/SF)
    "insulation_blown_in_per_sf": 3.15,         # blown-in cellulose/fiberglass ($2-$4/SF)
    "insulation_spray_foam_per_sf": 5.75,       # closed-cell spray foam ($4-$7/SF)
    "insulation_rigid_board_per_sf": 4.20,      # rigid foam board supply + install ($3-$5/SF)
}

# ──────────────────────────────────────────────
# Phase 5: Tile & Flooring
# ──────────────────────────────────────────────
# Sources: HomeWyse $17-$21/SF installed, Angi $10-$50/SF, RUBI $12-$35/SF
TILE_MATERIAL_RATES = {
    # Material cost per SF
    # 2026-08: +5% — tile is the most tariff-exposed category (Section 301/122
    # tariffs on China/India/Vietnam/Brazil imports; ~70% of ceramic is imported,
    # FloorDaily Ceramic Tile Report 2026)
    "ceramic": 4.20,                  # $2-$5/SF (Angi, HomeAdvisor)
    "porcelain": 7.85,                # $4-$10/SF (Angi)
    "natural_stone": 18.90,           # $10-$30/SF
    "glass_mosaic": 23.10,            # $16-$30/SF
    "lvt_spc": 4.70,                  # $3-$7/SF LVT/SPC plank
}

TILE_LABOR_RATES = {
    # Labor per SF by application
    # 2026-08: +4-5% (skilled tile installer demand + material handling of pricier tile)
    "floor_per_sf": 10.50,            # $8-$14/SF (Fixr tile installer)
    "wall_per_sf": 12.60,             # $10-$15/SF (vertical work premium)
    "shower_wall_per_sf": 14.70,      # $10-$18/SF (wet area, precision)
    # slope + drain cuts + mosaic → more labor than shower wall
    "shower_floor_per_sf": 18.90,     # $16-$22/SF
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
    "waste_factor": 0.10,             # 10% waste (unchanged — not a price)
    # 2026-08: material lines +5% (tariff-exposed), demo labor +2%
    "grout_per_sf": 1.57,             # grout material
    "sealer_per_sf": 0.78,            # sealant for natural stone
    "thinset_per_sf": 0.68,           # thinset mortar
    "tile_demo_per_sf": 4.10,         # old tile removal ($1.50-$4.50/SF)
}

# ──────────────────────────────────────────────
# Phase 6: Fixtures
# ──────────────────────────────────────────────
# Sources: Angi, HomeGuide, Fixr, Boss Design Center DC

# Bathtub (material only, install separate under plumbing)
# 2026-08: +2-3% (fixture/supplier increases, milder than tile/tariff-exposed categories)
BATHTUB_PRICES = {
    "alcove": {
        "acrylic": 460,               # most common, $300-$600
        "porcelain_steel": 358,       # cheap but chips, $200-$500
        "cast_iron": 970,             # heavy, premium, $700-$1,200
        "fiberglass": 333,            # budget, $200-$450
    },
    "drop_in": {
        "acrylic": 665,
        "porcelain_steel": 563,
        "cast_iron": 1225,
        "fiberglass": 511,
    },
    "freestanding": {
        "acrylic": 1225,              # $800-$2,000
        "cast_iron": 2555,            # $1,500-$4,000
        "fiberglass": 818,
    },
    "walk_in": {
        "acrylic": 3570,              # ADA/senior, $2,500-$5,000+
    },
}

BATHTUB_INSTALL = {
    "alcove": 690,                    # standard install (set, level, seal, connect; $500-$1,500 HomeGuide 2026)
    "drop_in": 970,                   # deck mount, more plumber time + framing
    "freestanding": 1125,             # floor mount, filler, drain alignment
    "walk_in": 1685,                  # complex install + electrical + ADA compliance
}

BATHTUB_EXTRAS = {
    "whirlpool_upgrade": 820,         # jets + pump + dedicated circuit
    "air_jet_upgrade": 615,
    "surround_tile_labor_per_sf": 13.65,  # surround tile install ($10-$16/SF) — tile labor category, +5%
    # Drain/overflow assembly — new tub needs new drain kit
    # Includes: drain body, overflow plate, linkage, gaskets, plumber's putty
    # Sources: Angi 2025-2026, HomeWyse ($80-$200 installed)
    "drain_overflow_kit": 139,        # drain + overflow assembly supply + install
    # Mortar bed / setting material — level base for tub
    # Acrylic/fiberglass tubs REQUIRE full support underneath (flex = crack)
    # Sources: Angi 2025, TerryLove forum, HomeGuide ($50-$150)
    "mortar_bed": 98,                 # mortar mix + pour + level ($75-$125)
    # Tub/shower valve replacement (when tub has surround tile / combo unit)
    # Valve body + trim kit, Moen/Delta mid-grade ($250-$450 parts + $150-$250 labor)
    "shower_valve_body_trim": 490,    # pressure-balance valve body + trim kit installed
    "shower_valve_trim_only": 232,    # trim kit only (retain existing valve body)
    "showerhead_install": 88,         # shower head + arm install labor
    "curtain_rod": 67,                # curtain rod + rings + mount (supply + install)
}

# Shower door / enclosure
# Material price by type × opening width (inches)
# Sources: Angi 2026, HomeGuide 2026, ThisOldHouse 2026
# 2026-08: +3% (imported glass/hardware components, moderate tariff exposure)
SHOWER_DOOR_PRICES = {
    # Curtain - flat rate
    "curtain": {"any": 46},
    # Framed sliding/bypass - budget ($400-$900 installed)
    "framed_sliding": {
        48: 288, 60: 360, 72: 433,
    },
    # Semi-frameless sliding ($700-$1,500 installed)
    "semi_frameless_sliding": {
        48: 464, 60: 567, 72: 670,
    },
    # Frameless sliding ($1,000-$2,500 installed, Angi 2026)
    "frameless_sliding": {
        48: 927, 60: 1082, 72: 1288,
    },
    # Framed pivot ($400-$1,100 installed)
    "framed_pivot": {
        28: 258, 32: 309, 36: 361,
    },
    # Semi-frameless pivot
    "semi_frameless_pivot": {
        28: 412, 32: 489, 36: 567,
    },
    # Frameless pivot ($1,000-$3,500 installed, Angi 2026)
    "frameless_pivot": {
        28: 927, 32: 1133, 36: 1391,
    },
    # Fixed panel / half wall glass
    "fixed_panel": {
        24: 412, 30: 567, 36: 721,
    },
}

# Installation labor by door category (precision leveling, drilling, sealing)
SHOWER_DOOR_INSTALL = {
    "curtain": 0,
    "framed_sliding": 283,
    "semi_frameless_sliding": 386,
    "frameless_sliding": 489,
    "framed_pivot": 283,
    "semi_frameless_pivot": 386,
    "frameless_pivot": 489,
    "fixed_panel": 361,
}

SHOWER_DOOR_TYPES = [
    "curtain",
    "framed_sliding", "semi_frameless_sliding",
    "frameless_sliding",
    "framed_pivot", "semi_frameless_pivot",
    "frameless_pivot",
    "fixed_panel",
    "framed_neo_angle", "semi_frameless_neo_angle",
    "frameless_neo_angle",
]

# Legacy compat — still referenced by enclosure dropdown (2026-08: +3%)
SHOWER_ENCLOSURE_PRICES = {
    "curtain": 46,
    "sliding": 361,
    "pivot": 567,
    "frameless": 1700,
    "half_wall_glass": 1236,
}

SHOWER_INSERT_PRICES = {
    # Prefab shower units (material only), +2-3% fixture supplier increase
    "one_piece": 667,                 # fiberglass one-piece ($400-$1,000)
    "multi_piece_kit": 977,           # multi-piece kit ($600-$1,500)
}

# prefab shower unit install (set, level, seal, connect)
SHOWER_INSERT_INSTALL = 590

# Neo-angle (corner) shower components
# Sources: Home Depot, Lowe's, Amazon 2025-2026
# Neo-angle base pan: acrylic/fiberglass, center drain
NEO_ANGLE_BASE_PRICES = {
    # By size (inches), material only. 2026-08: +3%
    32: 185,   # 32x32 ($150-$230)
    36: 227,   # 36x36 ($170-$280)
    38: 361,   # 38x38 ($270-$490)
    42: 438,   # 42x42 ($350-$500)
    48: 567,   # 48x48 ($450-$650)
}

# pan install: set, level, seal, connect drain
NEO_ANGLE_BASE_INSTALL = 489

# Neo-angle shower door (3-panel enclosure)
# door + 2 fixed side panels
# Higher than regular: precision angles, custom glass
# 2026-08: +3%
NEO_ANGLE_DOOR_PRICES = {
    # Framed (most common, budget) — by size
    "framed_neo_angle": {
        32: 361, 36: 438, 38: 515,
        42: 618, 48: 773,
    },
    # Semi-frameless
    "semi_frameless_neo_angle": {
        32: 567, 36: 670, 38: 773,
        42: 927, 48: 1133,
    },
    # Frameless ($1,200-$3,500+ installed, Angi 2026)
    "frameless_neo_angle": {
        32: 1082, 36: 1288, 38: 1494,
        42: 1803, 48: 2163,
    },
}

NEO_ANGLE_DOOR_INSTALL = {
    "framed_neo_angle": 386,
    "semi_frameless_neo_angle": 489,
    "frameless_neo_angle": 592,
}

# Neo-angle prefab wall surround
# (acrylic/fiberglass, replaces tile)
# Sources: MAAX, American Standard, Aquatic 2025-2026
# 2026-08: +3%
NEO_ANGLE_WALL_SURROUND_PRICES = {
    # By base size (inches), material only
    "prefab_acrylic": {
        32: 258, 36: 335, 38: 412,
        42: 515, 48: 670,
    },
    "prefab_fiberglass": {
        32: 180, 36: 232, 38: 283,
        42: 361, 48: 464,
    },
    "solid_surface": {
        32: 618, 36: 773, 38: 927,
        42: 1133, 48: 1442,
    },
}

# surround panel install ($350-$500)
NEO_ANGLE_WALL_SURROUND_INSTALL = 438

# Complete neo-angle kits (base + walls + door)
# Budget: MAAX Warren, Aqua Glass, American Std
# 2026-08: +3%
NEO_ANGLE_KIT_PRICES = {
    # base + wall surround + door (material only)
    "basic_fiberglass": {
        36: 773, 38: 927, 42: 1185,
    },
    "mid_acrylic": {
        36: 1236, 38: 1442, 42: 1854,
    },
}

# full kit install ($650-$850)
NEO_ANGLE_KIT_INSTALL = 773

# tile-adjacent labor items, +5% (tile category)
SHOWER_CUSTOM_EXTRAS = {
    "niche_each": 194,                # recessed niche (material + labor)
    "bench": 471,                     # tiled bench (material + labor)
    "curb": 236,                      # standard curb build
    "curbless_drain": 681,             # linear drain + slope work
}

# Shower head/valve — fixtures, +2-3%
SHOWERHEAD_PRICES = {
    "standard": 67,
    "rain": 180,
    "handheld": 98,
    "combo": 232,                     # rain + handheld
    "body_spray": 360,                # per set
}

SHOWER_VALVE_PRICES = {
    "pressure_balance": 283,          # code-required basic
    "thermostatic": 566,              # premium
}

TRIM_GRADE_MULTIPLIER = {
    "builder": 0.80,
    "mid": 1.00,
    "premium": 1.45,
}

# Vanity
# 2026-08: +5% — vanities/cabinets are the single most tariff-exposed category
# (50% tariff on imported cabinets effective Jan 1, 2026 pushes vanity costs up
# 20-28%; capped at the top of our 1-5% adjustment range here)
VANITY_PRICES = {
    # By width (material only, mid-range stock)
    "stock_rta": {24: 368, 30: 446, 36: 525, 48: 735, 60: 998, 72: 1260},
    "semi_custom": {24: 683, 30: 840, 36: 998, 48: 1418, 60: 1890, 72: 2520},
    # truly custom (local shop/craftsman); DMV min ~$2,500 for 36"
    "custom": {
        24: 1733, 30: 2205, 36: 2625,
        48: 3780, 60: 5040, 72: 6510,
    },
}

VANITY_TOP_PRICES = {
    # Per linear inch of width, +5%
    "cultured_marble": 8.40,          # integrated bowl, cheapest
    "quartz": 14.70,                  # most popular (36"=$504)
    "granite": 13.65,                 # (36"=$468)
    "marble": 23.10,                  # premium, sealing required
    "laminate": 5.25,
}

VANITY_INSTALL = 499                  # labor to install vanity (set, level, secure, cutouts; $400-$870 HomeWyse 2026), +5%

VANITY_EXTRAS = {
    # framing/faucet labor +3-4%, toe kick material +5%
    "wall_mount_blocking": 234,       # wood blocking for floating vanity (framing work)
    "faucet_single_hole": 255,        # faucet supply + install
    "faucet_centerset": 286,
    "faucet_widespread": 364,
    "faucet_wall_mount": 546,         # wall-mount requires rough valve + access
    "toe_kick_per_lf": 12.60,         # toe kick board (supply + install, freestanding vanity)
}

# Pedestal Sink / Wall-Mount Sink (non-vanity options), +2-3% fixture increase
SINK_PRICES = {
    # Supply (fixture + faucet)
    "pedestal_sink": 360,             # pedestal sink unit ($250-$500)
    "wall_mount_sink": 309,           # wall-mount basin ($200-$450)
}
SINK_INSTALL = {
    "pedestal_sink": 386,             # set pedestal, connect plumbing ($300-$450) — plumbing labor +3-4%
    "wall_mount_sink": 438,           # blocking + bracket + connect ($350-$500)
}
SINK_FAUCET = {
    "centerset": 180,                 # 4" centerset faucet supply
    "single_hole": 155,               # single hole faucet supply
}
SINK_FAUCET_INSTALL = 232             # faucet install labor (same as vanity)

# Mirror / Medicine Cabinet, +2-3%
MIRROR_PRICES = {
    "plain": 88,
    "framed": 180,
    "medicine_cabinet": 283,          # surface mount
    "medicine_cabinet_recessed": 386, # recessed (requires wall work)
    "led_backlit": 438,               # + electrical
}

MIRROR_INSTALL = 129                  # labor to hang (anchoring, leveling)

# Toilet, +2-3% (fixture supplier increases)
TOILET_PRICES = {
    # Material only (install under plumbing)
    "two_piece_standard": 232,        # basic two-piece ($130-$250)
    "two_piece_comfort": 304,         # comfort height
    "one_piece_standard": 386,        # one-piece ($250-$450)
    "one_piece_comfort": 438,
    "bidet_seat": 360,                # bidet seat add-on (needs GFCI)
    "smart_toilet": 1236,             # integrated bidet ($800-$2,000)
}

TOILET_EXTRAS = {
    "wax_ring": 15.50,
    "flange_repair": 98,              # if slab condition requires
    "soft_close_seat": 46,            # if not included
}

# ──────────────────────────────────────────────
# Phase 7: Finish (Paint, Trim, Accessories)
# ──────────────────────────────────────────────
# Sources: Fixr painter $2-$7/SF, HomeGuide baseboard $1-$3.50/LF
# 2026-08: +1-2% (paint/labor comparatively stable category)
PAINT_RATES = {
    "seal_prime_per_sf": 1.53,        # seal & prime repaired drywall only
    "wall_per_sf": 4.60,              # paint walls (prep + 2 coats; $4-$9/SF HomeWyse 2026)
    "ceiling_per_sf": 4.85,           # ceiling paint (overhead premium)
    "trim_per_lf": 3.85,              # baseboard/trim paint ($2.30-$4.88/LF)
}

PAINT_PREP = {
    "masking_per_sf": 0.76,               # tape, plastic sheeting on fixtures/trim ($0.50-$1.00/SF)
    "floor_protection_per_sf": 0.51,      # drop cloth / ram board for paint work ($0.35-$0.65/SF)
}

PAINT_GRADE_MULTIPLIER = {
    "builder": 0.85,
    "mid": 1.00,
    "premium": 1.30,                  # Sherwin Cashmere, BM Aura
}

# 2026-08: +1-2%
BASEBOARD_PRICES = {
    # Material + install per LF
    "pvc": 6.60,                      # PVC (recommended for bath)
    "mdf": 5.10,
    "wood": 8.65,
    "tile": 12.25,
}

# Tile baseboard pricing by tile material (material + labor per LF)
# Sources: HomeAdvisor 2025, Angi 2026, FlooringClarity
# 2026-08: +5% (tile category — tariff-exposed material)
TILE_BASEBOARD_PRICES = {
    "ceramic": 9.45,                  # $8-$12/LF installed
    "porcelain": 12.60,               # $10-$15/LF installed
    "natural_stone": 18.90,           # $15-$25/LF installed
    "glass_mosaic": 21.00,            # $16-$25/LF installed
}

# Quarter round molding pricing (material + labor per LF)
# Add-on to standard baseboard install; matches baseboard material
# Sources: Angi 2026 ($3-$7/LF installed), HomeGuide 2026, CountBricks 2026
# DMV mid-range: thin pin-nailer install, slightly faster than baseboard
# 2026-08: +1-2%
QUARTER_ROUND_PRICES = {
    "pvc": 3.80,                      # PVC quarter round (moisture-resistant, bath)
    "mdf": 3.30,                      # MDF quarter round (budget, paintable)
    "wood": 4.60,                     # Paint-grade pine quarter round
}

# Accessories (material + install per piece)
# Sources: HomeWyse towel bar $61-$134, grab bar $100-$350
# 2026-08: +1-2%
ACCESSORY_PRICES = {
    "towel_bar": 97,                  # supply + install ($61-$134)
    "hand_towel_ring": 76,
    "tp_holder": 56,
    "robe_hook": 51,
    "corner_shelf": 66,
    "grab_bar": 229,                  # + blocking ($100-$350, HomeGuide)
    "toilet_brush_holder": 46,
    "soap_dispenser": 66,
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
# 2026-08: +3-4% (skilled trade labor rates up ~8-10% YoY, applied at the
# lower end since D&R labor blends plumber/general-labor time)
DETACH_RESET_COSTS = {
    # Toilet: disconnect water, remove wax ring, store, reinstall w/ new wax ring
    "toilet": 192,                    # ~1.5 hrs plumber ($125-$250)
    # Vanity + sink: disconnect plumbing, remove, store, reinstall & reconnect
    # Larger vanities need 2-person crew, more time, bigger storage footprint
    # Sources: Xactimate D&R, Angi 2025-2026, HomeGuide
    "vanity": {
        24: 208,                      # small single vanity, ~1.5 hrs ($150-$250)
        30: 234,                      # standard single, ~1.75 hrs ($175-$275)
        36: 286,                      # standard single, ~2.5 hrs ($200-$350)
        48: 364,                      # large single, ~3 hrs, may need 2 ppl ($275-$425)
        60: 442,                      # double vanity, 2-person crew, ~3.5 hrs ($350-$500)
        72: 520,                      # large double, 2-person crew, ~4 hrs ($400-$600)
    },
    # Bathtub: disconnect plumbing, remove, store, reinstall
    "bathtub_standard": 468,          # ~4 hrs ($350-$550)
    "bathtub_cast_iron": 676,         # ~6 hrs, heavy ($500-$800)
    # Shower door/enclosure: careful glass removal, store, reinstall
    "shower_door": 286,               # ~2.5 hrs ($200-$350)
    # Shower surround (prefab): remove panels, store, reinstall
    "shower_surround": 364,           # ~3 hrs ($275-$425)
    # Mirror: careful removal, store, reinstall
    "mirror": 99,                     # ~0.75 hrs ($65-$125)
    # Vanity light: disconnect, remove, store, reinstall
    "vanity_light": 88,               # ~0.5-0.75 hrs ($65-$110)
    # Accessories (towel bars, tp holders, etc.): remove all, store, reinstall
    # Per-piece: unscrew/pull anchors, label, bag, reinstall w/ new anchors
    # Sources: Xactimate D&R, Angi 2025-2026
    "accessory_per_piece": 36,       # ~15-20 min each ($25-$45)
}

# ──────────────────────────────────────────────
# Hidden / Commonly Missed Costs
# ──────────────────────────────────────────────
# 2026-08: general labor/service lines +2%, tile-adjacent drywall work +5%
HIDDEN_COSTS = {
    "floor_protection": 128,          # Ram board, plastic, tape
    "mobilization": 179,              # tool/equipment transport
    "final_clean": 230,               # move-in ready cleaning
    "punch_list": 204,                # 1-2 follow-up visits
    "caulk_day": 281,                 # silicone/latex caulking (1 day labor)
    "drywall_patch_per_sf": 5.75,     # patching around tile edges
    "drywall_skim_coat_per_sf": 4.45, # skim coat after tile removal ($3-$6/SF)
    "trim_paint_per_lf": 4.60,        # post-install trim paint
    "lead_rrp": 383,                  # EPA RRP surcharge (pre-1978)
    "cast_iron_disposal": 179,        # weight surcharge for CI tub
    "permit_fee": 255,                # building permit (varies by county, $150-$400)
}

# ──────────────────────────────────────────────
# Shower Pan / Pre-slope (custom tile showers)
# ──────────────────────────────────────────────
# Sources: HomeGuide 2025, Angi 2026, Fixr
# 2026-08: +5% (tile/waterproofing category)
SHOWER_PAN_COSTS = {
    "mortar_preslope_per_sf": 8.90,   # mud bed pre-slope ($6-$12/SF)
    "pan_liner": 194,                 # PVC liner + drain assembly
    "curb_waterproof": 78.50,         # curb membrane wrap
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

SHOWER_TYPES = [
    "tub_combo", "one_piece", "multi_piece_kit",
    "custom_tile", "curbless",
    "neo_angle_kit", "neo_angle_custom",
]
ENCLOSURE_TYPES = ["curtain", "sliding", "pivot", "frameless", "half_wall_glass"]
SHOWERHEAD_TYPES = ["standard", "rain", "handheld", "combo", "body_spray"]
TRIM_GRADES = ["builder", "mid", "premium"]

BATHTUB_TYPES = ["alcove", "drop_in", "freestanding", "walk_in", "none"]
BATHTUB_MATERIALS = ["acrylic", "porcelain_steel", "cast_iron", "fiberglass"]

VANITY_SINK_TYPES = ["cabinet", "pedestal_sink", "wall_mount_sink"]
VANITY_WIDTHS = [24, 30, 36, 48, 60, 72]
VANITY_SOURCES = ["stock_rta", "semi_custom", "custom"]
VANITY_TOP_MATERIALS = ["cultured_marble", "quartz", "granite", "marble", "laminate"]
VANITY_MOUNTINGS = ["freestanding", "wall_mount"]
FAUCET_TYPES = ["single_hole", "centerset", "widespread", "wall_mount"]
MIRROR_TYPES = ["plain", "framed", "medicine_cabinet", "medicine_cabinet_recessed", "led_backlit"]

TOILET_TYPES = ["two_piece_standard", "two_piece_comfort", "one_piece_standard", "one_piece_comfort"]

TILE_MATERIALS = ["ceramic", "porcelain", "natural_stone", "glass_mosaic", "lvt_spc"]
TILE_PATTERNS = ["straight", "diagonal", "herringbone", "versailles"]

WATERPROOF_TYPES = ["paint_on", "sheet", "none"]

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
