"""The measurements a material quantity can be derived from.

A material formula is "take this measurement, divide by what one package
covers, round up, never go below this minimum". This module owns the
first part: the named measurements available as a basis, so the same
vocabulary is used by the costing, the API, and the price-book screen.

Adding a basis here makes it selectable in the UI immediately; nothing
else needs to change.
"""

import math
from typing import Any, Dict, List

# key -> (label shown in the UI, unit of the measurement)
BASIS_DEFS: Dict[str, Dict[str, str]] = {
    "squares": {
        "label": "지붕 면적 (waste 포함)", "unit": "SQ",
    },
    "squares_no_waste": {
        "label": "지붕 면적 (waste 제외)", "unit": "SQ",
    },
    "total_sf": {
        "label": "지붕 면적", "unit": "SF",
    },
    "eave_lf": {
        "label": "처마 (eave)", "unit": "LF",
    },
    "rake_lf": {
        "label": "박공 (rake)", "unit": "LF",
    },
    "drip_edge_lf": {
        "label": "드립엣지 (eave + rake)", "unit": "LF",
    },
    "ridge_lf": {
        "label": "용마루 (ridge)", "unit": "LF",
    },
    "hip_lf": {
        "label": "귀마루 (hip)", "unit": "LF",
    },
    "ridge_hip_lf": {
        "label": "ridge + hip", "unit": "LF",
    },
    "valley_lf": {
        "label": "골 (valley)", "unit": "LF",
    },
    "eave_valley_lf": {
        "label": "eave + valley (ice & water)", "unit": "LF",
    },
    "flashing_lf": {
        "label": "스텝 플래싱", "unit": "LF",
    },
    "wall_flashing_lf": {
        # Counter / apron flashing where the roof meets a wall or
        # chimney. Measured separately from step flashing.
        "label": "벽지점 플래싱 (counter/apron)", "unit": "LF",
    },
    "penetrations": {
        "label": "관통부 개수", "unit": "EA",
    },
    "chimneys": {
        "label": "굴뚝 개수", "unit": "EA",
    },
    "skylights": {
        "label": "스카이라이트 개수", "unit": "EA",
    },
    "gutter_lf": {
        "label": "거터 길이", "unit": "LF",
    },
    "downspout_lf": {
        "label": "다운스파웃 길이", "unit": "LF",
    },
    "fixed": {
        "label": "고정 수량 (측정치 무관)", "unit": "EA",
    },
}

BASIS_KEYS = list(BASIS_DEFS.keys())

# Names a formula refers to. Aliases keep the spreadsheet wording that
# estimators already use ("roof area w/ waste") pointing at one value.
FORMULA_ALIASES = {
    "roof_area_waste": "squares",
    "roof_area": "squares_no_waste",
    "squares_with_waste": "squares",
    "sq": "squares",
    "valley": "valley_lf",
    "eave": "eave_lf",
    "rake": "rake_lf",
    "ridge": "ridge_lf",
    "hip": "hip_lf",
    "ridge_hip": "ridge_hip_lf",
    "eave_valley": "eave_valley_lf",
    "drip_edge": "drip_edge_lf",
    "step_flashing": "flashing_lf",
    "wall_flashing": "wall_flashing_lf",
    "flashing": "wall_flashing_lf",
    "gutter": "gutter_lf",
    "downspout": "downspout_lf",
    "penetration_count": "penetrations",
    "chimney_count": "chimneys",
    "skylight_count": "skylights",
}

# What the editor offers first. The `_lf` names stay valid — every
# formula already written keeps working — but the unit is shown beside
# the name in the picker, so repeating it in the name is just noise.
PREFERRED_NAMES = {
    "squares": "roof_area_waste",
    "squares_no_waste": "roof_area",
    "valley_lf": "valley",
    "eave_lf": "eave",
    "rake_lf": "rake",
    "ridge_lf": "ridge",
    "hip_lf": "hip",
    "ridge_hip_lf": "ridge_hip",
    "eave_valley_lf": "eave_valley",
    "drip_edge_lf": "drip_edge",
    "flashing_lf": "step_flashing",
    "wall_flashing_lf": "wall_flashing",
    "gutter_lf": "gutter",
    "downspout_lf": "downspout",
}


