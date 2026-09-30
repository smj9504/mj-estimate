"""Dumpster sizing from estimated tear-off weight.

The estimate used to bill one size — a 20 yard can, one per 30 squares,
whatever was being torn off. That is wrong in both directions: a small
one-layer asphalt roof pays for a can twice the size it needs, and a
cedar shake or three-layer roof is under-ordered, which on the day means
a second haul nobody quoted.

Sizing a can is really a weight question, not an area one. Roofing
debris is dense enough that a roll-off hits its weight allowance long
before it fills up, so the calculation here is:

    squares x lb/SQ (by material, per layer) x condition factors
      -> total lb -> the smallest can that carries it

Weights are tear-off weights (installed material plus absorbed moisture
and embedded fasteners), which run heavier than the shipped product
weight on a bundle wrapper.

Sources: NRCA installed-weight tables, roll-off haulers' published
roofing allowances for the DMV area, 2026.
"""

from typing import Any, Dict, List, Optional

# ── Tear-off weight, pounds per square, per layer ──
#
# A "square" is 100 SF. These are per LAYER: a two-layer asphalt roof is
# roughly twice a one-layer roof, less a little because the bottom layer
# has usually shed granules.

MATERIAL_WEIGHTS_PER_SQ: Dict[str, float] = {
    # Architectural dominates the market now, so the generic "asphalt"
    # default sits near it rather than midway to three-tab.
    "asphalt": 325.0,
    "three_tab": 225.0,
    "architectural": 375.0,     # NRCA/GAF: 350-430 lb/SQ torn off
    "cedar_shake": 350.0,       # dry; wet shake is far heavier, see below
    "slate": 900.0,
    "tile": 1150.0,             # concrete; clay runs higher still
    "metal": 125.0,
}

DEFAULT_MATERIAL_WEIGHT = MATERIAL_WEIGHTS_PER_SQ["asphalt"]

# Layers past the first weigh at least as much as the first: the buried
# layer comes up with the nails, felt and embedded debris of the layer
# above it. Measured tear-offs run 1.0-2.1x per added layer; 1.0 is the
# conservative floor.
REPEAT_LAYER_FACTOR = 1.0

# Things that are torn off with the roof but are not the roof. Decking
# is the big one — a sheet of 7/16 OSB is about 46 lb, and a re-deck can
# quietly double the load.
DECKING_SHEET_LB = 46.0

# Underlayment, drip edge, flashing, nails, and the general debris that
# comes off with any roof, as a share of the roofing weight.
ANCILLARY_FACTOR = 0.08

# Wet debris is dramatically heavier. Cedar and any roof torn off in the
# rain soaks up water; haulers charge the overage either way.
WET_FACTOR = 1.25

# ── Can sizes ──
#
# `capacity_lb` is the weight a hauler will carry on that can for
# roofing debris before overage charges start — not the volumetric
# rating, which roofing rarely reaches. `volume_sq` is the bulk cap in
# layer-equivalent squares, which does bind on multi-layer tear-offs and
# on light-but-bulky debris.

# Charged per ton when a can exceeds its allowance. Paying the overage
# on a few hundred pounds is far cheaper than renting another can, so
# select_dumpsters() compares the two.
OVERAGE_PER_TON = 95.0

# How far past its allowance a can may be loaded. Overage is a billing
# arrangement, not permission to exceed the truck's legal axle weight —
# haulers refuse a can they cannot lift, so past this the job needs a
# second container no matter what the arithmetic says.
MAX_OVERAGE_LB = 2000.0

DUMPSTER_SIZES: List[Dict[str, Any]] = [
    {
        "yards": 10,
        "capacity_lb": 4000.0,
        "volume_sq": 15.0,
        "label": "10 yard",
        "note": "Small — up to about 15 SQ, single layer",
    },
    {
        "yards": 15,
        "capacity_lb": 6000.0,
        "volume_sq": 22.0,
        "label": "15 yard",
        "note": "Small-medium",
    },
    {
        "yards": 20,
        "capacity_lb": 8000.0,
        "volume_sq": 30.0,
        "label": "20 yard",
        "note": "Standard — most single-family homes",
    },
    {
        "yards": 30,
        "capacity_lb": 12000.0,
        "volume_sq": 45.0,
        "label": "30 yard",
        "note": "Large — multi-layer tear-off / cedar shake",
    },
]

SIZES_BY_YARD = {d["yards"]: d for d in DUMPSTER_SIZES}
LARGEST = DUMPSTER_SIZES[-1]


def material_weight_per_sq(material: Optional[str]) -> float:
    """Tear-off weight per square for one layer of a material."""
    if not material:
        return DEFAULT_MATERIAL_WEIGHT
    return MATERIAL_WEIGHTS_PER_SQ.get(
        str(material).lower().strip(), DEFAULT_MATERIAL_WEIGHT)


