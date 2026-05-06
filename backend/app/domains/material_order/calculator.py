"""
Material Order calculator.
Computes material quantities for Roofing and Siding based on EagleView measurements.
Formulas sourced from the Material Order feature spec.
"""

import math
import logging
from typing import Any, Dict, List

from .schemas import (
    MaterialCategory,
    MaterialItem,
    RoofingMeasurements,
    SidingMeasurements,
)

logger = logging.getLogger(__name__)

# ── Brand specs (LF/BD, SQ/RL, etc.) ──

BRAND_SPECS: Dict[str, Dict[str, Any]] = {
    "CertainTeed": {
        "roofing": {
            "shingle": {"bd_per_sq": 3},
            "starter": {"lf_per_bd": 116, "product": 'SwiftStart 7-5/8"'},
            "hip_ridge": {"lf_per_bd": 30, "product": "Shadow Ridge AR"},
            "ice_water": {"sq_per_rl": 2, "product": "WinterGuard Sand"},
            "felt": {"sq_per_rl": 10, "product": "RoofRunner"},
            "ridge_vent": {"lf_per_pc": 4, "product": "FilterVent III", "item": '4\' Ridge Vent 12" Filtered'},
        },
        "siding": {
            "panel": {"sqft_per_ctn": 200},
            "corner_post": {"lf_per_pc": 10},
            "j_channel": {"lf_per_pc": 12.5},
        },
    },
    "GAF": {
        "roofing": {
            "shingle": {"bd_per_sq": 3},
            "starter": {"lf_per_bd": 120, "product": "Pro-Start"},
            "hip_ridge": {"lf_per_bd": 25, "product": "Seal-A-Ridge"},
            "ice_water": {"sq_per_rl": 2, "product": "WeatherWatch"},
            "felt": {"sq_per_rl": 10, "product": "FeltBuster"},
            "ridge_vent": {"lf_per_pc": 4, "product": "Cobra Snow Country"},
        },
        "siding": {
            "panel": {"sqft_per_ctn": 200},
            "corner_post": {"lf_per_pc": 10},
            "j_channel": {"lf_per_pc": 12.5},
        },
    },
    "Owens Corning": {
        "roofing": {
            "shingle": {"bd_per_sq": 3},
            "starter": {"lf_per_bd": 105, "product": "Starter Strip"},
            "hip_ridge": {"lf_per_bd": 25, "product": "DecoRidge"},
            "ice_water": {"sq_per_rl": 2, "product": "WeatherLock G"},
            "felt": {"sq_per_rl": 10, "product": "ProArmor"},
            "ridge_vent": {"lf_per_pc": 4, "product": "VentSure"},
        },
        "siding": {
            "panel": {"sqft_per_ctn": 200},
            "corner_post": {"lf_per_pc": 10},
            "j_channel": {"lf_per_pc": 12.5},
        },
    },
}


def _get_brand_spec(brand: str, scope: str) -> Dict[str, Any]:
    """Get brand-specific specs, defaulting to CertainTeed."""
    specs = BRAND_SPECS.get(brand, BRAND_SPECS["CertainTeed"])
    return specs.get(scope, {})


