"""
The flooring prices a company can change: which tables in pricing.py are
prices, grouped for the price screen, and whether each is material, labor
or both. pricing.py wraps exactly these (unit_prices.catalog.install).

Waste, pattern labor, box coverage and the carpet roll rules aren't here:
they stay code.
"""

from app.domains.unit_prices.catalog import LABOR, MATERIAL, MIXED, TableSpec

# Material share of a price that is both
_TRIM = 0.35
_PREP = 0.40
_TRANSITION = 0.55
_STAIRS = 0.50

_MATERIAL_LABELS = {
    "lvp": "LVP", "laminate": "Laminate", "engineered_hardwood": "Engineered hardwood",
    "solid_hardwood": "Solid hardwood", "ceramic_tile": "Ceramic tile",
    "porcelain_tile": "Porcelain tile", "sheet_vinyl": "Sheet vinyl", "carpet": "Carpet",
}

PRICE_TABLES = [
    TableSpec(
        "FLOORING_MATERIAL", "Flooring", kind=MATERIAL, title="Material", unit="SF",
        units={"carpet": "SY"}, labels=_MATERIAL_LABELS,
        note="Floor material before waste; the calculator adds the waste.",
    ),
    TableSpec(
        "FLOORING_INSTALL_LABOR", "Flooring", kind=LABOR, title="Install", unit="SF",
        units={"carpet": "SY"}, labels=_MATERIAL_LABELS,
        note="Straight lay. Diagonal and herringbone take more (code, not a price).",
    ),
    TableSpec(
        "CUT_TO_FIT_RATES", "Flooring", kind=LABOR, title="Cuts", unit="EA",
        units={"tile_per_angled_lf": "LF", "wood_per_angled_lf": "LF"},
        labels={"tile_per_fixture": "Tile - cut to fit a fixture",
                "wood_per_fixture": "Wood - cut to fit a fixture",
                "tile_per_inside_corner": "Tile - notch around a corner",
                "wood_per_inside_corner": "Wood - notch around a corner",
                "tile_per_angled_lf": "Tile - cut along an angled wall",
                "wood_per_angled_lf": "Wood - cut along an angled wall"},
        note="Added to the room's new floor line: per fixture that needs a hole in the floor (toilet flange, "
             "floor register), per corner it is notched around, per LF of wall off square.",
    ),
    TableSpec(
        "REFINISH_RATES", "Refinish", kind=MIXED, share=0.23,
        kinds={"dustless_per_sf": LABOR, "lace_in_per_lf": LABOR, "trim_detach_reset_per_lf": LABOR},
        shares={"board_replace_per_sf": 0.55, "register_per_ea": 0.09, "seal": 0.18, "stain": 0.25,
                "extra_coat_per_sf": 0.28, "cover_per_sf": 0.20},
        units={"extra_coat_per_sf": "SF", "pre_stain_per_sf": "SF", "dustless_per_sf": "SF",
               "register_per_ea": "EA", "mask_per_lf": "LF", "cover_per_sf": "SF", "board_replace_per_sf": "SF",
               "lace_in_per_lf": "LF", "trim_detach_reset_per_lf": "LF", "minimum_charge": "EA",
               "steps_per_lf": "LF", "steps_stain_per_lf": "LF"},
        unit="SF",
        labels={
            "natural": "Sand & finish - natural", "stain": "Sand, stain & finish",
            "water_natural": "Sand & finish - water-based", "water_stain": "Sand, stain & finish - water-based",
            "seal": "Sand & seal", "extra_coat_per_sf": "Additional coat of finish",
            "pre_stain_per_sf": "Pre-stain conditioner", "dustless_per_sf": "Dustless sanding - add",
            "register_per_ea": "Sand & finish flush wood register", "mask_per_lf": "Mask baseboards & cabinets",
            "cover_per_sf": "Cover cabinets & fixtures - plastic", "board_replace_per_sf": "Replace damaged boards",
            "lace_in_per_lf": "Lace in new boards", "trim_detach_reset_per_lf": "Wood flooring trim - detach & reset",
            "minimum_charge": "Finish wood floor - minimum charge",
            "steps_per_lf": "Stairs - sand & finish", "steps_stain_per_lf": "Stairs - sand, stain & finish",
        },
        note="Sanding an existing hardwood floor in place of a new one.",
    ),
    TableSpec(
        "PAD_PRICES", "Flooring", kind=MATERIAL, title="Carpet pad", unit="SY",
        labels={"rebond_7_16": '7/16" rebond'},
    ),
    TableSpec(
        "REMOVAL_RATES", "Removal", kind=LABOR, title="Remove", unit="SF",
        labels={**_MATERIAL_LABELS, "carpet": "Carpet & pad"},
    ),
    TableSpec(
        "PREP_RATES", "Prep", kind=MIXED, share=_PREP,
        kinds={"floor_scrape_per_sf": LABOR},
        labels={
            "floor_scrape_per_sf": "Scrape floor - adhesive / residue",
            "self_leveling_per_sf": "Self-leveling underlayment",
            "subfloor_repair_per_sf": "Subfloor - replace plywood",
            "underlayment_per_sf": "Underlayment - foam / cork",
            "moisture_barrier_per_sf": "Moisture barrier - 6 mil poly",
            "cement_board_per_sf": "Cement board underlayment",
        },
    ),
    TableSpec(
        "TRIM_RATES", "Trim", kind=MIXED, share=_TRIM,
        kinds={"baseboard_detach_reset_per_lf": LABOR, "baseboard_remove_per_lf": LABOR,
               "shoe_molding_remove_per_lf": LABOR},
        shares={"baseboard_paint_per_lf": 0.15, "quarter_round_stained_per_lf": 0.45},
        labels={
            "baseboard_detach_reset_per_lf": "Baseboard - detach & reset",
            "baseboard_remove_per_lf": "Remove baseboard",
            "baseboard_mdf_per_lf": "Baseboard - MDF, install & paint",
            "baseboard_paint_per_lf": "Baseboard - paint",
            "shoe_molding_remove_per_lf": "Remove shoe molding / quarter round",
            "shoe_molding_per_lf": "Shoe molding - install & paint",
            "quarter_round_per_lf": "Quarter round - install & paint",
            "quarter_round_stained_per_lf": "Quarter round - hardwood, stain & finish",
            "tack_strip_per_lf": "Tack strip",
            "toe_kick_reskin_per_lf": "Cabinet toe kick - reskin",
        },
    ),
    TableSpec(
        "DETACH_RESET_RATES", "Detach & Reset", kind=LABOR,
        units={"toe_kick_per_lf": "LF"},
        labels={
            "toilet": "Toilet - detach & reset", "vanity": "Vanity - detach & reset",
            "pedestal_sink": "Pedestal sink - detach & reset",
            "utility_sink": "Utility sink / laundry tub - detach & reset",
            "toe_kick_per_lf": "Cabinet toe kick - detach & reset",
            "appliance": "Other appliance - detach & reset",
            "refrigerator": "Refrigerator - detach & reset", "range": "Range - electric - detach & reset",
            "range_gas": "Range - gas - detach & reset", "dishwasher": "Dishwasher - detach & reset",
            "washer": "Washer - detach & reset", "dryer": "Dryer - electric - detach & reset",
            "dryer_gas": "Dryer - gas - detach & reset",
            "door": "Door - detach & reset",
            "door_undercut": "Door - undercut",
        },
    ),
    TableSpec(
        "CABINET_RATES", "Cabinets", kind=LABOR,
        units={"base_detach_reset_per_lf": "LF", "island_detach_reset_per_lf": "LF", "panel_detach_reset_per_sf": "SF"},
        labels={
            "base_detach_reset_per_lf": "Base cabinets - detach & reset",
            "island_detach_reset_per_lf": "Island - detach & reset",
            "panel_detach_reset_per_sf": "Island back & end panels - detach & reset",
        },
    ),
    TableSpec(
        "REMOVAL_EXTRA_RATES", "Removal", kind=LABOR, title="Tear out extra", unit="SF",
        labels={
            "mortar_bed_per_sf": "Mortar bed under tile",
            "tile_on_slab_per_sf": "Tile on a concrete slab",
            "glue_down_concrete_per_sf": "Glued down over concrete",
            "glue_down_wood_per_sf": "Glued down over a wood subfloor",
            "vinyl_extra_layer_per_sf": "Another layer of vinyl",
        },
    ),
    TableSpec(
        "HVAC_RATES", "HVAC", kind=MIXED, share=0.60,
        kinds={"floor_register_detach_reset": LABOR},
        labels={
            "floor_register_detach_reset": "Floor register - detach & reset",
            "floor_register_replace": "Floor register - replace",
        },
    ),
    TableSpec(
        "TRANSITION_RATES", "Transitions", kind=MIXED, share=_TRANSITION,
        labels={"transition_strip": "Transition strip / reducer", "exterior_threshold": "Threshold - exterior door"},
    ),
    TableSpec(
        "STAIR_RATES", "Stairs", kind=MIXED, share=_STAIRS,
        labels={"carpet_per_step": "Carpet & pad, per step", "tread_riser_per_step": "Tread, riser & nose, per step"},
    ),
    TableSpec("CONTENTS_RATES", "Contents", kind=LABOR, title="Contents move"),
    TableSpec(
        "GENERAL_RATES", "General", kind=MIXED, share=0.30,
        kinds={"dumpster_10yard": MATERIAL, "final_clean_per_sf": LABOR},
        shares={"floor_protection_per_sf": 0.40},
        labels={
            "haul_debris_load": "Haul debris - pickup truck load", "dumpster_10yard": "Dumpster - 10 yard",
            "floor_protection_per_sf": "Floor protection", "final_clean_per_sf": "Final cleaning - floors",
        },
    ),
]
