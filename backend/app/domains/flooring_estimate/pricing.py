"""
Flooring estimate prices and the rules that aren't prices (waste, pattern
labor, box coverage).

Where the bathroom catalog already prices the same work, the same figure is
used so the two estimates agree:
  LVT/SPC material 5.00/SF, ceramic 4.45 and porcelain 8.25/SF, tile floor
  labor 11.00/SF, floor tile removal 3.25/SF, self-leveling 5.30/SF,
  subfloor repair 9.45/SF, toilet detach & reset 225, 30" vanity detach &
  reset 274, MDF base 5.45/LF, MDF quarter round 3.55/LF, floor
  protection 0.55/SF, 10-yard dumpster 420.
A company can set its own prices on the unit prices screen.

History
2026-11-12, first researched update. The flooring-only figures started as
unresearched placeholders, so they were re-set to the research, up or down,
instead of raised 1-5%. Sample estimates moved +0.2% to +7.7% in total.
  Sources: no public Northern Virginia Xactimate list exists, so figures
  are anchored to published Xactimate estimates (Baltimore MDBA8X Jun/Sep
  2024, Camden NJ Sep 2021, Houston Aug 2026, Boise 2024-25), brought
  forward by Verisk labor growth (~4-5%/yr); Homewyse at ZIP 22030 (May
  2026); Floor & Decor and Home Depot listings and Fairfax County dumpster
  quotes (Nov 2026).
  Trend: materials ~+2%/yr (Verisk Q3 2026), with Section 301 duties on
  China/Vietnam LVP and EU tile since 2026-07-24; labor ~+4%/yr, and DC
  had the fastest reconstruction-cost rise of any state.
  Shared with bathroom: left as they are, still equal. The research put
  several elsewhere; look at them with the next bathroom update: LVP
  material ~4.00, porcelain ~5.35 with setting materials, tile removal
  ~4.00, self-leveling ~4.25, subfloor ~6.75, toilet D&R ~290, 30" vanity
  D&R ~325, MDF base ~7.50, quarter round ~3.40, 10-yard dumpster ~550
  (Fairfax quotes $400-875).

Prices include material and labor unless the table says otherwise
(price_catalog.py says which side each one is). Material sales tax and
O&P are added by the calculator, never typed in here.
"""

# ──────────────────────────────────────────────
# What can be installed, and what can be torn out
# ──────────────────────────────────────────────

# key: (label on the estimate, unit it is sold in)
MATERIALS = {
    "lvp": {"label": "Luxury vinyl plank (LVP)", "short": "LVP", "unit": "SF",
            "line": "Luxury vinyl plank (LVP) - floating"},
    "laminate": {"label": "Laminate", "short": "Laminate", "unit": "SF",
                 "line": "Laminate flooring - floating"},
    "engineered_hardwood": {"label": "Engineered hardwood", "short": "Engineered", "unit": "SF",
                            "line": "Engineered hardwood flooring"},
    "solid_hardwood": {"label": "Solid hardwood (prefinished)", "short": "Hardwood", "unit": "SF",
                       "line": "Solid hardwood flooring - prefinished, nail down"},
    "ceramic_tile": {"label": "Ceramic tile", "short": "Ceramic", "unit": "SF",
                     "line": "Ceramic tile flooring"},
    "porcelain_tile": {"label": "Porcelain tile", "short": "Porcelain", "unit": "SF",
                       "line": "Porcelain tile flooring"},
    "sheet_vinyl": {"label": "Sheet vinyl", "short": "Sheet vinyl", "unit": "SF",
                    "line": "Sheet vinyl flooring"},
    "carpet": {"label": "Carpet & pad", "short": "Carpet", "unit": "SY",
               "line": "Carpet - mid grade, installed"},
}

# What the removal line says, by the floor being torn out
REMOVAL_LABELS = {
    "lvp": "Remove luxury vinyl plank - floating",
    "laminate": "Remove laminate flooring",
    "engineered_hardwood": "Remove engineered hardwood flooring",
    "solid_hardwood": "Remove solid hardwood flooring",
    "ceramic_tile": "Remove ceramic tile flooring",
    "porcelain_tile": "Remove porcelain tile flooring",
    "sheet_vinyl": "Remove sheet vinyl flooring",
    "carpet": "Remove carpet & pad",
}

