"""
A rebuild estimate's own sketch, and the rooms it keeps in step with it.

The sketch is drawn with the flooring estimate's editor and measured the
same way (flooring_estimate.geometry.measure_sketch). Each room drawn is a
room of the estimate (sketch_room_id) whose name, level and measures come
from the drawing: the floor and ceiling, the walls less their doors,
openings and windows, the outside walls, the perimeter and the height.

  - A room drawn takes, in this order: the room already drawn as it; a room
    the flooring estimate brought in as that same drawn room (a sketch
    copied from the flooring estimate keeps its room ids); a room of the
    same name on its level (or with no level) not drawn yet; else a new
    room. A new room that holds nothing yet gives way to a room of the same
    name when it is renamed to it (drawn, then named "Kitchen" where the
    kitchen estimate's room already is).
  - A room whose drawing is gone goes too, unless it holds lines (added
    here or brought in): then it stays, measured as it was last drawn, and
    can be typed or removed by hand.
  - Rooms not drawn are left as they are.
  - Rooms combined into one on the sketch (the combined room's merged_from)
    go into it: their lines (added here or brought in) move onto it, and a
    quantity that followed a room's measure is kept as it was measured, on
    the combined room's own lines too, so nothing is counted twice when the
    combined room is measured as a whole. Lines of the same item (its code,
    activity, section, unit, price and flood cut; a typed line by its words)
    become one, their quantities added up, the sum kept to read
    ("246.42 + 44.73"); other items stay as they are (owner, 2026-11-16).
  - The combined room keeps the rooms and lines as they were before
    (room["combined"], the latest last): drawn apart again (Separate rooms,
    or an undo), they come back as they were, and the combined room's lines
    go back to its own.
"""

import copy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Set

from app.domains.flooring_estimate.geometry import RoomMeasure, levels_of, measure_sketch

from .assemble import line_measure

# The id a room made by the sketch gets: the same room drawn again (an undo)
# comes back as the same room
SKETCH_PREFIX = "sk-"


def _norm(name: Any) -> str:
    return " ".join(str(name or "").lower().split())


def sketch_room_count(sketch: Optional[Mapping[str, Any]]) -> int:
    return sum(len([r for r in (lvl.get("rooms") or []) if len(r.get("points") or []) >= 3])
               for lvl in levels_of(sketch))


def measures_of(m: RoomMeasure) -> Dict[str, Optional[float]]:
    return {
        "floor_sf": round(m.floor_sf, 2),
        "ceiling_sf": round(m.ceiling_sf, 2),
        "wall_sf": round(m.wall_net_sf, 2),
        "exterior_wall_sf": round(m.exterior_wall_sf, 2),
        "perimeter_lf": round(m.perimeter_lf, 2),
        "height_ft": round(m.height_ft, 2),
    }


def held_rooms(lines: Iterable[Mapping[str, Any]], sources: Iterable[Mapping[str, Any]]) -> Set[str]:
    """Rooms with a line on them: added here, or brought in"""
    held = {str(li.get("room_id")) for li in lines if li.get("room_id")}
    for src in sources:
        held.update(str(room_id) for room_id in (src.get("room_map") or {}).values())
    return held


