"""The editable calculation settings — everything except material cost.

pricing.py holds the numbers the estimate is built from: installed rates,
pitch and story multipliers, waste factors, sales tax, permit fees, and
the fallback material portions. They were module constants, so changing
one meant editing code and deploying.

This module makes them editable from a screen without giving up the
constants as defaults. A setting is stored only when someone changes it;
resolution falls through company row -> global row -> pricing.py. An
empty table therefore behaves exactly like the code did before.

Supplier material costs are NOT here. They live in the price book
(material_price_book.py), which carries supplier, SKU, packaging and
quantity formulas that would be meaningless alongside a pitch
multiplier. Keeping the two apart is what lets the material screen stay
the single place a material cost is edited.
"""

import logging
from typing import Any, Dict, List, Optional

from . import pricing
from .material_basis import basis_unit
from .models import RoofingPricingSetting

logger = logging.getLogger(__name__)


# ── Group definitions ──
#
# Each group names the pricing.py dict it overrides, how its values
# behave, and how to label them. `kind` drives validation and the input
# widget: "money" is a dollar amount, "rate" a multiplier, "pct" a
# 0-1 fraction shown as a percentage.

GROUPS: List[Dict[str, Any]] = [
    {
        "group": "shingle_rate",
        "label": "Shingle (installed, per SQ)",
        "source": "SHINGLE_RATES",
        "kind": "money",
        "unit": "SQ",
        "help": "설치 단가 — 자재와 인건비가 합쳐진 금액입니다.",
    },
    {
        "group": "tearoff_rate",
        "label": "Tear-off & Dumpster",
        "source": "TEAROFF_RATES",
        "kind": "money",
        "unit": "SQ / EA",
        "help": "철거 단가(제곱당)와 덤스터 비용.",
    },
    {
        "group": "decking_rate",
        "label": "Decking",
        "source": "DECKING_RATES",
        "kind": "money",
        "unit": "sheet / SF",
        "help": "4x8 시트당 설치 단가. re_nail은 SF당입니다.",
    },
    {
        "group": "underlayment_rate",
        "label": "Underlayment (per SF)",
        "source": "UNDERLAYMENT_RATES",
        "kind": "money",
        "unit": "SF",
    },
    {
        "group": "penetration_rate",
        "label": "Penetrations (each)",
        "source": "PENETRATION_RATES",
        "kind": "money",
        "unit": "EA",
    },
    {
        "group": "flashing_rate",
        "label": "Flashing",
        "source": "FLASHING_RATES",
        "kind": "money",
        "unit": "LF / EA",
    },
    {
        "group": "ventilation_rate",
        "label": "Ventilation",
        "source": "VENTILATION_RATES",
        "kind": "money",
        "unit": "LF / EA",
    },
    {
        "group": "gutter_rate",
        "label": "Gutter & Guards",
        "source": "GUTTER_RATES",
        "kind": "money",
        "unit": "LF / EA",
    },
    {
        "group": "misc_rate",
        "label": "Cleanup & Misc",
        "source": "MISC_RATES",
        "kind": "money",
        "unit": "LS",
    },
    {
        "group": "skylight_rate",
        "label": "Skylight Replacement (add-on)",
        "source": "SKYLIGHT_REPLACEMENT_RATES",
        "kind": "money",
        "unit": "EA",
    },
    {
        "group": "pitch_multiplier",
        "label": "Pitch Multiplier",
        "source": "PITCH_MULTIPLIERS",
        "kind": "rate",
        "unit": "×",
        "help": "경사에 따른 인건비 배수. 1.00 = 할증 없음.",
    },
    {
        "group": "story_multiplier",
        "label": "Story Multiplier",
        "source": "STORY_MULTIPLIERS",
        "kind": "rate",
        "unit": "×",
        "help": "층수 할증. 1.00 = 할증 없음.",
    },
    {
        "group": "waste_factor",
        "label": "Waste Factor",
        "source": "WASTE_FACTORS",
        "kind": "pct",
        "unit": "%",
        "help": "지붕 형태별 자재 폐기율.",
    },
    {
        "group": "sales_tax",
        "label": "Sales Tax (by state)",
        "source": "SALES_TAX_RATES",
        "kind": "pct",
        "unit": "%",
        "help": "자재분에만 부과됩니다.",
    },
    {
        "group": "permit_fee",
        "label": "Permit Fee (by state)",
        "source": "PERMIT_FEES",
        "kind": "money",
        "unit": "LS",
    },
    {
        "group": "material_portion",
        "label": "Material Portion (fallback)",
        "source": "MATERIAL_PORTIONS",
        "kind": "pct",
        "unit": "%",
        "help": (
            "설치 단가 중 자재로 보는 비중. price book에 원가가 있는 "
            "카테고리는 실제 원가로 계산되므로 이 값은 쓰이지 않습니다."
        ),
    },
]

