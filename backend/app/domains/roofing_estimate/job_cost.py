"""What the job costs to run — labor and debris disposal.

The profit panel used to subtract only material cost from the estimate
total, which counted the crew and the dumpster as profit and reported
margins near 70% on jobs that actually clear far less.

This module supplies the other two pieces:

  * labor — crews are paid by the square, and every crew charges a
    different rate, so the rate is entered per estimate rather than
    assumed. Nothing is guessed: with no rate entered the result says
    labor is unknown instead of treating it as zero.
  * disposal — either the dumpster already on the estimate, or, when
    the debris is hauled on the company's own truck, the landfill
    tipping fee plus the labor for the trips.

Nothing here touches what the customer is quoted. It answers "what is
left after we pay for this job", not "what do we charge".
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DISPOSAL_DUMPSTER = "dumpster"
DISPOSAL_TRUCK = "truck"

# Roughly what a pickup with a dump insert or a small dump trailer
# carries in roofing debris. Only used to suggest a trip count when the
# user has not entered one.
DEFAULT_TRUCK_CAPACITY_LB = 3000.0


def _f(value, default=0.0) -> float:
    """Tolerant float: blank strings and None mean 'not entered'."""
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def suggested_haul_trips(debris_lb: float,
                         capacity_lb: float = DEFAULT_TRUCK_CAPACITY_LB) -> int:
    """Trips a truck needs for this much debris, rounded up."""
    if debris_lb <= 0 or capacity_lb <= 0:
        return 0
    return max(1, int(-(-debris_lb // capacity_lb)))


def calculate_labor_cost(
    squares: float, inputs: Dict[str, Any],
) -> Dict[str, Any]:
    """Crew cost for the job, from per-square rates.

    `squares` is the roof area WITH waste, because that is what the crew
    actually lays. Tear-off is priced separately from installation since
    crews quote them apart, and a layover job has no tear-off at all.
    """
    install_rate = _f(inputs.get("labor_per_sq"))
    tearoff_rate = _f(inputs.get("tearoff_per_sq"))
    fixed = _f(inputs.get("labor_fixed"))

    install = round(squares * install_rate, 2)
    tearoff = round(squares * tearoff_rate, 2)
    total = round(install + tearoff + fixed, 2)

    return {
        "install_cost": install,
        "tearoff_cost": tearoff,
        "fixed_cost": round(fixed, 2),
        "total": total,
        "install_per_sq": install_rate,
        "tearoff_per_sq": tearoff_rate,
        "squares": round(squares, 2),
        "crew_name": inputs.get("crew_name") or None,
        # The panel must not present a number it does not have.
        "entered": bool(install_rate or tearoff_rate or fixed),
    }


def calculate_disposal_cost(
    inputs: Dict[str, Any],
    dumpster: Optional[Dict[str, Any]] = None,
    dumpster_billed: float = 0.0,
) -> Dict[str, Any]:
    """Cost of getting the debris off the property.

    Two ways a job does this:

      dumpster — a can is rented, and the estimate already carries its
        price. That billed amount IS the cost, so it is reused rather
        than re-derived.
      truck — the crew hauls it themselves. Then the cost is the
        landfill's tipping fee on the actual tonnage, plus the labor for
        the round trips. This is usually cheaper than a can, which is
        why contractors do it, but it is never free — and treating it as
        free is what inflated the old margin.
    """
    method = (inputs.get("disposal_method") or DISPOSAL_DUMPSTER).lower()
    debris_lb = float((dumpster or {}).get("weight", {}).get("total_lb") or 0)
    tons = debris_lb / 2000.0

    if method == DISPOSAL_TRUCK:
        tipping_per_ton = _f(inputs.get("tipping_fee_per_ton"))
        cost_per_trip = _f(inputs.get("haul_cost_per_trip"))
        trips = int(_f(inputs.get("haul_trips"))) or suggested_haul_trips(
            debris_lb)

        tipping = round(tons * tipping_per_ton, 2)
        hauling = round(trips * cost_per_trip, 2)
        return {
            "method": DISPOSAL_TRUCK,
            "tipping_fee": tipping,
            "haul_labor": hauling,
            "trips": trips,
            "tipping_fee_per_ton": tipping_per_ton,
            "haul_cost_per_trip": cost_per_trip,
            "debris_lb": round(debris_lb, 1),
            "debris_tons": round(tons, 2),
            "total": round(tipping + hauling, 2),
            "entered": bool(tipping_per_ton or cost_per_trip),
        }

    # Dumpster: the estimate already priced the can(s).
    return {
        "method": DISPOSAL_DUMPSTER,
        "container": (dumpster or {}).get("reason"),
        "debris_lb": round(debris_lb, 1),
        "debris_tons": round(tons, 2),
        "total": round(float(dumpster_billed or 0), 2),
        # A billed dumpster is a known cost; no user input needed.
        "entered": bool(dumpster_billed),
    }


def calculate_job_cost(
    estimate,
    material_total_with_tax: float,
    line_items: Optional[List[Dict[str, Any]]] = None,
    dumpster: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full job cost and the profit actually left over.

    Returns `complete` False when labor has not been entered. The panel
    must say "labor not entered" rather than show a profit that quietly
    assumes the crew works for nothing — that overstatement is the whole
    reason this exists.
    """
    inputs = (getattr(estimate, "job_cost_inputs", None) or {})
    line_items = line_items or []

    # Crews are paid on what they lay, which includes waste.
    squares = float(getattr(estimate, "squares", 0) or 0)
    waste = float(getattr(estimate, "waste_factor", 0) or 0)
    squares_with_waste = round(squares * (1 + waste), 2)

    labor = calculate_labor_cost(squares_with_waste, inputs)

    # What the estimate already bills for the dumpster, so the truck
    # option can be compared against a real number.
    dumpster_billed = sum(
        float(it.get("total") or 0) for it in line_items
        if str(it.get("description", "")).startswith("Dumpster")
    )
    disposal = calculate_disposal_cost(inputs, dumpster, dumpster_billed)

    material = round(float(material_total_with_tax or 0), 2)
    known_cost = round(material + labor["total"] + disposal["total"], 2)

    estimate_total = float(getattr(estimate, "total", 0) or 0)
    complete = labor["entered"]

    profit = None
    margin = None
    if estimate_total and complete:
        profit = round(estimate_total - known_cost, 2)
        margin = round(profit / estimate_total * 100, 1)

    missing = []
    if not labor["entered"]:
        missing.append("labor")
    if not disposal["entered"]:
        missing.append("disposal")

    return {
        "material_cost": material,
        "labor": labor,
        "disposal": disposal,
        "total_cost": known_cost,
        "estimate_total": estimate_total or None,
        "profit": profit,
        "margin_pct": margin,
        # False -> the UI shows what is missing instead of a margin.
        "complete": complete,
        "missing": missing,
        "cost_breakdown_pct": {
            "material": round(material / known_cost * 100, 1)
            if known_cost else 0.0,
            "labor": round(labor["total"] / known_cost * 100, 1)
            if known_cost else 0.0,
            "disposal": round(disposal["total"] / known_cost * 100, 1)
            if known_cost else 0.0,
        },
    }
