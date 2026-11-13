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
        # An open wall is a side with no wall at all (a kitchen open to the
        # family room): it is measured like a doorway as wide as that side.
        "openings": [{"id", "kind", "rooms": [room_id, room_id | null], "a": {...}, "b": {...},
                      "swing": room_id, "hinge": "a" | "b"}],
        # Where base cabinets stand along a wall: no baseboard there. The
        # cabinets' fronts and the sides that show take shoe molding; side_a
        # / side_b say whether a side shows at that end (null: worked out)
        "cabinet_runs": [{"id", "room_id", "a": {...}, "b": {...}, "side_a", "side_b"}],
        # Things on the floor, by their center: toilets, vanities, pedestal sinks,
        # utility sinks, islands, appliances, floor registers
        # (a range or dryer may be on gas: "gas": true)
        "fixtures": [{"id", "type", "x", "y", "w", "h", "rotation", "floor_under", "gas"}],
        # A wall built out from one of the room's walls (a wall end, a
        # partition): from a, on the room's wall, to b. Its faces take
        # baseboard, and so does its end when it stops short in the room;
        # it stands on what it covers of the floor.
        "walls": [{"id", "room_id", "a": {...}, "b": {...}, "thickness"}],
      }],
    }
"""

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

Point = Tuple[float, float]

# Opening kinds with a door leaf in them (doors to undercut, detach and reset)
DOOR_KINDS = frozenset({"door", "bifold", "pocket", "slider", "exterior_door"})
OPENING_KINDS = frozenset({"opening", "open_wall"}) | DOOR_KINDS

APPLIANCE_TYPES = frozenset({"refrigerator", "range", "dishwasher", "washer", "dryer"})
# What stands beside the end of a cabinet run and hides its side (a
# dishwasher sits in the run, so it doesn't)
SIDE_HIDERS = frozenset({"refrigerator", "range", "washer", "dryer", "other"})

CABINET_DEPTH_FT = 2.0
# A base cabinet with its top, 34 1/2": how high an island's panels are
CABINET_HEIGHT_FT = 2.875
# An appliance this close to a run's end hides the cabinet's side
SIDE_TOUCH_FT = 0.75
# Appliances whose detach & reset differs on gas
GAS_APPLIANCES = frozenset({"range", "dryer"})
FIXTURE_TYPES = frozenset({
    "toilet", "vanity", "pedestal_sink", "utility_sink", "island", "floor_register", "other",
}) | APPLIANCE_TYPES


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
    cabinet_run_lf: float = 0.0    # along the walls the cabinets stand against
    cabinet_front_lf: float = 0.0  # their fronts, less where another run meets them at a corner
    cabinet_side_lf: float = 0.0   # their sides that show, at a run's free end
    base_lf: float = 0.0           # perimeter less openings and cabinet runs: where base trim goes
    toe_kick_lf: float = 0.0       # cabinet fronts plus all round islands
    island_count: int = 0
    island_floored_count: int = 0  # islands the new floor runs under: they come out and go back
    island_lf: float = 0.0         # islands' lengths
    island_perimeter_lf: float = 0.0
    island_panel_sf: float = 0.0   # an island's back and both ends, cabinet high
    # Shoe molding: the baseboard, the cabinets' fronts and showing sides, and
    # all round islands (the wall behind the cabinets only when they come out)
    shoe_lf: float = 0.0
    wall_sf: float = 0.0
    # Counts
    door_count: int = 0            # doors hung in this room (the side they swing into)
    exterior_door_count: int = 0
    toilet_count: int = 0
    vanity_count: int = 0
    pedestal_sink_count: int = 0
    utility_sink_count: int = 0    # a laundry tub / mop sink standing on the floor
    appliance_count: int = 0       # every appliance; by kind below
    refrigerator_count: int = 0
    range_count: int = 0           # electric
    range_gas_count: int = 0
    dishwasher_count: int = 0
    washer_count: int = 0
    dryer_count: int = 0           # electric
    dryer_gas_count: int = 0
    register_count: int = 0        # HVAC floor registers
    openings: List[OpeningRef] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["points"] = [{"x": x, "y": y} for x, y in self.points]
        for key, value in data.items():
            if isinstance(value, float):
                data[key] = round(value, 2)
        return data


# How close to a room's wall a built-out wall's end has to be to count as joined to it
WALL_JOIN_FT = 0.05


def _on_outline(p: Point, points: Sequence[Point]) -> bool:
    n = len(points)
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        len2 = dx * dx + dy * dy
        t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
        if distance(p, (a[0] + dx * t, a[1] + dy * t)) <= WALL_JOIN_FT:
            return True
    return False


def _segment_distance(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    return distance(p, (a[0] + dx * t, a[1] + dy * t))


def wall_faces(a: Point, b: Point, thickness: float, points: Sequence[Point]) -> Tuple[float, float, float]:
    """A built-out wall's exposed length (both faces, and each end that
    stops in the room), the floor it stands on, and the length of the
    room's own wall its joined ends cover"""
    length = distance(a, b)
    joined = sum(1 for p in (a, b) if _on_outline(p, points))
    return 2 * length + (2 - joined) * thickness, length * thickness, joined * thickness