GROUPS_BY_NAME = {g["group"]: g for g in GROUPS}

# Single-value settings that are not part of a dict.
SCALAR_SETTINGS: Dict[str, Dict[str, Any]] = {
    "ice_water_shield_rate": {
        "label": "Ice & Water Shield (per SF)",
        "source": "ICE_WATER_SHIELD_RATE",
        "kind": "money",
        "unit": "SF",
    },
    "drip_edge_rate": {
        "label": "Drip Edge (per LF)",
        "source": "DRIP_EDGE_RATE",
        "kind": "money",
        "unit": "LF",
    },
    "ridge_cap_rate": {
        "label": "Ridge Cap (per LF)",
        "source": "RIDGE_CAP_RATE",
        "kind": "money",
        "unit": "LF",
    },
    "default_material_portion": {
        "label": "Default Material Portion",
        "source": "DEFAULT_MATERIAL_PORTION",
        "kind": "pct",
        "unit": "%",
    },
}

SCALAR_GROUP = "scalar"

# Story multipliers are keyed by int in pricing.py but by string in the
# database, so the two have to be reconciled on the way in and out.
INT_KEYED_GROUPS = {"story_multiplier"}


def _source_dict(group: str) -> Dict[Any, float]:
    """The pricing.py dict a group overrides."""
    spec = GROUPS_BY_NAME.get(group)
    if not spec:
        return {}
    return getattr(pricing, spec["source"], {}) or {}


def default_for(group: str, key: str) -> Optional[float]:
    """The pricing.py constant behind one setting, if it has one."""
    if group == SCALAR_GROUP:
        spec = SCALAR_SETTINGS.get(key)
        if not spec:
            return None
        return getattr(pricing, spec["source"], None)

    source = _source_dict(group)
    if group in INT_KEYED_GROUPS:
        try:
            return source.get(int(key))
        except (TypeError, ValueError):
            return None
    return source.get(key)


def build_default_catalog() -> List[Dict[str, Any]]:
    """Every setting the screen can edit, at its pricing.py default.

    Nothing is written to the database by this — it is the full list of
    what *could* be overridden, which the API merges stored rows onto so
    the screen shows edited and untouched settings side by side.
    """
    catalog: List[Dict[str, Any]] = []

    for spec in GROUPS:
        group = spec["group"]
        for key, value in _source_dict(group).items():
            catalog.append({
                "setting_group": group,
                "setting_key": str(key),
                "group_label": spec["label"],
                "label": _humanize(str(key)),
                "kind": spec["kind"],
                "unit": spec.get("unit"),
                "help": spec.get("help"),
                "value": float(value),
                "default_value": float(value),
                "is_overridden": False,
            })

    for key, spec in SCALAR_SETTINGS.items():
        value = getattr(pricing, spec["source"], None)
        if value is None:
            continue
        catalog.append({
            "setting_group": SCALAR_GROUP,
            "setting_key": key,
            "group_label": "Single Rates",
            "label": spec["label"],
            "kind": spec["kind"],
            "unit": spec.get("unit"),
            "help": spec.get("help"),
            "value": float(value),
            "default_value": float(value),
            "is_overridden": False,
        })

    return catalog


# ── Material cost shown beside an installed rate ──
#
# An installed rate is quoted per SQ, LF or SF; the supplier sells the
# material by the bundle, roll or stick. To answer "how much of this
# $750/SQ is shingles" the cost has to be restated in the rate's unit.
#
# Only the PAIRING is declared here — which price-book material a rate is
# mostly made of, and the unit the rate is quoted in. The packaging
# conversion is NOT declared: it is read from the price-book row
# (qty_basis + coverage_per_unit), the same figures the costing engine
# uses and the price-book screen already lets people edit. Duplicating
# them here would mean a coverage corrected on that screen silently
# disagreeing with this one.

# Rate unit per setting group; None means the group is mixed and every
# member must name its own unit in MATERIAL_LINKS.
GROUP_RATE_UNITS = {
    "shingle_rate": "SQ",
    "decking_rate": "EA",        # priced per 4x8 sheet
    "underlayment_rate": "SF",
    "penetration_rate": "EA",
    "gutter_rate": "LF",
    "skylight_rate": "EA",
    "ventilation_rate": None,    # mixed: per LF and per EA
    "flashing_rate": None,       # mixed
}

