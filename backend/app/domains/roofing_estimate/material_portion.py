"""Per-category material portions derived from real supplier costs.

calculator.py prices at *installed* rates, then splits each line into a
material and a labor half so markup and sales tax can be applied to the
right part of it. That split used fixed ratios from pricing.py — a
shingle line was always 45% material, whatever the shingles actually
cost. Raising a price-book cost therefore moved the profit report and
nothing else.

This module closes that gap. For each category it takes what the
supplier actually charges (material_cost.py, priced off the same roof
measurements) and divides it by what that category is billed at
(installed rate x quantity). The quotient is the category's real
material share, and it replaces the table ratio.

What deliberately does NOT change: the installed rates, and so the
subtotal. A price-book edit moves markup and tax, not the base price of
the work. Restructuring the estimate around cost-plus pricing would be a
different decision than the one this implements.
"""

import logging
from typing import Any, Dict, List, Optional

from .pricing import get_material_portion

logger = logging.getLogger(__name__)

# A derived portion outside this band means the cost data and the
# installed rate disagree badly enough that trusting it would distort the
# estimate — a category priced below its own material cost, or one whose
# costs were never entered. Clamp, warn, and carry on.
MIN_DERIVED_PORTION = 0.05
MAX_DERIVED_PORTION = 0.95

# Material rows are grouped under the category whose line items they are
# consumed by. Accessories (nails, caulk, cap nails) have no line of
# their own — they are consumed installing the shingles and ride along in
# that category's installed rate.
CATEGORY_ALIASES = {
    "accessories": "shingle",
}

# Categories with no purchased material at all. Tear-off is labor and
# dumpster fees; misc is permits, RRP and HOA review. Deriving a portion
# for these from an empty cost list would say 0% material, which is
# already what the table says — so leave them to it rather than emitting
# a derived value that implies it was measured.
NO_MATERIAL_CATEGORIES = {"tearoff", "misc"}


def _category_of(row: Dict[str, Any]) -> str:
    cat = row.get("category") or "misc"
    return CATEGORY_ALIASES.get(cat, cat)


def derive_material_portions(
    line_items: List[Dict[str, Any]],
    material_rows: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """Map category -> derived material portion and the evidence for it.

    `line_items` are the calculator's installed-price lines; `material_rows`
    are `calculate_material_costs()["items"]`. Both cover the whole
    estimate, so multi-structure jobs work without special handling:
    material is bought for the roof as a whole, and the installed totals
    being divided into are likewise summed across structures.

    Returns one entry per category that had both a cost and a billed
    total, each carrying the inputs so the ratio can be explained on
    screen rather than appearing as an unsourced number.
    """
    billed: Dict[str, float] = {}
    for item in line_items:
        cat = item.get("category") or "misc"
        if cat in NO_MATERIAL_CATEGORIES:
            continue
        billed[cat] = billed.get(cat, 0.0) + float(item.get("total") or 0)

    cost: Dict[str, float] = {}
    for row in material_rows:
        cat = _category_of(row)
        if cat in NO_MATERIAL_CATEGORIES:
            continue
        cost[cat] = cost.get(cat, 0.0) + float(row.get("subtotal") or 0)

    derived: Dict[str, Dict[str, Any]] = {}
    for cat, billed_total in billed.items():
        material_total = cost.get(cat)
        # No cost rows for this category: the price book has nothing to
        # say about it, so the table ratio stands.
        if material_total is None or billed_total <= 0:
            continue

        raw = material_total / billed_total
        portion = min(MAX_DERIVED_PORTION, max(MIN_DERIVED_PORTION, raw))
        derived[cat] = {
            "portion": round(portion, 4),
            "raw_portion": round(raw, 4),
            "material_cost": round(material_total, 2),
            "billed_total": round(billed_total, 2),
            "clamped": abs(portion - raw) > 1e-9,
            "table_portion": round(get_material_portion(cat), 4),
        }

    return derived


def portion_warnings(derived: Dict[str, Dict[str, Any]]) -> List[str]:
    """Human-readable flags for categories whose ratio had to be clamped.

    A clamp is worth surfacing: it usually means the installed rate is at
    or below supplier cost for that category, which is a pricing problem
    rather than a rounding artifact.
    """
    warnings = []
    for cat, info in sorted(derived.items()):
        if not info["clamped"]:
            continue
        warnings.append(
            f"{cat}: material cost ${info['material_cost']:,.2f} is "
            f"{info['raw_portion'] * 100:.0f}% of the billed "
            f"${info['billed_total']:,.2f} — capped at "
            f"{info['portion'] * 100:.0f}%. Check the installed rate."
        )
    return warnings


def apply_material_portions(
    line_items: List[Dict[str, Any]],
    derived: Dict[str, Dict[str, Any]],
    override_pct: Optional[float] = None,
) -> None:
    """Rewrite each line item's material/labor split in place.

    `override_pct` is the estimate-level setting. It stays the most
    specific answer available — a user who says "60% material on this
    job" has overruled both the table and the derived costs — so when it
    is set this function leaves the items exactly as the calculator built
    them.
    """
    if override_pct is not None:
        return

    for item in line_items:
        info = derived.get(item.get("category") or "misc")
        if not info:
            continue
        portion = info["portion"]
        total = float(item.get("total") or 0)
        material_cost = round(total * portion, 2)
        item["material_portion"] = portion
        item["material_cost"] = material_cost
        item["labor_cost"] = round(total - material_cost, 2)
        item["material_portion_source"] = "price_book"
