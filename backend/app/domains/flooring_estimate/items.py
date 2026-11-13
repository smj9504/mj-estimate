"""
The work that comes along with a new floor, room by room.

Which of it a job needs can't be decided ahead: one house keeps its
baseboard and gets shoe molding, the next has the base taken off and put
back; one kitchen's cabinets get their toe kicks pulled, another's don't.
So none of it is hard-wired. Each item here is offered on every room with

  - a quantity measured from the sketch (basis): base trim follows the
    baseboard length (perimeter less openings and cabinet runs), toe kicks
    the cabinet runs and islands, toilets the toilets drawn in the room...
  - a default (rule) that only says whether it starts switched on, from
    what is plain in the room: under tile, LVP and laminate the baseboard
    stays and is painted with new shoe molding, under wood it is replaced;
    tack strip under carpet; a toilet, pedestal sink, utility sink or floor
    register detach & reset when one is drawn.

The estimator decides. Per room, an item can be switched on or off and
given its own quantity or price (room_scopes[room].items[key]); for the
whole job, an item can be switched on or off for every room at once
(job_scope.room_items[key]), and a room's own choice wins over it. Anything
the catalog doesn't have goes in as a custom item, on a room or on the job.

The keys are stored on estimates: never rename one.
"""

from dataclasses import dataclass
from typing import Callable, Dict, List, Mapping

from . import pricing


@dataclass(frozen=True)
class ItemDef:
    key: str
    label: str              # the line's description
    group: str              # where the estimator finds it
    category: str           # where the line sits in the room (CATEGORY_ORDER)
    unit: str
    price: str              # path of its price in pricing.py ("TRIM_RATES.tack_strip_per_lf")
    basis: str              # what its quantity is measured from (BASES)
    factor: float = 1.0     # share of the basis (self-leveling: 10% of the floor)
    manual_qty: float = 1.0  # quantity when the basis is "manual"
    rule: str = "off"       # when it starts switched on (RULES)
    hint: str = ""


# Where a line sits in its room
CATEGORY_ORDER = (
    "contents", "detach_reset", "removal", "prep", "install", "trim",
    "transition", "stairs", "general", "custom",
)

# What a quantity can be measured from: (label, unit)
BASES = {
    "floor_sf": "Floor SF",
    "base_lf": "Baseboard LF (perimeter less openings and cabinet runs)",
    "toe_kick_lf": "Cabinet fronts and all round islands LF",
    "shoe_lf": "Baseboard, cabinet fronts and showing sides, all round islands LF "
               "(and the wall behind the cabinets when they come out)",
    "cabinet_run_lf": "Base cabinets along the walls LF",
    "island_lf": "Islands' length LF",
    "island_panel_sf": "Islands' back and end panels SF",
    "door_count": "Doors hung in the room",
    "exterior_door_count": "Exterior doors",
    "toilet_count": "Toilets drawn in the room",
    "vanity_count": "Vanities drawn in the room",
    "pedestal_sink_count": "Pedestal sinks drawn in the room",
    "utility_sink_count": "Utility sinks drawn in the room",
    "register_count": "Floor registers drawn in the room",
    "appliance_count": "Appliances drawn in the room",
    "refrigerator_count": "Refrigerators drawn in the room",
    "range_count": "Electric ranges drawn in the room",
    "range_gas_count": "Gas ranges drawn in the room",
    "dishwasher_count": "Dishwashers drawn in the room",
    "washer_count": "Washers drawn in the room",
    "dryer_count": "Electric dryers drawn in the room",
    "dryer_gas_count": "Gas dryers drawn in the room",
    "transition_count": "Doorways where the floor changes",
    "job_floor_sf": "Floor SF of every room on the estimate",
    "manual": "Entered by hand",
}

# Appliances by what their detach & reset costs: key -> what the line calls it
APPLIANCE_KINDS = {
    "refrigerator": "Refrigerator",
    "range": "Range - electric",
    "range_gas": "Range - gas",
    "dishwasher": "Dishwasher",
    "washer": "Washer",
    "dryer": "Dryer - electric",
    "dryer_gas": "Dryer - gas",
}

