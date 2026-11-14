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
"""

import copy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Set

from app.domains.flooring_estimate.geometry import RoomMeasure, levels_of, measure_sketch

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