def _outward_normal(points: Sequence[Point], a: Point, b: Point) -> Point:
    """The outward normal of the room wall a..b lies on (the nearest one)"""
    ccw = sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1]
              for i in range(len(points))) > 0
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    best, best_d = (0.0, 0.0), None
    for i in range(len(points)):
        p, q = points[i], points[(i + 1) % len(points)]
        dx, dy = q[0] - p[0], q[1] - p[1]
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        t = max(0.0, min(1.0, ((mid[0] - p[0]) * dx + (mid[1] - p[1]) * dy) / length ** 2))
        d = distance(mid, (p[0] + dx * t, p[1] + dy * t))
        if best_d is None or d < best_d:
            u = (dx / length, dy / length)
            best, best_d = ((u[1], -u[0]) if ccw else (-u[1], u[0])), d
    return best


def _near_fixture(p: Point, fixture: Mapping[str, Any], reach: float) -> bool:
    """Whether p is within reach of a fixture's footprint, turned as drawn"""
    cx, cy = float(fixture.get("x") or 0), float(fixture.get("y") or 0)
    th = math.radians(float(fixture.get("rotation") or 0))
    dx, dy = p[0] - cx, p[1] - cy
    lx, ly = dx * math.cos(th) + dy * math.sin(th), -dx * math.sin(th) + dy * math.cos(th)
    w, h = float(fixture.get("w") or 0), float(fixture.get("h") or 0)
    return math.hypot(max(abs(lx) - w / 2, 0.0), max(abs(ly) - h / 2, 0.0)) <= reach


