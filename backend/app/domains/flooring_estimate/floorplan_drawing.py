"""
The sketch, drawn for the PDF with reportlab: a small drawing of one room
(the corner of each room's block, as Xactimate prints it) and the plan of a
whole level.

Everything is vector, in feet scaled to fit, so a 2" thumbnail stays sharp.
Rooms are interior outlines; walls are drawn WALL_T thick around them.
"""

import math
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from reportlab.graphics.shapes import Drawing, Ellipse, Group, Line, Polygon, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth

from . import pricing
from .geometry import format_ft_in, is_window, point, points_of

Point = Tuple[float, float]

WALL_T = 0.375  # 4.5" interior wall
DOOR_KINDS = frozenset({"door", "exterior_door"})

INK = colors.HexColor("#1a2332")
GREY = colors.HexColor("#4a5568")
WALL = colors.HexColor("#2d3748")
FRAME = colors.HexColor("#e2e2e2")
CABINET = colors.HexColor("#d9d4c7")

# Floor colors by material. Warm and neutral tones only.
MATERIAL_FILLS = {
    "lvp": colors.HexColor("#f3e3c7"),
    "laminate": colors.HexColor("#f6ead2"),
    "engineered_hardwood": colors.HexColor("#ead2aa"),
    "solid_hardwood": colors.HexColor("#e3c69a"),
    "ceramic_tile": colors.HexColor("#e1e6dd"),
    "porcelain_tile": colors.HexColor("#e1e6dd"),
    "sheet_vinyl": colors.HexColor("#f2e4e1"),
    "carpet": colors.HexColor("#e4e1db"),
    # The existing hardwood sanded and refinished
    "refinish": colors.HexColor("#dcc08f"),
}
REFINISH_LABEL, REFINISH_SHORT = "Hardwood - sand & refinish", "Refinish"
NO_FILL = colors.white


def fill_for(material: Optional[str]):
    return MATERIAL_FILLS.get(material or "", NO_FILL)


# ── Geometry in feet ──

def _signed_area2(pts: Sequence[Point]) -> float:
    n = len(pts)
    return sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))


def _area(pts: Sequence[Point]) -> float:
    return abs(_signed_area2(pts)) / 2


def _edges(pts: Sequence[Point]):
    """(a, b, length, unit dir, outward normal) for each wall"""
    ccw = _signed_area2(pts) > 0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1e-9
        u = (dx / length, dy / length)
        n = (u[1], -u[0]) if ccw else (-u[1], u[0])
        yield a, b, length, u, n


def offset_polygon(pts: Sequence[Point], d: float) -> List[Point]:
    lines = [((a[0] + n[0] * d, a[1] + n[1] * d), u) for a, _b, _l, u, n in _edges(pts)]
    out = []
    for i in range(len(lines)):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        cross = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(cross) < 1e-9:
            out.append(p2)
            continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out


def centroid(pts: Sequence[Point]) -> Point:
    a2 = _signed_area2(pts)
    if abs(a2) < 1e-9:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cx = cy = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    return cx / (3 * a2), cy / (3 * a2)


def _span_on_room(opening: Mapping[str, Any], pts: Sequence[Point]):
    """Where an opening crosses one of this room's walls: (a, b, outward normal), or None"""
    p, q = point(opening.get("a") or (0, 0)), point(opening.get("b") or (0, 0))
    best = None
    for a, b, length, u, n in _edges(pts):
        if abs(u[0] * (q[1] - p[1]) - u[1] * (q[0] - p[0])) > 1e-3:
            continue
        dist = abs((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1])
        if dist > WALL_T + 0.05:
            continue
        s1 = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]
        s2 = (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1]
        lo, hi = max(0.0, min(s1, s2)), min(length, max(s1, s2))
        if hi - lo < 0.05:
            continue
        if best is None or dist < best[0]:
            best = (dist, (a[0] + u[0] * s1, a[1] + u[1] * s1), (a[0] + u[0] * s2, a[1] + u[1] * s2), n)
    return None if best is None else best[1:]


class _Mapper:
    def __init__(self, minx: float, maxy: float, scale: float, ox: float, oy: float):
        self.minx, self.maxy, self.s, self.ox, self.oy = minx, maxy, scale, ox, oy

    def __call__(self, p: Point) -> Point:
        return self.ox + (p[0] - self.minx) * self.s, self.oy + (self.maxy - p[1]) * self.s

    def flat(self, pts: Iterable[Point]) -> List[float]:
        out: List[float] = []
        for p in pts:
            out.extend(self(p))
        return out


