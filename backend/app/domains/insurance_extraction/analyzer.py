"""Surface-category analyser for insurance extraction line items.

Classifies each line item into Wall / Floor / Ceiling / General based on
keyword matching against the item description.  Pure logic — no DB dependency.
"""

import re
from enum import Enum
from typing import Any, Dict, List, Optional


class SurfaceCategory(str, Enum):
    WALL = "wall"
    FLOOR = "floor"
    CEILING = "ceiling"
    GENERAL = "general"


# Ordered list of (category, compiled-regex).
# First match wins; items that match nothing fall to GENERAL.
_SURFACE_RULES: List[tuple] = [
    # ── Ceiling (check before wall — "paint ceiling" should not match wall) ──
    (SurfaceCategory.CEILING, re.compile(r"ceil", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"light\s*fix", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"popcorn", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"soffit", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"can\s*light", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"recessed\s*light", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"chandelier", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"pendant\s*light", re.I)),
    (SurfaceCategory.CEILING, re.compile(r"ceiling\s*fan", re.I)),
    # ── Floor ──
    (SurfaceCategory.FLOOR, re.compile(r"floor", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"carpet", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"vinyl\b", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"tile(?!.*ceil)", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"laminate", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"hardwood", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"subfloor", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"linoleum", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"grout", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"underlayment", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"\bLVP\b", re.I)),
    (SurfaceCategory.FLOOR, re.compile(r"\bLVT\b", re.I)),
    # ── Wall ──
    (SurfaceCategory.WALL, re.compile(r"drywall", re.I)),
    (SurfaceCategory.WALL, re.compile(r"sheetrock", re.I)),
    (SurfaceCategory.WALL, re.compile(r"paint.*wall", re.I)),
    (SurfaceCategory.WALL, re.compile(r"wall.*paint", re.I)),
    (SurfaceCategory.WALL, re.compile(r"baseboard", re.I)),
    (SurfaceCategory.WALL, re.compile(r"base\s*mold", re.I)),
    (SurfaceCategory.WALL, re.compile(r"chair\s*rail", re.I)),
    (SurfaceCategory.WALL, re.compile(r"crown\s*mold", re.I)),
    (SurfaceCategory.WALL, re.compile(r"wallpaper", re.I)),
    (SurfaceCategory.WALL, re.compile(r"wall\s*covering", re.I)),
    (SurfaceCategory.WALL, re.compile(r"wainscot", re.I)),
    (SurfaceCategory.WALL, re.compile(r"texture.*wall", re.I)),
    (SurfaceCategory.WALL, re.compile(r"wall.*texture", re.I)),
    (SurfaceCategory.WALL, re.compile(r"\btrim\b", re.I)),
    (SurfaceCategory.WALL, re.compile(r"casing", re.I)),
    (SurfaceCategory.WALL, re.compile(r"door\s*frame", re.I)),
    (SurfaceCategory.WALL, re.compile(r"window\s*frame", re.I)),
    (SurfaceCategory.WALL, re.compile(r"stucco", re.I)),
    (SurfaceCategory.WALL, re.compile(r"plaster", re.I)),
    (SurfaceCategory.WALL, re.compile(r"tape.*mud", re.I)),
    (SurfaceCategory.WALL, re.compile(r"mud.*tape", re.I)),
    (SurfaceCategory.WALL, re.compile(r"\bpaint\b", re.I)),  # bare "paint" → wall (most common)
]


def categorize_item(line_item: str) -> SurfaceCategory:
    """Return the surface category for a single line-item description."""
    for category, pattern in _SURFACE_RULES:
        if pattern.search(line_item):
            return category
    return SurfaceCategory.GENERAL


def _categorize_items(
    items: list,
    item_indices: List[int],
) -> Dict[str, list]:
    """Group items by surface category.

    Returns dict with keys "wall", "floor", "ceiling", "general",
    each containing a list of categorized item dicts.
    """
    by_surface: Dict[str, list] = {cat.value: [] for cat in SurfaceCategory}

    for idx in item_indices:
        if idx < 0 or idx >= len(items):
            continue
        item = items[idx]
        line_item_text = getattr(item, "line_item", None) or ""
        cat = categorize_item(line_item_text)
        by_surface[cat.value].append({
            "item_id": str(getattr(item, "id", "")),
            "line_item": line_item_text,
            "surface_category": cat.value,
            "quantity": float(item.quantity) if getattr(item, "quantity", None) is not None else None,
            "unit": getattr(item, "unit", None),
            "unit_price": float(item.unit_price) if getattr(item, "unit_price", None) is not None else None,
        })

    return by_surface


def analyze_extraction(
    items: list,
    hierarchy: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Analyse an entire extraction, returning room-by-room surface breakdown.

    Parameters
    ----------
    items : list
        The ORM item objects (InsurancePdfExtractionItem) from the extraction,
        ordered by sort_order.
    hierarchy : dict or None
        The ``parser_metadata["hierarchy"]`` dict with levels/sections/unassigned.

    Returns
    -------
    dict with keys: rooms, sections, unassigned_items, summary
    """
    if not hierarchy:
        # No hierarchy — treat all items as one flat "general" group
        all_indices = list(range(len(items)))
        by_surface = _categorize_items(items, all_indices)
        total = sum(len(v) for v in by_surface.values())
        return {
            "rooms": [],
            "sections": [],
            "unassigned_items": by_surface,
            "summary": _build_summary_from_surfaces([by_surface]),
        }

    rooms_out: List[Dict[str, Any]] = []
    all_surfaces: List[Dict[str, list]] = []

    for level in hierarchy.get("levels", []):
        for room in level.get("rooms", []):
            indices = room.get("item_indices", [])
            by_surface = _categorize_items(items, indices)
            all_surfaces.append(by_surface)
            rooms_out.append({
                "room_name": room.get("name", "Unknown"),
                "level_name": level.get("name", ""),
                "dimensions": room.get("dimensions", {}),
                "height_ft": room.get("height_ft"),
                "items_by_surface": by_surface,
                "item_count": sum(len(v) for v in by_surface.values()),
            })

    # Sections (Debris Removal, etc.)
    sections_out: List[Dict[str, Any]] = []
    for sec in hierarchy.get("sections", []):
        indices = sec.get("item_indices", [])
        by_surface = _categorize_items(items, indices)
        all_surfaces.append(by_surface)
        sections_out.append({
            "section_name": sec.get("name", "Unknown"),
            "kind": sec.get("kind", "section"),
            "items_by_surface": by_surface,
            "item_count": sum(len(v) for v in by_surface.values()),
        })

    # Unassigned
    unassigned_indices = hierarchy.get("unassigned_item_indices", [])
    unassigned_surface = _categorize_items(items, unassigned_indices)
    all_surfaces.append(unassigned_surface)

    return {
        "rooms": rooms_out,
        "sections": sections_out,
        "unassigned_items": unassigned_surface,
        "summary": _build_summary_from_surfaces(all_surfaces),
    }


def _build_summary_from_surfaces(
    all_surfaces: List[Dict[str, list]],
) -> Dict[str, Any]:
    """Aggregate counts across all surface groupings."""
    totals: Dict[str, int] = {cat.value: 0 for cat in SurfaceCategory}
    for surfaces in all_surfaces:
        for cat_val, items_list in surfaces.items():
            totals[cat_val] = totals.get(cat_val, 0) + len(items_list)
    total_items = sum(totals.values())
    return {
        "total_items": total_items,
        "by_category": totals,
    }
