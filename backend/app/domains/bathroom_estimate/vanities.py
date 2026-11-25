"""
A cabinet vanity's size: its width (the top, end to end), however long, and
under a long top an open knee space if it has one (a makeup area: no cabinet
below it, the floor and the baseboard run on under it). One sink or two
whatever the width.

The cabinet is the width less the knee space, priced by its width from the
price table (VANITY_PRICES): a size in the table at its price, a size between
two by the inch between them, past the largest at the rate between the two
largest (a 96" vanity), under the smallest pro rata. The top runs the whole
width.
"""

from typing import Any, Dict, Mapping, Optional

# The least cabinet a knee space leaves: one base cabinet for the sink
MIN_CABINET_IN = 12.0


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f > 0 else None


def width_in(item: Mapping[str, Any], default: float = 36.0) -> float:
    """The vanity's width, inches (the top's), the default when not given"""
    return _num(item.get("width")) or default


def knee_space_in(item: Mapping[str, Any], default_width: float = 36.0) -> float:
    """The open knee space under the top, inches: none but on a cabinet vanity, and never all of it"""
    if (item.get("sink_type") or "cabinet") != "cabinet":
        return 0.0
    knee = _num(item.get("knee_space_in")) or 0.0
    return max(0.0, min(knee, width_in(item, default_width) - MIN_CABINET_IN))


def cabinet_width_in(item: Mapping[str, Any], default_width: float = 36.0) -> float:
    """The cabinet under the top: its width less the knee space"""
    return width_in(item, default_width) - knee_space_in(item, default_width)


def cabinet_price(prices: Mapping[Any, Any], width: float) -> float:
    """A cabinet's price at any width from a table of prices by width (see the module note)"""
    table: Dict[float, float] = {}
    for k, v in prices.items():
        kw, kv = _num(k), _num(v)
        if kw and kv:
            table[kw] = kv
    if not table:
        return 0.0
    sizes = sorted(table)
    if width in table:
        return round(table[width], 2)
    if width < sizes[0]:
        return round(table[sizes[0]] * width / sizes[0], 2)
    if width > sizes[-1]:
        if len(sizes) < 2:
            return round(table[sizes[-1]] * width / sizes[-1], 2)
        a, b = sizes[-2], sizes[-1]
        per_in = (table[b] - table[a]) / (b - a)
        return round(table[b] + (width - b) * per_in, 2)
    for a, b in zip(sizes, sizes[1:]):
        if a < width < b:
            return round(table[a] + (width - a) * (table[b] - table[a]) / (b - a), 2)
    return round(table[sizes[-1]], 2)


def inches(v: float) -> str:
    """96, 30.5: an inch count as a line writes it"""
    return f"{v:g}"