def formula_variables(basis_values: Dict[str, float]) -> Dict[str, float]:
    """Every name a formula may use, aliases included."""
    variables = dict(basis_values)
    for alias, target in FORMULA_ALIASES.items():
        if target in basis_values:
            variables[alias] = basis_values[target]
    return variables


def formula_variable_docs() -> List[Dict[str, Any]]:
    """Variable reference for the formula editor.

    `name` is the short form to write; every other spelling that resolves
    to the same measurement is listed under `aliases`, so an existing
    formula using `valley_lf` still type-checks against this list.
    """
    docs = []
    for key, spec in BASIS_DEFS.items():
        if key == "fixed":
            continue
        preferred = PREFERRED_NAMES.get(key, key)
        others = {key} | {
            a for a, t in FORMULA_ALIASES.items() if t == key
        }
        others.discard(preferred)
        docs.append({
            "name": preferred,
            "label": spec["label"],
            "unit": spec["unit"],
            "aliases": sorted(others),
        })
    return docs


def apply_formula(measured: float, per_pack: float,
                  minimum: float = 0) -> int:
    """Packages needed to cover `measured`, always rounding up.

    `per_pack` is how much of the basis ONE package covers, so it is
    divided into the measurement — 10 SQ/RL of felt, 48 LF/RL of ice
    barrier. A shingle bundle covers a third of a square, so its
    per_pack is 1/3 and 28.25 SQ becomes 85 BD.
    """
    if per_pack and per_pack > 0 and measured > 0:
        packs = int(math.ceil(round(measured / per_pack, 6)))
    else:
        packs = 0
    return max(packs, int(minimum or 0))


def basis_options() -> List[Dict[str, Any]]:
    """Basis list for the price-book screen's dropdown."""
    return [
        {"value": key, "label": spec["label"], "unit": spec["unit"]}
        for key, spec in BASIS_DEFS.items()
    ]


def basis_unit(basis: str) -> str:
    return BASIS_DEFS.get(basis, {}).get("unit", "")


def build_basis_values(m: Dict[str, Any], squares_with_waste: float,
                       flash: Dict[str, Any],
                       gutter: Dict[str, Any]) -> Dict[str, float]:
    """Resolve every basis against one roof's measurements."""
    return {
        "squares": squares_with_waste,
        "squares_no_waste": m.get("squares", 0),
        "total_sf": m.get("total_sf", 0),
        "eave_lf": m.get("eave_lf", 0),
        "rake_lf": m.get("rake_lf", 0),
        "drip_edge_lf": m.get("eave_lf", 0) + m.get("rake_lf", 0),
        "ridge_lf": m.get("ridge_lf", 0),
        "hip_lf": m.get("hip_lf", 0),
        "ridge_hip_lf": m.get("ridge_lf", 0) + m.get("hip_lf", 0),
        "valley_lf": m.get("valley_lf", 0),
        "eave_valley_lf": m.get("eave_lf", 0) + m.get("valley_lf", 0),
        "flashing_lf": flash.get(
            "step_flashing_lf", m.get("step_flashing_lf", 0)),
        # Wall/counter flashing is entered on the flashing spec; it
        # is not one of the measured roof lines.
        "wall_flashing_lf": flash.get("wall_flashing_lf", 0) or 0,
        "penetrations": m.get("penetration_count", 0),
        "chimneys": m.get("chimney_count", 0),
        "skylights": m.get("skylight_count", 0),
        "gutter_lf": gutter.get("total_lf", 0) or 0,
        "downspout_lf": gutter.get("downspout_lf", 0) or 0,
        # A fixed quantity ignores the roof: the formula is just the
        # minimum, so the basis contributes nothing.
        "fixed": 0,
    }
