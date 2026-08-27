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

2026-08-26 follow-up increase (user feedback: base prices still low vs.
market after the 2026-08-25 pass). Fresh research: HomeWyse May 2026 —
bathroom ceramic tile install $17.22-$21.37/SF all-in (already matched
by our porcelain floor combo ~$18.35/SF); DC toilet-install labor
benchmark $200-$300 (already matched/exceeded by our $365); bathroom
vanity install labor $576-$871 (our $499 was well below range).
Applied tiered: pure labor/install line items +15-20% (vanity install,
electrical fixture installs, bathtub/shower/sink/mirror install labor,
Detach & Reset costs), items already near market +5-8% (tile combo
rates, plumbing fixture-connection labor, demo, paint/trim, materials).
"""

# ──────────────────────────────────────────────
# Phase 1: Demo & Disposal
# ──────────────────────────────────────────────
# Sources: Angi avg $1,445, Modernize $8-$20/SF, This Old House $658-$2,469
DEMO_RATES = {
    # Per-SF demo rates (labor only — unskilled labor, straightforward removal)
    # 2026-08-26: +6-7% (Tier B — near-market category, follow-up pass)
    "floor_tile_per_sf": 3.25,        # tile removal + haul ($2-$4/SF avg)
    "wall_tile_per_sf": 4.05,         # wall tile removal ($3-$5/SF)
    "deck_tile_per_sf": 3.75,         # tub deck/rim tile removal — horizontal, easier access than
                                       # a wall, but bonded to a mortar bed/bullnose edge like a floor
    "ceiling_per_sf": 2.20,           # ceiling demo

    # Per-fixture demo (labor, disconnect + remove + haul)
    "bathtub_standard": 217,          # standard acrylic/fiberglass ($200-$500, HomeGuide 2026)
    "bathtub_cast_iron": 350,         # cast iron (heavy, needs crew)
    "shower_surround": 164,           # prefab surround removal
    "shower_custom_tile": 270,        # custom tile shower tear-out
    "vanity": 164,                    # vanity + top removal + haul ($150-$500, Angi 2026)
    "pedestal_sink": 60,              # pedestal sink disconnect + remove
    "wall_mount_sink": 55,            # wall-mount sink disconnect + remove
    "toilet": 65,                     # toilet disconnect + remove
    "mirror": 39,                     # mirror removal

    # Substrate demo
    "durock_per_sf": 2.20,            # cement board tear-out
    "drywall_per_sf": 1.95,           # drywall tear-out
    "subfloor_per_sf": 4.35,          # subfloor removal/repair

    # Dumpster (DMV area, Angi DC avg $442, range $370-$900)
    "dumpster_10yard": 420,
    "dumpster_15yard": 505,
    "dumpster_20yard": 590,
    "dump_tip_fee": 80,               # tip/disposal fee
    "debris_bag": 27.00,               # per bag: heavy-duty bag + haul-away labor
}

# ──────────────────────────────────────────────
# Phase 2: Plumbing Rough
# ──────────────────────────────────────────────
# Sources: Angi rough-in avg $6,500 (full new), Fixr $75-$150/hr plumber
# For like-for-like replacement, much less than full rough-in
PLUMBING_RATES = {
    # Per-unit costs (material + labor)
    # 2026-08-26: +5-7% (Tier B — fixture-connection labor already at/above
    # DC toilet-install benchmark $200-$300; nudged up modestly, not 15-20%)
    "shutoff_valve_each": 204,        # quarter-turn ball valve replacement ($150-$335, HomeWyse 2026)
    "supply_line_each": 72,           # braided stainless flex line
    "p_trap_each": 193,               # P-trap replacement ($200-$325, HomeAdvisor 2026; on-site discount)
    "drain_modification": 386,        # drain line modification
    "pressure_balance_valve": 466,    # code-required shower valve ($300-$550)
    "rough_inspection_fee": 163,      # county inspection fee

    # Fixture connection labor (licensed plumber, per fixture)
    "toilet_set": 387,                # toilet install (set, wax ring, bolt, connect, test; already at/above $200-$300 DC labor benchmark)
    "vanity_faucet_install": 249,     # faucet install ($200-$250; simplest plumbing task)
    "tub_faucet_install": 440,        # tub faucet/valve install (access panel, connect, test)
    "shower_valve_trim": 358,         # shower trim kit install (existing valve)
}

# ──────────────────────────────────────────────
# Phase 3: Electrical
# ──────────────────────────────────────────────
# Sources: Angi GFCI $130-$300 avg $210, Exhaust fan $250-$950
ELECTRICAL_RATES = {
    # 2026-08-26 follow-up: install-LABOR items (Tier A +16-18%, structurally
    # same underpriced gap as vanity install labor); fixture/material items
    # (gfci/exhaust fan/heated floor mat/inspection) stay Tier B +5-6%
    # 1st outlet ~$210 incl. service call; add'l same visit ~$100
    "gfci_outlet_each": 181,          # blended avg (1-3 outlets per bath) — Tier B
    "vanity_light_install": 227,      # light fixture install (labor) — Tier A
    "ceiling_fixture_install": 236,   # standard ceiling light install — Tier A
    "recessed_light_install": 275,    # recessed can light (cut hole + housing + trim + wire) — Tier A
    "recessed_light_multi": 214,      # per-can when installing multiple (reduced per-unit) — Tier A
    "exhaust_fan": {                  # fan + install by CFM ($250-$950, Angi/HomeGuide) — Tier B
        50: 357,
        80: 466,
        110: 599,
        150: 756,
    },
    "exhaust_fan_switch": {           # switch upgrade — Tier B
        "standard": 39,
        "timer": 83,
        "humidity": 138,
    },
    "heated_floor_per_sf": 13.25,     # mat + install ($8-$15/SF, Greenwave 2025) — Tier B
    "heated_floor_thermostat": 211,   # programmable thermostat — Tier A (install labor)
    "heated_floor_circuit": 421,      # dedicated 20A circuit — Tier A (install labor)
    "electrical_inspection_fee": 137, # county inspection — Tier B
    "megohmmeter_check": 163,         # insulation resistance test on circuits — Tier B
}

# ──────────────────────────────────────────────
# Phase 4: Substrate (Durock / Waterproofing)
# ──────────────────────────────────────────────
# Sources: CountBricks $4-$6/SF labor, PRG Contractors, TillerStead
SUBSTRATE_RATES = {
    # 2026-08-26: +6-7% (Tier B, follow-up pass)
    "durock_per_sf": 7.20,            # 1/2" cement board material + install ($5-$8/SF)
    "durock_floor_per_sf": 6.15,      # 1/4" cement board for floor
    "greenboard_per_sf": 5.00,        # moisture-resistant drywall
    "mold_resistant_drywall_per_sf": 5.85,  # mold-resistant ceiling drywall

    # Waterproofing membrane
    "paint_on_per_sf": 2.50,          # paint-on membrane: RedGard, HydroBan ($1-$3/SF)
    # Sheet membrane: Schluter Kerdi — material ~$2.25/SF + thinset + labor → $7-$12/SF
    "sheet_per_sf": 10.00,

    # Subfloor repair
    "subfloor_repair_per_sf": 9.45,   # plywood + install ($6-$12/SF)
    "self_leveling_per_sf": 5.30,     # self-leveling compound + pour ($3-$7/SF, Angi 2026)

    # Drywall repair (full replacement: hang + tape + mud + sand + prime)
    "drywall_replace_per_sf": 6.40,   # standard 1/2" drywall ($4-$7/SF installed)
    "drywall_replace_moisture_per_sf": 7.20,  # greenboard/moisture-resistant ($5-$8/SF)

    # Insulation (demo + install)
    "insulation_demo_per_sf": 1.65,             # tear-out existing insulation ($1-$2/SF)
    "insulation_fiberglass_batt_per_sf": 2.75,  # R-13 fiberglass batt supply + install ($1.50-$3.50/SF)
    "insulation_blown_in_per_sf": 3.35,         # blown-in cellulose/fiberglass ($2-$4/SF)
    "insulation_spray_foam_per_sf": 6.10,       # closed-cell spray foam ($4-$7/SF)
    "insulation_rigid_board_per_sf": 4.45,      # rigid foam board supply + install ($3-$5/SF)
}

# ──────────────────────────────────────────────
# Phase 5: Tile & Flooring
# ──────────────────────────────────────────────
# Sources: HomeWyse $17-$21/SF installed, Angi $10-$50/SF, RUBI $12-$35/SF
TILE_MATERIAL_RATES = {
    # Material cost per SF
    # 2026-08-26: +5-6% (Tier B — combo already near HomeWyse May 2026
    # ceramic tile install benchmark $17.22-$21.37/SF all-in; modest nudge only)
    "ceramic": 4.45,                  # $2-$5/SF (Angi, HomeAdvisor)
    "porcelain": 8.25,                # $4-$10/SF (Angi)
    "natural_stone": 19.85,           # $10-$30/SF
    "glass_mosaic": 24.25,            # $16-$30/SF
    "lvt_spc": 5.00,                  # $3-$7/SF LVT/SPC plank
}

TILE_LABOR_RATES = {
    # Labor per SF by application
    # 2026-08-26: +5% (Tier B — porcelain floor combo already ~$19.25/SF,
    # inside the $17.22-$21.37/SF HomeWyse May 2026 benchmark range)
    "floor_per_sf": 11.00,            # $8-$14/SF (Fixr tile installer)
    "wall_per_sf": 13.25,             # $10-$15/SF (vertical work premium)
    "shower_wall_per_sf": 15.45,      # $10-$18/SF (wet area, precision)
    # slope + drain cuts + mosaic → more labor than shower wall
    "shower_floor_per_sf": 19.85,     # $16-$22/SF
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
    # 2026-08-26: +6% (Tier B, follow-up pass)
    "grout_per_sf": 1.65,             # grout material
    "sealer_per_sf": 0.85,            # sealant for natural stone
    "thinset_per_sf": 0.72,           # thinset mortar
    "tile_demo_per_sf": 4.35,         # old tile removal ($1.50-$4.50/SF)
}

# ──────────────────────────────────────────────
# Phase 6: Fixtures
# ──────────────────────────────────────────────
# Sources: Angi, HomeGuide, Fixr, Boss Design Center DC

# Bathtub (material only, install separate under plumbing)
# 2026-08-26: +6-7% (Tier B — material, follow-up pass)
BATHTUB_PRICES = {
    "alcove": {
        "acrylic": 488,               # most common, $300-$600
        "porcelain_steel": 380,       # cheap but chips, $200-$500
        "cast_iron": 1028,            # heavy, premium, $700-$1,200
        "fiberglass": 356,            # budget, $200-$450
    },
    "drop_in": {
        "acrylic": 705,
        "porcelain_steel": 597,
        "cast_iron": 1300,
        "fiberglass": 547,
    },
    "freestanding": {
        "acrylic": 1300,              # $800-$2,000
        "cast_iron": 2710,            # $1,500-$4,000
        "fiberglass": 875,
    },
    "walk_in": {
        "acrylic": 3785,              # ADA/senior, $2,500-$5,000+
    },
}

# 2026-08-26: +16-18% (Tier A — pure install labor, structurally underpriced
# like vanity install; HomeWyse May 2026 vanity-install benchmark $576-$871
# exposed the same gap likely applies to other install-labor line items)
BATHTUB_INSTALL = {
    "alcove": 807,                    # standard install (set, level, seal, connect; $500-$1,500 HomeGuide 2026)
    "drop_in": 1135,                  # deck mount, more plumber time + framing
    "freestanding": 1328,             # floor mount, filler, drain alignment
    "walk_in": 1988,                  # complex install + electrical + ADA compliance
}

BATHTUB_EXTRAS = {
    # 2026-08-26: whirlpool/air-jet upgrade + surround tile labor = Tier B
    # (+5-6%, material/tile-adjacent); D&R-style install-labor items below
    # = Tier A (+16-18%, same underpriced-install-labor gap as vanity)
    "whirlpool_upgrade": 869,         # jets + pump + dedicated circuit
    "air_jet_upgrade": 652,
    "surround_tile_labor_per_sf": 14.35,  # surround tile install ($10-$16/SF) — tile labor category
    # Drain/overflow assembly — new tub needs new drain kit
    # Includes: drain body, overflow plate, linkage, gaskets, plumber's putty
    # Sources: Angi 2025-2026, HomeWyse ($80-$200 installed)
    "drain_overflow_kit": 161,        # drain + overflow assembly supply + install
    # Mortar bed / setting material — level base for tub
    # Acrylic/fiberglass tubs REQUIRE full support underneath (flex = crack)
    # Sources: Angi 2025, TerryLove forum, HomeGuide ($50-$150)
    "mortar_bed": 115,                # mortar mix + pour + level ($75-$125)
    # Tub/shower valve replacement (when tub has surround tile / combo unit)
    # Valve body + trim kit, Moen/Delta mid-grade ($250-$450 parts + $150-$250 labor)
    "shower_valve_body_trim": 568,    # pressure-balance valve body + trim kit installed
    "shower_valve_trim_only": 271,    # trim kit only (retain existing valve body)
    "showerhead_install": 104,        # shower head + arm install labor
    "curtain_rod": 79,                # curtain rod + rings + mount (supply + install)
}

# Shower door / enclosure
# Material price by type × opening width (inches)
# Sources: Angi 2026, HomeGuide 2026, ThisOldHouse 2026
# 2026-08-26 2nd follow-up (user feedback: door pricing still low even after
# the +5-6% Tier B bump). Fresh research: framed $400-900 installed, semi-
# frameless $500-1550, frameless $600-1900 (or $1000-2500/$1000-3000+ per
# other sources) — "frameless runs 40-60% above framed" is the market norm,
# but our combined (material+install) framed-vs-frameless gap had already
# grown wider than that, so weighted the increase toward framed/semi-
# frameless (still below top of their ranges) and kept frameless's bump
# smaller (already relatively ahead) to avoid stretching the ratio further:
# framed +12%, semi-frameless +10%, frameless +8%, fixed_panel +10%.
SHOWER_DOOR_PRICES = {
    # Curtain - flat rate
    "curtain": {"any": 49},
    # Framed sliding/bypass - budget ($400-$900 installed)
    "framed_sliding": {
        48: 342, 60: 428, 72: 514,
    },
    # Semi-frameless sliding ($700-$1,500 installed)
    "semi_frameless_sliding": {
        48: 541, 60: 655, 72: 774,
    },
    # Frameless sliding ($1,000-$2,500 installed, Angi 2026)
    "frameless_sliding": {
        48: 1051, 60: 1227, 72: 1460,
    },
    # Framed pivot ($400-$1,100 installed)
    "framed_pivot": {
        28: 307, 32: 367, 36: 429,
    },
    # Semi-frameless pivot
    "semi_frameless_pivot": {
        28: 481, 32: 570, 36: 655,
    },
    # Frameless pivot ($1,000-$3,500 installed, Angi 2026)
    "frameless_pivot": {
        28: 1051, 32: 1285, 36: 1578,
    },
    # Fixed panel / half wall glass
    "fixed_panel": {
        24: 481, 30: 655, 36: 833,
    },
}

# Installation labor by door category (precision leveling, drilling, sealing)
# 2026-08-26: +16-18% (Tier A — pure install labor, same underpriced gap as
# vanity install; curtain install stays $0, no labor line for a curtain rod hang)
SHOWER_DOOR_INSTALL = {
    "curtain": 0,
    "framed_sliding": 331,
    "semi_frameless_sliding": 452,
    "frameless_sliding": 577,
    "framed_pivot": 331,
    "semi_frameless_pivot": 452,
    "frameless_pivot": 577,
    "fixed_panel": 419,
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

# Legacy compat — still referenced by enclosure dropdown
# 2026-08-26 2nd follow-up: same +12%/+10%/+8% weighting as SHOWER_DOOR_PRICES
SHOWER_ENCLOSURE_PRICES = {
    "curtain": 49,
    "sliding": 429,
    "pivot": 655,
    "frameless": 1928,
    "half_wall_glass": 1428,
}

SHOWER_INSERT_PRICES = {
    # Prefab shower units (material only), Tier B +5-6%
    "one_piece": 707,                 # fiberglass one-piece ($400-$1,000)
    "multi_piece_kit": 1026,          # multi-piece kit ($600-$1,500)
}

# prefab shower unit install (set, level, seal, connect)
# 2026-08-26: +17% (Tier A — pure install labor)
SHOWER_INSERT_INSTALL = 690

# Neo-angle (corner) shower components
# Sources: Home Depot, Lowe's, Amazon 2025-2026
# Neo-angle base pan: acrylic/fiberglass, center drain
NEO_ANGLE_BASE_PRICES = {
    # By size (inches), material only. 2026-08-26: +5-6% (Tier B)
    32: 196,   # 32x32 ($150-$230)
    36: 241,   # 36x36 ($170-$280)
    38: 383,   # 38x38 ($270-$490)
    42: 460,   # 42x42 ($350-$500)
    48: 595,   # 48x48 ($450-$650)
}

# pan install: set, level, seal, connect drain
# 2026-08-26: +17% (Tier A — pure install labor)
NEO_ANGLE_BASE_INSTALL = 572

# Neo-angle shower door (3-panel enclosure)
# door + 2 fixed side panels
# Higher than regular: precision angles, custom glass
# 2026-08-26 2nd follow-up: same +12%/+10%/+8% weighting as SHOWER_DOOR_PRICES
# (still low even after the earlier +5-6% Tier B pass)
NEO_ANGLE_DOOR_PRICES = {
    # Framed (most common, budget) — by size
    "framed_neo_angle": {
        32: 429, 36: 515, 38: 606,
        42: 727, 48: 909,
    },
    # Semi-frameless
    "semi_frameless_neo_angle": {
        32: 655, 36: 774, 38: 893,
        42: 1070, 48: 1309,
    },
    # Frameless ($1,200-$3,500+ installed, Angi 2026)
    "frameless_neo_angle": {
        32: 1227, 36: 1460, 38: 1695,
        42: 2044, 48: 2453,
    },
}

# 2026-08-26: +17-18% (Tier A — pure install labor)
NEO_ANGLE_DOOR_INSTALL = {
    "framed_neo_angle": 452,
    "semi_frameless_neo_angle": 572,
    "frameless_neo_angle": 699,
}

# Neo-angle prefab wall surround
# (acrylic/fiberglass, replaces tile)
# Sources: MAAX, American Standard, Aquatic 2025-2026
# 2026-08-26: +5-6% (Tier B — material)
NEO_ANGLE_WALL_SURROUND_PRICES = {
    # By base size (inches), material only
    "prefab_acrylic": {
        32: 274, 36: 352, 38: 437,
        42: 541, 48: 704,
    },
    "prefab_fiberglass": {
        32: 191, 36: 246, 38: 300,
        42: 383, 48: 487,
    },
    "solid_surface": {
        32: 649, 36: 812, 38: 973,
        42: 1190, 48: 1514,
    },
}

# surround panel install ($350-$500)
# 2026-08-26: +16% (Tier A — pure install labor)
NEO_ANGLE_WALL_SURROUND_INSTALL = 508

# Complete neo-angle kits (base + walls + door)
# Budget: MAAX Warren, Aqua Glass, American Std
# 2026-08-26: +5% (Tier B — material)
NEO_ANGLE_KIT_PRICES = {
    # base + wall surround + door (material only)
    "basic_fiberglass": {
        36: 812, 38: 973, 42: 1244,
    },
    "mid_acrylic": {
        36: 1298, 38: 1514, 42: 1947,
    },
}

# full kit install ($650-$850)
# 2026-08-26: +17% (Tier A — pure install labor)
NEO_ANGLE_KIT_INSTALL = 904

# tile-adjacent labor items, Tier B +5-6%
SHOWER_CUSTOM_EXTRAS = {
    "niche_each": 206,                # recessed niche (material + labor)
    "bench": 495,                     # tiled bench (material + labor)
    "curb": 250,                      # standard curb build
    "curbless_drain": 715,             # linear drain + slope work
}

# Shower head/valve — fixtures, Tier B +5-6%
SHOWERHEAD_PRICES = {
    "standard": 71,
    "rain": 189,
    "handheld": 104,
    "combo": 244,                     # rain + handheld
    "body_spray": 378,                # per set
}

SHOWER_VALVE_PRICES = {
    "pressure_balance": 300,          # code-required basic
    "thermostatic": 594,              # premium
}

TRIM_GRADE_MULTIPLIER = {
    "builder": 0.80,
    "mid": 1.00,
    "premium": 1.45,
}

# Vanity
# 2026-08-26: +5-6% (Tier B — material; the Tier A gap found in research was
# specific to vanity INSTALL LABOR, not the vanity unit material cost itself)
VANITY_PRICES = {
    # By width (material only, mid-range stock)
    "stock_rta": {24: 390, 30: 468, 36: 551, 48: 772, 60: 1048, 72: 1323},
    "semi_custom": {24: 724, 30: 882, 36: 1048, 48: 1489, 60: 1985, 72: 2646},
    # truly custom (local shop/craftsman); DMV min ~$2,500 for 36"
    "custom": {
        24: 1820, 30: 2315, 36: 2756,
        48: 3969, 60: 5292, 72: 6836,
    },
}

VANITY_TOP_PRICES = {
    # Per linear inch of width, Tier B +5%
    "cultured_marble": 8.85,          # integrated bowl, cheapest
    "quartz": 15.45,                  # most popular (36"=$556)
    "granite": 14.35,                 # (36"=$517)
    "marble": 24.25,                  # premium, sealing required
    "laminate": 5.55,
}

# 2026-08-26: +18% (Tier A — HomeWyse May 2026 vanity-install benchmark
# $576-$871 (mid ~$724); our prior $499 was well below even the low end)
VANITY_INSTALL = 589                  # labor to install vanity (set, level, secure, cutouts; $576-$871 HomeWyse 2026)

VANITY_EXTRAS = {
    # 2026-08-26: faucet/blocking install labor = Tier A +15-17% (same
    # underpriced-install-labor gap as vanity install); toe kick = Tier B
    # +6% (material, not labor)
    "wall_mount_blocking": 271,       # wood blocking for floating vanity (framing work)
    "faucet_single_hole": 298,        # faucet supply + install
    "faucet_centerset": 335,
    "faucet_widespread": 422,
    "faucet_wall_mount": 628,         # wall-mount requires rough valve + access
    "toe_kick_per_lf": 13.35,         # toe kick board (supply + install, freestanding vanity)
}

# Pedestal Sink / Wall-Mount Sink (non-vanity options)
# 2026-08-26: material Tier B +5%
SINK_PRICES = {
    # Supply (fixture + faucet)
    "pedestal_sink": 378,             # pedestal sink unit ($250-$500)
    "wall_mount_sink": 324,           # wall-mount basin ($200-$450)
}
# 2026-08-26: +16-17% (Tier A — pure install labor)
SINK_INSTALL = {
    "pedestal_sink": 448,             # set pedestal, connect plumbing ($300-$450)
    "wall_mount_sink": 513,           # blocking + bracket + connect ($350-$500)
}
SINK_FAUCET = {
    # Tier B material +5%
    "centerset": 189,                 # 4" centerset faucet supply
    "single_hole": 163,               # single hole faucet supply
}
# 2026-08-26: +17% (Tier A — pure install labor, same as vanity)
SINK_FAUCET_INSTALL = 271             # faucet install labor (same as vanity)

# Mirror / Medicine Cabinet
# 2026-08-26: material Tier B +5-6%
MIRROR_PRICES = {
    "plain": 93,
    "framed": 189,
    "medicine_cabinet": 297,          # surface mount
    "medicine_cabinet_recessed": 405, # recessed (requires wall work)
    "led_backlit": 460,               # + electrical
}

# 2026-08-26: +17% (Tier A — pure install labor)
MIRROR_INSTALL = 151                  # labor to hang (anchoring, leveling)

# Toilet, Tier B +5% (fixture material — toilet SET labor is in PLUMBING_RATES)
TOILET_PRICES = {
    # Material only (install under plumbing)
    "two_piece_standard": 244,        # basic two-piece ($130-$250)
    "two_piece_comfort": 319,         # comfort height
    "one_piece_standard": 405,        # one-piece ($250-$450)
    "one_piece_comfort": 460,
    "bidet_seat": 378,                # bidet seat add-on (needs GFCI)
    "smart_toilet": 1298,             # integrated bidet ($800-$2,000)
}

TOILET_EXTRAS = {
    "wax_ring": 16.45,
    "flange_repair": 104,             # if slab condition requires
    "soft_close_seat": 49,            # if not included
}

# ──────────────────────────────────────────────
# Phase 7: Finish (Paint, Trim, Accessories)
# ──────────────────────────────────────────────
# Sources: Fixr painter $2-$7/SF, HomeGuide baseboard $1-$3.50/LF
# 2026-08-26: +6% (Tier B, follow-up pass)
PAINT_RATES = {
    "seal_prime_per_sf": 1.65,        # seal & prime repaired drywall only
    "wall_per_sf": 4.90,              # paint walls (prep + 2 coats; $4-$9/SF HomeWyse 2026)
    "ceiling_per_sf": 5.15,           # ceiling paint (overhead premium)
    "trim_per_lf": 4.10,              # baseboard/trim paint ($2.30-$4.88/LF)
}

PAINT_PREP = {
    # 2026-08-26: +7-8% (Tier B)
    "masking_per_sf": 0.80,               # tape, plastic sheeting on fixtures/trim ($0.50-$1.00/SF)
    "floor_protection_per_sf": 0.55,      # drop cloth / ram board for paint work ($0.35-$0.65/SF)
}

PAINT_GRADE_MULTIPLIER = {
    "builder": 0.85,
    "mid": 1.00,
    "premium": 1.30,                  # Sherwin Cashmere, BM Aura
}

# 2026-08-26: +6% (Tier B)
BASEBOARD_PRICES = {
    # Material + install per LF
    "pvc": 7.00,                      # PVC (recommended for bath)
    "mdf": 5.45,
    "wood": 9.15,
    "tile": 13.00,
}

# Tile baseboard pricing by tile material (material + labor per LF)
# Sources: HomeAdvisor 2025, Angi 2026, FlooringClarity
# 2026-08-26: +5% (Tier B — tile category, already near market)
TILE_BASEBOARD_PRICES = {
    "ceramic": 9.95,                  # $8-$12/LF installed
    "porcelain": 13.25,               # $10-$15/LF installed
    "natural_stone": 19.85,           # $15-$25/LF installed
    "glass_mosaic": 22.00,            # $16-$25/LF installed
}

# Quarter round molding pricing (material + labor per LF)
# Add-on to standard baseboard install; matches baseboard material
# Sources: Angi 2026 ($3-$7/LF installed), HomeGuide 2026, CountBricks 2026
# DMV mid-range: thin pin-nailer install, slightly faster than baseboard
# 2026-08-26: +6-7% (Tier B)
QUARTER_ROUND_PRICES = {
    "pvc": 4.05,                      # PVC quarter round (moisture-resistant, bath)
    "mdf": 3.55,                      # MDF quarter round (budget, paintable)
    "wood": 4.90,                     # Paint-grade pine quarter round
}

# Accessories (material + install per piece)
# Sources: HomeWyse towel bar $61-$134, grab bar $100-$350
# 2026-08-26: +6-8% (Tier B)
ACCESSORY_PRICES = {
    "towel_bar": 104,                 # supply + install ($61-$134)
    "hand_towel_ring": 81,
    "tp_holder": 60,
    "robe_hook": 55,
    "corner_shelf": 71,
    "grab_bar": 243,                  # + blocking ($100-$350, HomeGuide)
    "toilet_brush_holder": 50,
    "soap_dispenser": 71,
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
# 2026-08-26: +16-18% (Tier A — this is 100% install/removal labor, same
# underpriced-install-labor gap the vanity-install research exposed)
DETACH_RESET_COSTS = {
    # Toilet: disconnect water, remove wax ring, store, reinstall w/ new wax ring
    "toilet": 225,                    # ~1.5 hrs plumber ($125-$250)
    # Vanity + sink: disconnect plumbing, remove, store, reinstall & reconnect
    # Larger vanities need 2-person crew, more time, bigger storage footprint
    # Sources: Xactimate D&R, Angi 2025-2026, HomeGuide
    "vanity": {
        24: 241,                      # small single vanity, ~1.5 hrs ($150-$250)
        30: 274,                      # standard single, ~1.75 hrs ($175-$275)
        36: 335,                      # standard single, ~2.5 hrs ($200-$350)
        48: 422,                      # large single, ~3 hrs, may need 2 ppl ($275-$425)
        60: 517,                      # double vanity, 2-person crew, ~3.5 hrs ($350-$500)
        72: 614,                      # large double, 2-person crew, ~4 hrs ($400-$600)
    },
    # Bathtub: disconnect plumbing, remove, store, reinstall
    "bathtub_standard": 548,          # ~4 hrs ($350-$550)
    "bathtub_cast_iron": 791,         # ~6 hrs, heavy ($500-$800)
    # Shower door/enclosure: careful glass removal, store, reinstall
    "shower_door": 335,               # ~2.5 hrs ($200-$350)
    # Shower surround (prefab): remove panels, store, reinstall
    "shower_surround": 422,           # ~3 hrs ($275-$425)
    # Mirror: careful removal, store, reinstall
    "mirror": 116,                    # ~0.75 hrs ($65-$125)
    # Vanity light: disconnect, remove, store, reinstall
    "vanity_light": 104,              # ~0.5-0.75 hrs ($65-$110)
    # Accessories (towel bars, tp holders, etc.): remove all, store, reinstall
    # Per-piece: unscrew/pull anchors, label, bag, reinstall w/ new anchors
    # Sources: Xactimate D&R, Angi 2025-2026
    "accessory_per_piece": 42,       # ~15-20 min each ($25-$45)
}

# ──────────────────────────────────────────────
# Hidden / Commonly Missed Costs
# ──────────────────────────────────────────────
# 2026-08-26: +5-6% (Tier B, follow-up pass)
HIDDEN_COSTS = {
    "floor_protection": 136,          # Ram board, plastic, tape
    "mobilization": 190,              # tool/equipment transport
    "final_clean": 244,               # move-in ready cleaning
    "punch_list": 216,                # 1-2 follow-up visits
    "caulk_day": 298,                 # silicone/latex caulking (1 day labor)
    "drywall_patch_per_sf": 6.10,     # patching around tile edges
    "drywall_skim_coat_per_sf": 4.70, # skim coat after tile removal ($3-$6/SF)
    "trim_paint_per_lf": 4.90,        # post-install trim paint
    "lead_rrp": 402,                  # EPA RRP surcharge (pre-1978)
    "cast_iron_disposal": 190,        # weight surcharge for CI tub
    "permit_fee": 268,                # building permit (varies by county, $150-$400)
}

# ──────────────────────────────────────────────
# Shower Pan / Pre-slope (custom tile showers)
# ──────────────────────────────────────────────
# Sources: HomeGuide 2025, Angi 2026, Fixr
# 2026-08-26: +6% (Tier B — tile/waterproofing category, already near market)
SHOWER_PAN_COSTS = {
    "mortar_preslope_per_sf": 9.45,   # mud bed pre-slope ($6-$12/SF)
    "pan_liner": 206,                 # PVC liner + drain assembly
    "curb_waterproof": 83.25,         # curb membrane wrap
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
