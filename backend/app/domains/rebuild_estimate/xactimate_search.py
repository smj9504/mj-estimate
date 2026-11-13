"""
Finding a repair in the Xactimate price list (xactimate_items, the latest
month loaded) to add to a rebuild estimate: each match with the activities
it can be added as, each activity's price and the share of it that is
material (for the material tax).

The line keeps what it was added with (the price, as Xactimate has it),
so the estimate doesn't move when a newer month is loaded. The price is
marked up when the line is priced (assemble.added_price). Each activity
comes with our words for it where there are some (wording.py).

The matches come in the order an estimator looks for them: the code typed
exactly, then the lines we have words for (the ones in use), then the plain
item before its variants (the shorter code: DRY1/2 before DRY1/2FT), then
the shorter description.
"""

from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlalchemy import case, desc, func, or_

from app.domains.unit_prices.xactimate import xact

from .wording import wording_for, worded_codes

ACTIVITY_LABELS = {
    "&": "R&R", "+": "Replace", "-": "Remove", "R": "Detach & Reset", "M": "Material only", "I": "Install only",
}


def _f(value: Any) -> Optional[float]:
    return None if value is None else float(value)


def activities(item: Any) -> List[Dict[str, Any]]:
    """What it can be added as: an R&R item also as replace or remove, then
    whichever of detach & reset, material only and install only Xactimate
    offers. The material (item.material_cost) is the replace's."""
    total = _f(item.untaxed_unit_price) or 0.0
    replace, remove = _f(item.replace_price), _f(item.remove_price)
    material = _f(item.material_cost) or 0.0

    def entry(activity: str, price: float, material_part: float) -> Dict[str, Any]:
        return {
            "activity": activity, "label": ACTIVITY_LABELS[activity], "price": round(price, 2),
            "marked_up": xact(price),
            "material_share": round(min(material_part / price, 1.0), 4) if price > 0 else 0.0,
        }

    own = item.activity if item.activity in ("&", "+", "-") else "+"
    if own == "&" and replace is not None and remove is not None:
        out = [entry("&", total, material), entry("+", replace, material), entry("-", remove, 0.0)]
    elif own == "-":
        out = [entry("-", total, 0.0)]
    else:
        out = [entry(own, total, material)]
    others = item.other_activities or ""
    for activity, price, material_part in (
        ("R", _f(item.detach_reset_price), 0.0),
        ("M", _f(item.material_only_price), None),
        ("I", _f(item.install_only_price), 0.0),
    ):
        if activity in others and price is not None:
            out.append(entry(activity, price, price if material_part is None else material_part))
    return out


def match_of(item: Any, saved: Mapping[Tuple[str, str], str]) -> Dict[str, Any]:
    acts = activities(item)
    for a in acts:
        a["wording"] = wording_for(item.item_code, a["activity"], saved)
    return {
        "code": item.item_code, "category_code": item.category_code, "description": item.description,
        "unit": item.unit or "EA", "price_list": item.price_list, "activities": acts,
        "ours": any(a["wording"] for a in acts),
    }


def latest_month(session: Any) -> Optional[Tuple[int, int]]:
    from app.domains.xactimate.models import XactimateItem

    return (
        session.query(XactimateItem.price_year, XactimateItem.price_month)
        .order_by(desc(XactimateItem.price_year), desc(XactimateItem.price_month))
        .first()
    )


def search(session: Any, q: str, limit: int = 25,
           saved: Optional[Mapping[Tuple[str, str], str]] = None) -> List[Dict[str, Any]]:
    from app.domains.xactimate.models import XactimateItem

    saved = saved or {}

    words = [w for w in (q or "").split() if w]
    if not words:
        return []
    latest = latest_month(session)
    if latest is None:
        return []
    code = func.upper(XactimateItem.item_code)
    query = session.query(XactimateItem).filter(
        XactimateItem.price_year == latest[0], XactimateItem.price_month == latest[1],
    )
    for word in words:
        term = f"%{word}%"
        query = query.filter(or_(XactimateItem.description.ilike(term), XactimateItem.item_code.ilike(term)))
    items = (
        query.order_by(
            case((code == q.strip().upper(), 0), else_=1),
            case((XactimateItem.item_code.in_(sorted(worded_codes(saved))), 0), else_=1),
            func.length(XactimateItem.item_code), func.length(XactimateItem.description), XactimateItem.item_code,
        )
        .limit(limit)
        .all()
    )
    return [match_of(item, saved) for item in items]