HARD_SURFACES = frozenset({
    "lvp", "laminate", "engineered_hardwood", "solid_hardwood", "ceramic_tile", "porcelain_tile",
})
TILES = frozenset({"ceramic_tile", "porcelain_tile"})
# Floating floors that are laid over a separate underlayment roll
UNDERLAYMENT_FLOORS = frozenset({"laminate", "engineered_hardwood"})

PATTERNS = {"straight": "straight lay", "diagonal": "diagonal lay", "herringbone": "herringbone"}
# Materials laid in a pattern; carpet and sheet vinyl are rolled out
PATTERNED = HARD_SURFACES

# ──────────────────────────────────────────────
# Not prices: waste, pattern labor, packaging
# ──────────────────────────────────────────────

# Percent of the floor area added for cuts, by material and pattern
WASTE_PCT = {
    "lvp": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "laminate": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "engineered_hardwood": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "solid_hardwood": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "ceramic_tile": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "porcelain_tile": {"straight": 10, "diagonal": 15, "herringbone": 20},
    "sheet_vinyl": {"straight": 15},
    # Only when the room isn't cut from the roll in one piece (see calculator)
    "carpet": {"straight": 15},
}

# Laying on a diagonal or in herringbone is slower: the install labor goes up
PATTERN_LABOR_MULTIPLIER = {"straight": 1.00, "diagonal": 1.15, "herringbone": 1.40}

# SF in one box, to say how many boxes to order
BOX_COVERAGE_SF = {
    "lvp": 20.0,
    "laminate": 22.0,
    "engineered_hardwood": 24.0,
    "solid_hardwood": 20.0,
    "ceramic_tile": 15.0,
    "porcelain_tile": 15.5,
}

CARPET_ROLL_WIDTH_FT = 12.0
CARPET_TRIM_FT = 0.25          # 3" over at each cut, trimmed off at the wall
# A room is cut from the roll in one piece when it is at least this much of
# the roll's width across; a narrower one (a hall, a closet) comes from the
# leftovers, so it is priced by waste instead of a whole roll width
CARPET_ROLL_MIN_USE = 0.5
PAD_WASTE_PCT = 5

# ──────────────────────────────────────────────
# Prices
# ──────────────────────────────────────────────

# Floor material, per SF (carpet per SY), before waste
FLOORING_MATERIAL = {
    "lvp": 5.00,                  # = bathroom TILE_MATERIAL_RATES.lvt_spc
    "laminate": 2.75,             # retail medians 2.39-2.99 (HD, F&D)
    "engineered_hardwood": 6.50,  # F&D median 5.99, upper quartile 6.99
    "solid_hardwood": 6.50,       # prefinished oak: F&D 5.74-6.49, HD median 5.99
    "ceramic_tile": 4.45,         # = bathroom ceramic
    "porcelain_tile": 8.25,       # = bathroom porcelain
    "sheet_vinyl": 2.25,
    "carpet": 29.70,              # per SY ($3.30/SF)
}

# Install labor, per SF (carpet per SY), straight lay
FLOORING_INSTALL_LABOR = {
    "lvp": 2.65,
    "laminate": 3.00,             # DMV 3.22-6.84 (Homewyse 22030), HomeGuide 3-8
    "engineered_hardwood": 4.15,
    "solid_hardwood": 5.25,
    "ceramic_tile": 11.00,        # = bathroom TILE_LABOR_RATES.floor_per_sf
    "porcelain_tile": 12.00,      # porcelain runs $1-3/SF over ceramic
    "sheet_vinyl": 1.50,          # Angi ~1-2
    "carpet": 9.00,               # per SY ($1.00/SF), pad laid in the same visit; HomeGuide 4.50-13.50
}

# Carpet pad, material per SY (laid with the carpet)
PAD_PRICES = {
    "rebond_7_16": 5.85,          # 8 lb; DMV 4.50-7.65 (Potomac Floors 2026)
}

# Tear-out and haul to the truck, labor per SF
REMOVAL_RATES = {
    "carpet": 1.00,               # carpet and pad, dry; Homewyse 0.86-1.87
    "lvp": 1.55,                  # Xactimate Baltimore 1.44 (2024), brought forward
    "laminate": 1.60,             # Xactimate Houston 1.61 (2026)
    "engineered_hardwood": 3.10,  # Xactimate Baltimore "remove wood floor" 2.88 (2024), brought forward
    "solid_hardwood": 3.10,
    "ceramic_tile": 3.25,         # = bathroom DEMO_RATES.floor_tile_per_sf
    "porcelain_tile": 3.25,
    "sheet_vinyl": 1.45,
}