def calculate_roofing(
    m: RoofingMeasurements, brand: str = "CertainTeed",
    product: str | None = None, color: str | None = None,
) -> List[MaterialItem]:
    """Calculate roofing material quantities."""
    spec = _get_brand_spec(brand, "roofing")
    items: List[MaterialItem] = []

    sq_w_waste = m.squares_with_waste if m.squares_with_waste > 0 else m.squares * (1 + m.waste_pct / 100)
    drip_edge_ft = m.drip_edge_lf if m.drip_edge_lf > 0 else m.eaves_lf + m.rakes_lf

    color_str = f" ({color})" if color else ""
    product_str = product or ""

    # Shingles
    bd_per_sq = spec.get("shingle", {}).get("bd_per_sq", 3)
    qty_shingles = math.ceil(sq_w_waste * bd_per_sq)
    items.append(MaterialItem(
        category=MaterialCategory.main,
        item=f"{brand} {product_str} Shingles{color_str}".strip(),
        qty=qty_shingles, unit="BD",
        formula=f"ROUNDUP({sq_w_waste:.1f} x {bd_per_sq})",
        note=f"{bd_per_sq} BD/SQ",
    ))

    # Starter Strip
    starter = spec.get("starter", {})
    lf_per_bd = starter.get("lf_per_bd", 116)
    starter_product = starter.get("product", "Starter Strip")
    qty_starter = math.ceil(m.eaves_lf / lf_per_bd)
    items.append(MaterialItem(
        category=MaterialCategory.main,
        item=f"{brand} {starter_product}",
        qty=qty_starter, unit="BD",
        formula=f"ROUNDUP({m.eaves_lf:.0f} / {lf_per_bd})",
        note=f"{lf_per_bd} LF/BD",
    ))

    # Hip & Ridge
    hr = spec.get("hip_ridge", {})
    hr_lf_per_bd = hr.get("lf_per_bd", 30)
    hr_product = hr.get("product", "Hip & Ridge")
    total_hr = m.ridges_lf + m.hips_lf
    qty_hr = math.ceil(total_hr / hr_lf_per_bd) if total_hr > 0 else 0
    if qty_hr > 0:
        items.append(MaterialItem(
            category=MaterialCategory.main,
            item=f"{brand} {hr_product}{color_str}",
            qty=qty_hr, unit="BD",
            formula=f"ROUNDUP(({m.ridges_lf:.0f}+{m.hips_lf:.0f}) / {hr_lf_per_bd})",
            note=f"{hr_lf_per_bd} LF/BD",
        ))

    # Ice & Water Shield
    iw = spec.get("ice_water", {})
    iw_sq_per_rl = iw.get("sq_per_rl", 2)
    iw_product = iw.get("product", "Ice & Water Shield")
    qty_iw = math.ceil(m.eaves_lf / 48)  # 48 LF/RL for 2 SQ coverage
    items.append(MaterialItem(
        category=MaterialCategory.underlayment,
        item=f"{brand} {iw_product}",
        qty=qty_iw, unit="RL",
        formula=f"ROUNDUP({m.eaves_lf:.0f} / 48)",
        note=f"{iw_sq_per_rl} SQ/RL",
    ))

    # Synthetic Felt
    felt = spec.get("felt", {})
    felt_sq_per_rl = felt.get("sq_per_rl", 10)
    felt_product = felt.get("product", "Synthetic Felt")
    qty_felt = math.ceil(sq_w_waste / felt_sq_per_rl)
    items.append(MaterialItem(
        category=MaterialCategory.underlayment,
        item=f"{brand} {felt_product}",
        qty=qty_felt, unit="RL",
        formula=f"ROUNDUP({sq_w_waste:.1f} / {felt_sq_per_rl})",
        note=f"{felt_sq_per_rl} SQ/RL",
    ))

    # Drip Edge
    qty_drip = math.ceil(drip_edge_ft / 10)
    items.append(MaterialItem(
        category=MaterialCategory.trim,
        item="Drip Edge",
        qty=qty_drip, unit="PC",
        formula=f"ROUNDUP({drip_edge_ft:.0f} / 10)",
        note="10 LF/PC",
    ))

    # Ridge Vent
    rv = spec.get("ridge_vent", {})
    rv_lf_per_pc = rv.get("lf_per_pc", 4)
    rv_product = rv.get("product", "Ridge Vent")
    if m.ridges_lf > 0:
        qty_rv = math.ceil(m.ridges_lf / rv_lf_per_pc)
        rv_item_name = rv.get("item") or f"{brand} {rv_product}"
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item=rv_item_name,
            qty=qty_rv, unit="PC",
            formula=f"ROUNDUP({m.ridges_lf:.0f} / {rv_lf_per_pc})",
            note=f"{rv_lf_per_pc} LF/PC",
        ))

    # Step Flashing
    if m.step_flashing_lf > 0:
        qty_sf = math.ceil(m.step_flashing_lf * 1.5 / 100)
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item='Step Flashing 3"x3"x8"',
            qty=max(1, qty_sf), unit="BX",
            formula=f"ROUNDUP({m.step_flashing_lf:.0f} x 1.5 / 100)",
            note="100 pcs/BX",
        ))

    # Pipe Flashing
    if m.penetration_count > 0:
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item='Pipe Flashing 1-3" Aluminum',
            qty=m.penetration_count, unit="EA",
            formula=f"Penetrations: {m.penetration_count}",
        ))

    # Trim Coil (counter flashing for wall/penetration areas)
    if m.flashing_lf >= 5:
        qty_coil_rl = math.ceil(m.flashing_lf / 50)
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item='Trim Coil 24"x50',
            qty=qty_coil_rl, unit="RL",
            formula=f"CEIL({m.flashing_lf:.0f} / 50)",
        ))

    # Snow Guards
    if m.include_snow_guards and m.eaves_lf > 0 and m.roof_pitch and m.rafter_length_lf:
        pitch = m.roof_pitch
        rafter = m.rafter_length_lf
        row_spacing = 15 if pitch <= 2 else 10 if pitch <= 4 else 8 if pitch <= 6 else 5
        num_rows = max(1, math.ceil(rafter / row_spacing))
        guards_per_row = math.ceil(m.eaves_lf)
        total_guards = guards_per_row * num_rows
        items.append(MaterialItem(
            category=MaterialCategory.misc,
            item="Snow Guard",
            qty=total_guards, unit="EA",
            formula=f"CEIL({m.eaves_lf:.0f} LF) x {num_rows} rows ({pitch}/12 pitch, {rafter:.0f}ft rafter)",
        ))

    # Coil Nails 1-1/4"
    qty_coil = math.ceil(sq_w_waste / 20)
    items.append(MaterialItem(
        category=MaterialCategory.fastener,
        item='Coil Nails 1-1/4"',
        qty=qty_coil, unit="BX",
        formula=f"ROUNDUP({sq_w_waste:.1f} / 20)",
        note="7,200 cnt/BX",
    ))

    # Nails 2-1/2"
    qty_nails = max(1, math.ceil(drip_edge_ft / 200))
    items.append(MaterialItem(
        category=MaterialCategory.fastener,
        item='Hand Nails 2-1/2"',
        qty=qty_nails, unit="BX",
        formula=f"MAX(1, ROUNDUP({drip_edge_ft:.0f} / 200))",
        note="5 lb/BX",
    ))

    # Staples
    qty_staples = math.ceil(sq_w_waste / 15)
    items.append(MaterialItem(
        category=MaterialCategory.fastener,
        item='Staples 5/16"',
        qty=qty_staples, unit="BX",
        formula=f"ROUNDUP({sq_w_waste:.1f} / 15)",
        note="5,000 cnt/BX",
    ))

    # Sealant
    qty_sealant = max(2, math.ceil(m.penetration_count / 3))
    items.append(MaterialItem(
        category=MaterialCategory.misc,
        item="Sealant (Geocel 2300 / Vulkem)",
        qty=qty_sealant, unit="TB",
        formula=f"MAX(2, ROUNDUP({m.penetration_count} / 3))",
        note="",
    ))

    # Touch-up Paint
    items.append(MaterialItem(
        category=MaterialCategory.misc,
        item=f"Touch-up Paint{color_str}",
        qty=1, unit="EA",
        formula="Fixed: 1",
        note="Color match",
    ))

    return items


