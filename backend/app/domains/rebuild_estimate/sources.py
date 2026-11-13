"""
The trade estimates a rebuild estimate imports, and what it keeps of each.

An imported estimate is kept as it was when imported (its snapshot): its
rooms and every priced line, with the unit price it was calculated at,
material tax and O&P already in it. It doesn't follow the original by
itself: when the original's lines change (it was recalculated), the
rebuild estimate says so and Refresh takes them again (owner, 2026-11-13).

  flooring  each of its rooms (sketch room) -> a room; its whole-job lines
            to the General section; every line under "Floor"
  bathroom  one room, the bathroom; lines under its phases
  cabinet   one room, the kitchen; lines under "Cabinets"
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

KINDS = ("flooring", "bathroom", "cabinet")
KIND_LABELS = {
    "flooring": "Flooring estimate",
    "bathroom": "Bathroom estimate",
    "cabinet": "Kitchen cabinet estimate",
}
# Where each kind's own page is (for a link back)
KIND_PATHS = {
    "flooring": "/flooring-estimates",
    "bathroom": "/bathroom-estimates",
    "cabinet": "/cabinet-estimates",
}

# A bathroom estimate's room, by its designation
_BATH_NAMES = {
    "master": "Master Bathroom",
    "hall": "Hall Bathroom",
    "powder": "Powder Room",
    "three_quarter": "Bathroom",
    "jack_jill": "Jack & Jill Bathroom",
}


def model_of(kind: str) -> Any:
    if kind == "flooring":
        from app.domains.flooring_estimate.models import FlooringEstimate
        return FlooringEstimate
    if kind == "bathroom":
        from app.domains.bathroom_estimate.models import BathroomEstimate
        return BathroomEstimate
    if kind == "cabinet":
        from app.domains.cabinet_estimate.models import CabinetEstimate
        return CabinetEstimate
    raise ValueError(f"Unknown estimate kind: {kind}")


def _num(value: Any) -> Optional[float]:
    try:
        return None if value is None else round(float(value), 2)
    except (TypeError, ValueError):
        return None


def label_of(kind: str, est: Any) -> str:
    label = KIND_LABELS[kind]
    if kind == "bathroom":
        name = _BATH_NAMES.get(str(getattr(est, "designation", "") or ""))
        if name:
            label = f"{label} - {name}"
    option = getattr(est, "option_label", None)
    if getattr(est, "kind", None) == "option" and option:
        label = f"{label} · {option}"
    return label


def op_included(kind: str, est: Any) -> bool:
    """Whether its prices have overhead & profit in them"""
    if kind == "cabinet":
        # Always applied on a cabinet estimate
        return float(est.overhead_pct or 0) + float(est.profit_pct or 0) > 0
    return bool(getattr(est, "include_overhead_profit", False))


def priced_lines(est: Any) -> List[Any]:
    return sorted(est.line_items or [], key=lambda li: (li.display_order or 0))


def fingerprint(est: Any) -> str:
    """Changes when its lines do (a recalculation that moved anything)"""
    rows = [
        [li.description, round(float(li.quantity or 0), 4), round(float(li.unit_price or 0), 4),
         round(float(li.total or 0), 2)]
        for li in priced_lines(est)
    ]
    return hashlib.sha1(json.dumps(rows).encode()).hexdigest()


def _flooring(est: Any) -> Dict[str, Any]:
    rooms = []
    for r in est.calculated_rooms or []:
        if r.get("included") is False:
            continue
        floor = _num(r.get("floor_sf"))
        rooms.append({
            "key": f"room:{r.get('room_id')}", "name": r.get("name") or "Room",
            "level_name": r.get("level_name"),
            "measures": {
                "floor_sf": floor, "ceiling_sf": _num(r.get("ceiling_sf")) or floor, "wall_sf": _num(r.get("wall_sf")),
                "perimeter_lf": _num(r.get("perimeter_lf")), "height_ft": _num(r.get("height_ft")),
            },
        })
    known = {room["key"] for room in rooms}
    lines = []
    for li in priced_lines(est):
        key = f"room:{li.room_id}" if li.room_id else None
        if key and key not in known:
            # A room the line names that the calculation didn't keep
            rooms.append({"key": key, "name": li.room_name or "Room", "level_name": li.level_name, "measures": {}})
            known.add(key)
        lines.append(_line(li, key, "floor" if key else "other"))
    return {"rooms": rooms, "lines": lines}


def _bathroom(est: Any) -> Dict[str, Any]:
    floor = _num(est.floor_sf)
    length, width = _num(est.length_ft), _num(est.width_ft)
    room = {
        "key": "bathroom", "name": _BATH_NAMES.get(str(est.designation or ""), "Bathroom"), "level_name": None,
        "measures": {
            "floor_sf": floor, "ceiling_sf": floor, "wall_sf": _num(est.wall_sf),
            "perimeter_lf": round(2 * (length + width), 2) if length and width else None,
            "height_ft": _num(est.height_ft),
        },
    }
    lines = [_line(li, "bathroom", f"bath_{int(li.phase or 7)}") for li in priced_lines(est)]
    return {"rooms": [room], "lines": lines}


def _cabinet(est: Any) -> Dict[str, Any]:
    room = {"key": "kitchen", "name": "Kitchen", "level_name": None, "measures": {}}
    lines = [_line(li, "kitchen", "cabinets") for li in priced_lines(est)]
    return {"rooms": [room], "lines": lines}


def _line(li: Any, room_key: Optional[str], section: str) -> Dict[str, Any]:
    return {
        "room_key": room_key, "section": section,
        "description": li.description, "quantity": round(float(li.quantity or 0), 2), "unit": li.unit,
        "unit_price": round(float(li.unit_price or 0), 2), "total": round(float(li.total or 0), 2),
        "notes": li.notes,
    }


def snapshot(kind: str, est: Any) -> Dict[str, Any]:
    """What the rebuild estimate keeps of an estimate it imports"""
    body = {"flooring": _flooring, "bathroom": _bathroom, "cabinet": _cabinet}[kind](est)
    return {
        "kind": kind,
        "estimate_id": str(est.id),
        "label": label_of(kind, est),
        "op_included": op_included(kind, est),
        "total": round(sum(li["total"] for li in body["lines"]), 2),
        "fingerprint": fingerprint(est),
        "imported_at": datetime.now(timezone.utc).isoformat(),
        **body,
    }


def importable(kind: str, est: Any) -> bool:
    """Priced and not the bathroom's never-priced current layout"""
    if kind == "bathroom" and getattr(est, "kind", None) == "existing":
        return False
    return bool(est.line_items)
