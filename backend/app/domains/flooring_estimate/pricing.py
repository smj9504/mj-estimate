"""
Flooring estimate prices and the rules that aren't prices (waste, pattern
labor, box coverage).

Initial defaults, 2026-11. Where the bathroom catalog already prices the
same work, the same figure is used so the two estimates agree:
  LVT/SPC material 5.00/SF, ceramic 4.45 and porcelain 8.25/SF, tile floor
  labor 11.00/SF, floor tile removal 3.25/SF, self-leveling 5.30/SF,
  subfloor repair 9.45/SF, toilet and vanity detach & reset, MDF base
  5.45/LF, MDF quarter round 3.55/LF, floor protection 0.55/SF, 10-yard
  dumpster 420.
Added 2026-11-12 from Xactimate line items, marked up by XACTIMATE_MARKUP
(the owner's rule: never Xactimate's own figure; 10% over it). Each is
written as xact(<Xactimate price>) with the line's code beside it. Toilet,
vanity and toe kick detach & reset moved onto Xactimate the same way on
2026-11-13, in the bathroom catalog too.
The rest are mid-range DMV placeholders that have not been researched yet.
Check them with the update-unit-prices skill before relying on them; a
company can also set its own on the unit prices screen.

Prices include material and labor unless the table says otherwise
(price_catalog.py says which side each one is). Material sales tax and
O&P are added by the calculator, never typed in here.
"""

# What we charge over an Xactimate line item's price: one markup for every
# estimate, set in unit_prices/xactimate.py
from app.domains.unit_prices.xactimate import XACTIMATE_MARKUP, xact  # noqa: F401

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
# What happens to the baseboard (the owner's rule, 2026-11-12): under tile,
# LVP and laminate it stays on the wall and is painted, with new shoe
# molding; under a wood floor it is torn off and replaced
KEEPS_BASE_FLOORS = frozenset({"lvp", "laminate", "ceramic_tile", "porcelain_tile"})
WOOD_FLOORS = frozenset({"engineered_hardwood", "solid_hardwood"})
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
    "laminate": 3.25,
    "engineered_hardwood": 7.25,
    "solid_hardwood": 7.75,
    "ceramic_tile": 4.45,         # = bathroom ceramic
    "porcelain_tile": 8.25,       # = bathroom porcelain
    "sheet_vinyl": 2.25,
    "carpet": 29.70,              # per SY ($3.30/SF)
}

# Install labor, per SF (carpet per SY), straight lay
FLOORING_INSTALL_LABOR = {
    "lvp": 2.65,
    "laminate": 2.45,
    "engineered_hardwood": 4.15,
    "solid_hardwood": 5.25,
    "ceramic_tile": 11.00,        # = bathroom TILE_LABOR_RATES.floor_per_sf
    "porcelain_tile": 11.00,
    "sheet_vinyl": 2.10,
    "carpet": 8.10,               # per SY ($0.90/SF), pad laid in the same visit
}

# Carpet pad, material per SY (laid with the carpet)
PAD_PRICES = {
    "rebond_7_16": 5.85,
}

# Tear-out and haul to the truck, labor per SF
REMOVAL_RATES = {
    "carpet": 0.75,               # carpet and pad
    "lvp": 0.95,
    "laminate": 0.95,
    "engineered_hardwood": 2.10,
    "solid_hardwood": 2.40,
    "ceramic_tile": 3.25,         # = bathroom DEMO_RATES.floor_tile_per_sf
    "porcelain_tile": 3.25,
    "sheet_vinyl": 1.45,
}

# Getting the subfloor ready, per SF
PREP_RATES = {
    "floor_scrape_per_sf": 0.85,          # adhesive / residue scrape
    "self_leveling_per_sf": 5.30,         # = bathroom SUBSTRATE_RATES.self_leveling_per_sf
    "subfloor_repair_per_sf": 9.45,       # = bathroom SUBSTRATE_RATES.subfloor_repair_per_sf
    "underlayment_per_sf": 0.75,          # foam / cork roll under a floating floor
    "moisture_barrier_per_sf": 0.45,      # 6 mil poly over a slab
    "cement_board_per_sf": 3.85,          # backer board under tile on a wood subfloor
}

