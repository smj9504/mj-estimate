"""
The rebuild estimate put together: each room's imported lines and the
repairs added to it, under their sections, priced, numbered and totalled.

A room reads like a contractor's estimate (owner, 2026-11-13): its floor
(the flooring estimate's lines), its cabinets (the kitchen estimate's), a
bathroom's phases (the bathroom estimate's), then the walls and the
ceiling. Lines are numbered through the whole estimate.

An added repair is an Xactimate line (its code and activity, the price list
price kept on the line when it was added) or one typed in. Its price is the
Xactimate price marked up (unit_prices.xactimate), material tax on its
material share, and the estimate's O&P when it is on, all folded into the
unit price, as on the flooring estimate. A price typed in is used as typed.
Its quantity, unless typed, is the room's measure it follows (basis): the
walls' SF (less doors and openings) for paint on the walls, the outside
walls' for insulation, the ceiling's for the ceiling... A wall measure can be
taken only part of the way up (a 2' or 4' flood cut, cut_height_ft) or only
above that (the rest of the wall, painted to match).

A line from the price list is written in our words, not Xactimate's (owner,
2026-11-13: wording.py); one still in Xactimate's words is pointed out.
"""

from typing import Any, Dict, List, Mapping, Optional, Tuple

from app.domains.unit_prices.xactimate import xact

# A room's sections, in the order they print
SECTIONS = (
    ("floor", "Floor"),
    ("cabinets", "Cabinets"),
    ("bath_1", "Demo & Disposal"),
    ("bath_2", "Rough Trades (Plumbing & Electrical)"),
    ("bath_3", "Substrate & Waterproofing"),
    ("bath_4", "Tile & Flooring"),
    ("bath_5", "Fixtures Install"),
    ("bath_6", "Finish (Paint & Trim)"),
    ("bath_7", "Punch / Cleanup / Accessories"),
    ("wall", "Wall"),
    ("ceiling", "Ceiling"),
    ("other", "Other"),
)
SECTION_LABELS = dict(SECTIONS)
_ORDER = {key: i for i, (key, _) in enumerate(SECTIONS)}
# What a repair added here can go under
ADDED_SECTIONS = ("floor", "wall", "ceiling", "other")

# A room's measures a quantity can follow: label, unit
BASES = {
    "floor_sf": ("Floor SF", "SF"),
    "ceiling_sf": ("Ceiling SF", "SF"),
    "wall_sf": ("Wall SF", "SF"),
    "exterior_wall_sf": ("Outside wall SF", "SF"),
    "perimeter_lf": ("Perimeter LF", "LF"),
}
# The measures a cut height applies to
WALL_BASES = ("wall_sf", "exterior_wall_sf")
MEASURES = ("floor_sf", "ceiling_sf", "wall_sf", "exterior_wall_sf", "perimeter_lf", "height_ft")
DEFAULT_HEIGHT_FT = 8.0

GENERAL = "General"


def tax_rate(state: Optional[str], zip_code: Optional[str]) -> float:
    # The same internal material tax loading the trade estimates use
    from app.domains.bathroom_estimate.pricing import get_material_tax_loading

    return get_material_tax_loading(state or "MD", zip_code or "")


def measure(room: Optional[Mapping[str, Any]], basis: Optional[str]) -> Optional[float]:
    if not room or not basis:
        return None
    measures = room.get("measures") or {}
    value = measures.get(basis)
    if value is None and basis == "ceiling_sf":
        value = measures.get("floor_sf")
    try:
        return None if value is None else round(float(value), 2)
    except (TypeError, ValueError):
        return None


def line_measure(line: Mapping[str, Any], room: Optional[Mapping[str, Any]]) -> Optional[float]:
    """The room's measure a line follows, only the part of the wall it is
    for when it has a cut height: the lower part (the walls' SF times the
    cut over the room's height: the doors take their share) or the rest"""
    value = measure(room, line.get("basis"))
    cut = line.get("cut_height_ft")
    if value is None or not cut or line.get("basis") not in WALL_BASES:
        return value
    height = float((room.get("measures") or {}).get("height_ft") or DEFAULT_HEIGHT_FT)
    share = min(float(cut) / height, 1.0)
    if line.get("cut_part") == "above":
        share = 1.0 - share
    return round(value * share, 2)


def cut_note(line: Mapping[str, Any]) -> Optional[str]:
    """Which part of the wall a line is for, said on the estimate"""
    cut = line.get("cut_height_ft")
    if not cut or line.get("basis") not in WALL_BASES:
        return None
    walls = "outside walls" if line.get("basis") == "exterior_wall_sf" else "walls"
    return f"The {walls} above {float(cut):g}'" if line.get("cut_part") == "above" else f"Lower {float(cut):g}' of the {walls}"


