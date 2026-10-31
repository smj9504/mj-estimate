"""
How one content item gets packed, and what that takes in materials and labor.

Everything here comes from the item's attributes (what it is, category, size,
weight, fragile, disassembly, quantity), so changing one by hand re-prices the
item without asking the AI again. A packing method the estimator chose wins
over the one picked here.

Size and weight describe ONE unit. Labor is person-hours across the whole job,
packing out and packing back; the calculator splits it between the two.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


SIZES = ("small", "medium", "large", "xlarge")
WEIGHTS = ("light", "medium", "heavy", "very_heavy")

# A photo can't weigh anything, so weight is a class; this is what gets stored
WEIGHT_CLASS_LB = {"light": 10.0, "medium": 35.0, "heavy": 100.0, "very_heavy": 200.0}

# When the AI gives no size or weight, or an older estimate has none
_CATEGORY_DEFAULTS = {
    "Furniture": ("large", "heavy"),
    "Appliances": ("medium", "medium"),
    "Electronics": ("medium", "medium"),
    "Artwork": ("medium", "light"),
    "Sports": ("medium", "medium"),
    "Tools": ("small", "medium"),
}
_FALLBACK_DEFAULTS = ("small", "light")

# METHODS below hold hands-on time. Over a whole job a crew also sets up, labels,
# walks between rooms and comes back to unpack. Tuned so a sample seven-room house
# totals about what the room-based estimate gave it (55 person-hours), and the
# one number to change if estimates run high or low overall.
JOB_HOURS_FACTOR = 1.3

# Handling one unit gets slower once it needs two people or a dolly
WEIGHT_LABOR_MULT = {"light": 1.0, "medium": 1.0, "heavy": 1.25, "very_heavy": 1.6}

# Wrapping something fragile that its method doesn't already treat with care
FRAGILE_LABOR_MULT = 1.3

# Add-ons per unit, on top of packing it. Disassembly includes putting it back together.
DISASSEMBLY_HOURS = {"small": 0.3, "medium": 0.5, "large": 1.0, "xlarge": 1.5}
HIGH_VALUE_HOURS = 1 / 6  # serial number, condition photo, value record

# Person-minutes to carry one unit to the truck or staging area
CARRY_MINS_PER_BOX = 1.5
CARRY_MINS_PER_PIECE = {"small": 1.5, "medium": 2.5, "large": 3.5, "xlarge": 5.0}
WEIGHT_CARRY_MULT = {"light": 0.8, "medium": 1.0, "heavy": 1.2, "very_heavy": 1.6}


@dataclass(frozen=True)
class PackingMethod:
    label: str
    base: float  # setup once per line, whatever the quantity
    per_unit: Tuple[float, float, float, float]  # hours for one unit, by size
    materials: Tuple[dict, dict, dict, dict]  # amount for one unit, by size
    careful: bool = False  # each unit wrapped by hand: fragile labor, no surcharge
    batch: bool = False  # small pieces packed together: one piece's weight doesn't slow it
    piece: bool = False  # carried as its own piece, not in a box
    tier: str = "standard"


def _same(materials: dict) -> Tuple[dict, dict, dict, dict]:
    return (materials, materials, materials, materials)


# Keys mirror PACKING_METHOD_OPTIONS in the frontend's packing-estimate/constants.ts.
# Material amounts are per unit: 1/8 of a box means eight fit in one, so a room's
# units share boxes and rolls.
METHODS: Dict[str, PackingMethod] = {
    "box_standard": PackingMethod(
        "Box", 0.10, (0.03, 0.08, 0.15, 0.25),
        ({"box_small": 1 / 8}, {"box_medium": 1 / 4}, {"box_large": 1 / 2}, {"box_xlarge": 1}),
    ),
    "box_padded": PackingMethod(
        "Padded box", 0.10, (0.08, 0.15, 0.25, 0.40),
        (
            {"box_small": 1 / 2, "bubble_12": 1 / 20},
            {"box_medium": 1, "bubble_12": 1 / 10},
            {"box_large": 1, "bubble_24": 1 / 8},
            {"box_xlarge": 1, "bubble_24": 1 / 4},
        ),
    ),
    "box_fragile": PackingMethod(
        "Wrap & box", 0.15, (0.05, 0.10, 0.25, 0.40),
        (
            {"box_small": 1 / 4, "bubble_12": 1 / 20, "packing_paper": 1},
            {"box_medium": 1 / 2, "bubble_12": 1 / 10, "packing_paper": 1},
            {"box_large": 1, "bubble_24": 1 / 8, "packing_paper": 1},
            {"box_xlarge": 1, "bubble_24": 1 / 4, "packing_paper": 1},
        ),
        careful=True,
    ),
    "dish_pack": PackingMethod(
        "Dish pack", 0.20, (0.04, 0.05, 0.08, 0.10),
        (
            {"box_dish": 1 / 12, "packing_paper": 1},
            {"box_dish": 1 / 6, "packing_paper": 1},
            {"box_dish": 1 / 3, "packing_paper": 1},
            {"box_dish": 1 / 2, "packing_paper": 1},
        ),
        careful=True, batch=True,
    ),
    "book_box": PackingMethod(
        "Book box", 0.25, (0.02, 0.02, 0.03, 0.03),
        ({"box_book": 1 / 20}, {"box_book": 1 / 15}, {"box_book": 1 / 10}, {"box_book": 1 / 5}),
        batch=True,
    ),
    "wardrobe_box": PackingMethod(
        "Wardrobe box", 0.20, (0.01, 0.01, 0.02, 0.02),
        (
            {"box_wardrobe": 1 / 24}, {"box_wardrobe": 1 / 24},
            {"box_wardrobe": 1 / 12}, {"box_wardrobe": 1 / 8},
        ),
        batch=True,
    ),
    "soft_pack": PackingMethod(
        "Soft goods box", 0.15, (0.01, 0.02, 0.05, 0.08),
        ({"box_medium": 1 / 12}, {"box_large": 1 / 6}, {"box_large": 1 / 3}, {"box_xlarge": 1 / 2}),
        batch=True,
    ),
    "blanket_wrap": PackingMethod(
        "Blanket wrap", 0.10, (0.15, 0.30, 0.60, 1.20),
        (
            {"blanket": 1, "shrink_wrap": 1 / 8},
            {"blanket": 1, "shrink_wrap": 1 / 8},
            {"blanket": 2, "shrink_wrap": 1 / 8},
            {"blanket": 3, "shrink_wrap": 1 / 4},
        ),
        piece=True,
    ),
    "cover_wrap": PackingMethod(
        "Cover & wrap", 0.10, (0.15, 0.30, 0.65, 0.90),
        (
            {"chair_cover": 1},
            {"chair_cover": 1, "shrink_wrap": 1 / 8},
            {"sofa_cover": 1, "blanket": 2, "shrink_wrap": 1 / 8},
            {"sofa_cover": 1, "blanket": 2, "shrink_wrap": 1 / 8},
        ),
        piece=True,
    ),
    "mattress_bag": PackingMethod(
        "Mattress bag", 0.05, (0.15, 0.15, 0.20, 0.25),
        ({"mattress_twin": 1}, {"mattress_full": 1}, {"mattress_queen": 1}, {"mattress_king": 1}),
        piece=True,
    ),
    "tv_box": PackingMethod(
        "TV box", 0.10, (0.20, 0.25, 0.35, 0.50),
        _same({"box_tv": 1, "bubble_12": 1 / 10}),
        careful=True,
    ),
    "mirror_box": PackingMethod(
        "Mirror/picture box", 0.10, (0.05, 0.10, 0.25, 0.40),
        (
            {"box_mirror": 1 / 4, "bubble_12": 1 / 20},
            {"box_mirror": 1 / 2, "bubble_12": 1 / 20},
            {"box_mirror": 1, "bubble_12": 1 / 10, "corner_protector": 1 / 16},
            {"box_mirror": 1, "bubble_24": 1 / 8, "corner_protector": 1 / 16},
        ),
        careful=True,
    ),
    "lamp_box": PackingMethod(
        "Lamp box", 0.02, (0.10, 0.12, 0.20, 0.30),
        _same({"box_lamp": 1, "bubble_12": 1 / 20}),
        careful=True,
    ),
    "appliance_secure": PackingMethod(
        "Secure & dolly", 0.20, (0.30, 0.50, 0.90, 1.20),
        (
            {"blanket": 1},
            {"blanket": 1, "shrink_wrap": 1 / 8},
            {"blanket": 2, "shrink_wrap": 1 / 8},
            {"blanket": 3, "shrink_wrap": 1 / 4},
        ),
        piece=True, tier="appliance",
    ),
    "rug_roll": PackingMethod(
        "Roll & wrap", 0.05, (0.10, 0.15, 0.30, 0.50),
        _same({"shrink_wrap": 1 / 8}),
        piece=True,
    ),
    "crate": PackingMethod(
        "Custom crate", 0.25, (0.50, 0.75, 1.50, 2.50),
        (
            {"box_large": 1, "bubble_24": 1 / 4, "corner_protector": 1 / 16},
            {"box_xlarge": 1, "bubble_24": 1 / 2, "corner_protector": 1 / 16},
            {"box_xlarge": 1, "bubble_24": 1, "corner_protector": 1 / 8},
            {"box_xlarge": 2, "bubble_24": 1, "corner_protector": 1 / 8},
        ),
        careful=True, piece=True,
    ),
    "move_as_is": PackingMethod(
        "Move as is", 0.0, (0.01, 0.02, 0.05, 0.08),
        _same({}),
        piece=True,
    ),
}


_TV_WORDS = ("tv", "television", "flat screen", "flatscreen", "oled", "qled")
_MATTRESS_SIZES = (
    ("king", "mattress_king"),
    ("queen", "mattress_queen"),
    ("full", "mattress_full"),
    ("double", "mattress_full"),
    ("twin", "mattress_twin"),
    ("single", "mattress_twin"),
)


def _has(text: str, *words: str) -> bool:
    return any(word in text for word in words)


def _has_word(text: str, *words: str) -> bool:
    tokens = text.replace("/", " ").replace("-", " ").split()
    return any(word in tokens for word in words)


def default_method(
    name: str,
    category: str,
    size: str,
    weight: str,
    is_fragile: bool = False,
    is_high_value: bool = False,
) -> str:
    """The packing method for an item like this: what it is first, then its category."""
    text = (name or "").lower()

    if _has(text, "mattress"):
        return "mattress_bag"
    if _has(text, "rug", "carpet"):
        return "rug_roll"
    if _has(text, "storage bin", "plastic bin", "tote", "cardboard box", "moving box", "packed box", "ladder"):
        return "move_as_is"
    if _has(text, "mirror", "picture", "painting", "canvas", "wall art", "poster", "photo frame"):
        return "mirror_box"
    if _has(text, "lamp"):
        return "lamp_box"

    if category == "Books":
        return "book_box"
    if category == "Clothing":
        return "wardrobe_box" if _has(text, "hanging", "coat", "jacket", "suit", "dress") else "soft_pack"
    if _has(text, "quilt", "comforter", "duvet", "blanket", "pillow", "sheet", "towel", "linen",
            "bedding", "curtain", "drape", "stuffed", "plush"):
        return "soft_pack"

    if category == "Kitchenware" and is_fragile:
        return "dish_pack"
    if category == "Electronics":
        if _has_word(text, *_TV_WORDS) or (_has(text, "monitor") and size in ("large", "xlarge")):
            return "tv_box"
        return "box_padded"
    if category == "Appliances":
        return "appliance_secure" if size in ("large", "xlarge") or weight in ("heavy", "very_heavy") else "box_padded"
    if category == "Furniture":
        if _has(text, "sofa", "couch", "loveseat", "sectional", "settee", "futon", "recliner",
                "armchair", "accent chair", "dining chair", "ottoman", "upholstered"):
            return "cover_wrap"
        return "blanket_wrap"

    if is_fragile:
        return "crate" if size == "xlarge" or (size == "large" and is_high_value) else "box_fragile"
    return "blanket_wrap" if size in ("large", "xlarge") else "box_standard"


@dataclass(frozen=True)
class ItemPlan:
    size: str
    weight: str
    method: str
    base_hours: float
    per_unit_hours: float
    total_hours: float
    tier_hours: Dict[str, float]  # labor tier -> hours for the whole line
    materials: Dict[str, float]  # material -> amount for one unit
    carry_minutes: float  # person-minutes to carry one unit out
    flags: List[str]


def method_label(method: Optional[str]) -> str:
    """A method's name; older estimates saved the AI's own words here, shown as they are."""
    known = METHODS.get(method or "")
    return known.label if known else (method or "")


def default_size_weight(category: str) -> Tuple[str, str]:
    return _CATEGORY_DEFAULTS.get(category, _FALLBACK_DEFAULTS)


def plan_item(item) -> ItemPlan:
    """Work out the packing method, materials and labor from an item's attributes."""
    default_size, default_weight = default_size_weight(item.category)
    size = item.size if item.size in SIZES else default_size
    weight = item.weight if item.weight in WEIGHTS else default_weight
    size_index = SIZES.index(size)
    quantity = item.quantity or 1

    chosen = item.packing_method if item.packing_locked and item.packing_method in METHODS else None
    key = chosen or default_method(
        item.name, item.category, size, weight, item.is_fragile, item.is_high_value,
    )
    method = METHODS[key]

    weight_mult = 1.0 if method.batch else WEIGHT_LABOR_MULT[weight]
    surcharged = item.is_fragile and not method.careful and not method.batch and key != "move_as_is"
    base_hours = method.base * JOB_HOURS_FACTOR
    packing_hours = method.per_unit[size_index] * weight_mult * JOB_HOURS_FACTOR
    if surcharged:
        packing_hours *= FRAGILE_LABOR_MULT

    materials = dict(method.materials[size_index])
    if key == "mattress_bag":
        for word, bag in _MATTRESS_SIZES:
            if word in (item.name or "").lower():
                materials = {bag: 1}
                break
    if surcharged:
        extra = ("bubble_12", 1 / 10) if size in ("small", "medium") else ("bubble_24", 1 / 8)
        materials[extra[0]] = materials.get(extra[0], 0) + extra[1]

    disassembly_hours = DISASSEMBLY_HOURS[size] if item.needs_disassembly else 0.0
    high_value_hours = HIGH_VALUE_HOURS if item.is_high_value else 0.0
    per_unit_hours = packing_hours + disassembly_hours + high_value_hours

    if method.tier != "standard":
        tier = method.tier
    else:
        tier = "fragile" if item.is_fragile or method.careful else "standard"
    tier_hours = {tier: base_hours + packing_hours * quantity}
    if disassembly_hours:
        tier_hours["furniture_disassembly"] = disassembly_hours * quantity
    if high_value_hours:
        tier_hours["specialty"] = high_value_hours * quantity

    if method.piece:
        carry_minutes = CARRY_MINS_PER_PIECE[size] * WEIGHT_CARRY_MULT[weight]
    else:
        boxes = sum(amount for material, amount in materials.items() if material.startswith("box_"))
        carry_minutes = boxes * CARRY_MINS_PER_BOX

    flags = []
    if item.is_fragile:
        flags.append("FRAGILE")
    if item.is_high_value:
        flags.append("HIGH_VALUE")
    if weight in ("heavy", "very_heavy"):
        flags.append("HEAVY")
    if item.needs_disassembly:
        flags.append("DISASSEMBLY")

    return ItemPlan(
        size=size,
        weight=weight,
        method=key,
        base_hours=round(base_hours, 4),
        per_unit_hours=round(per_unit_hours, 4),
        total_hours=round(round(base_hours, 4) + round(per_unit_hours, 4) * quantity, 4),
        tier_hours=tier_hours,
        materials=materials,
        carry_minutes=carry_minutes,
        flags=flags,
    )


