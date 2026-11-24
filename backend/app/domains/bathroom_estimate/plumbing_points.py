"""
Where a tub's or shower's faucet and drain are on a sketch.

The same rules as the sketch's utils/plumbingPoints.ts: each is a point in
the fixture's box, x and y from 0 to 1 across its width and depth from its
back-left corner, kept in properties.faucetPos / drainPos. Unset, they're
where the sketch has always drawn them: a tub's drain under its faucet, a
shower's in the middle. layout_changes prices a drain or a faucet an option
moves.

A drop-in tub's are its tub's, never out on its deck: the faucet on the
tub's rim (the edge of the tub nearest where it's put), the drain inside the
tub. The tub is where its decks side by side (properties.deckSideWidths)
leave it in the platform, else where the sketch draws it.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

Pt01 = Tuple[float, float]

FAUCET_MARGIN = 0.1
DRAIN_MARGIN = 0.08
DRAIN_IN_FROM_FAUCET = 6.0
# A drop-in's faucet on its tub's rim: this far in from the tub's edge, and from its corners (inches)
RIM_IN = 0.75
RIM_CORNER_IN = 3.0
# A drop-in's drain stays this far inside its tub, inches
DRAIN_IN_TUB_IN = 3.0
# The least tub a drop-in's decks leave inside its platform (sketch utils/tubDeck)
MIN_TUB_LENGTH_IN = 24.0
MIN_TUB_DEPTH_IN = 18.0

Rect01 = Tuple[float, float, float, float]  # x0, x1, y0, y1


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _props(f: Dict[str, Any]) -> Dict[str, Any]:
    return f.get("properties") or {}


def _dims(f: Dict[str, Any]) -> Tuple[float, float]:
    d = f.get("dimensions") or {}
    return float(d.get("width") or 0), float(d.get("height") or 0)


def _num(v: Any) -> float:
    try:
        return max(0.0, float(v or 0))
    except (TypeError, ValueError):
        return 0.0


def _fit(a: float, b: float, span: float, least: float) -> Tuple[float, float]:
    """Two decks across a span, cut down (the second first) so the tub keeps its least size"""
    room = max(0.0, span - least)
    first = min(a, room)
    return first, min(b, room - first)


def tub_in_deck01(f: Dict[str, Any]) -> Optional[Rect01]:
    """A drop-in tub's tub inside its platform, 0-1 of its box; None for any other fixture."""
    p = _props(f)
    if f.get("type") != "bathtub" or (p.get("bathtubSubType") or "standard_alcove") != "drop_in":
        return None
    sides = p.get("deckSideWidths")
    if not isinstance(sides, dict):
        return 0.15, 0.85, 0.1, 0.9
    w, d = _dims(f)
    if not w or not d:
        return 0.15, 0.85, 0.1, 0.9
    left, right = _fit(_num(sides.get("left")), _num(sides.get("right")), w, MIN_TUB_LENGTH_IN)
    back, front = _fit(_num(sides.get("back")), _num(sides.get("front")), d, MIN_TUB_DEPTH_IN)
    return left / w, (w - right) / w, back / d, (d - front) / d


def _on_tub_rim(f: Dict[str, Any], tub: Rect01, pt: Pt01) -> Pt01:
    """`pt` put on the tub's rim: the edge of the tub nearest it, a little in, clear of the corners"""
    w, d = _dims(f)
    w, d = w or 1.0, d or 1.0
    bx0, bx1, by0, by1 = tub[0] * w, tub[1] * w, tub[2] * d, tub[3] * d
    x = _clamp(pt[0] * w, bx0, bx1)
    y = _clamp(pt[1] * d, by0, by1)
    off = [("north", y - by0), ("south", by1 - y), ("west", x - bx0), ("east", bx1 - x)]
    edge = off[0]
    for e in off[1:]:
        if e[1] < edge[1]:
            edge = e
    cx = min(RIM_CORNER_IN, (bx1 - bx0) / 2)
    cy = min(RIM_CORNER_IN, (by1 - by0) / 2)
    ax = _clamp(x, bx0 + cx, bx1 - cx)
    ay = _clamp(y, by0 + cy, by1 - cy)
    px, py = {"north": (ax, by0 + RIM_IN), "south": (ax, by1 - RIM_IN),
              "west": (bx0 + RIM_IN, ay)}.get(edge[0], (bx1 - RIM_IN, ay))
    return px / w, py / d


def faucet_edges(f: Dict[str, Any]) -> Optional[List[str]]:
    """The walls a faucet can be on, or None when it can be anywhere (a deck, the floor)."""
    p = _props(f)
    if f.get("type") == "bathtub":
        return ["north", "west", "east"] if (p.get("bathtubSubType") or "standard_alcove") == "standard_alcove" else None
    layout = p.get("showerLayout") or "alcove"
    if layout in ("corner", "neo_angle"):
        return ["north", "west"]
    if layout in ("corner_right", "neo_angle_right"):
        return ["north", "east"]
    return ["north", "west", "east"]