def merged_into(sketch: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    """Each room combined into another on the sketch: its id -> the room it is part of now"""
    out: Dict[str, str] = {}
    for level in levels_of(sketch):
        for room in level.get("rooms") or []:
            for old in room.get("merged_from") or []:
                out[str(old)] = str(room.get("id"))
    return out


def _same_item(li: Mapping[str, Any]):
    code = li.get("code")
    return (
        li.get("section") or "other",
        code or " ".join(str(li.get("description") or "").lower().split()),
        li.get("activity") if code else None,
        li.get("unit") or "EA",
        li.get("unit_price"),
        li.get("cut_height_ft"),
        li.get("cut_part") or "below",
    )


def _figure(value: Any) -> str:
    return f"{float(value or 0):.2f}".rstrip("0").rstrip(".")


def merge_same(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Lines of the same item as one, in the order they first come: their
    quantities added up, the sum kept to read, their notes together"""
    groups: Dict[Any, List[Dict[str, Any]]] = {}
    for li in lines:
        groups.setdefault(_same_item(li), []).append(li)
    out = []
    for group in groups.values():
        if len(group) == 1:
            out.append(group[0])
            continue
        merged = dict(group[0])
        merged["quantity"] = round(sum(float(li.get("quantity") or 0) for li in group), 2)
        merged["basis"] = None
        formula = " + ".join(f"({li['qty_formula']})" if li.get("qty_formula") else _figure(li.get("quantity"))
                             for li in group)
        merged["qty_formula"] = formula if len(formula) <= 200 else None
        notes = list(dict.fromkeys(str(li["notes"]).strip() for li in group if li.get("notes")))
        merged["notes"] = "; ".join(notes)[:500] or None
        out.append(merged)
    return out


def _unfold(rooms: List[Dict[str, Any]], drawn: Set[str], into: Mapping[str, str],
            lines: List[Dict[str, Any]], sources: List[Dict[str, Any]]):
    """Combined rooms drawn apart again: the rooms and lines as they were before"""
    changed = False
    for room in list(rooms):
        stack = room.get("combined") or []
        if not stack:
            continue
        last = stack[-1]
        apart = [str(i) for i in last.get("sketch_ids") or []]
        if not apart or not all(i in drawn and i not in into for i in apart):
            continue
        taken = {str(r["id"]) for r in rooms}
        back = [p["room"] for p in last.get("parts") or [] if str(p["room"]["id"]) not in taken]
        rid = str(room["id"])
        lines = ([li for li in lines if str(li.get("room_id") or "") != rid] + list(last.get("own_lines") or [])
                 + [li for p in last.get("parts") or [] for li in p.get("lines") or []])
        restored = []
        for src in sources:
            keys = (last.get("source_keys") or {}).get(str(src.get("id")), {})
            if keys:
                src = {**src, "room_map": {**(src.get("room_map") or {}), **keys}}
            restored.append(src)
        sources = restored
        room["combined"] = stack[:-1] or None
        rooms = rooms + back
        changed = True
    return rooms, lines, sources, changed


def fold_merged(rooms: List[Dict[str, Any]], sketch: Optional[Mapping[str, Any]],
                lines: List[Dict[str, Any]], sources: List[Dict[str, Any]]):
    """(rooms, lines, sources, whether any changed): the rooms combined on the
    sketch taken into the room they were combined into, and those drawn apart
    again brought back (see the module's notes)"""
    into = merged_into(sketch) if sketch else {}
    drawn = {str(r.get("id")) for level in levels_of(sketch) for r in (level.get("rooms") or [])}
    rooms = [dict(r) for r in rooms]
    rooms, lines, sources, unfolded = _unfold(rooms, drawn, into, lines, sources)
    if not into:
        return rooms, lines, sources, unfolded
    by_sketch = {str(r["sketch_room_id"]): r for r in rooms if r.get("sketch_room_id")}
    moves: Dict[str, Dict[str, Any]] = {}
    keepers: Set[str] = set()
    for old_sid, new_sid in into.items():
        if old_sid in drawn:  # drawn again (combined, then undone)
            continue
        old, new = by_sketch.get(old_sid), by_sketch.get(new_sid)
        if old is None or new is None or old["id"] == new["id"]:
            continue
        moves[str(old["id"])] = new
        keepers.add(str(new["id"]))
    if not moves:
        return rooms, lines, sources, unfolded
    by_id = {str(r["id"]): r for r in rooms}

    # As they were, to separate them again
    for kid in keepers:
        keeper = by_id[kid]
        gone = [rid for rid, new in moves.items() if str(new["id"]) == kid]
        keeper["combined"] = list(keeper.get("combined") or []) + [{
            "sketch_ids": [str(by_id[rid].get("sketch_room_id")) for rid in gone],
            "own_lines": [copy.deepcopy(li) for li in lines if str(li.get("room_id") or "") == kid],
            "parts": [{"room": copy.deepcopy(by_id[rid]),
                       "lines": [copy.deepcopy(li) for li in lines if str(li.get("room_id") or "") == rid]}
                      for rid in gone],
            "source_keys": {str(src.get("id")): {k: v for k, v in (src.get("room_map") or {}).items() if str(v) in gone}
                            for src in sources if any(str(v) in gone for v in (src.get("room_map") or {}).values())},
        }]

    # The combined room's own lines first: a line of the same item is theirs, the others' added on
    others: List[Dict[str, Any]] = []
    own: Dict[str, List[Dict[str, Any]]] = {kid: [] for kid in keepers}
    taken_in: Dict[str, List[Dict[str, Any]]] = {kid: [] for kid in keepers}
    for li in lines:
        li = dict(li)
        rid = str(li.get("room_id") or "")
        if rid in moves or rid in keepers:
            if li.get("quantity") is None and li.get("basis"):
                measured = line_measure(li, by_id.get(rid))
                if measured is not None:
                    li["quantity"] = measured
                    li["qty_formula"] = None
            if rid in moves:
                li["room_id"] = moves[rid]["id"]
                taken_in[str(li["room_id"])].append(li)
            else:
                own[rid].append(li)
        else:
            others.append(li)
    out_lines = others + [li for kid in keepers for li in merge_same(own[kid] + taken_in[kid])]
    out_sources = []
    for src in sources:
        room_map = src.get("room_map") or {}
        if any(str(v) in moves for v in room_map.values()):
            src = {**src, "room_map": {k: (moves[str(v)]["id"] if str(v) in moves else v) for k, v in room_map.items()}}
        out_sources.append(src)
    return [r for r in rooms if str(r["id"]) not in moves], out_lines, out_sources, True


def sync_rooms(rooms: List[Dict[str, Any]], sketch: Optional[Mapping[str, Any]],
               lines: Iterable[Mapping[str, Any]], sources: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """The rooms, in step with the sketch (see the module's notes)"""
    sources = list(sources)
    measured = measure_sketch(sketch) if sketch else []
    drawn = {m.room_id: m for m in measured}
    held = held_rooms(lines, sources)
    out = [copy.deepcopy(r) for r in rooms]

    # A room whose drawing is gone is let go
    kept: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for room in out:
        rid = room.get("sketch_room_id")
        if rid and (rid not in drawn or rid in seen):
            if str(room["id"]) not in held:
                continue
            room["sketch_room_id"] = None
        if room.get("sketch_room_id"):
            seen.add(room["sketch_room_id"])
        kept.append(room)
    out = kept

    # The rooms a flooring estimate brought in, by the drawn room they were
    flooring_room: Dict[str, str] = {}
    for src in sources:
        if src.get("kind") != "flooring":
            continue
        for key, room_id in (src.get("room_map") or {}).items():
            if str(key).startswith("room:"):
                flooring_room.setdefault(str(key)[5:], str(room_id))

    def free_match(m: RoomMeasure) -> Optional[Dict[str, Any]]:
        free = [r for r in out if not r.get("sketch_room_id")]
        own = next((r for r in free if r["id"] == (SKETCH_PREFIX + m.room_id)[:64]), None)
        if own is not None:
            return own
        brought = flooring_room.get(m.room_id)
        hit = next((r for r in free if r["id"] == brought), None) if brought else None
        if hit is not None:
            return hit
        return next((r for r in free if _norm(r.get("name")) == _norm(m.name)
                     and (not r.get("level_name") or r.get("level_name") == m.level_name)), None)

    for m in measured:
        current = next((r for r in out if r.get("sketch_room_id") == m.room_id), None)
        if current is None or (str(current["id"]).startswith(SKETCH_PREFIX) and str(current["id"]) not in held):
            better = free_match(m)
            if better is not None:
                if current is not None:
                    out.remove(current)
                current = better
        if current is None:
            room_id = (SKETCH_PREFIX + m.room_id)[:64]
            if any(r["id"] == room_id for r in out):
                room_id = f"{SKETCH_PREFIX}{len(out)}-{m.room_id}"[:64]
            current = {"id": room_id}
            out.append(current)
        current.update({
            "name": m.name or "Room",
            "level_name": m.level_name or None,
            "measures": measures_of(m),
            "sketch_room_id": m.room_id,
        })
    return out