# setting -> (price book key, rate unit; None takes the group default)
MATERIAL_LINKS = {
    "shingle_rate:three_tab": ("shingle:three_tab", None),
    "shingle_rate:architectural_std": ("shingle:architectural_std", None),
    "shingle_rate:architectural_premium": (
        "shingle:architectural_premium", None),
    "shingle_rate:designer": ("shingle:designer", None),
    "shingle_rate:impact_resistant": ("shingle:impact_resistant", None),

    "decking_rate:osb_716": ("decking:osb_716", None),
    "decking_rate:osb_12": ("decking:osb_12", None),
    "decking_rate:cdx_12": ("decking:cdx_12", None),
    "decking_rate:cdx_58": ("decking:cdx_58", None),

    "underlayment_rate:synthetic": ("underlayment:synthetic", None),

    "scalar:ice_water_shield_rate": ("ice_water", "SF"),
    "scalar:drip_edge_rate": ("drip_edge", "LF"),
    "scalar:ridge_cap_rate": ("ridge_cap", "LF"),

    "penetration_rate:pipe_boot_rubber": ("pipe_boots:rubber", None),
    "penetration_rate:pipe_boot_lead": ("pipe_boots:lead", None),
    "penetration_rate:pipe_boot_lifetime": ("pipe_boots:lifetime", None),

    "flashing_rate:chimney_small": ("chimney_flashing", "EA"),
    "flashing_rate:chimney_large": ("chimney_flashing", "EA"),
    "flashing_rate:skylight_flashing_kit": ("skylight_flashing", "EA"),
    "flashing_rate:step_flashing_per_lf": ("step_flashing", "LF"),

    "ventilation_rate:ridge_vent_shingle_over_per_lf": (
        "ridge_vent:shingle_over", "LF"),
    "ventilation_rate:ridge_vent_aluminum_per_lf": (
        "ridge_vent:aluminum", "LF"),
    "ventilation_rate:static_vent_each": ("static_vent", "EA"),

    "gutter_rate:k_style_5": ("gutter:k_style_5", None),
    "gutter_rate:k_style_6": ("gutter:k_style_6", None),
    "gutter_rate:half_round_5": ("gutter:half_round_5", None),
    "gutter_rate:half_round_6": ("gutter:half_round_6", None),
    "gutter_rate:copper_k_style_5": ("gutter:copper_k_style_5", None),
    "gutter_rate:copper_k_style_6": ("gutter:copper_k_style_6", None),
    "gutter_rate:downspout_2x3": ("downspout:2x3", None),
    "gutter_rate:downspout_3x4": ("downspout:3x4", None),
    "gutter_rate:guard_mesh": ("gutter_guard:mesh", None),
    "gutter_rate:guard_micro_mesh": ("gutter_guard:micro_mesh", None),
    "gutter_rate:guard_foam": ("gutter_guard:foam", None),
    "gutter_rate:guard_reverse_curve": ("gutter_guard:reverse_curve", None),
}

# A square is 100 SF. Length and count units do not convert into each
# other, and a missing pair means the two cannot be reconciled.
UNIT_CONVERSIONS = {
    ("SF", "SQ"): 1.0 / 100.0,
    ("SQ", "SF"): 100.0,
}


def _measured_per_rate_unit(rate_unit, basis_unit_name):
    """How much of the material's measure one unit of the rate covers.

    None when the units cannot be reconciled — a per-LF rate against a
    material measured in SQ, say. Guessing there would produce a
    confident wrong number, so the caller shows nothing instead.
    """
    if not rate_unit or not basis_unit_name:
        return None
    if rate_unit == basis_unit_name:
        return 1.0
    return UNIT_CONVERSIONS.get((rate_unit, basis_unit_name))


