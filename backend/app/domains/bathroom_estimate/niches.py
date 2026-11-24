"""
Niches set in a bathroom wall: a tiled niche (framed in the stud bay, or a
pre-formed foam niche set in it) in a tub or shower wall, or a drywall niche
painted with the wall. Each kind is its own line, priced each (pricing.
WALL_NICHE_PRICES); a niche is built, never detached and reset.

They're kept in accessories_spec.niches as [{type, count, width, height}]
(the opening, inches), filled from the sketch (each niche drawn in a wall) or
typed in on the estimate page. A shower's own niche count
(shower_spec.niches) is priced with the shower, and the sketch sends it as 0
once niches are drawn in its walls.

A bigger niche costs more: Xactimate's TIL NICHE is a 12" x 12" niche (8
bullnose pieces 3/4" x 6", 4 LF, round its edge; 2 SF of tile for its back
and returns; 1.25 hours). The returns, the edge trim and most of the labor
run along the edge, so a niche is priced at its edge length over those 4 LF
(a 12" x 24" one: 6 LF, x 1.5), never under one niche. The back is in the
wall's own tile or paint (a niche isn't taken out of the wall's area).
"""

from typing import Any, Dict, List, Optional, Tuple

NICHE_TYPES: Dict[str, Dict[str, Any]] = {
    "tile": {"label": "Tiled wall niche", "tiled": True},
    "tile_foam": {"label": "Tiled wall niche, foam insert", "tiled": True},
    "drywall": {"label": "Drywall wall niche, painted", "tiled": False},
}


# Xactimate's TIL NICHE: a 12" x 12" niche, 4 LF of edge
REFERENCE_NICHE_IN = (12.0, 12.0)
REFERENCE_EDGE_IN = 2 * (REFERENCE_NICHE_IN[0] + REFERENCE_NICHE_IN[1])


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _inches(v: Any) -> Optional[float]:
    """An opening side in inches, to the quarter inch; None when not given"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f <= 0:
        return None
    return round(f * 4) / 4


def size_factor(width: Optional[float], height: Optional[float]) -> float:
    """
    A niche's price over one of Xactimate's 12" x 12" niches: its edge over 4 LF,
    never under 1. A niche of no size given is priced as one.
    """
    if not width or not height:
        return 1.0
    return round(max(1.0, 2 * (width + height) / REFERENCE_EDGE_IN), 4)


def edge_lf(width: Optional[float], height: Optional[float]) -> Optional[float]:
    if not width or not height:
        return None
    return round(2 * (width + height) / 12, 2)


def size_label(width: Optional[float], height: Optional[float]) -> str:
    """12″ × 24″ (quarter inches as decimals)"""
    if not width or not height:
        return ""
    fmt = lambda v: f"{v:g}"  # noqa: E731
    return f"{fmt(width)}″ × {fmt(height)}″"


def niche_groups(estimate) -> List[Dict[str, Any]]:
    """
    The estimate's niches as [{type, count, width, height}], one per kind and
    size, in the order they first appear (width/height None when not given).
    """
    acc = getattr(estimate, "accessories_spec", None) or {}
    rows = acc.get("niches")
    if not isinstance(rows, list):
        return []
    merged: Dict[Tuple[str, Optional[float], Optional[float]], Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("type") not in NICHE_TYPES:
            continue
        count = _int(row.get("count"), 1)
        if count <= 0:
            continue
        w, h = _inches(row.get("width")), _inches(row.get("height"))
        if w is None or h is None:
            w = h = None
        key = (row["type"], w, h)
        if key in merged:
            merged[key]["count"] += count
        else:
            merged[key] = {"type": row["type"], "count": count, "width": w, "height": h}
    return list(merged.values())
