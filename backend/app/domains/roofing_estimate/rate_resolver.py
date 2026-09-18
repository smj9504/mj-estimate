"""Resolves a calculation rate to its overridden or default value.

calculator.py reads the pricing.py constants at roughly forty call
sites. Threading an override through each one by hand would be a large,
easy-to-get-wrong change, and every new rate added later would have to
remember to do the same.

Instead the calculator holds one Rates object and asks it for values.
With no overrides it returns the pricing.py constant, so behaviour is
unchanged; with overrides loaded it returns the stored value. A rate
that nobody has edited costs one dict lookup that misses.

Deliberately NOT handled here: supplier material costs. Those resolve
through the price book, which has its own snapshot rules.
"""

from typing import Any, Dict, Optional

from . import pricing
from .pricing_settings import SCALAR_GROUP


class Rates:
    """Rate lookups for one estimate, with overrides applied.

    `overrides` is the flat {"group:key": value} mapping produced by
    pricing_settings.load_settings(). An empty mapping (the default)
    makes every lookup fall through to pricing.py.
    """

    __slots__ = ("_o",)

    def __init__(self, overrides: Optional[Dict[str, float]] = None):
        self._o = overrides or {}

    # ── dict-backed groups ──

    def _lookup(
        self, group: str, key: Any, source: Dict, fallback: float = None,
    ) -> float:
        value = self._o.get(f"{group}:{key}")
        if value is not None:
            return value
        if key in source:
            return source[key]
        return fallback

    def shingle(self, key: str, fallback: float = 550.0) -> float:
        return self._lookup(
            "shingle_rate", key, pricing.SHINGLE_RATES, fallback)

    def tearoff(self, key: str, fallback: float = None) -> float:
        return self._lookup(
            "tearoff_rate", key, pricing.TEAROFF_RATES, fallback)

    def decking(self, key: str, fallback: float = 90.0) -> float:
        return self._lookup(
            "decking_rate", key, pricing.DECKING_RATES, fallback)

    def underlayment(self, key: str, fallback: float = 0.65) -> float:
        return self._lookup(
            "underlayment_rate", key, pricing.UNDERLAYMENT_RATES, fallback)

    def penetration(self, key: str, fallback: float = 65.0) -> float:
        return self._lookup(
            "penetration_rate", key, pricing.PENETRATION_RATES, fallback)

    def pipe_boot(self, key: str, fallback: float = 65.0) -> float:
        # Pipe boots are edited as penetrations on the screen; the two
        # dicts carry the same three boot rates under different names.
        value = self._o.get(f"penetration_rate:pipe_boot_{key}")
        if value is not None:
            return value
        return pricing.PIPE_BOOT_RATES.get(key, fallback)

    def flashing(self, key: str, fallback: float = None) -> float:
        return self._lookup(
            "flashing_rate", key, pricing.FLASHING_RATES, fallback)

    def ventilation(self, key: str, fallback: float = 11.0) -> float:
        return self._lookup(
            "ventilation_rate", key, pricing.VENTILATION_RATES, fallback)

    def misc(self, key: str, fallback: float = None) -> float:
        return self._lookup(
            "misc_rate", key, pricing.MISC_RATES, fallback)

    def skylight(self, key: str, fallback: float = 850.0) -> float:
        return self._lookup(
            "skylight_rate", key, pricing.SKYLIGHT_REPLACEMENT_RATES,
            fallback)

    # ── scalars ──

    def _scalar(self, key: str, default: float) -> float:
        value = self._o.get(f"{SCALAR_GROUP}:{key}")
        return default if value is None else value

    @property
    def ice_water(self) -> float:
        return self._scalar(
            "ice_water_shield_rate", pricing.ICE_WATER_SHIELD_RATE)

    @property
    def drip_edge(self) -> float:
        return self._scalar("drip_edge_rate", pricing.DRIP_EDGE_RATE)

    @property
    def ridge_cap(self) -> float:
        return self._scalar("ridge_cap_rate", pricing.RIDGE_CAP_RATE)

    # ── derived lookups (mirror the pricing.py helpers) ──

    def gutter(self, style: str, size: int, material: str = "aluminum"):
        key = (
            f"copper_{style}_{size}" if material == "copper"
            else f"{style}_{size}"
        )
        return self._lookup("gutter_rate", key, pricing.GUTTER_RATES, 12.0)

    def guard(self, guard_type: str) -> float:
        return self._lookup(
            "gutter_rate", f"guard_{guard_type}", pricing.GUTTER_RATES, 11.0)

    def pitch_multiplier(self, pitch: str) -> float:
        if not pitch:
            return 1.0
        return self._lookup(
            "pitch_multiplier", pitch, pricing.PITCH_MULTIPLIERS, 1.0)

    def story_multiplier(self, stories: int) -> float:
        # Stored keys are strings; the pricing.py dict is int-keyed.
        value = self._o.get(f"story_multiplier:{stories}")
        if value is not None:
            return value
        return pricing.STORY_MULTIPLIERS.get(stories, 1.0)

    def waste_factor(self, complexity: str) -> float:
        return self._lookup(
            "waste_factor", complexity, pricing.WASTE_FACTORS, 0.12)

    def sales_tax(self, state: str, locality: str = None,
                  as_of: str = None) -> float:
        """Material sales tax for a jurisdiction.

        An override keyed on the plain state still wins, so a company
        that has set its own rate keeps it; otherwise the pricing.py
        helper resolves the NoVA add-on and DC's 2026-10-01 increase.
        """
        value = self._o.get(f"sales_tax:{state}")
        if value is not None:
            return value
        return pricing.get_sales_tax_rate(state, locality, as_of)

    def permit_fee(self, state: str, locality: str = None,
                   like_for_like: bool = True,
                   roof_sf: float = 0) -> float:
        """Permit fee, by jurisdiction rule rather than a flat rate."""
        value = self._o.get(f"permit_fee:{state}")
        if value is not None:
            return value
        return pricing.get_permit_fee(
            state, locality, like_for_like, roof_sf)

    def material_portion(
        self, category: str, override: float = None,
    ) -> float:
        """Fallback material share for a category.

        `override` is the estimate-level setting and still wins over
        everything, matching pricing.get_material_portion().
        """
        if override is not None:
            return max(0.0, min(1.0, float(override)))
        value = self._o.get(f"material_portion:{category}")
        if value is not None:
            return value
        if category in pricing.MATERIAL_PORTIONS:
            return pricing.MATERIAL_PORTIONS[category]
        return self._scalar(
            "default_material_portion", pricing.DEFAULT_MATERIAL_PORTION)


# Shared instance for callers with no overrides, so the common path
# allocates nothing.
DEFAULT_RATES = Rates()
