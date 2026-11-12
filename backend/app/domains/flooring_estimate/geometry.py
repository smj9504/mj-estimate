"""
Measurements from a flooring sketch.

The sketch stores everything in feet, so nothing here needs a canvas
scale. A room is the polygon of its finished floor: its points are the
interior faces of the walls, wall to wall, as measured on site. Walls are
drawn around the rooms; they are not part of the area.

    sketch_data = {
      "version": 1, "units": "ft",
      "levels": [{
        "id": "main", "name": "Main Level",
        "rooms": [{"id", "name", "height_ft", "points": [{"x", "y"}, ...], "subroom_of"}],
        # An opening sits in the wall between two rooms (or a room and the
        # outside: null). a/b are its two jambs on the first room's side.
        "openings": [{"id", "kind", "rooms": [room_id, room_id | null], "a": {...}, "b": {...},
                      "swing": room_id, "hinge": "a" | "b"}],
        # Where base cabinets stand along a wall: no baseboard there
        "cabinet_runs": [{"id", "room_id", "a": {...}, "b": {...}}],
        # Things on the floor, by their center: toilets, vanities, islands, appliances
        "fixtures": [{"id", "type", "x", "y", "w", "h", "rotation", "floor_under"}],
      }],
    }
"""

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

Point = Tuple[float, float]

# Opening kinds with a door leaf in them (doors to undercut, detach and reset)
DOOR_KINDS = frozenset({"door", "bifold", "pocket", "slider", "exterior_door"})
OPENING_KINDS = frozenset({"opening"}) | DOOR_KINDS

APPLIANCE_TYPES = frozenset({"refrigerator", "range", "dishwasher", "washer", "dryer"})
FIXTURE_TYPES = frozenset({"toilet", "vanity", "island", "other"}) | APPLIANCE_TYPES


def point(value: Any) -> Point:
    if isinstance(value, Mapping):
        return float(value.get("x") or 0), float(value.get("y") or 0)
    return float(value[0]), float(value[1])


def points_of(values: Optional[Iterable[Any]]) -> List[Point]:
    return [point(v) for v in (values or [])]


def distance(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _doubled_area(points: Sequence[Point]) -> float:
    n = len(points)
    return sum(
        points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1]
        for i in range(n)
    )


def polygon_area(points: Sequence[Point]) -> float:
    if len(points) < 3:
        return 0.0
    return abs(_doubled_area(points)) / 2