def _angle(m: _Mapper, a: Point, b: Point) -> float:
    (x1, y1), (x2, y2) = m(a), m(b)
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    return ang


def _text(g: Group, text: str, x: float, y: float, angle: float, size: float, color, bold: bool = False):
    s = String(0, -size * 0.35, text, fontName="Helvetica-Bold" if bold else "Helvetica",
               fontSize=size, fillColor=color, textAnchor="middle")
    grp = Group(s)
    grp.translate(x, y)
    grp.rotate(angle)
    g.add(grp)


class _Labels:
    """Each label goes at the first of its spots that is clear of the labels
    already placed and inside the drawing; one with no clear spot is left out."""

    def __init__(self, w: float, h: float):
        self.w, self.h, self.boxes = w, h, []

    @staticmethod
    def box(text: str, x: float, y: float, angle: float, size: float, bold: bool):
        tw = stringWidth(text, "Helvetica-Bold" if bold else "Helvetica", size) + 2
        th = size + 1
        if abs(angle) > 45:
            tw, th = th, tw
        return x - tw / 2, y - th / 2, x + tw / 2, y + th / 2

    def clear(self, b) -> bool:
        if b[0] < 1 or b[1] < 1 or b[2] > self.w - 1 or b[3] > self.h - 1:
            return False
        return all(b[2] <= o[0] or b[0] >= o[2] or b[3] <= o[1] or b[1] >= o[3] for o in self.boxes)

    def place(self, g: Group, text: str, spots, size: float, color, bold: bool = False) -> bool:
        for x, y, angle in spots:
            b = self.box(text, x, y, angle, size, bold)
            if self.clear(b):
                self.boxes.append(b)
                _text(g, text, x, y, angle, size, color, bold)
                return True
        return False


def _openings(d: Group, m: _Mapper, room: Mapping[str, Any], pts: Sequence[Point], openings, gap_fill):
    """The gaps a room's doorways and windows make in its walls, and the doors that swing into it"""
    room_id = str(room.get("id"))
    for op in openings:
        if room_id not in [str(r) for r in (op.get("rooms") or []) if r]:
            continue
        hit = _span_on_room(op, pts)
        if hit is None:
            continue
        p1, p2, n = hit
        out = lambda p, k=WALL_T: (p[0] + n[0] * k, p[1] + n[1] * k)  # noqa: E731
        if is_window(op):
            # The glass in the wall: its frame across it and the panes along it
            d.add(Polygon(m.flat([p1, p2, out(p2), out(p1)]), fillColor=colors.white, strokeColor=None))
            for p in (p1, p2):
                d.add(Line(*m(p), *m(out(p)), strokeColor=WALL, strokeWidth=0.6))
            for k in (0, WALL_T * 0.5, WALL_T):
                d.add(Line(*m(out(p1, k)), *m(out(p2, k)), strokeColor=WALL, strokeWidth=0.4))
            continue
        d.add(Polygon(m.flat([p1, p2, out(p2), out(p1)]), fillColor=gap_fill, strokeColor=None))
        if op.get("kind") == "open_wall":
            # No wall there: a dashed line where it would stand
            d.add(Line(*m(out(p1, WALL_T / 2)), *m(out(p2, WALL_T / 2)), strokeColor=GREY, strokeWidth=0.5,
                       strokeDashArray=[2, 1.5]))
            continue
        for p in (p1, p2):
            d.add(Line(*m(p), *m(out(p)), strokeColor=WALL, strokeWidth=0.6))
        if str(op.get("swing") or "") != room_id:
            continue
        inward = (-n[0], -n[1])
        w = math.dist(p1, p2) or 1e-9
        kind = op.get("kind")
        if kind in DOOR_KINDS:
            hinge, other = (p2, p1) if op.get("hinge") == "b" else (p1, p2)
            toward = ((other[0] - hinge[0]) / w, (other[1] - hinge[1]) / w)
            leaf = (hinge[0] + inward[0] * w, hinge[1] + inward[1] * w)
            d.add(Line(*m(hinge), *m(leaf), strokeColor=WALL, strokeWidth=0.8))
            arc = []
            for k in range(13):
                th = (math.pi / 2) * k / 12
                arc.append((hinge[0] + w * (math.cos(th) * inward[0] + math.sin(th) * toward[0]),
                            hinge[1] + w * (math.cos(th) * inward[1] + math.sin(th) * toward[1])))
            d.add(PolyLine(m.flat(arc), strokeColor=GREY, strokeWidth=0.4, strokeDashArray=[1.5, 1.2]))
        elif kind == "bifold":
            zig = []
            for k in range(5):
                s = k / 4
                depth = 0.35 if k % 2 else 0
                zig.append((p1[0] + (p2[0] - p1[0]) * s + inward[0] * depth,
                            p1[1] + (p2[1] - p1[1]) * s + inward[1] * depth))
            d.add(PolyLine(m.flat(zig), strokeColor=WALL, strokeWidth=0.6))
        elif kind in ("slider", "pocket"):
            d.add(Line(*m(out(p1, WALL_T / 2)), *m(out(p2, WALL_T / 2)), strokeColor=WALL, strokeWidth=0.8,
                       strokeDashArray=[2, 1.5] if kind == "pocket" else None))


