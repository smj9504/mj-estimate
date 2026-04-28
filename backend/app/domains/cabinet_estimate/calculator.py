"""
Cabinet Estimate calculation engine.
Converts box-level measurements to LF-based estimates with multipliers.
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .pricing import (
    BASE_RATES,
    DEFAULT_OVERHEAD_PCT,
    DEFAULT_PROFIT_PCT,
    FINISH_MULTIPLIER,
    MATERIAL_MULTIPLIER,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    get_labor_multiplier,
)

logger = logging.getLogger(__name__)


@dataclass
class BoxInput:
    code: str
    cab_type: str       # base / wall / tall / specialty
    width_inches: int
    height_inches: float
    is_specialty: bool
    specialty_type: Optional[str]
    qty: int


@dataclass
class LineItem:
    description: str
    quantity: float
    unit: str           # LF, EA, SF, HR
    unit_price: float
    total: float
    category: str       # supply / labor / scope / premium
    notes: Optional[str] = None


@dataclass
class CalculationResult:
    line_items: List[LineItem]
    subtotal: float
    overhead_pct: float
    overhead_amount: float
    profit_pct: float
    profit_amount: float
    total: float
    methodology_notes: str
    warning_flags: List[str]
    base_lf: float
    wall_lf: float
    tall_count: int
    total_mult: float


def calculate_estimate(
    boxes: List[BoxInput],
    tier: str,
    box_material: str,
    finish: str,
    zip_code: str,
    include_demo: bool = True,
    include_install: bool = True,
    include_delivery: bool = True,
    include_plumbing: bool = False,
    include_countertop_reset: bool = False,
    include_hardware: bool = True,
    overhead_pct: float = DEFAULT_OVERHEAD_PCT,
    profit_pct: float = DEFAULT_PROFIT_PCT,
) -> CalculationResult:
    """
    Main calculation: Box inputs → LF-based estimate with line items.

    Algorithm:
    1. Aggregate boxes by type → calculate LF
    2. Apply tier rates × material × finish × labor multipliers
    3. Add specialty premiums
    4. Add scope items
    5. Calculate O&P
    """
    warnings: List[str] = []
    line_items: List[LineItem] = []

    # ── 1. Aggregate boxes by type ──
    base_boxes = [b for b in boxes if b.cab_type == "base"]
    wall_boxes = [b for b in boxes if b.cab_type == "wall"]
    tall_boxes = [b for b in boxes if b.cab_type == "tall"]

    base_lf = sum(b.width_inches * b.qty for b in base_boxes) / 12
    wall_lf = sum(b.width_inches * b.qty for b in wall_boxes) / 12
    tall_count = sum(b.qty for b in tall_boxes)
    total_lf = base_lf + wall_lf

    # ── 2. Get multipliers ──
    rates = BASE_RATES.get(tier)
    if not rates:
        raise ValueError(f"Unknown tier: {tier}")

    material_mult = MATERIAL_MULTIPLIER.get(box_material, 1.0)
    finish_mult = FINISH_MULTIPLIER.get(finish, 1.0)
    labor_mult = get_labor_multiplier(zip_code)
    total_mult = material_mult * finish_mult * labor_mult

    # ── 3. Cabinet supply line items ──
    if base_lf > 0:
        base_unit = round(rates["base_lf"] * total_mult, 2)
        base_total = round(base_lf * base_unit, 2)
        line_items.append(LineItem(
            description=f"Base Cabinets - {tier} ({box_material}, {finish})",
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=base_unit,
            total=base_total,
            category="supply",
        ))

    if wall_lf > 0:
        wall_unit = round(rates["wall_lf"] * total_mult, 2)
        wall_total = round(wall_lf * wall_unit, 2)
        line_items.append(LineItem(
            description=f"Wall Cabinets - {tier} ({box_material}, {finish})",
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=wall_unit,
            total=wall_total,
            category="supply",
        ))

    if tall_count > 0:
        tall_unit = round(rates["tall_each"] * total_mult, 2)
        tall_total = round(tall_count * tall_unit, 2)
        line_items.append(LineItem(
            description=f"Tall Cabinets - {tier} ({box_material}, {finish})",
            quantity=tall_count,
            unit="EA",
            unit_price=tall_unit,
            total=tall_total,
            category="supply",
        ))

    # ── 4. Specialty premiums ──
    specialty_boxes = [b for b in boxes if b.is_specialty and b.specialty_type]
    for box in specialty_boxes:
        premium = SPECIALTY_PREMIUM.get(box.specialty_type, 0)
        if premium > 0:
            item_total = round(premium * box.qty, 2)
            line_items.append(LineItem(
                description=f"Specialty Premium - {box.code} ({box.specialty_type.replace('_', ' ').title()})",
                quantity=box.qty,
                unit="EA",
                unit_price=premium,
                total=item_total,
                category="premium",
                notes=f"Additional cost for {box.specialty_type.replace('_', ' ')} cabinet",
            ))
            warnings.append(f"{box.specialty_type.replace('_', ' ').title()} premium applied: {box.code}")

    # ── 5. Scope items ──
    if include_demo and total_lf > 0:
        demo_cost = max(total_lf * SCOPE_ITEMS["demo_per_lf"], SCOPE_ITEMS["demo_min"])
        demo_cost = round(demo_cost, 2)
        line_items.append(LineItem(
            description="Cabinet Demolition & Removal",
            quantity=round(total_lf, 2),
            unit="LF",
            unit_price=SCOPE_ITEMS["demo_per_lf"],
            total=demo_cost,
            category="scope",
            notes=f"Minimum charge ${SCOPE_ITEMS['demo_min']}" if demo_cost == SCOPE_ITEMS["demo_min"] else None,
        ))

    if include_install:
        if base_lf > 0:
            install_base = round(base_lf * SCOPE_ITEMS["install_base_per_lf"], 2)
            line_items.append(LineItem(
                description="Base Cabinet Installation",
                quantity=round(base_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["install_base_per_lf"],
                total=install_base,
                category="scope",
            ))
        if wall_lf > 0:
            install_wall = round(wall_lf * SCOPE_ITEMS["install_wall_per_lf"], 2)
            line_items.append(LineItem(
                description="Wall Cabinet Installation",
                quantity=round(wall_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["install_wall_per_lf"],
                total=install_wall,
                category="scope",
            ))
        if tall_count > 0:
            install_tall = round(tall_count * SCOPE_ITEMS["install_tall_per_each"], 2)
            line_items.append(LineItem(
                description="Tall Cabinet Installation",
                quantity=tall_count,
                unit="EA",
                unit_price=SCOPE_ITEMS["install_tall_per_each"],
                total=install_tall,
                category="scope",
            ))

    if include_delivery:
        delivery_cost = round(
            max(
                SCOPE_ITEMS["delivery_base"] + total_lf * SCOPE_ITEMS["delivery_per_lf"],
                SCOPE_ITEMS["delivery_min"],
            ), 2
        )
        line_items.append(LineItem(
            description="Cabinet Delivery",
            quantity=1,
            unit="EA",
            unit_price=delivery_cost,
            total=delivery_cost,
            category="scope",
            notes=f"Base ${SCOPE_ITEMS['delivery_base']} + ${SCOPE_ITEMS['delivery_per_lf']}/LF",
        ))

    if include_plumbing:
        line_items.append(LineItem(
            description="Plumbing Disconnect",
            quantity=1,
            unit="EA",
            unit_price=SCOPE_ITEMS["plumbing_disconnect"],
            total=SCOPE_ITEMS["plumbing_disconnect"],
            category="scope",
        ))
        line_items.append(LineItem(
            description="Plumbing Reconnect (Sink, DW, Disposal)",
            quantity=1,
            unit="EA",
            unit_price=SCOPE_ITEMS["plumbing_reconnect"],
            total=SCOPE_ITEMS["plumbing_reconnect"],
            category="scope",
        ))

    if include_countertop_reset:
        line_items.append(LineItem(
            description="Countertop Reset",
            quantity=1,
            unit="EA",
            unit_price=SCOPE_ITEMS["countertop_reset"],
            total=SCOPE_ITEMS["countertop_reset"],
            category="scope",
        ))

    # Site protection & cleanup (scale with kitchen size)
    site_prot_cost = round(
        SCOPE_ITEMS["site_protection_base"] + total_lf * SCOPE_ITEMS["site_protection_per_lf"], 2
    )
    line_items.append(LineItem(
        description="Site Protection",
        quantity=round(total_lf, 2),
        unit="LF",
        unit_price=SCOPE_ITEMS["site_protection_per_lf"],
        total=site_prot_cost,
        category="scope",
        notes=f"Base ${SCOPE_ITEMS['site_protection_base']} + ${SCOPE_ITEMS['site_protection_per_lf']}/LF",
    ))

    cleanup_cost = round(
        SCOPE_ITEMS["cleanup_base"] + total_lf * SCOPE_ITEMS["cleanup_per_lf"], 2
    )
    line_items.append(LineItem(
        description="Final Cleanup",
        quantity=round(total_lf, 2),
        unit="LF",
        unit_price=SCOPE_ITEMS["cleanup_per_lf"],
        total=cleanup_cost,
        category="scope",
        notes=f"Base ${SCOPE_ITEMS['cleanup_base']} + ${SCOPE_ITEMS['cleanup_per_lf']}/LF",
    ))

    # ── 6. Cabinet hardware (knobs/pulls) ──
    if include_hardware:
        total_openings = sum(b.qty for b in boxes)
        if total_openings > 0:
            hw_supply_unit = SCOPE_ITEMS["hardware_per_opening"]
            hw_install_unit = SCOPE_ITEMS["hardware_install_per_opening"]

            hw_supply_total = round(total_openings * hw_supply_unit, 2)
            line_items.append(LineItem(
                description="Cabinet Hardware (Knobs/Pulls)",
                quantity=total_openings,
                unit="EA",
                unit_price=hw_supply_unit,
                total=hw_supply_total,
                category="supply",
                notes="Mid-grade brushed nickel",
            ))

            hw_install_total = round(total_openings * hw_install_unit, 2)
            line_items.append(LineItem(
                description="Hardware Installation",
                quantity=total_openings,
                unit="EA",
                unit_price=hw_install_unit,
                total=hw_install_total,
                category="scope",
            ))

    # ── 7. Calculate totals ──
    subtotal = round(sum(item.total for item in line_items), 2)
    overhead_amount = round(subtotal * overhead_pct, 2)
    profit_amount = round(subtotal * profit_pct, 2)
    total = round(subtotal + overhead_amount + profit_amount, 2)

    # ── 8. Methodology notes ──
    methodology = (
        f"Estimate based on {tier} tier cabinets.\n"
        f"Base: {base_lf:.1f} LF, Wall: {wall_lf:.1f} LF, Tall: {tall_count} EA\n"
        f"Multipliers: Material({box_material})={material_mult}, "
        f"Finish({finish})={finish_mult}, "
        f"Labor(ZIP {zip_code})={labor_mult}\n"
        f"Combined multiplier: {total_mult:.2f}\n"
        f"O&P: {overhead_pct*100:.0f}% / {profit_pct*100:.0f}%"
    )

    return CalculationResult(
        line_items=line_items,
        subtotal=subtotal,
        overhead_pct=overhead_pct,
        overhead_amount=overhead_amount,
        profit_pct=profit_pct,
        profit_amount=profit_amount,
        total=total,
        methodology_notes=methodology,
        warning_flags=warnings,
        base_lf=base_lf,
        wall_lf=wall_lf,
        tall_count=tall_count,
        total_mult=total_mult,
    )