def default_faucet(f: Dict[str, Any]) -> Pt01:
    p = _props(f)
    if f.get("type") == "bathtub":
        sub = p.get("bathtubSubType") or "standard_alcove"
        if sub == "drop_in":
            return snap_faucet(f, (0.5, 0.05))
        return {"corner_garden": (0.72, 0.52), "corner_drop_in": (0.72, 0.52),
                "freestanding": (0.5, 1.0)}.get(sub, (0.5, 0.0))
    layout = p.get("showerLayout") or "alcove"
    return (0.45 if layout == "neo_angle" else 0.55 if layout == "neo_angle_right" else 0.5, 0.0)


def snap_faucet(f: Dict[str, Any], pt: Pt01) -> Pt01:
    tub = tub_in_deck01(f)
    if tub:
        return _on_tub_rim(f, tub, pt)
    edges = faucet_edges(f)
    x, y = pt
    if not edges:
        return _clamp(x, 0, 1), _clamp(y, 0, 1)
    off = {"north": abs(y), "south": abs(1 - y), "west": abs(x), "east": abs(1 - x)}
    edge = edges[0]
    for e in edges[1:]:
        if off[e] < off[edge]:
            edge = e

    def along(v: float) -> float:
        return _clamp(v, FAUCET_MARGIN, 1 - FAUCET_MARGIN)

    return {"north": (along(x), 0.0), "south": (along(x), 1.0), "west": (0.0, along(y))}.get(edge, (1.0, along(y)))


def _pt(v: Any) -> Optional[Pt01]:
    if isinstance(v, dict) and v.get("x") is not None and v.get("y") is not None:
        return float(v["x"]), float(v["y"])
    return None


def faucet_of(f: Dict[str, Any]) -> Pt01:
    set_ = _pt(_props(f).get("faucetPos"))
    return snap_faucet(f, set_) if set_ else default_faucet(f)


def clamp_drain(pt: Pt01, f: Optional[Dict[str, Any]] = None) -> Pt01:
    """`pt` kept where a drain can be: in from the box's edges, or inside a drop-in's tub"""
    tub = tub_in_deck01(f) if f else None
    if tub:
        w, d = _dims(f)
        w, d = w or 1.0, d or 1.0

        def inside(v: float, lo: float, hi: float, size: float) -> float:
            m = min(DRAIN_IN_TUB_IN, (hi - lo) * size / 2) / size
            return _clamp(v, lo + m, hi - m)

        return inside(pt[0], tub[0], tub[1], w), inside(pt[1], tub[2], tub[3], d)
    return _clamp(pt[0], DRAIN_MARGIN, 1 - DRAIN_MARGIN), _clamp(pt[1], DRAIN_MARGIN, 1 - DRAIN_MARGIN)


def default_drain(f: Dict[str, Any]) -> Pt01:
    if f.get("type") == "shower":
        layout = _props(f).get("showerLayout") or "alcove"
        return {"neo_angle": (0.4, 0.4), "neo_angle_right": (0.6, 0.4)}.get(layout, (0.5, 0.5))
    fx, fy = faucet_of(f)
    tub = tub_in_deck01(f)
    mx, my = ((tub[0] + tub[1]) / 2, (tub[2] + tub[3]) / 2) if tub else (0.5, 0.5)
    w, d = _dims(f)
    if not w or not d:
        return mx, my
    dx, dy = (mx - fx) * w, (my - fy) * d
    length = math.hypot(dx, dy)
    if length < 0.5:
        return mx, my
    step = min(DRAIN_IN_FROM_FAUCET, length)
    return clamp_drain((fx + dx / length * step / w, fy + dy / length * step / d), f)


def drain_of(f: Dict[str, Any]) -> Pt01:
    set_ = _pt(_props(f).get("drainPos"))
    return clamp_drain(set_, f) if set_ else default_drain(f)


def in_room(f: Dict[str, Any], pt: Pt01, ppf: float) -> Tuple[float, float]:
    """A point of the fixture's box in the room, inches, turned as the fixture is."""
    w, d = _dims(f)
    pos = f.get("position") or {}
    cx, cy = float(pos.get("x", 0)) / ppf * 12, float(pos.get("y", 0)) / ppf * 12
    lx, ly = (pt[0] - 0.5) * w, (pt[1] - 0.5) * d
    r = math.radians(float(f.get("rotation") or 0))
    return cx + lx * math.cos(r) - ly * math.sin(r), cy + lx * math.sin(r) + ly * math.cos(r)