def cabinet_layout(
    runs: Sequence[Mapping[str, Any]], points: Sequence[Point], fixtures: Sequence[Mapping[str, Any]],
    walls: Sequence[Mapping[str, Any]] = (),
) -> List[Dict[str, Any]]:
    """Per cabinet run of one room: its front (less where another run meets
    it at a corner) and whether its side shows at each end. A side is hidden
    by the wall at a corner, by a wall built out beside it, by another run,
    or by an appliance standing beside it; one set on the run (side_a /
    side_b) is taken as set."""
    frames = []
    for run in runs:
        a, b = point(run.get("a") or (0, 0)), point(run.get("b") or (0, 0))
        length = distance(a, b)
        if length < 1e-6:
            continue
        u = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        frames.append((run, a, b, u, _outward_normal(points, a, b), length))

    def in_run(p: Point, frame, pad: float = 0.01) -> bool:
        _run, a, _b, u, n, length = frame
        s = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]
        t = -((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1])
        return -pad <= s <= length + pad and -pad <= t <= CABINET_DEPTH_FT + pad

    hiders = [f for f in fixtures if str(f.get("type") or "") in SIDE_HIDERS]
    # Each built-out wall: its line and how far from it still touches it
    stubs = [(point(w.get("a") or (0, 0)), point(w.get("b") or (0, 0)),
              float(w.get("thickness") or 0.375) / 2 + 0.2) for w in walls]
    out: List[Dict[str, Any]] = []
    for frame in frames:
        run, a, b, u, n, length = frame
        others = [f for f in frames if f is not frame]
        # The front, a little at a time: what lies in another run is a corner
        steps = max(1, int(math.ceil(length / 0.05)))
        step = length / steps
        front = 0.0
        for k in range(steps):
            s = (k + 0.5) * step
            q = (a[0] + u[0] * s - n[0] * CABINET_DEPTH_FT * 0.999, a[1] + u[1] * s - n[1] * CABINET_DEPTH_FT * 0.999)
            if not any(in_run(q, o) for o in others):
                front += step
        sides = {}
        for key, end, away in (("a", a, (-u[0], -u[1])), ("b", b, u)):
            set_on_run = run.get(f"side_{key}")
            if set_on_run is not None:
                sides[key] = bool(set_on_run)
                continue
            # Just past the end, halfway back to the wall
            p = (end[0] + away[0] * 0.15 - n[0] * CABINET_DEPTH_FT / 2,
                 end[1] + away[1] * 0.15 - n[1] * CABINET_DEPTH_FT / 2)
            hidden = (
                not point_in_polygon(p, points)
                or any(in_run(p, o, 0.05) for o in others)
                or any(_near_fixture(p, f, SIDE_TOUCH_FT) for f in hiders)
                or any(_segment_distance(p, wa, wb) <= reach for wa, wb, reach in stubs)
            )
            sides[key] = not hidden
        out.append({"id": str(run.get("id") or ""), "front_lf": front, "side_a": sides["a"], "side_b": sides["b"]})
    return out


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
                m.cabinet_run_lf += distance(point(run.get("a") or (0, 0)), point(run.get("b") or (0, 0)))

        for wall in level.get("walls") or []:
            m = by_id.get(str(wall.get("room_id")))
            if m is None:
                continue
            exposed, footprint, covered = wall_faces(
                point(wall.get("a") or (0, 0)), point(wall.get("b") or (0, 0)),
                float(wall.get("thickness") or 0.375), m.points,
            )
            # Where it joins the room's wall, that much of the room's wall is gone
            m.perimeter_lf += exposed - covered
            m.wall_sf += (exposed - covered) * m.height_ft
            m.floor_sf = max(0.0, m.floor_sf - footprint)

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
            elif kind == "pedestal_sink":
                owner.pedestal_sink_count += 1
            elif kind == "utility_sink":
                owner.utility_sink_count += 1
            elif kind == "floor_register":
                owner.register_count += 1
            elif kind in APPLIANCE_TYPES:
                owner.appliance_count += 1
                gas = kind in GAS_APPLIANCES and bool(fixture.get("gas"))
                field_name = f"{kind}_gas_count" if gas else f"{kind}_count"
                setattr(owner, field_name, getattr(owner, field_name) + 1)
            elif kind == "island":
                w, h = float(fixture.get("w") or 0), float(fixture.get("h") or 0)
                owner.island_count += 1
                owner.island_lf += max(w, h)
                owner.island_perimeter_lf += 2 * (w + h)
                owner.island_panel_sf += (max(w, h) + 2 * min(w, h)) * CABINET_HEIGHT_FT
                if fixture.get("floor_under"):
                    owner.island_floored_count += 1
                else:
                    owner.floor_sf = max(0.0, owner.floor_sf - w * h)

        fixtures_of = {room_id: [] for room_id in by_id}
        for fixture in level.get("fixtures") or []:
            center = (float(fixture.get("x") or 0), float(fixture.get("y") or 0))
            owner = next((m for m in by_id.values() if point_in_polygon(center, m.points)), None)
            if owner is not None:
                fixtures_of[owner.room_id].append(fixture)
        runs_of = {room_id: [] for room_id in by_id}
        for run in level.get("cabinet_runs") or []:
            if str(run.get("room_id")) in runs_of:
                runs_of[str(run.get("room_id"))].append(run)
        walls_of = {room_id: [] for room_id in by_id}
        for wall in level.get("walls") or []:
            if str(wall.get("room_id")) in walls_of:
                walls_of[str(wall.get("room_id"))].append(wall)
        for room_id, m in by_id.items():
            for run in cabinet_layout(runs_of[room_id], m.points, fixtures_of[room_id], walls_of[room_id]):
                m.cabinet_front_lf += run["front_lf"]
                m.cabinet_side_lf += CABINET_DEPTH_FT * (run["side_a"] + run["side_b"])
            m.toe_kick_lf = m.cabinet_front_lf + m.island_perimeter_lf

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
            m.shoe_lf = m.base_lf + m.cabinet_front_lf + m.cabinet_side_lf + m.island_perimeter_lf
            m.floor_sy = m.floor_sf / 9
        measured.extend(ordered)
    return measured