def apply_plan(item) -> ItemPlan:
    """Write an item's plan onto it, so what's shown and saved matches what's priced."""
    plan = plan_item(item)
    item.size = plan.size
    item.weight = plan.weight
    item.packing_method = plan.method
    item.required_materials = sorted(plan.materials)
    item.base_labor_hours = plan.base_hours
    item.per_unit_labor_hours = plan.per_unit_hours
    item.estimated_labor_hours = plan.total_hours
    item.estimator_flags = plan.flags
    return plan


# ── Saved with the estimate ──────────────────
# pack_items keeps weight as pounds and unsettled fields among the item's flags.

_REVIEW_FLAG = "REVIEW:"


def weight_class_from_lb(pounds: Optional[float]) -> Optional[str]:
    if pounds is None:
        return None
    if pounds < 20:
        return "light"
    if pounds < 50:
        return "medium"
    if pounds < 150:
        return "heavy"
    return "very_heavy"


def flags_for_storage(flags: Optional[List[str]], uncertain_fields: Optional[List[str]]) -> List[str]:
    return list(flags or []) + [f"{_REVIEW_FLAG}{field}" for field in uncertain_fields or []]


def flags_from_storage(stored: Optional[List[str]]) -> Tuple[List[str], List[str]]:
    """Split saved flags back into (flags, fields still to review)."""
    flags: List[str] = []
    uncertain: List[str] = []
    for flag in stored or []:
        if flag.startswith(_REVIEW_FLAG):
            uncertain.append(flag[len(_REVIEW_FLAG):])
        else:
            flags.append(flag)
    return flags, uncertain
