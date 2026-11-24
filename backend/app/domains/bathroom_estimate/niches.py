"""
Niches set in a bathroom wall: a tiled niche (framed in the stud bay, or a
pre-formed foam niche set in it) in a tub or shower wall, or a drywall niche
painted with the wall. Each kind is its own line, priced each (pricing.
WALL_NICHE_PRICES); a niche is built, never detached and reset.

They're kept in accessories_spec.niches as [{type, count}], filled from the
sketch (each niche drawn in a wall) or typed in on the estimate page. A
shower's own niche count (shower_spec.niches) is priced with the shower, and
the sketch sends it as 0 once niches are drawn in its walls.
"""

from typing import Any, Dict, List

NICHE_TYPES: Dict[str, Dict[str, Any]] = {
    "tile": {"label": "Tiled wall niche", "tiled": True},
    "tile_foam": {"label": "Tiled wall niche, foam insert", "tiled": True},
    "drywall": {"label": "Drywall wall niche, painted", "tiled": False},
}


def _int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def niche_groups(estimate) -> List[Dict[str, Any]]:
    """The estimate's niches as [{type, count}], one per kind, in the order they first appear."""
    acc = getattr(estimate, "accessories_spec", None) or {}
    rows = acc.get("niches")
    if not isinstance(rows, list):
        return []
    merged: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("type") not in NICHE_TYPES:
            continue
        count = _int(row.get("count"), 1)
        if count <= 0:
            continue
        if row["type"] in merged:
            merged[row["type"]]["count"] += count
        else:
            merged[row["type"]] = {"type": row["type"], "count": count}
    return list(merged.values())
