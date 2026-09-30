"""How measured roof quantities become things you actually buy.

A roof is measured in squares and linear feet, but nothing is ordered
that way: shingles come in bundles, underlayment and ice barrier in
rolls, drip edge and ridge vent in sticks. Costing a job in SQ and SF
therefore prices a quantity no supplier will ever invoice, and it hides
the rounding — three bundles get bought whether 2.1 or 2.9 are needed.

This module owns that conversion. The packaging figures come from
`material_order.calculator.BRAND_SPECS`, which already carries them per
brand (3 BD/SQ, 10 SQ/RL felt, 48 LF/RL ice barrier, …), so the two
places that reason about roofing materials agree on what a bundle is.

Every conversion rounds up: you cannot buy 2.4 rolls.
"""

import math
from typing import Any, Dict, Optional

from app.domains.material_order.calculator import BRAND_SPECS

# Units that are counted rather than packaged, and so never converted.
COUNTED_UNITS = {"EA"}

# Fallbacks for materials no brand spec covers, or when the estimate
# names a brand we have no spec for. These match the CertainTeed values.
DEFAULT_PACKAGING = {
    "shingle_bd_per_sq": 3,
    "hip_ridge_lf_per_bd": 30,
    "felt_sq_per_rl": 10,
    "ice_water_lf_per_rl": 48,
    "drip_edge_lf_per_pc": 10,
    "ridge_vent_lf_per_pc": 4,
    # Pre-bent step flashing: 100 pcs/BD, laid about 1.5 pcs per LF.
    "step_flashing_lf_per_bd": 100 / 1.5,
    "gutter_lf_per_pc": 10,
    "downspout_lf_per_pc": 10,
    "gutter_guard_lf_per_pc": 4,
}


def round_squares_to_bundle(
    squares: float, bd_per_sq: float = None,
) -> float:
    """Round a roof area up to whole bundles, expressed in squares.

    Shingles are sold by the bundle and three of them cover a square, so
    a roof is quoted in thirds: 10, 10.33, 10.67, 11. A figure like
    27.50 SQ is 82.5 bundles — half a bundle nobody can buy, and it also
    put the estimate 0.17 SQ below what the material side actually
    orders.

    Always rounds up: the extra fraction of a bundle is bought whether
    or not it is billed.

    Returned to two decimals, which is how a quote shows it. A third of
    a square is 0.333..., so more decimals do not survive the round trip
    anyway — 10.6667 x 3 is 32.0001 bundles, not 32 — and the estimate
    is priced and printed on the two-decimal figure.
    """
    if squares is None or squares <= 0:
        return 0.0
    per = bd_per_sq or DEFAULT_PACKAGING["shingle_bd_per_sq"]
    if per <= 0:
        return float(squares)
    bundles = math.ceil(round(float(squares) * per, 6))
    return round(bundles / per, 2)


def brand_roofing_spec(brand: Optional[str]) -> Dict[str, Any]:
    """Roofing packaging for a brand, falling back to CertainTeed.

    The estimate stores brands lowercased with underscores
    ("owens_corning"); BRAND_SPECS keys them as written.
    """
    if not brand:
        return BRAND_SPECS["CertainTeed"]["roofing"]
    wanted = str(brand).replace("_", " ").strip().lower()
    for name, spec in BRAND_SPECS.items():
        if name.lower() == wanted:
            return spec["roofing"]
    return BRAND_SPECS["CertainTeed"]["roofing"]


class Packaging:
    """Converts a measured quantity into whole purchase units.

    Each method returns (quantity, unit, note) where `note` spells out
    the conversion so the cost screen can show why 85 BD was ordered.
    """

    def __init__(self, brand: Optional[str] = None):
        self.spec = brand_roofing_spec(brand)

    def _per(self, section: str, key: str, default_key: str) -> float:
        value = (self.spec.get(section) or {}).get(key)
        if not value:
            value = DEFAULT_PACKAGING[default_key]
        return float(value)

    @staticmethod
    def _packs(measured: float, per_pack: float) -> int:
        """Whole packs needed to cover `measured`. Always rounds up."""
        if measured <= 0 or per_pack <= 0:
            return 0
        return int(math.ceil(round(measured / per_pack, 6)))

    # ── Conversions, one per material ──

    def shingle(self, squares_with_waste: float):
        per = self._per("shingle", "bd_per_sq", "shingle_bd_per_sq")
        qty = self._packs(squares_with_waste * per, 1)
        return qty, "BD", f"{per:g} BD/SQ × {squares_with_waste:.1f} SQ"

    def hip_ridge(self, lf: float):
        per = self._per("hip_ridge", "lf_per_bd", "hip_ridge_lf_per_bd")
        return self._packs(lf, per), "BD", f"{per:g} LF/BD"

    def underlayment(self, squares_with_waste: float):
        per = self._per("felt", "sq_per_rl", "felt_sq_per_rl")
        return self._packs(squares_with_waste, per), "RL", f"{per:g} SQ/RL"

    def ice_water(self, lf: float):
        per = self._per("ice_water", "lf_per_rl", "ice_water_lf_per_rl")
        return self._packs(lf, per), "RL", f"{per:g} LF/RL"

    def drip_edge(self, lf: float):
        per = DEFAULT_PACKAGING["drip_edge_lf_per_pc"]
        return self._packs(lf, per), "PC", f"{per:g} LF/PC"

    def ridge_vent(self, lf: float):
        per = self._per("ridge_vent", "lf_per_pc", "ridge_vent_lf_per_pc")
        return self._packs(lf, per), "PC", f"{per:g} LF/PC"

    def step_flashing(self, lf: float):
        per = DEFAULT_PACKAGING["step_flashing_lf_per_bd"]
        return self._packs(lf, per), "BD", "100 pcs/BD (1.5 pcs/LF)"

    def consumable(self, measured: float, per_pack: float,
                   unit: str, note: str, minimum: int = 0):
        """A consumable bought by the carton/box/tube."""
        qty = max(self._packs(measured, per_pack), minimum)
        return qty, unit, note

    def gutter(self, lf: float):
        per = DEFAULT_PACKAGING["gutter_lf_per_pc"]
        return self._packs(lf, per), "PC", f"{per:g} LF/PC"

    def downspout(self, lf: float):
        per = DEFAULT_PACKAGING["downspout_lf_per_pc"]
        return self._packs(lf, per), "PC", f"{per:g} LF/PC"

    def gutter_guard(self, lf: float):
        per = DEFAULT_PACKAGING["gutter_guard_lf_per_pc"]
        return self._packs(lf, per), "PC", f"{per:g} LF/PC"