def _activity(line: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    for a in line.get("activities") or []:
        if a.get("activity") == line.get("activity"):
            return a
    return None


def added_price(line: Mapping[str, Any], tax: float, op_factor: float) -> Tuple[float, Optional[float], bool]:
    """(unit price, the Xactimate price marked up, typed) of a repair added here"""
    if line.get("unit_price") is not None:
        return round(float(line["unit_price"]), 2), None, True
    activity = _activity(line)
    if activity is None:
        return 0.0, None, False
    base = xact(float(activity.get("price") or 0))
    share = min(max(float(activity.get("material_share") or 0), 0.0), 1.0)
    return round((base + base * share * tax) * op_factor, 2), base, False


def _added_line(line: Mapping[str, Any], room: Optional[Mapping[str, Any]], tax: float, op_factor: float,
                warnings: List[str], where: str) -> Dict[str, Any]:
    auto = line_measure(line, room)
    typed_qty = line.get("quantity")
    qty = round(float(typed_qty), 2) if typed_qty is not None else (auto if auto is not None else 0.0)
    unit_price, base, typed = added_price(line, tax, op_factor)
    description = str(line.get("description") or "").strip() or "Repair"
    if typed_qty is None and auto is None:
        warnings.append(f'{where}: "{description}" has no quantity: type it, or the room\'s '
                        f'{BASES.get(str(line.get("basis")), ("measure",))[0].lower()}.')
    if not typed and base is None:
        warnings.append(f'{where}: "{description}" has no price.')
    if line.get("xact_words"):
        warnings.append(f"{where}: \"{description}\" is in Xactimate's words: write it our way.")
    return {
        "id": line.get("id"), "source": "added", "section": line.get("section") or "other",
        "description": description, "quantity": qty, "unit": line.get("unit") or "EA",
        "unit_price": unit_price, "total": round(qty * unit_price, 2), "notes": line.get("notes") or cut_note(line),
        "basis": line.get("basis"), "cut_height_ft": line.get("cut_height_ft"), "cut_part": line.get("cut_part"),
        "auto_qty": auto, "qty_typed": typed_qty is not None, "xact_words": bool(line.get("xact_words")),
        "price_typed": typed, "base_price": base, "code": line.get("code"), "activity": line.get("activity"),
    }


def _sections(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by: Dict[str, List[Dict[str, Any]]] = {}
    for li in lines:
        by.setdefault(li["section"] if li["section"] in _ORDER else "other", []).append(li)
    return [
        {"key": key, "label": SECTION_LABELS[key], "lines": by[key], "total": round(sum(li["total"] for li in by[key]), 2)}
        for key in sorted(by, key=lambda k: _ORDER[k])
    ]


def assemble(est: Any) -> Dict[str, Any]:
    """Every room with its sections and lines, the General section, the
    totals by imported estimate, and what is missing"""
    rooms = list(est.rooms or [])
    by_id = {str(r.get("id")): r for r in rooms}
    sources = list(est.sources or [])
    tax = tax_rate(est.state, est.zip_code)
    op_factor = (1 + float(est.overhead_pct or 0)) * (1 + float(est.profit_pct or 0)) if est.include_overhead_profit else 1.0
    warnings: List[str] = []

    placed: Dict[Optional[str], List[Dict[str, Any]]] = {}
    by_source = []
    for src in sources:
        room_map = src.get("room_map") or {}
        for i, li in enumerate(src.get("lines") or []):
            room_id = room_map.get(li.get("room_key")) if li.get("room_key") else None
            if room_id is not None and room_id not in by_id:
                room_id = None
            placed.setdefault(room_id, []).append({
                **li, "id": f"{src.get('id')}:{i}", "source": "imported",
                "source_id": src.get("id"), "source_label": src.get("label"),
            })
        by_source.append({"id": src.get("id"), "label": src.get("label"), "total": src.get("total") or 0})
        if bool(src.get("op_included")) != bool(est.include_overhead_profit):
            warnings.append(
                f"{src.get('label')} is priced {'with' if src.get('op_included') else 'without'} O&P, "
                f"the repairs added here {'with' if est.include_overhead_profit else 'without'} it."
            )

    for line in est.lines or []:
        room_id = line.get("room_id")
        room = by_id.get(str(room_id)) if room_id else None
        where = room.get("name") if room else GENERAL
        placed.setdefault(str(room_id) if room else None, []).append(
            _added_line(line, room, tax, op_factor, warnings, where)
        )

    number = 0
    out_rooms = []
    for room in [*rooms, None]:
        room_id = str(room.get("id")) if room else None
        lines = placed.get(room_id, [])
        if room is None and not lines:
            continue
        sections = _sections(lines)
        for section in sections:
            for li in section["lines"]:
                number += 1
                li["n"] = number
        out_rooms.append({
            "id": room_id, "name": room.get("name") if room else GENERAL,
            "level_name": room.get("level_name") if room else None,
            "measures": dict(room.get("measures") or {}) if room else {},
            "sketch_room_id": room.get("sketch_room_id") if room else None,
            "sections": sections,
            "total": round(sum(s["total"] for s in sections), 2),
        })
    added_total = round(sum(li["total"] for ls in placed.values() for li in ls if li["source"] == "added"), 2)
    total = round(sum(r["total"] for r in out_rooms), 2)
    return {
        "rooms": out_rooms,
        "by_source": by_source,
        "added_total": added_total,
        "total": total,
        "tax_rate": tax,
        "warnings": warnings,
    }