# Getting the subfloor ready, per SF
PREP_RATES = {
    "floor_scrape_per_sf": 0.95,          # adhesive / residue scrape; Xactimate Houston 0.91 (2026)
    "self_leveling_per_sf": 5.30,         # = bathroom SUBSTRATE_RATES.self_leveling_per_sf
    "subfloor_repair_per_sf": 9.45,       # = bathroom SUBSTRATE_RATES.subfloor_repair_per_sf
    "underlayment_per_sf": 0.75,          # foam / cork roll under a floating floor
    "moisture_barrier_per_sf": 0.45,      # 6 mil poly over a slab
    "cement_board_per_sf": 4.50,          # 1/4" backer board under tile on a wood subfloor; 2.70-8.50 (Xactimate, One and Done 2026)
}

# Base trim, per LF
TRIM_RATES = {
    "baseboard_detach_reset_per_lf": 4.00,  # Xactimate Houston D&R 5 1/4" MDF 4.22 (2026)
    "baseboard_remove_per_lf": 0.80,
    "baseboard_mdf_per_lf": 5.45,         # = bathroom BASEBOARD_PRICES.mdf
    "shoe_molding_remove_per_lf": 0.25,   # Xactimate Baltimore "remove base shoe" 0.21 (2024)
    "shoe_molding_per_lf": 3.40,          # install and paint; Xactimate Baltimore 1.96 + paint 1.21 (2024), brought forward
    "quarter_round_per_lf": 3.55,         # = bathroom QUARTER_ROUND_PRICES.mdf
    "tack_strip_per_lf": 0.75,            # Xactimate 0.55 (2021) to 0.82 (2023)
}

# Moving what is in the way and putting it back, labor
DETACH_RESET_RATES = {
    "toilet": 225,                        # = bathroom DETACH_RESET_COSTS.toilet
    "vanity": 274,                        # = bathroom DETACH_RESET_COSTS.vanity 30"
    "toe_kick_per_lf": 10.00,             # Xactimate NJ 8.25 (2021), brought forward
    "appliance": 65,                      # pull out and reset: Xactimate range 38-40, fridge 51-54 (2021), brought forward
    "dishwasher": 280,                    # disconnect and reconnect: Xactimate 207-272 (2021)
    "door": 32,                           # slab only: Xactimate 19-24 (2021), brought forward
    "door_undercut": 50,                  # cut down the slab: Xactimate NJ 41.60 (2021), brought forward
}

# Where one floor meets another
TRANSITION_RATES = {
    "transition_strip": 32.00,            # T-mold / reducer / carpet edge, one doorway; Xactimate T-mold 3 LF 23.73 (2021), brought forward
    "exterior_threshold": 85.00,          # Xactimate 65-69 (2021), brought forward
}

# Stairs, per step
STAIR_RATES = {
    "carpet_per_step": 45.00,             # Xactimate built up 28-35 (2021); DMV retail 35-50 with markup
    "tread_riser_per_step": 160.00,       # hard-surface tread, riser and nose; Xactimate oak R&R 136 (2021)
}

CONTENTS_RATES = {
    "average_room": 85.00,                # move out then reset; Xactimate 70 (NJ 2021) to 75 (Boise 2025)
}

# The whole job
GENERAL_RATES = {
    "haul_debris_load": 210.00,           # pickup truck load, dump fee included; Xactimate 152-267; Fairfax tipping fees up in FY2027
    "dumpster_10yard": 420.00,            # = bathroom DEMO_RATES.dumpster_10yard
    "floor_protection_per_sf": 0.55,      # = bathroom HIDDEN_COSTS.floor_protection_per_sf
    "final_clean_per_sf": 0.34,           # Xactimate 0.24-0.33 (2021-2025)
}


# ──────────────────────────────────────────────
# Company prices
# ──────────────────────────────────────────────
# The tables listed in price_catalog.py are wrapped in place, so a company's
# own prices and an estimate's pinned price book answer for them while it is
# calculated (app/domains/unit_prices). Outside a calculation they read as
# the defaults above.
from app.domains.unit_prices.catalog import install as _install_price_tables  # noqa: E402

from .price_catalog import PRICE_TABLES as _PRICE_TABLES  # noqa: E402

_install_price_tables("flooring", "Flooring", globals(), _PRICE_TABLES)