# When an item starts switched on. Each gets the room's context.
RULES: Dict[str, Callable[[Mapping], bool]] = {
    "off": lambda ctx: False,
    "on": lambda ctx: True,
    "hard_surface": lambda ctx: ctx["new_material"] in pricing.HARD_SURFACES,
    "keeps_base": lambda ctx: ctx["new_material"] in pricing.KEEPS_BASE_FLOORS,
    "wood": lambda ctx: ctx["new_material"] in pricing.WOOD_FLOORS,
    "carpet": lambda ctx: ctx["new_material"] == "carpet",
    "tile": lambda ctx: ctx["new_material"] in pricing.TILES,
    "underlayment": lambda ctx: ctx["new_material"] in pricing.UNDERLAYMENT_FLOORS,
    "has_toilet": lambda ctx: ctx["toilet_count"] > 0,
    "has_vanity": lambda ctx: ctx["vanity_count"] > 0,
    "island_floored": lambda ctx: ctx["island_floored_count"] > 0,
    "has_pedestal_sink": lambda ctx: ctx["pedestal_sink_count"] > 0,
    "has_utility_sink": lambda ctx: ctx["utility_sink_count"] > 0,
    "has_register": lambda ctx: ctx["register_count"] > 0,
    **{f"has_{kind}": (lambda key: lambda ctx: ctx[key] > 0)(f"{kind}_count") for kind in APPLIANCE_KINDS},
    "has_appliance": lambda ctx: ctx["appliance_count"] > 0,
    "has_transition": lambda ctx: ctx["transition_count"] > 0,
    "has_removal": lambda ctx: ctx["any_removal"],
}

RULE_LABELS = {
    "off": "Off unless switched on",
    "on": "On unless switched off",
    "hard_surface": "On under a new hard-surface floor",
    "keeps_base": "On under new tile, LVP and laminate",
    "wood": "On under a new wood floor",
    "carpet": "On under new carpet",
    "tile": "On under new tile",
    "underlayment": "On under laminate and engineered hardwood",
    "has_toilet": "On when a toilet is drawn in the room",
    "has_vanity": "On when a vanity is drawn in the room",
    "island_floored": "On when the new floor runs under an island drawn in the room",
    "has_pedestal_sink": "On when a pedestal sink is drawn in the room",
    "has_utility_sink": "On when a utility sink is drawn in the room",
    "has_register": "On when floor registers are drawn in the room",
    **{f"has_{kind}": f"On when a {label.lower()} is drawn in the room" for kind, label in APPLIANCE_KINDS.items()},
    "has_appliance": "On when appliances are drawn in the room",
    "has_transition": "On when the floor changes at a doorway",
    "has_removal": "On when any floor is torn out",
}