# Base trim, per LF
TRIM_RATES = {
    "baseboard_detach_reset_per_lf": 2.35,
    "baseboard_remove_per_lf": 0.80,
    "baseboard_mdf_per_lf": 5.45,         # = bathroom BASEBOARD_PRICES.mdf
    "baseboard_paint_per_lf": xact(2.13),     # PNT B2: left on the wall, two coats
    "shoe_molding_remove_per_lf": 0.55,
    "shoe_molding_per_lf": 3.75,          # install and paint
    "quarter_round_per_lf": 3.55,         # = bathroom QUARTER_ROUND_PRICES.mdf
    "tack_strip_per_lf": 0.60,
    "toe_kick_reskin_per_lf": xact(12.14),    # CAB PLYTK: new 1/4" prefinished skin over the old toe kick
}

# Moving what is in the way and putting it back, labor
DETACH_RESET_RATES = {
    "toilet": xact(395.96),               # PLM TLTRS (= bathroom DETACH_RESET_COSTS.toilet)
    # CAB VANTRS 2.5 LF + PLM SNKRS: a 30" vanity with its top, and its sink
    # (= bathroom DETACH_RESET_COSTS.vanity 30")
    "vanity": xact(90.96 * 2.5 + 244.52),
    "pedestal_sink": xact(462.02),        # PLM PSNKRS: disconnect, lift, reset and reconnect
    "utility_sink": xact(483.02),         # PLM LTUBRS: laundry tub / mop sink, supply, drain and faucet
    "toe_kick_per_lf": xact(9.54),        # CAB TKRS
    "appliance": 85,                      # one the sketch has no kind for
    "refrigerator": xact(61.53),          # APP RFRS
    "range": xact(46.17),                 # APP RGRS: electric, pull out, unplug, reset
    "range_gas": xact(261.16),            # APP RGGRS: gas, shut off, disconnect, reconnect, leak check
    "dishwasher": xact(380.98),           # APP DWRS: out from under the counter, water, drain, power
    "washer": xact(59.87),                # APP WSHRS
    "dryer": xact(46.17),                 # APP DRYRS: electric
    "dryer_gas": xact(224.48),            # APP DRYGRS
    "door": 48,
    "door_undercut": 38,
}

# Floor registers (heat / AC) set in the floor
HVAC_RATES = {
    "floor_register_detach_reset": xact(8.16),  # HVC REGFRS: lifted for the new floor, set back
    "floor_register_replace": xact(25.11),      # HVC REGF: the old one rusted, bent or the wrong size
}

# Cabinets the new floor goes under, labor
CABINET_RATES = {
    "base_detach_reset_per_lf": xact(83.51),    # CAB LOWRS: lower (base) units
    "island_detach_reset_per_lf": xact(83.51),  # CAB LOWRS: an island is base units too
    "panel_detach_reset_per_sf": xact(19.72),   # CAB APNLRS: an island's back and end panels
}

# More labor to tear out a floor than the floor's own removal, per SF
REMOVAL_EXTRA_RATES = {
    "mortar_bed_per_sf": xact(1.66),            # FCT MORTAR (its remove side): tile set thick in a mortar bed
    "tile_on_slab_per_sf": xact(2.13),          # FCT CNCRM: tile bonded to a concrete slab
    "glue_down_concrete_per_sf": xact(1.83),    # FCV PLKGDC / FCW GADDC: glued-down plank or wood over concrete
    "glue_down_wood_per_sf": xact(3.67),        # FCV PLKGDW / FCW GADDW: glued down over a wood subfloor
    "vinyl_extra_layer_per_sf": xact(0.38),     # FCV AVALR: another layer of vinyl under the top one
}

# Where one floor meets another
TRANSITION_RATES = {
    "transition_strip": 45.00,            # T-mold / reducer / carpet edge, one doorway
    "exterior_threshold": 68.00,
}

# Stairs, per step
STAIR_RATES = {
    "carpet_per_step": 52.00,
    "tread_riser_per_step": 145.00,       # hard-surface tread, riser and nose
}

CONTENTS_RATES = {
    "average_room": 64.50,                # move out then reset
}

# The whole job
GENERAL_RATES = {
    "haul_debris_load": 185.00,           # pickup truck load, dump fee included
    "dumpster_10yard": 420.00,            # = bathroom DEMO_RATES.dumpster_10yard
    "floor_protection_per_sf": 0.55,      # = bathroom HIDDEN_COSTS.floor_protection_per_sf
    "final_clean_per_sf": 0.28,
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
