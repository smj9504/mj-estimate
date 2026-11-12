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
    what is plain in the room: base detach & reset under a new hard floor,
    tack strip under carpet, a toilet detach & reset when a toilet is drawn.

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
    "toe_kick_lf": "Cabinet runs and island sides LF",
    "door_count": "Doors hung in the room",
    "exterior_door_count": "Exterior doors",
    "toilet_count": "Toilets drawn in the room",
    "vanity_count": "Vanities drawn in the room",
    "appliance_count": "Appliances drawn in the room",
    "transition_count": "Doorways where the floor changes",
    "job_floor_sf": "Floor SF of every room on the estimate",
    "manual": "Entered by hand",
}

# When an item starts switched on. Each gets the room's context.
RULES: Dict[str, Callable[[Mapping], bool]] = {
    "off": lambda ctx: False,
    "on": lambda ctx: True,
    "hard_surface": lambda ctx: ctx["new_material"] in pricing.HARD_SURFACES,
    "carpet": lambda ctx: ctx["new_material"] == "carpet",
    "tile": lambda ctx: ctx["new_material"] in pricing.TILES,
    "underlayment": lambda ctx: ctx["new_material"] in pricing.UNDERLAYMENT_FLOORS,
    "has_toilet": lambda ctx: ctx["toilet_count"] > 0,
    "has_appliance": lambda ctx: ctx["appliance_count"] > 0,
    "has_transition": lambda ctx: ctx["transition_count"] > 0,
    "has_removal": lambda ctx: ctx["any_removal"],
}

RULE_LABELS = {
    "off": "Off unless switched on",
    "on": "On unless switched off",
    "hard_surface": "On under a new hard-surface floor",
    "carpet": "On under new carpet",
    "tile": "On under new tile",
    "underlayment": "On under laminate and engineered hardwood",
    "has_toilet": "On when a toilet is drawn in the room",
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
            "detach_reset", "EA", "DETACH_RESET_RATES.vanity", "vanity_count",
            hint="When the floor runs under the vanity"),
    ItemDef("toe_kick_detach_reset", "Cabinet toe kick - detach & reset", "Detach & Reset",
            "detach_reset", "LF", "DETACH_RESET_RATES.toe_kick_per_lf", "toe_kick_lf",
            hint="When the floor runs under the toe kick"),
    ItemDef("appliance_detach_reset", "Appliance - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.appliance", "appliance_count", rule="has_appliance"),
    ItemDef("door_detach_reset", "Door - detach & reset", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.door", "door_count"),
    ItemDef("door_undercut", "Door - undercut for new floor height", "Detach & Reset",
            "detach_reset", "EA", "DETACH_RESET_RATES.door_undercut", "door_count"),
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
            "trim", "LF", "TRIM_RATES.baseboard_detach_reset_per_lf", "base_lf", rule="hard_surface"),
    ItemDef("baseboard_remove", "Remove baseboard", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_remove_per_lf", "base_lf"),
    ItemDef("baseboard_install", "Baseboard - MDF, install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.baseboard_mdf_per_lf", "base_lf"),
    ItemDef("shoe_molding_remove", "Remove shoe molding / quarter round", "Trim",
            "trim", "LF", "TRIM_RATES.shoe_molding_remove_per_lf", "base_lf"),
    ItemDef("shoe_molding", "Shoe molding - install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.shoe_molding_per_lf", "base_lf"),
    ItemDef("quarter_round", "Quarter round - install & paint", "Trim",
            "trim", "LF", "TRIM_RATES.quarter_round_per_lf", "base_lf"),
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