def attach_material_costs(catalog, price_book):
    """Annotate settings whose rate covers a known material, in place.

    The conversion comes from the price-book row, so a coverage
    corrected on that screen moves this number too. Where a row carries
    no coverage rule the material is counted one-for-one (a pipe boot
    per penetration); where the units cannot be bridged the setting is
    left unannotated rather than given a misleading number.

    Only the material a rate is mostly made of is shown — the shingles
    behind a shingle rate, not the nails and caulk that also go into it.
    `material_cost` is therefore "what this rate's main material costs",
    not a full cost breakdown.
    """
    for entry in catalog:
        link = MATERIAL_LINKS.get(
            f"{entry['setting_group']}:{entry['setting_key']}")
        if not link:
            continue
        book_key, unit_override = link
        row = price_book.get(book_key)
        if not row:
            # Retired or renamed on the price book.
            continue

        rate_unit = unit_override or GROUP_RATE_UNITS.get(
            entry["setting_group"])
        if not rate_unit:
            continue

        unit_cost = float(row.get("unit_cost") or 0)
        coverage = row.get("coverage_per_unit")
        basis = row.get("qty_basis")

        if not coverage or not basis:
            # No packaging rule: one purchase unit per rate unit, which
            # is how the counted materials (boots, vents, sheets) work.
            if rate_unit != "EA":
                continue
            packs_per_rate_unit = 1.0
        else:
            measured = _measured_per_rate_unit(rate_unit, basis_unit(basis))
            if measured is None:
                continue
            # coverage is measured-per-pack, so packs per rate unit is
            # the rate unit's measure over what one pack covers.
            packs_per_rate_unit = measured / float(coverage)

        entry["material_cost"] = round(unit_cost * packs_per_rate_unit, 4)
        entry["material_label"] = row.get("label")
        entry["material_unit_cost"] = round(unit_cost, 4)
        entry["material_purchase_unit"] = row.get("unit")
        entry["material_key"] = book_key
        entry["material_per_rate_unit"] = round(packs_per_rate_unit, 6)
        entry["material_rate_unit"] = rate_unit


def setting_groups() -> List[Dict[str, Any]]:
    """Group metadata for the screen's section headers and ordering."""
    groups = [
        {
            "group": g["group"],
            "label": g["label"],
            "kind": g["kind"],
            "unit": g.get("unit"),
            "help": g.get("help"),
        }
        for g in GROUPS
    ]
    groups.append({
        "group": SCALAR_GROUP,
        "label": "Single Rates",
        "kind": "money",
        "unit": None,
        "help": "단일 값으로 쓰이는 단가들.",
    })
    return groups


def _humanize(key: str) -> str:
    """'architectural_std' -> 'Architectural Std'; '6/12' stays as is."""
    if "/" in key:
        return key
    return key.replace("_", " ").title()


def is_valid_setting(group: str, key: str) -> bool:
    """Whether this group/key names a setting that actually exists.

    Guards the write path: an unknown key would be stored and then
    silently ignored by every lookup, which looks like a save that did
    nothing.
    """
    return default_for(group, key) is not None


def validate_value(group: str, key: str, value: float) -> Optional[str]:
    """Reject values that would produce nonsense. None when acceptable.

    Deliberately permissive about *amounts* — a user may legitimately
    price well above or below the default — and strict only about ranges
    that break the arithmetic, like a negative rate or a portion above
    100%.
    """
    try:
        value = float(value)
    except (TypeError, ValueError):
        return "숫자여야 합니다"

    if value != value or value in (float("inf"), float("-inf")):
        return "숫자여야 합니다"
    if value < 0:
        return "0 이상이어야 합니다"

    spec = (
        SCALAR_SETTINGS.get(key) if group == SCALAR_GROUP
        else GROUPS_BY_NAME.get(group)
    )
    kind = (spec or {}).get("kind")

    if kind == "pct" and value > 1:
        return "0과 1 사이여야 합니다 (0.06 = 6%)"
    if kind == "rate" and value > 10:
        return "배수가 너무 큽니다 (10 이하)"
    return None


def load_settings(session, company_id=None) -> Dict[str, float]:
    """Stored overrides as {"group:key": value}, company over global.

    Both scopes are read in one query and the company row wins, so a
    company that has overridden three settings still inherits every
    global default for the rest.
    """
    rows = (
        session.query(RoofingPricingSetting)
        .filter(
            (RoofingPricingSetting.company_id == company_id)
            | (RoofingPricingSetting.company_id.is_(None))
        )
        .all()
    )

    globals_: Dict[str, float] = {}
    company: Dict[str, float] = {}
    for row in rows:
        key = f"{row.setting_group}:{row.setting_key}"
        if row.company_id is None:
            globals_[key] = float(row.value)
        else:
            company[key] = float(row.value)

    resolved = dict(globals_)
    resolved.update(company)
    return resolved


def setting_dict(row, spec_lookup=None) -> Dict[str, Any]:
    """One stored row as the API returns it."""
    default = default_for(row.setting_group, row.setting_key)
    if default is None:
        default = row.default_value
    return {
        "id": str(row.id),
        "setting_group": row.setting_group,
        "setting_key": row.setting_key,
        "value": float(row.value),
        "default_value": (
            float(default) if default is not None else None
        ),
        "notes": row.notes,
        "is_overridden": True,
        "company_id": str(row.company_id) if row.company_id else None,
    }