def estimate_tearoff_weight(
    squares: float,
    material: Optional[str] = "asphalt",
    layers: int = 1,
    decking_sheets: float = 0,
    wet: bool = False,
) -> Dict[str, Any]:
    """Pounds of debris a tear-off will produce, and how it breaks down.

    Returned rather than just totalled so the estimate can show its
    work — "8,200 lb: 6,900 shingle + 920 decking + 550 misc" is
    checkable by the person ordering the can, where a bare number is not.
    """
    squares = max(0.0, float(squares or 0))
    layers = max(1, int(layers or 1))
    per_sq = material_weight_per_sq(material)

    # First layer at full weight, the rest discounted.
    layer_equiv = 1.0 + (layers - 1) * REPEAT_LAYER_FACTOR
    roofing_lb = squares * per_sq * layer_equiv

    decking_lb = max(0.0, float(decking_sheets or 0)) * DECKING_SHEET_LB
    ancillary_lb = roofing_lb * ANCILLARY_FACTOR

    subtotal = roofing_lb + decking_lb + ancillary_lb
    total = subtotal * (WET_FACTOR if wet else 1.0)

    return {
        "total_lb": round(total, 1),
        "roofing_lb": round(roofing_lb, 1),
        "decking_lb": round(decking_lb, 1),
        "ancillary_lb": round(ancillary_lb, 1),
        "wet_surcharge_lb": round(total - subtotal, 1),
        "weight_per_sq": per_sq,
        "layer_equivalent": round(layer_equiv, 2),
        "squares": round(squares, 2),
        "layers": layers,
        "material": material or "asphalt",
        "wet": bool(wet),
    }


def _fits(size: Dict[str, Any], weight_lb: float, bulk_sq: float) -> bool:
    """Whether one can carries this load by both weight and bulk."""
    return weight_lb <= size["capacity_lb"] and bulk_sq <= size["volume_sq"]


def _combination(weight_lb: float, bulk_sq: float) -> List[Dict[str, Any]]:
    """Cans for a load too big for any single one.

    Fills with the largest can while more than one is still needed, then
    drops to the smallest can that takes the remainder. Two 30s for a
    load that is really a 30 plus a 10 is a real cost: the tail can is
    sized to what is actually left rather than rounded up to the biggest.
    """
    cans: List[Dict[str, Any]] = []
    remaining_lb = weight_lb
    remaining_sq = bulk_sq

    # Guard against a pathological loop on absurd inputs.
    while len(cans) < 20:
        if _fits(LARGEST, remaining_lb, remaining_sq):
            for size in DUMPSTER_SIZES:
                if _fits(size, remaining_lb, remaining_sq):
                    cans.append(size)
                    return cans
        cans.append(LARGEST)
        remaining_lb -= LARGEST["capacity_lb"]
        remaining_sq -= LARGEST["volume_sq"]
        if remaining_lb <= 0 and remaining_sq <= 0:
            return cans
    return cans


def select_dumpsters(
    squares: float,
    material: Optional[str] = "asphalt",
    layers: int = 1,
    decking_sheets: float = 0,
    wet: bool = False,
) -> Dict[str, Any]:
    """Pick the can size(s) for a tear-off.

    One can of the smallest size that fits is the answer whenever the
    job fits in one. Past that the load is split across cans, sizing the
    last one to the remainder instead of ordering another of the largest.
    """
    breakdown = estimate_tearoff_weight(
        squares, material, layers, decking_sheets, wet)
    weight = breakdown["total_lb"]

    if weight <= 0:
        return {
            "size": None, "count": 0, "cans": [], "weight": breakdown,
            "reason": "No tear-off",
        }

    # Bulk scales with layers too: 25 SQ of three-layer debris fills far
    # more of a can than 25 SQ of one-layer, even before the decking.
    bulk_sq = (
        breakdown["squares"] * breakdown["layer_equivalent"]
        + (decking_sheets or 0) * 0.08   # a sheet is roughly 0.08 SQ of bulk
    )

    for size in DUMPSTER_SIZES:
        if _fits(size, weight, bulk_sq):
            return {
                "size": size,
                "count": 1,
                "cans": [size],
                "weight": breakdown,
                "bulk_sq": round(bulk_sq, 2),
                "capacity_used_pct": round(
                    weight / size["capacity_lb"] * 100, 1),
                "reason": (
                    f"{weight:,.0f} lb within the {size['label']} "
                    f"allowance of {size['capacity_lb']:,.0f} lb"
                ),
            }

    # Before renting another can, check whether simply going over the
    # largest single can's allowance is cheaper. A 488 lb overage costs
    # about $25; a second can costs hundreds.
    over_lb = weight - LARGEST["capacity_lb"]
    if 0 < over_lb <= MAX_OVERAGE_LB and bulk_sq <= LARGEST["volume_sq"]:
        overage_cost = (over_lb / 2000.0) * OVERAGE_PER_TON
        return {
            "size": LARGEST,
            "count": 1,
            "cans": [LARGEST],
            "weight": breakdown,
            "bulk_sq": round(bulk_sq, 2),
            "overage_lb": round(over_lb, 1),
            "overage_cost": round(overage_cost, 2),
            "capacity_used_pct": round(
                weight / LARGEST["capacity_lb"] * 100, 1),
            "reason": (
                f"{weight:,.0f} lb — one {LARGEST['label']} plus "
                f"{over_lb:,.0f} lb overage (approx. ${overage_cost:,.0f})"
            ),
        }

    cans = _combination(weight, bulk_sq)
    total_capacity = sum(c["capacity_lb"] for c in cans)
    counts: Dict[str, int] = {}
    for c in cans:
        counts[c["label"]] = counts.get(c["label"], 0) + 1
    summary = " + ".join(
        f"{label} x{n}" if n > 1 else label for label, n in counts.items()
    )
    return {
        # The largest can is the headline size; `cans` carries the mix.
        "size": cans[0],
        "count": len(cans),
        "cans": cans,
        "weight": breakdown,
        "bulk_sq": round(bulk_sq, 2),
        "capacity_used_pct": round(weight / total_capacity * 100, 1),
        "reason": f"{weight:,.0f} lb — {summary}",
    }