def _room_points(room: Mapping[str, Any]) -> List[Point]:
    return points_of(room.get("points"))


def _walls(d: Group, m: _Mapper, walls, room_ids=None):
    """Walls built out into a room, as thick as they are"""
    for wall in walls or []:
        if room_ids is not None and str(wall.get("room_id")) not in room_ids:
            continue
        a, b = point(wall.get("a") or (0, 0)), point(wall.get("b") or (0, 0))
        length = math.dist(a, b)
        if length < 1e-6:
            continue
        half = float(wall.get("thickness") or WALL_T) / 2
        nx, ny = -(b[1] - a[1]) / length * half, (b[0] - a[0]) / length * half
        corners = [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)]
        d.add(Polygon(m.flat(corners), fillColor=WALL, strokeColor=None))


def room_thumbnail(
    level: Mapping[str, Any], room: Mapping[str, Any], width: float, height: float,
    material: Optional[str] = None, max_scale: float = 12.0,
) -> Drawing:
    """One room, cropped to it: its walls with their lengths outside them,
    its doorways and the doors that swing into it, and its name."""
    pts = _room_points(room)
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=colors.white, strokeColor=FRAME, strokeWidth=0.75))
    if len(pts) < 3:
        return d
    outer = offset_polygon(pts, WALL_T)
    xs, ys = [p[0] for p in outer], [p[1] for p in outer]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pad = 15
    scale = min((width - 2 * pad) / max(maxx - minx, 0.1), (height - 2 * pad) / max(maxy - miny, 0.1), max_scale)
    m = _Mapper(minx, maxy, scale, (width - (maxx - minx) * scale) / 2, (height - (maxy - miny) * scale) / 2)

    d.add(Polygon(m.flat(outer), fillColor=WALL, strokeColor=None))
    d.add(Polygon(m.flat(pts), fillColor=fill_for(material), strokeColor=None))
    _openings(d, m, room, pts, level.get("openings") or [], colors.white)
    _walls(d, m, level.get("walls"), {str(room.get("id"))})

    labels = _Labels(width, height)
    cx, cy = m(centroid(pts))
    labels.place(d, str(room.get("name") or ""), [(cx, cy, 0)], 6.4, INK, bold=True)
    # Longest walls first, so a short wall's label is the one that moves
    for a, b, length, _u, n in sorted(_edges(pts), key=lambda e: -e[2]):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        ox, oy = m((mid[0] + n[0] * WALL_T, mid[1] + n[1] * WALL_T))
        ix, iy = m(mid)
        angle = _angle(m, a, b)
        labels.place(d, format_ft_in(length), [
            (ox + n[0] * 6.5, oy - n[1] * 6.5, angle),
            (ix - n[0] * 6.0, iy + n[1] * 6.0, angle),
            (ox + n[0] * 14, oy - n[1] * 14, angle),
        ], 6.2, INK)
    return d