def calculate_siding(
    m: SidingMeasurements, brand: str = "CertainTeed",
    product: str | None = None, color: str | None = None,
) -> List[MaterialItem]:
    """Calculate siding material quantities."""
    spec = _get_brand_spec(brand, "siding")
    items: List[MaterialItem] = []

    waste = 1 + m.waste_pct / 100
    color_str = f" ({color})" if color else ""
    product_str = product or "Vinyl Siding"
    sqft_per_ctn = spec.get("panel", {}).get("sqft_per_ctn", 200)
    lf_per_pc_corner = spec.get("corner_post", {}).get("lf_per_pc", 10)
    lf_per_pc_j = spec.get("j_channel", {}).get("lf_per_pc", 12.5)

    # Siding Panels
    qty_panels = math.ceil(m.net_siding_sqft * waste / sqft_per_ctn)
    items.append(MaterialItem(
        category=MaterialCategory.main,
        item=f"{brand} {product_str}{color_str}",
        qty=qty_panels, unit="CTN",
        formula=f"ROUNDUP({m.net_siding_sqft:.0f} x {waste:.2f} / {sqft_per_ctn})",
        note=f"{sqft_per_ctn} ft\u00b2/CTN, {m.waste_pct:.0f}% waste",
    ))

    # Starter Strip
    qty_starter = math.ceil(m.bottom_wall_lf * waste / lf_per_pc_j)
    items.append(MaterialItem(
        category=MaterialCategory.main,
        item="Starter Strip",
        qty=qty_starter, unit="PC",
        formula=f"ROUNDUP({m.bottom_wall_lf:.0f} x {waste:.2f} / {lf_per_pc_j})",
        note="EV: Bottom of Siding Walls",
    ))

    # J-Channel 3/4"
    j_total = (m.wd_perimeter_lf + m.fascia_lf) * waste
    qty_j = math.ceil(j_total / lf_per_pc_j)
    items.append(MaterialItem(
        category=MaterialCategory.trim,
        item='J-Channel 3/4"',
        qty=qty_j, unit="PC",
        formula=f"ROUNDUP(({m.wd_perimeter_lf:.0f}+{m.fascia_lf:.0f}) x {waste:.2f} / {lf_per_pc_j})",
        note="W&D perimeter + Eaves/Rakes",
    ))

    # Undersill Trim
    undersill_lf = (m.wd_perimeter_lf / 2 + m.top_wall_lf) * waste
    qty_undersill = math.ceil(undersill_lf / lf_per_pc_j)
    items.append(MaterialItem(
        category=MaterialCategory.trim,
        item="Undersill Trim",
        qty=qty_undersill, unit="PC",
        formula=f"ROUNDUP(({m.wd_perimeter_lf:.0f}/2+{m.top_wall_lf:.0f}) x {waste:.2f} / {lf_per_pc_j})",
        note="Window tops + eave line",
    ))

    # Outside Corner Post
    if m.outside_corner_lf > 0:
        qty_oc = math.ceil(m.outside_corner_lf / lf_per_pc_corner)
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item="Outside Corner Post",
            qty=qty_oc, unit="PC",
            formula=f"ROUNDUP({m.outside_corner_lf:.0f} / {lf_per_pc_corner})",
            note=f"{lf_per_pc_corner} LF/PC, siding faces only",
        ))

    # Inside Corner Post
    if m.inside_corner_lf > 0:
        qty_ic = math.ceil(m.inside_corner_lf / lf_per_pc_corner)
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item="Inside Corner Post",
            qty=qty_ic, unit="PC",
            formula=f"ROUNDUP({m.inside_corner_lf:.0f} / {lf_per_pc_corner})",
            note="EV Corner Totals",
        ))

    # House Wrap
    hw_sqft = (m.net_siding_sqft + m.wd_area_sqft) * waste
    qty_hw = math.ceil(hw_sqft / 1350)
    items.append(MaterialItem(
        category=MaterialCategory.underlayment,
        item="Tyvek House Wrap 9'x150'",
        qty=qty_hw, unit="RL",
        formula=f"ROUNDUP(({m.net_siding_sqft:.0f}+{m.wd_area_sqft:.0f}) x {waste:.2f} / 1350)",
        note="1,350 ft\u00b2/RL",
    ))

    # Flashing Tape
    corner_total = m.outside_corner_lf + m.inside_corner_lf
    flash_lf = corner_total * 2 + m.wd_perimeter_lf
    qty_flash = math.ceil(flash_lf / 75)
    items.append(MaterialItem(
        category=MaterialCategory.trim,
        item="Flashing Tape 6\"x75' (Butyl)",
        qty=qty_flash, unit="RL",
        formula=f"ROUNDUP((({m.outside_corner_lf:.0f}+{m.inside_corner_lf:.0f})x2+{m.wd_perimeter_lf:.0f}) / 75)",
        note="Butyl, masonry joints",
    ))

    # Trim Coil
    trim_coil_lf = (corner_total * 20 / 12)
    qty_trim_coil = math.ceil(trim_coil_lf / 50) if trim_coil_lf > 0 else 0
    if qty_trim_coil > 0:
        items.append(MaterialItem(
            category=MaterialCategory.trim,
            item='Trim Coil Aluminum 24"',
            qty=qty_trim_coil, unit="RL",
            formula=f"ROUNDUP(({corner_total:.0f} x 20/12) / 50)",
            note="50 LF/RL",
        ))

    # HW Seam Tape
    if qty_hw > 0:
        qty_seam = math.ceil(qty_hw / 1.5)
        items.append(MaterialItem(
            category=MaterialCategory.misc,
            item="House Wrap Seam Tape",
            qty=qty_seam, unit="RL",
            formula=f"ROUNDUP({qty_hw} / 1.5)",
            note="Per HW roll count",
        ))

    # Nails 2-1/2"
    qty_nails = max(4, math.ceil(m.net_siding_sqft / 800))
    items.append(MaterialItem(
        category=MaterialCategory.fastener,
        item='Nails 2-1/2"',
        qty=qty_nails, unit="BX",
        formula=f"MAX(4, ROUNDUP({m.net_siding_sqft:.0f} / 800))",
        note="5 lb/BX",
    ))

    # Sealant / Caulk
    qty_sealant = max(8, math.ceil(m.wd_count / 3))
    items.append(MaterialItem(
        category=MaterialCategory.misc,
        item="Sealant / Caulk",
        qty=qty_sealant, unit="TB",
        formula=f"MAX(8, ROUNDUP({m.wd_count} / 3))",
        note="Masonry joints emphasis",
    ))

    return items
