"""
Floor protection kinds a water mitigation scope bills separately.

A sketch strip is laid with paper or plastic, on a floor or on stairs. Each
of the four becomes its own scope item, and the Standard Scope Item of the
same name maps it to its own line item. The names must stay in step with
floorProtectionScopeName in frontend/src/types/wmSketch.ts.

The material is read from the strip's protection_type text; strips saved
before plastic existed say "Heavy duty paper & tape".
"""

from typing import Optional

PAPER = "paper"
PLASTIC = "plastic"

# In scope order: paper floor, paper stairs, plastic floor, plastic stairs
FLOOR_PROTECTION_KINDS = (
    (PAPER, False, "Floor Protection", "#FFD700"),
    (PAPER, True, "Floor Protection (Stairs)", "#FF8C00"),
    (PLASTIC, False, "Floor Protection - Plastic", "#26C6DA"),
    (PLASTIC, True, "Floor Protection - Plastic (Stairs)", "#00838F"),
)

FLOOR_PROTECTION_SCOPE_NAMES = tuple(name for _, _, name, _ in FLOOR_PROTECTION_KINDS)


def floor_protection_material(protection_type: Optional[str]) -> str:
    """'plastic' when the strip says plastic, otherwise 'paper'."""
    return PLASTIC if "plastic" in (protection_type or "").lower() else PAPER


def floor_protection_scope_name(protection_type: Optional[str], is_stair: bool) -> str:
    """The scope item a strip rolls up into."""
    material = floor_protection_material(protection_type)
    for m, stair, name, _ in FLOOR_PROTECTION_KINDS:
        if m == material and stair == bool(is_stair):
            return name
    return FLOOR_PROTECTION_SCOPE_NAMES[0]


def floor_protection_color(protection_type: Optional[str], is_stair: bool) -> str:
    """Drawing color of a strip's kind."""
    material = floor_protection_material(protection_type)
    for m, stair, _, color in FLOOR_PROTECTION_KINDS:
        if m == material and stair == bool(is_stair):
            return color
    return FLOOR_PROTECTION_KINDS[0][3]