def polygon_perimeter(points: Sequence[Point]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(distance(points[i], points[(i + 1) % len(points)]) for i in range(len(points)))


def point_in_polygon(p: Point, points: Sequence[Point]) -> bool:
    """Ray casting; a point on the edge may go either way."""
    x, y = p
    inside = False
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            cross_x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < cross_x:
                inside = not inside
    return inside


def bounding_box(points: Sequence[Point]) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def is_axis_rectangle(points: Sequence[Point], tolerance: float = 0.01) -> bool:
    """Four corners with every wall square to the page: a plain rectangular room."""
    if len(points) != 4:
        return False
    for i in range(4):
        a, b = points[i], points[(i + 1) % 4]
        if abs(a[0] - b[0]) > tolerance and abs(a[1] - b[1]) > tolerance:
            return False
    return True


def format_ft_in(feet: float) -> str:
    """12.1667 -> 12' 2\""""
    total = int(round(feet * 12))
    ft, inches = divmod(total, 12)
    return f"{ft}' {inches}\""


@dataclass
class OpeningRef:
    id: str
    kind: str
    width_lf: float
    to_room_id: Optional[str]
    to_room_name: Optional[str]


@dataclass
class RoomMeasure:
    """One room as measured from the sketch: what every quantity starts from."""

    room_id: str
    name: str
    level_id: str
    level_name: str
    height_ft: float
    subroom_of: Optional[str]
    points: List[Point]
    # Floor and ceiling
    floor_sf: float = 0.0          # less anything set on the floor that isn't floored under (an island)
    ceiling_sf: float = 0.0
    floor_sy: float = 0.0
    # Lengths
    perimeter_lf: float = 0.0
    openings_lf: float = 0.0
    cabinet_run_lf: float = 0.0
    base_lf: float = 0.0           # perimeter less openings and cabinet runs: where base trim goes
    toe_kick_lf: float = 0.0       # cabinet runs plus the sides of islands
    wall_sf: float = 0.0
    # Counts
    door_count: int = 0            # doors hung in this room (the side they swing into)
    exterior_door_count: int = 0
    toilet_count: int = 0
    vanity_count: int = 0
    appliance_count: int = 0
    openings: List[OpeningRef] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["points"] = [{"x": x, "y": y} for x, y in self.points]
        for key, value in data.items():
            if isinstance(value, float):
                data[key] = round(value, 2)
        return data


def levels_of(sketch: Optional[Mapping[str, Any]]) -> List[Mapping[str, Any]]:
    return list((sketch or {}).get("levels") or [])


def measure_sketch(sketch: Optional[Mapping[str, Any]]) -> List[RoomMeasure]:
    """Every room of every level, in the order they were drawn, with a
    subroom (a closet) right after the room it belongs to."""
    measured: List[RoomMeasure] = []
    for level in levels_of(sketch):
        level_id = str(level.get("id") or "")
        level_name = str(level.get("name") or "")
        rooms = [r for r in (level.get("rooms") or []) if len(r.get("points") or []) >= 3]
        names = {str(r.get("id")): str(r.get("name") or "") for r in rooms}
        by_id: Dict[str, RoomMeasure] = {}
        for room in rooms:
            pts = points_of(room.get("points"))
            area = polygon_area(pts)
            perimeter = polygon_perimeter(pts)
            height = float(room.get("height_ft") or 8.0)
            by_id[str(room.get("id"))] = RoomMeasure(
                room_id=str(room.get("id")),
                name=str(room.get("name") or "Room"),
                level_id=level_id,
                level_name=level_name,
                height_ft=height,
                subroom_of=room.get("subroom_of") or None,
                points=pts,
                floor_sf=area,
                ceiling_sf=area,
                perimeter_lf=perimeter,
                wall_sf=perimeter * height,
            )

        for opening in level.get("openings") or []:
            ids = [str(r) if r else None for r in (opening.get("rooms") or [])][:2]
            if not any(ids):
                continue
            width = distance(point(opening.get("a") or (0, 0)), point(opening.get("b") or (0, 0)))
            kind = str(opening.get("kind") or "opening")
            exterior = len(ids) < 2 or None in ids
            for i, room_id in enumerate(ids):
                m = by_id.get(room_id) if room_id else None
                if m is None:
                    continue
                other = ids[1 - i] if len(ids) == 2 else None
                m.openings_lf += width
                m.openings.append(OpeningRef(
                    id=str(opening.get("id") or ""), kind=kind, width_lf=width,
                    to_room_id=other, to_room_name=names.get(other) if other else None,
                ))
            if kind in DOOR_KINDS:
                swing = opening.get("swing")
                hung_in = swing if swing in ids and swing else next(r for r in ids if r)
                m = by_id.get(hung_in)
                if m is not None:
                    m.door_count += 1
                    if exterior:
                        m.exterior_door_count += 1

        for run in level.get("cabinet_runs") or []:
            m = by_id.get(str(run.get("room_id")))
            if m is not None:
                length = distance(point(run.get("a") or (0, 0)), point(run.get("b") or (0, 0)))
                m.cabinet_run_lf += length
                m.toe_kick_lf += length

        for fixture in level.get("fixtures") or []:
            center = (float(fixture.get("x") or 0), float(fixture.get("y") or 0))
            owner = next((m for m in by_id.values() if point_in_polygon(center, m.points)), None)
            if owner is None:
                continue
            kind = str(fixture.get("type") or "other")
            if kind == "toilet":
                owner.toilet_count += 1
            elif kind == "vanity":
                owner.vanity_count += 1
            elif kind in APPLIANCE_TYPES:
                owner.appliance_count += 1
            elif kind == "island":
                w, h = float(fixture.get("w") or 0), float(fixture.get("h") or 0)
                owner.toe_kick_lf += 2 * (w + h)
                if not fixture.get("floor_under"):
                    owner.floor_sf = max(0.0, owner.floor_sf - w * h)

        ordered: List[RoomMeasure] = []
        for room in rooms:
            m = by_id[str(room.get("id"))]
            if m.subroom_of and m.subroom_of in by_id:
                continue
            ordered.append(m)
            ordered.extend(
                by_id[str(r.get("id"))] for r in rooms
                if (r.get("subroom_of") or None) == m.room_id
            )
        for m in ordered:
            m.base_lf = max(0.0, m.perimeter_lf - m.openings_lf - m.cabinet_run_lf)
            m.floor_sy = m.floor_sf / 9
        measured.extend(ordered)
    return measured