def level_plan(
    level: Mapping[str, Any], width: float, height: float,
    materials: Mapping[str, Optional[str]], in_scope: Iterable[str],
) -> Drawing:
    """A whole level: every room drawn, filled by its new floor; a room left
    out of the estimate is drawn white and marked so. A legend of the floors
    and a scale bar run along the bottom."""
    rooms = [r for r in (level.get("rooms") or []) if len(r.get("points") or []) >= 3]
    scope = {str(r) for r in in_scope}
    d = Drawing(width, height)
    if not rooms:
        return d
    legend_h = 30
    outer_all = [p for r in rooms for p in offset_polygon(_room_points(r), WALL_T)]
    xs, ys = [p[0] for p in outer_all], [p[1] for p in outer_all]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pad = 10
    scale = min((width - 2 * pad) / max(maxx - minx, 0.1), (height - 2 * pad - legend_h) / max(maxy - miny, 0.1))
    m = _Mapper(minx, maxy, scale, (width - (maxx - minx) * scale) / 2,
                legend_h + (height - legend_h - (maxy - miny) * scale) / 2)

    for r in rooms:  # walls first, floors over them: a shared wall shows once
        d.add(Polygon(m.flat(offset_polygon(_room_points(r), WALL_T)), fillColor=WALL, strokeColor=None))
    for r in rooms:
        rid = str(r.get("id"))
        fill = fill_for(materials.get(rid)) if rid in scope else NO_FILL
        d.add(Polygon(m.flat(_room_points(r)), fillColor=fill, strokeColor=None))
    openings = level.get("openings") or []
    for r in rooms:
        _openings(d, m, r, _room_points(r), openings, colors.white)
    _walls(d, m, level.get("walls"))

    by_id = {str(r.get("id")): _room_points(r) for r in rooms}
    for run in level.get("cabinet_runs") or []:
        pts = by_id.get(str(run.get("room_id")))
        if not pts:
            continue
        a, b = point(run.get("a") or (0, 0)), point(run.get("b") or (0, 0))
        hit = _span_on_room({"a": run.get("a"), "b": run.get("b")}, pts)
        n = hit[2] if hit else (0.0, 0.0)
        inn = lambda p: (p[0] - n[0] * 2, p[1] - n[1] * 2)  # noqa: E731
        d.add(Polygon(m.flat([a, b, inn(b), inn(a)]), fillColor=CABINET, strokeColor=GREY, strokeWidth=0.4))
    for f in level.get("fixtures") or []:
        _fixture(d, m, f)

    labels = _Labels(width, height)
    for r in rooms:
        rid = str(r.get("id"))
        pts = _room_points(r)
        cx, cy = m(centroid(pts))
        rx = [p[0] for p in pts]
        ry = [p[1] for p in pts]
        small = min(max(rx) - min(rx), max(ry) - min(ry)) * scale < 50
        name = str(r.get("name") or "")
        if rid not in scope:
            lines = [(name, 8, True, GREY)] + ([] if small else [("Not in scope", 6.5, False, GREY)])
        elif small:
            lines = [(f"{name} · {_area(pts):,.2f} SF", 7, True, INK)]
        else:
            short = _material_short(materials.get(rid) or "")
            lines = [(name, 9, True, INK), (f"{_area(pts):,.2f} SF", 7.5, False, INK)] + (
                [(short, 7, False, GREY)] if short else [])
        block = sum(size + 2.5 for _, size, _, _ in lines)
        y = cy + block / 2
        for text, size, bold, color in lines:
            y -= (size + 2.5) / 2
            labels.boxes.append(_Labels.box(text, cx, y, 0, size, bold))
            _text(d, text, cx, y, 0, size, color, bold)
            y -= (size + 2.5) / 2
    for r in rooms:
        pts = _room_points(r)
        color = GREY if str(r.get("id")) not in scope else INK
        for a, b, length, _u, n in sorted(_edges(pts), key=lambda e: -e[2]):
            x, y = m(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
            angle = _angle(m, a, b)
            labels.place(d, format_ft_in(length), [
                (x - n[0] * 6.5, y + n[1] * 6.5, angle), (x - n[0] * 13, y + n[1] * 13, angle),
            ], 6.6, color)

    bar = 10 if (maxx - minx) > 25 else 5
    bx = width - 4 - bar * scale
    # Legend: the floors on this level, then "not in scope" if any room is;
    # onto a second line before it reaches the scale bar
    shown = []
    for rid in [str(r.get("id")) for r in rooms]:
        mat = materials.get(rid)
        if rid in scope and mat and mat not in shown:
            shown.append(mat)
    entries = [(fill_for(mat), _material_label(mat)) for mat in shown]
    if any(str(r.get("id")) not in scope for r in rooms):
        entries.append((NO_FILL, "Not in scope"))
    lines: List[List[Tuple[Any, str, float]]] = [[]]
    lx = 4.0
    for fill, label in entries:
        w = 24 + stringWidth(label, "Helvetica", 7.5)
        if lines[-1] and lx + w - 8 > bx - 8:
            lines.append([])
            lx = 4.0
        lines[-1].append((fill, label, lx))
        lx += w
    for line, y in zip(lines, [6.0] if len(lines) == 1 else [17.0, 5.0]):
        for fill, label, x in line:
            d.add(Rect(x, y, 12, 9, fillColor=fill, strokeColor=WALL, strokeWidth=0.4))
            d.add(String(x + 16, y + 2, label, fontName="Helvetica", fontSize=7.5, fillColor=INK))
    for k in range(2):
        d.add(Rect(bx + k * bar / 2 * scale, 8, bar / 2 * scale, 4, fillColor=WALL if k == 0 else colors.white,
                   strokeColor=WALL, strokeWidth=0.5))
    for k, text in enumerate(["0", f"{bar // 2}'", f"{bar}'"]):
        d.add(String(bx + k * bar / 2 * scale, 15, text, fontName="Helvetica", fontSize=6.5, fillColor=GREY,
                     textAnchor="middle"))
    return d


FIXTURE_MARKS = {
    "toilet": "", "vanity": "Van", "island": "Island", "refrigerator": "Ref", "range": "Range",
    "dishwasher": "DW", "washer": "W", "dryer": "D", "other": "",
    "pedestal_sink": "", "utility_sink": "Sink", "floor_register": "",
}


def _fixture(d: Drawing, m: _Mapper, f: Mapping[str, Any]):
    """A fixture's footprint, turned as drawn, marked the way plans mark it"""
    w, h = float(f.get("w") or 0), float(f.get("h") or 0)
    if w <= 0 or h <= 0:
        return
    px, py = m((float(f.get("x") or 0), float(f.get("y") or 0)))
    sw, sh = w * m.s, h * m.s
    g = Group()
    g.translate(px, py)
    # Turned clockwise on the screen, which is counter to the page's y-up
    g.rotate(-float(f.get("rotation") or 0))
    if f.get("type") == "toilet":
        # Tank against the wall, bowl in front
        g.add(Rect(-sw / 2, sh / 2 - sh * 0.3, sw, sh * 0.3, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
        g.add(Ellipse(0, -sh * 0.15, sw * 0.42, sh * 0.35, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
    elif f.get("type") == "pedestal_sink":
        # Basin, back to the wall, and the pedestal under it
        g.add(Ellipse(0, 0, sw / 2, sh / 2, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
        g.add(Ellipse(0, sh * 0.08, sw * 0.3, sh * 0.26, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.4))
    elif f.get("type") == "floor_register":
        # A grille: the frame and its slats
        g.add(Rect(-sw / 2, -sh / 2, sw, sh, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
        for k in range(1, 6):
            x = -sw / 2 + sw * k / 6
            g.add(Line(x, -sh * 0.32, x, sh * 0.32, strokeColor=WALL, strokeWidth=0.3))
    elif f.get("type") == "utility_sink":
        g.add(Rect(-sw / 2, -sh / 2, sw, sh, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
        g.add(Rect(-sw * 0.38, -sh * 0.38, sw * 0.76, sh * 0.62, fillColor=colors.white, strokeColor=WALL,
                   strokeWidth=0.4))
    else:
        g.add(Rect(-sw / 2, -sh / 2, sw, sh, fillColor=colors.white, strokeColor=WALL, strokeWidth=0.5))
        mark = FIXTURE_MARKS.get(str(f.get("type") or ""), "")
        if mark and stringWidth(mark, "Helvetica", 6) <= sw - 2 and sh >= 8:
            g.add(String(0, -2, mark, fontName="Helvetica", fontSize=6, fillColor=GREY, textAnchor="middle"))
    d.add(g)


def _material_label(key: str) -> str:
    if key == "refinish":
        return REFINISH_LABEL
    return pricing.MATERIALS.get(key, {}).get("label", key)


def _material_short(key: str) -> str:
    if key == "refinish":
        return REFINISH_SHORT
    return pricing.MATERIALS.get(key, {}).get("short", "")
