"""
Sets of repairs added to a room together (owner, 2026-11-13), so the
drywall doesn't go in without its primer and paint. Each item is a price
list line with the activity it is added as, the section it goes under and
the room measure its quantity follows. A set that asks for a cut height is
for the lower part of the walls (a 2' or 4' flood cut): its items follow
that part, and the paint to match goes on the rest of the wall above it.
"""

from typing import Any, Dict, List, Mapping, Optional, Tuple

from .xactimate_search import latest_month, match_of


def _item(code: str, activity: str, section: str, basis: Optional[str],
          cut_part: Optional[str] = None, only_with_cut: bool = False) -> Dict[str, Any]:
    return {"code": code, "activity": activity, "section": section, "basis": basis,
            "cut_part": cut_part, "only_with_cut": only_with_cut}


_WALL_DRYWALL = [
    _item("DRY1/2", "&", "wall", "wall_sf", "below"),
    _item("PNTSP", "+", "wall", "wall_sf", "below"),
    # The rest of the wall, painted to match the new drywall
    _item("PNTP", "+", "wall", "wall_sf", "above", only_with_cut=True),
]

ASSEMBLIES: List[Dict[str, Any]] = [
    {
        "key": "walls_drywall", "label": "Walls - new drywall, primed & painted", "asks_cut": True,
        "hint": "Drywall torn out and replaced (the lower part with a flood cut), sealed, primed and painted; "
                "the rest of the wall painted to match",
        "items": _WALL_DRYWALL,
    },
    {
        "key": "walls_drywall_insulation", "label": "Walls - new insulation & drywall, primed & painted",
        "asks_cut": True,
        "hint": "As above, with new insulation in the outside walls",
        "items": [_item("INSBTF4+", "&", "wall", "exterior_wall_sf", "below"), *_WALL_DRYWALL],
    },
    {
        "key": "ceiling_drywall", "label": "Ceiling - new drywall, primed & painted", "asks_cut": False,
        "hint": "Drywall torn out and replaced, sealed, primed and painted",
        "items": [_item("DRY1/2", "&", "ceiling", "ceiling_sf"), _item("PNTSP", "+", "ceiling", "ceiling_sf")],
    },
    {
        "key": "walls_paint", "label": "Walls - repaint, 2 coats", "asks_cut": False,
        "hint": "The walls, less doors and openings",
        "items": [_item("PNTP2", "+", "wall", "wall_sf")],
    },
    {
        "key": "ceiling_paint", "label": "Ceiling - repaint, 1 coat", "asks_cut": False, "hint": "",
        "items": [_item("PNTP", "+", "ceiling", "ceiling_sf")],
    },
    {
        "key": "paint_prep", "label": "Paint prep - masking & floor protection", "asks_cut": False,
        "hint": "Masking along the room's walls, film over its floor",
        "items": [_item("PNTMASKLF", "+", "other", "perimeter_lf"), _item("PNTMASKFL", "+", "other", "floor_sf")],
    },
    {
        "key": "final_clean", "label": "Final construction clean-up", "asks_cut": False, "hint": "The room's floor area",
        "items": [_item("CLNFINALR", "+", "other", "floor_sf")],
    },
]


def assemblies(session: Any, saved: Mapping[Tuple[str, str], str]) -> List[Dict[str, Any]]:
    """Every set with each item's line from the latest price list (an item
    the price list doesn't have is left out of its set)"""
    from app.domains.xactimate.models import XactimateItem

    latest = latest_month(session)
    codes = sorted({item["code"] for a in ASSEMBLIES for item in a["items"]})
    rows = {}
    if latest is not None:
        rows = {
            r.item_code: r for r in session.query(XactimateItem).filter(
                XactimateItem.price_year == latest[0], XactimateItem.price_month == latest[1],
                XactimateItem.item_code.in_(codes),
            ).all()
        }
    out = []
    for a in ASSEMBLIES:
        items = []
        for item in a["items"]:
            row = rows.get(item["code"])
            if row is None:
                continue
            match = match_of(row, saved)
            if not any(act["activity"] == item["activity"] for act in match["activities"]):
                continue
            items.append({**item, "match": match})
        if items:
            out.append({k: a[k] for k in ("key", "label", "hint", "asks_cut")} | {"items": items})
    return out
