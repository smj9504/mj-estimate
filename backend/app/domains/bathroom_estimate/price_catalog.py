"""
The bathroom prices a company can change: which tables in pricing.py are
prices, grouped for the price screen, and whether each is material, labor
or both. pricing.py wraps exactly these (unit_prices.catalog.install).

A price that is both is split by its line category's material share
(pricing.MATERIAL_SHARE_BY_CATEGORY), the same split the calculator loads
material tax on, unless a key says otherwise. Multipliers, waste, tax,
zip factors and permit rules aren't here: they stay code.
"""

from app.domains.unit_prices.catalog import LABOR, MATERIAL, MIXED, TableSpec

# Line category shares, as in pricing.MATERIAL_SHARE_BY_CATEGORY
_PLUMBING = 0.30
_ELECTRICAL = 0.20
_SUBSTRATE = 0.35
_TILE = 0.45
_FIXTURE = 0.70
_FINISH = 0.35
_ACCESSORY = 0.60

PRICE_TABLES = [
    # ── Demo & disposal ──
    TableSpec(
        "DEMO_RATES", "Demo & Disposal", kind=LABOR,
        kinds={
            "dumpster_10yard": MATERIAL, "dumpster_15yard": MATERIAL,
            "dumpster_20yard": MATERIAL, "dump_tip_fee": MATERIAL,
            "debris_bag": MATERIAL,
        },
        units={"dumpster_10yard": "EA", "dumpster_15yard": "EA", "dumpster_20yard": "EA"},
        note="Dumpster, tip fee and debris bags are fees; the rest is removal labor.",
    ),
    # ── Plumbing ──
    TableSpec(
        "PLUMBING_RATES", "Plumbing", kind=MIXED, share=_PLUMBING,
        kinds={
            "toilet_set": LABOR, "vanity_faucet_install": LABOR,
            "tub_faucet_install": LABOR, "shower_valve_trim": LABOR,
            "rough_inspection_fee": MATERIAL,
        },
    ),
    TableSpec(
        "LAYOUT_CHANGE_RATES", "Layout Changes", kind=MIXED, share=_PLUMBING,
        shares={
            "partition_wall_per_lf": _SUBSTRATE, "wall_removal_per_lf": 0.10,
            "door_relocation": _SUBSTRATE, "door_new_opening": _SUBSTRATE,
            "door_infill": _SUBSTRATE, "light_relocation": _ELECTRICAL,
            "light_new_box": _ELECTRICAL,
        },
        note="What an option's sketch moves, adds or takes out against the bathroom as it is.",
    ),
    # ── Electrical ──
    TableSpec(
        "ELECTRICAL_RATES", "Electrical", kind=MIXED, share=_ELECTRICAL,
        kinds={
            "vanity_light_install": LABOR, "ceiling_fixture_install": LABOR,
            "megohmmeter_check": LABOR, "electrical_inspection_fee": MATERIAL,
        },
        labels={"exhaust_fan_switch": "Exhaust fan switch"},
        size_formats={"exhaust_fan": "{} CFM"},
    ),
    # ── Substrate ──
    TableSpec(
        "SUBSTRATE_RATES", "Substrate & Insulation", kind=MIXED, share=_SUBSTRATE,
        kinds={"insulation_demo_per_sf": LABOR},
    ),
    TableSpec(
        "SHOWER_PAN_COSTS", "Custom Tile Shower", kind=MIXED, share=_SUBSTRATE,
    ),
    # ── Tile ──
    TableSpec("TILE_MATERIAL_RATES", "Tile", kind=MATERIAL, unit="SF",
              labels={"lvt_spc": "LVT / SPC"}, note="Tile material per SF, before waste."),
    TableSpec("TILE_LABOR_RATES", "Tile", kind=LABOR,
              note="Setting labor per SF; thinset and grout are in it."),
    TableSpec("TILE_EXTRAS", "Tile", kind=MIXED, share=_TILE, skip=("waste_factor",)),
    TableSpec("TILE_BASEBOARD_PRICES", "Tile", kind=MIXED, share=_TILE, unit="LF",
              note="Tile base per LF, material and labor."),
    TableSpec("DECORATIVE_TILE", "Tile", kind=MIXED, share=_TILE, title="Decorative",
              labels={"border_per_lf": "Border / listello", "insert_each": "Accent insert"},
              note="On top of the field tile: a border strip per LF, an insert each."),
    TableSpec("WALL_NICHE_PRICES", "Tile", kind=MIXED, share=_TILE, title="Wall niches",
              units={"tile": "EA", "foam_insert": "EA", "drywall_build": "EA", "paint": "EA"},
              shares={"drywall_build": _FINISH, "paint": _FINISH},
              labels={"tile": "Tile a niche (tile, trim & labor)", "foam_insert": "Foam niche insert, set & sealed",
                      "drywall_build": "Drywall niche, framed & finished", "paint": "Paint a niche"},
              note="Each 12″ × 12″ niche (Xactimate's: 4 LF of edge); a bigger one is priced at its edge over 4 LF. "
                   "A tiled one is the tile (plus the foam insert if it's one); a drywall one is built and painted."),
    # ── Bathtub ──
    TableSpec("BATHTUB_PRICES", "Bathtub", kind=MATERIAL),
    TableSpec("BATHTUB_INSTALL", "Bathtub", kind=LABOR),
    TableSpec(
        "BATHTUB_EXTRAS", "Bathtub", kind=MIXED, share=_PLUMBING,
        kinds={"surround_tile_labor_per_sf": LABOR, "showerhead_install": LABOR},
        shares={"whirlpool_upgrade": _FIXTURE, "air_jet_upgrade": _FIXTURE, "curtain_rod": _FINISH},
    ),
    TableSpec("TUB_FAUCET_PRICES", "Bathtub", kind=MATERIAL,
              note="Faucet material; its labor is Plumbing · Tub faucet install."),
    TableSpec(
        "TUB_GLASS_PANEL", "Bathtub", kind=MIXED, share=0.58, title="Glass panel",
        kinds={"frosted_per_sf": MATERIAL, "detach_reset_per_sf": LABOR, "minimum": LABOR},
        labels={"replace_per_sf": "New, per SF", "frosted_per_sf": "Frosted glass, per SF",
                "detach_reset_per_sf": "Detach & reset, per SF", "minimum": "Minimum charge"},
        units={"minimum": "EA"},
        note="A fixed glass panel on the tub, per SF of glass; never under the minimum.",
    ),
    TableSpec(
        "TUB_GLASS_DOORS", "Bathtub", kind=MIXED, share=0.58, title="Sliding doors",
        kinds={"detach_reset": LABOR, "frameless_detach_reset_per_sf": LABOR},
        labels={"standard": "Framed set, standard (chrome)",
                "mid": "Framed set, chrome with obscure glass",
                "high": "Framed set, bronze or brass",
                "premium": "Framed set, bronze or brass with frosted or mirrored glass",
                "frameless_per_sf": "Frameless, per SF",
                "detach_reset": "Framed set, detach & reset",
                "frameless_detach_reset_per_sf": "Frameless, detach & reset, per SF"},
        note="Sliding glass doors across the tub; replacing takes the old set out. "
             "Frameless never under the glass panel's minimum.",
    ),
    # ── Shower ──
    TableSpec("SHOWER_DOOR_PRICES", "Shower Door", kind=MATERIAL, size_format='{}" opening',
              labels={"any": "Any size"}),
    TableSpec("SHOWER_DOOR_INSTALL", "Shower Door", kind=LABOR, skip_zero=True),
    TableSpec("SHOWER_INSERT_PRICES", "Shower Unit", kind=MATERIAL),
    TableSpec("SHOWER_INSERT_INSTALL", "Shower Unit", kind=LABOR, scalar=True,
              labels={"SHOWER_INSERT_INSTALL": "Prefab shower unit install"}),
    TableSpec("NEO_ANGLE_BASE_PRICES", "Neo-angle Shower", kind=MATERIAL, size_format='Base {}"'),
    TableSpec("NEO_ANGLE_BASE_INSTALL", "Neo-angle Shower", kind=LABOR, scalar=True,
              labels={"NEO_ANGLE_BASE_INSTALL": "Base install"}),
    TableSpec("NEO_ANGLE_DOOR_PRICES", "Neo-angle Shower", kind=MATERIAL),
    TableSpec("NEO_ANGLE_DOOR_INSTALL", "Neo-angle Shower", kind=LABOR),
    TableSpec("NEO_ANGLE_WALL_SURROUND_PRICES", "Neo-angle Shower", kind=MATERIAL),
    TableSpec("NEO_ANGLE_WALL_SURROUND_INSTALL", "Neo-angle Shower", kind=LABOR, scalar=True,
              labels={"NEO_ANGLE_WALL_SURROUND_INSTALL": "Wall surround install"}),
    TableSpec("NEO_ANGLE_KIT_PRICES", "Neo-angle Shower", kind=MATERIAL),
    TableSpec("NEO_ANGLE_KIT_INSTALL", "Neo-angle Shower", kind=LABOR, scalar=True,
              labels={"NEO_ANGLE_KIT_INSTALL": "Kit install"}),
    TableSpec(
        "SHOWER_CUSTOM_EXTRAS", "Custom Tile Shower", kind=MIXED, share=_TILE,
        kinds={"linear_drain_standard": MATERIAL, "linear_drain_premium": MATERIAL},
        shares={"curbless_floor_wood": _SUBSTRATE, "curbless_floor_slab": _SUBSTRATE},
    ),
    TableSpec("SHOWERHEAD_PRICES", "Shower & Tub Trim", kind=MATERIAL),
    TableSpec("SHOWER_VALVE_PRICES", "Shower & Tub Trim", kind=MATERIAL),
    # ── Vanity, faucet, sink ──
    TableSpec("VANITY_PRICES", "Vanity", kind=MATERIAL, labels={"stock_rta": "Stock / RTA"}),
    TableSpec("VANITY_TOP_PRICES", "Vanity", kind=MIXED, share=_FIXTURE, unit="IN",
              note="Per inch of vanity width, installed."),
    TableSpec("VANITY_INSTALL", "Vanity", kind=LABOR, scalar=True,
              labels={"VANITY_INSTALL": "Vanity install"}),
    TableSpec("VANITY_EXTRAS", "Vanity", kind=MIXED, share=_FINISH),
    TableSpec("FAUCET_PRICES", "Faucet & Sink", kind=MATERIAL,
              note="Faucet material; its labor is Plumbing · Vanity faucet install."),
    TableSpec("FAUCET_WALL_MOUNT_ROUGH", "Faucet & Sink", kind=MIXED, share=_PLUMBING, scalar=True,
              labels={"FAUCET_WALL_MOUNT_ROUGH": "Wall-mount faucet rough valve + access"}),
    TableSpec("SINK_PRICES", "Faucet & Sink", kind=MATERIAL),
    TableSpec("SINK_INSTALL", "Faucet & Sink", kind=LABOR),
    # ── Mirror, wall cabinet, toilet ──
    TableSpec("MIRROR_PRICES", "Mirror & Wall Cabinet", kind=MATERIAL),
    TableSpec("MIRROR_INSTALL", "Mirror & Wall Cabinet", kind=LABOR, scalar=True,
              labels={"MIRROR_INSTALL": "Mirror / medicine cabinet install"}),
    TableSpec("WALL_CABINET_PRICE", "Mirror & Wall Cabinet", kind=MATERIAL, scalar=True,
              labels={"WALL_CABINET_PRICE": "Wall cabinet (over toilet)"}),
    TableSpec("WALL_CABINET_INSTALL", "Mirror & Wall Cabinet", kind=LABOR, scalar=True,
              labels={"WALL_CABINET_INSTALL": "Wall cabinet install"}),
    TableSpec("TOILET_PRICES", "Toilet", kind=MATERIAL,
              note="Toilet material; setting it is Plumbing · Toilet set."),
    TableSpec("TOILET_EXTRAS", "Toilet", kind=MATERIAL,
              kinds={"flange_repair": MIXED}, shares={"flange_repair": _PLUMBING}),
    # ── Paint, trim, accessories ──
    TableSpec("PAINT_RATES", "Paint & Trim", kind=MIXED, share=_FINISH,
              labels={"quarter_round_per_lf": "Quarter round - seal & paint"},
              note="Mid grade; the paint grade and bath-paint premium multiply it."),
    TableSpec("PAINT_PREP", "Paint & Trim", kind=MIXED, share=_FINISH),
    TableSpec(
        "DOOR_TRIM", "Paint & Trim", kind=MIXED, share=_FINISH, title="Door trim",
        units={"paint_per_side": "EA"},
        labels={"casing_per_lf": "Casing, remove & install new, per LF",
                "paint_per_side": "Trim & jamb paint, per side"},
        note="One side of a door or window; the paint grade and bath-paint premium multiply the paint.",
    ),
    TableSpec("BASEBOARD_PRICES", "Paint & Trim", kind=MIXED, share=_FINISH, unit="LF"),
    TableSpec("QUARTER_ROUND_PRICES", "Paint & Trim", kind=MIXED, share=_FINISH, unit="LF"),
    TableSpec("ACCESSORY_PRICES", "Accessories", kind=MIXED, share=_ACCESSORY,
              labels={"tp_holder": "Toilet paper holder"},
              note="Chrome, mid grade; finish and grade multiply it."),
    # ── Detach & reset ──
    TableSpec("DETACH_RESET_COSTS", "Detach & Reset", kind=LABOR, size_format='{}" wide'),
    # ── General conditions ──
    TableSpec(
        "HIDDEN_COSTS", "General Conditions", kind=LABOR,
        skip=("punch_list",),
        kinds={
            "floor_protection": MIXED, "drywall_patch_per_sf": MIXED,
            "drywall_skim_coat_per_sf": MIXED, "trim_paint_per_lf": MIXED,
            "cast_iron_disposal": MATERIAL, "permit_fee": MATERIAL,
        },
        shares={
            "floor_protection": 0.40, "drywall_patch_per_sf": _SUBSTRATE,
            "drywall_skim_coat_per_sf": _SUBSTRATE, "trim_paint_per_lf": _FINISH,
        },
        labels={"lead_rrp": "Lead-safe (EPA RRP) surcharge", "permit_fee": "Permit allowance"},
    ),
    TableSpec(
        "PUNCH_LIST_BASIS", "General Conditions", kind=LABOR,
        skip=("visits", "hours_per_visit"),
        units={"hourly_rate": "HR", "travel_per_visit": "EA"},
        labels={"hourly_rate": "Punch list labor rate", "travel_per_visit": "Punch list travel per visit"},
        note="The punch list allowance is visits x hours x this rate + travel.",
    ),
]