# ── Offered on every room ──
ROOM_ITEMS: List[ItemDef] = [
    # Contents
    ItemDef("contents_move", "Contents - move out then reset - average room", "Contents",
            "contents", "EA", "CONTENTS_RATES.average_room", "manual"),
    # Detach & reset
    ItemDef("toilet_detach_reset", "Toilet - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.toilet", "toilet_count", rule="has_toilet"),
    ItemDef("vanity_detach_reset", "Vanity - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.vanity", "vanity_count", rule="has_vanity"),
    ItemDef("pedestal_sink_detach_reset", "Pedestal sink - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.pedestal_sink", "pedestal_sink_count",
            rule="has_pedestal_sink"),
    ItemDef("utility_sink_detach_reset", "Utility sink / laundry tub - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.utility_sink", "utility_sink_count",
            rule="has_utility_sink"),
    # Cabinets
    ItemDef("base_cabinet_detach_reset", "Base cabinets - detach & reset", "Cabinets",
            "detach_reset", "LF", "CABINET_RATES.base_detach_reset_per_lf", "cabinet_run_lf",
            hint="The floor then runs under them, and shoe molding goes along the wall behind them too"),
    ItemDef("island_detach_reset", "Island - detach & reset", "Cabinets",
            "detach_reset", "LF", "CABINET_RATES.island_detach_reset_per_lf", "island_lf", rule="island_floored",
            hint="Even when the kitchen's cabinets stay"),
    ItemDef("island_panel_detach_reset", "Island back & end panels - detach & reset", "Cabinets",
            "detach_reset", "SF", "CABINET_RATES.panel_detach_reset_per_sf", "island_panel_sf",
            hint="The back and both ends, 34 1/2\" high; type the SF when only some are panelled"),
    ItemDef("toe_kick_detach_reset", "Cabinet toe kick - detach & reset", "Cabinets",
            "detach_reset", "LF", "DETACH_RESET_RATES.toe_kick_per_lf", "toe_kick_lf",
            hint="When the floor runs under the toe kick"),
    ItemDef("toe_kick_reskin", "Cabinet toe kick - reskin", "Cabinets",
            "detach_reset", "LF", "TRIM_RATES.toe_kick_reskin_per_lf", "toe_kick_lf",
            hint="New skin over a toe kick that is stained, swollen or scuffed"),
    # Each appliance by its kind; a gas range or dryer is disconnected and reconnected
    *[ItemDef(f"{kind}_detach_reset", f"{label} - detach & reset", "Detach & Reset",
              "detach_reset", "EA", f"DETACH_RESET_RATES.{kind}", f"{kind}_count", rule=f"has_{kind}")
      for kind, label in APPLIANCE_KINDS.items()],
    # Before appliances were priced by kind this was every appliance drawn; now
    # it is one the sketch has no kind for (a freezer, a wine fridge)
    ItemDef("appliance_detach_reset", "Other appliance - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.appliance", "manual",
            hint="One the sketch has no kind for: a freezer, a wine fridge"),
    ItemDef("register_detach_reset", "Floor register - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "HVAC_RATES.floor_register_detach_reset", "register_count",
            rule="has_register"),
    ItemDef("register_replace", "Floor register - replace", "Detach & Reset",
            "detach_reset", "EA", "HVAC_RATES.floor_register_replace", "register_count",
            hint="When the old register is rusted, bent or won't fit the new floor"),
    ItemDef("door_detach_reset", "Door - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.door", "door_count"),
    ItemDef("door_undercut", "Door - undercut for new floor height", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.door_undercut", "door_count"),
    # More to the tear-out than the floor's own removal
    ItemDef("mortar_bed_removal", "Remove mortar bed under tile - additional labor", "Tear out",
            "removal", "SF", "REMOVAL_EXTRA_RATES.mortar_bed_per_sf", "floor_sf",
            hint="Tile set thick in a mortar bed"),
    ItemDef("tile_on_slab_removal", "Additional labor to remove tile from concrete slab", "Tear out",
            "removal", "SF", "REMOVAL_EXTRA_RATES.tile_on_slab_per_sf", "floor_sf"),
    ItemDef("glue_down_removal_concrete", "Additional labor to remove glued-down flooring - over concrete",
            "Tear out", "removal", "SF", "REMOVAL_EXTRA_RATES.glue_down_concrete_per_sf", "floor_sf",
            hint="Glued-down vinyl plank or wood"),
    ItemDef("glue_down_removal_wood", "Additional labor to remove glued-down flooring - over wood subfloor",
            "Tear out", "removal", "SF", "REMOVAL_EXTRA_RATES.glue_down_wood_per_sf", "floor_sf",
            hint="Glued-down vinyl plank or wood"),
    ItemDef("vinyl_extra_layer_removal", "Tear out additional layer of vinyl floor covering", "Tear out",
            "removal", "SF", "REMOVAL_EXTRA_RATES.vinyl_extra_layer_per_sf", "floor_sf",
            hint="Another layer of vinyl under the top one"),
    # Prep
    ItemDef("floor_scrape", "Scrape floor - adhesive / residue", "Prep",
            "prep", "SF", "PREP_RATES.floor_scrape_per_sf", "floor_sf"),
    ItemDef("self_leveling", "Self-leveling underlayment - allowance", "Prep",
            "prep", "SF", "PREP_RATES.self_leveling_per_sf", "floor_sf", factor=0.10,
            hint="Starts at 10% of the floor"),
    ItemDef("subfloor_repair", "Subfloor - replace plywood", "Prep",
            "prep", "SF", "PREP_RATES.subfloor_repair_per_sf", "manual", manual_qty=32,
            hint="Starts at one 4x8 sheet"),
    ItemDef("underlayment", "Underlayment - foam / cork", "Prep",
            "prep", "SF", "PREP_RATES.underlayment_per_sf", "floor_sf", rule="underlayment"),
    ItemDef("moisture_barrier", "Moisture barrier - 6 mil poly", "Prep",
            "prep", "SF", "PREP_RATES.moisture_barrier_per_sf", "floor_sf",
            hint="Over a concrete slab"),
    ItemDef("cement_board", "Cement board underlayment", "Prep",
            "prep", "SF", "PREP_RATES.cement_board_per_sf", "floor_sf", rule="tile"),
    # Trim
    ItemDef("baseboard_detach_reset", "Baseboard - detach & reset", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_detach_reset_per_lf", "base_lf"),
    ItemDef("baseboard_paint", "Baseboard - paint", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_paint_per_lf", "base_lf", rule="keeps_base"),
    ItemDef("baseboard_remove", "Remove baseboard", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_remove_per_lf", "base_lf", rule="wood"),
    ItemDef("baseboard_install", "Baseboard - MDF, install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_mdf_per_lf", "base_lf", rule="wood"),
    ItemDef("shoe_molding_remove", "Remove shoe molding / quarter round", "Trim",
            "trim", "LF", "TRIM_RATES.shoe_molding_remove_per_lf", "shoe_lf", rule="keeps_base",
            hint="Under a wood floor it comes off with the baseboard"),
    ItemDef("shoe_molding", "Shoe molding - install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.shoe_molding_per_lf", "shoe_lf", rule="hard_surface",
            hint="Along the baseboard, the cabinets' fronts and showing sides, and all round islands"),
    ItemDef("quarter_round", "Quarter round - install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.quarter_round_per_lf", "shoe_lf"),
    ItemDef("tack_strip", "Tack strip", "Trim",
            "trim", "LF", "TRIM_RATES.tack_strip_per_lf", "base_lf", rule="carpet"),
    # Transitions
    ItemDef("transition", "Transition strip / reducer", "Transitions",
            "transition", "EA", "TRANSITION_RATES.transition_strip", "transition_count",
            rule="has_transition"),
    ItemDef("exterior_threshold", "Threshold - exterior door", "Transitions",
            "transition", "EA", "TRANSITION_RATES.exterior_threshold", "exterior_door_count"),
    # Stairs
    ItemDef("stairs_carpet", "Stairs - carpet & pad, per step", "Stairs",
            "stairs", "EA", "STAIR_RATES.carpet_per_step", "manual", manual_qty=13),
    ItemDef("stairs_tread_riser", "Stairs - tread, riser & nose, per step", "Stairs",
            "stairs", "EA", "STAIR_RATES.tread_riser_per_step", "manual", manual_qty=13),
]

# ── Once for the whole job (General) ──
GENERAL_ITEMS: List[ItemDef] = [
    ItemDef("haul_debris", "Haul debris - pickup truck load, incl. dump fees", "General",
            "general", "EA", "GENERAL_RATES.haul_debris_load", "manual", rule="has_removal"),
    ItemDef("dumpster", "Dumpster - 10 yard", "General",
            "general", "EA", "GENERAL_RATES.dumpster_10yard", "manual"),
    ItemDef("floor_protection", "Floor protection - adjacent areas", "General",
            "general", "SF", "GENERAL_RATES.floor_protection_per_sf", "manual", manual_qty=100),
    ItemDef("final_clean", "Final cleaning - floors", "General",
            "general", "SF", "GENERAL_RATES.final_clean_per_sf", "job_floor_sf", rule="on"),
]

ROOM_ITEM_MAP: Dict[str, ItemDef] = {item.key: item for item in ROOM_ITEMS}
GENERAL_ITEM_MAP: Dict[str, ItemDef] = {item.key: item for item in GENERAL_ITEMS}

# The room's own flooring lines. They take the same overrides as the items
# above (on / qty / unit_price), so the estimator can, say, leave the new
# floor off a room that is only torn out.
MAIN_KEYS = ("removal", "install", "pad")
MAIN_LABELS = {"removal": "Tear out", "install": "New floor", "pad": "Carpet pad"}

ROOM_KEYS = frozenset(MAIN_KEYS) | frozenset(ROOM_ITEM_MAP)
GENERAL_KEYS = frozenset(GENERAL_ITEM_MAP)


def catalog_info() -> Dict[str, List[Dict[str, object]]]:
    """The items as the estimate form lists them."""

    def row(item: ItemDef) -> Dict[str, object]:
        return {
            "key": item.key, "label": item.label, "group": item.group, "unit": item.unit,
            "basis": item.basis, "basis_label": BASES[item.basis], "factor": item.factor,
            "manual_qty": item.manual_qty, "rule": item.rule, "rule_label": RULE_LABELS[item.rule],
            "price_key": item.price, "hint": item.hint,
        }

    return {
        "room_items": [row(i) for i in ROOM_ITEMS],
        "general_items": [row(i) for i in GENERAL_ITEMS],
    }
