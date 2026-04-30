"""
Cabinet Estimate calculation engine.
Converts box-level measurements to LF-based estimates with multipliers.
"""

import logging
from dataclasses import dataclass
from typing import List, Optional

from .pricing import (
    BACKSPLASH_TYPES,
    BASE_RATES,
    COUNTERTOP_MATERIALS,
    CROWN_MOLDING_PRICING,
    DEFAULT_OVERHEAD_PCT,
    DEFAULT_PROFIT_PCT,
    GLASS_DOOR_PREMIUM,
    ISLAND_PANEL_PRICING,
    SCOPE_ITEMS,
    SPECIALTY_PREMIUM,
    TALL_CABINET_TYPES,
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
    has_glass_door: bool
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
    zip_code: str,
    include_demo: bool = True,
    include_install: bool = True,
    include_delivery: bool = True,
    include_plumbing: bool = False,
    include_countertop_reset: bool = False,
    include_hardware: bool = True,
    include_crown_molding: bool = False,
    include_backsplash: bool = False,
    backsplash_type: Optional[str] = None,
    backsplash_sqft: Optional[float] = None,
    include_toe_kick: bool = True,
    include_countertop: bool = False,
    countertop_material: Optional[str] = None,
    countertop_sqft: Optional[float] = None,
    include_drywall_repair: bool = False,
    drywall_repair_sqft: Optional[float] = None,
    include_painting: bool = False,
    painting_sqft: Optional[float] = None,
    include_appliance_rr: bool = False,
    include_dumpster: bool = True,
    island_end_panel_sqft: float = 0,
    island_back_panel_sqft: float = 0,
    overhead_pct: float = DEFAULT_OVERHEAD_PCT,
    profit_pct: float = DEFAULT_PROFIT_PCT,
) -> CalculationResult:
    """
    Main calculation: Box inputs → LF-based estimate with line items.

    Algorithm:
    1. Aggregate boxes by type → calculate LF
    2. Apply tier rates × labor multipliers
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

    labor_mult = get_labor_multiplier(zip_code)
    total_mult = labor_mult

    # ── 3. Cabinet supply line items ──
    if base_lf > 0:
        base_unit = round(rates["base_lf"] * total_mult, 2)
        base_total = round(base_lf * base_unit, 2)
        line_items.append(LineItem(
            description=f"Base Cabinets - {tier}",
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
            description=f"Wall Cabinets - {tier}",
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=wall_unit,
            total=wall_total,
            category="supply",
        ))

    # Tall cabinets: split by type-specific pricing
    generic_tall = [b for b in tall_boxes
                    if not b.specialty_type
                    or b.specialty_type not in TALL_CABINET_TYPES]
    typed_tall = [b for b in tall_boxes
                  if b.specialty_type
                  and b.specialty_type in TALL_CABINET_TYPES]

    generic_tall_count = sum(b.qty for b in generic_tall)
    if generic_tall_count > 0:
        tall_unit = round(rates["tall_each"] * total_mult, 2)
        tall_total = round(generic_tall_count * tall_unit, 2)
        line_items.append(LineItem(
            description=f"Tall Cabinets - {tier}",
            quantity=generic_tall_count,
            unit="EA",
            unit_price=tall_unit,
            total=tall_total,
            category="supply",
        ))

    for box in typed_tall:
        type_prices = TALL_CABINET_TYPES[box.specialty_type]
        type_unit = round(
            type_prices.get(tier, rates["tall_each"]) * total_mult,
            2,
        )
        type_total = round(box.qty * type_unit, 2)
        type_label = box.specialty_type.replace("_", " ").title()
        line_items.append(LineItem(
            description=f"{type_label} - {tier}",
            quantity=box.qty,
            unit="EA",
            unit_price=type_unit,
            total=type_total,
            category="supply",
            notes=f"{box.code} — {type_label}",
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
    # Estimate openings per box by width:
    #   base ≤21" → 1 door+1 drawer=2, base >21" → 2 doors+1 drawer=3
    #   drawer_base → width/6 drawers (e.g. 24"=4, 30"=5)
    #   wall ≤21" → 1 door, wall >21" → 2 doors
    #   tall → 2~4 doors depending on height
    if include_hardware:
        total_openings = 0
        for b in boxes:
            if b.specialty_type == "drawer_base":
                openings = max(3, b.width_inches // 6)
            elif b.cab_type == "base":
                openings = 2 if b.width_inches <= 21 else 3
            elif b.cab_type == "wall":
                openings = 1 if b.width_inches <= 21 else 2
            elif b.cab_type == "tall":
                openings = 3 if b.height_inches <= 84 else 4
            else:
                openings = 2
            total_openings += openings * b.qty
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

    # ── 7. Glass door premiums ──
    glass_boxes = [b for b in boxes if b.has_glass_door]
    if glass_boxes:
        glass_premium = GLASS_DOOR_PREMIUM.get(tier, 100)
        for box in glass_boxes:
            glass_total = round(glass_premium * box.qty, 2)
            line_items.append(LineItem(
                description=(
                    f"Glass Door Upgrade - {box.code}"
                ),
                quantity=box.qty,
                unit="EA",
                unit_price=glass_premium,
                total=glass_total,
                category="premium",
                notes=f"{tier} tier glass door insert",
            ))
        warnings.append(
            f"Glass door upgrade applied to "
            f"{sum(b.qty for b in glass_boxes)} door(s)"
        )

    # ── 8. Crown molding ──
    if include_crown_molding and wall_lf > 0:
        molding_mat = CROWN_MOLDING_PRICING.get(tier, 15)
        molding_inst = CROWN_MOLDING_PRICING["install_per_lf"]
        molding_mat_total = round(wall_lf * molding_mat, 2)
        molding_inst_total = round(wall_lf * molding_inst, 2)
        line_items.append(LineItem(
            description=(
                f"Crown Molding - {tier} (Material)"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_mat,
            total=molding_mat_total,
            category="supply",
        ))
        line_items.append(LineItem(
            description="Crown Molding Installation",
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_inst,
            total=molding_inst_total,
            category="scope",
        ))

    # ── 9. Island panels (SF-based) ──
    if island_end_panel_sqft > 0:
        ep_mat = ISLAND_PANEL_PRICING[
            "end_panel_per_sf"
        ].get(tier, 20)
        ep_inst = ISLAND_PANEL_PRICING["install_per_sf"]
        ep_sqft = round(island_end_panel_sqft, 2)
        ep_mat_total = round(ep_sqft * ep_mat, 2)
        ep_inst_total = round(ep_sqft * ep_inst, 2)
        line_items.append(LineItem(
            description=(
                f"Island End Panel - {tier} (Material)"
            ),
            quantity=ep_sqft,
            unit="SF",
            unit_price=ep_mat,
            total=ep_mat_total,
            category="supply",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description="Island End Panel Installation",
            quantity=ep_sqft,
            unit="SF",
            unit_price=ep_inst,
            total=ep_inst_total,
            category="scope",
        ))

    if island_back_panel_sqft > 0:
        bp_mat = ISLAND_PANEL_PRICING[
            "back_panel_per_sf"
        ].get(tier, 16)
        bp_inst = ISLAND_PANEL_PRICING["install_per_sf"]
        bp_sqft = round(island_back_panel_sqft, 2)
        bp_mat_total = round(bp_sqft * bp_mat, 2)
        bp_inst_total = round(bp_sqft * bp_inst, 2)
        line_items.append(LineItem(
            description=(
                f"Island Back Panel - {tier} (Material)"
            ),
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_mat,
            total=bp_mat_total,
            category="supply",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description="Island Back Panel Installation",
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_inst,
            total=bp_inst_total,
            category="scope",
        ))

    # ── 10. Backsplash ──
    if include_backsplash and backsplash_type and backsplash_sqft:
        bs_info = BACKSPLASH_TYPES.get(backsplash_type)
        if bs_info:
            bs_mat_unit = bs_info["material_per_sf"]
            bs_inst_unit = bs_info["install_per_sf"]
            bs_sqft = round(backsplash_sqft, 2)
            bs_mat_total = round(bs_sqft * bs_mat_unit, 2)
            bs_inst_total = round(bs_sqft * bs_inst_unit, 2)
            line_items.append(LineItem(
                description=(
                    f"Backsplash - {bs_info['label']} "
                    f"(Material)"
                ),
                quantity=bs_sqft,
                unit="SF",
                unit_price=bs_mat_unit,
                total=bs_mat_total,
                category="supply",
            ))
            line_items.append(LineItem(
                description=(
                    f"Backsplash - {bs_info['label']} "
                    f"(Installation)"
                ),
                quantity=bs_sqft,
                unit="SF",
                unit_price=bs_inst_unit,
                total=bs_inst_total,
                category="scope",
            ))

    # ── 11. Backsplash misc materials ──
    if include_backsplash and backsplash_type:
        misc_cost = SCOPE_ITEMS["backsplash_misc_materials"]
        line_items.append(LineItem(
            description="Backsplash Miscellaneous Materials",
            quantity=1,
            unit="SET",
            unit_price=misc_cost,
            total=misc_cost,
            category="supply",
            notes=(
                "Brushes, painter's tape, "
                "sandpaper, grout, etc."
            ),
        ))

    # ── 12. Toe kick ──
    if include_toe_kick and base_lf > 0:
        tk_unit = SCOPE_ITEMS["toe_kick_per_lf"]
        tk_total = round(base_lf * tk_unit, 2)
        line_items.append(LineItem(
            description="Install Matching Toe Kick",
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=tk_unit,
            total=tk_total,
            category="scope",
        ))

    # ── 13. Countertop (supply + install) ──
    if include_countertop and countertop_sqft:
        ct_mat = countertop_material or "Laminate"
        ct_info = COUNTERTOP_MATERIALS.get(
            ct_mat, {"rate": 35, "label": ct_mat}
        )
        ct_rate = ct_info["rate"]
        ct_label = ct_info["label"]
        ct_sqft = round(countertop_sqft, 2)
        ct_total = round(ct_sqft * ct_rate, 2)
        line_items.append(LineItem(
            description=(
                f"Countertop - {ct_label} "
                f"(supply + install)"
            ),
            quantity=ct_sqft,
            unit="SF",
            unit_price=ct_rate,
            total=ct_total,
            category="supply",
        ))

    # ── 14. Drywall repair (R&R behind cabinets) ──
    if include_drywall_repair and drywall_repair_sqft:
        dw_sqft = round(drywall_repair_sqft, 2)
        dw_rate = SCOPE_ITEMS["drywall_rr_per_sf"]
        dw_total = round(dw_sqft * dw_rate, 2)
        line_items.append(LineItem(
            description="R&R Sheetrock (behind cabinets)",
            quantity=dw_sqft,
            unit="SF",
            unit_price=dw_rate,
            total=dw_total,
            category="scope",
        ))

    # ── 15. Painting (prep + prime & paint) ──
    if include_painting and painting_sqft:
        p_sqft = round(painting_sqft, 2)
        prep_rate = SCOPE_ITEMS["paint_prep_per_sf"]
        paint_rate = SCOPE_ITEMS[
            "paint_primer_paint_per_sf"
        ]
        prep_total = round(p_sqft * prep_rate, 2)
        paint_total = round(p_sqft * paint_rate, 2)
        line_items.append(LineItem(
            description=(
                "Prep for Painting: "
                "Compound, Sanding"
            ),
            quantity=p_sqft,
            unit="SF",
            unit_price=prep_rate,
            total=prep_total,
            category="scope",
        ))
        line_items.append(LineItem(
            description="Primer & Paint; Color Match",
            quantity=p_sqft,
            unit="SF",
            unit_price=paint_rate,
            total=paint_total,
            category="scope",
        ))

    # ── 16. Appliance R&R ──
    if include_appliance_rr:
        app_cost = SCOPE_ITEMS["appliance_rr"]
        line_items.append(LineItem(
            description=(
                "R&R Appliances (Cooktop, DW, "
                "Disposal, Oven, Fridge)"
            ),
            quantity=1,
            unit="SET",
            unit_price=app_cost,
            total=app_cost,
            category="scope",
        ))

    # ── 17. Dumpster / trash disposal ──
    # Auto-size based on demo volume estimate
    # Base: 2'D x 2.875'H = 5.75 cu ft/LF
    # Wall: 1'D x 2.5'H   = 2.5  cu ft/LF
    # Tall: 2'D x 7'H x 2'W avg = 28 cu ft/EA
    # Countertop: ~0.15 cu ft/SF
    # Packing factor: 1.3x (loose fill)
    if include_dumpster:
        demo_cuft = (
            base_lf * 5.75
            + wall_lf * 2.5
            + tall_count * 28
        )
        if include_countertop and countertop_sqft:
            demo_cuft += countertop_sqft * 0.15
        if include_backsplash and backsplash_sqft:
            demo_cuft += backsplash_sqft * 0.3
        demo_cuyd = (demo_cuft * 1.3) / 27  # to yards

        if demo_cuyd <= 5:
            dump_size, dump_key = 10, "dumpster_10yard"
        elif demo_cuyd <= 8:
            dump_size, dump_key = 15, "dumpster_15yard"
        elif demo_cuyd <= 12:
            dump_size, dump_key = 20, "dumpster_20yard"
        else:
            dump_size, dump_key = 30, "dumpster_30yard"

        dump_cost = SCOPE_ITEMS[dump_key]
        line_items.append(LineItem(
            description=(
                f"Trash Disposal with "
                f"{dump_size} Yard Dumpster"
            ),
            quantity=1,
            unit="EA",
            unit_price=dump_cost,
            total=dump_cost,
            category="scope",
            notes=(
                f"Est. {demo_cuyd:.1f} cu yd demo volume"
            ),
        ))

    # ── 18. Calculate totals ──
    subtotal = round(sum(item.total for item in line_items), 2)
    overhead_amount = round(subtotal * overhead_pct, 2)
    profit_amount = round(subtotal * profit_pct, 2)
    total = round(subtotal + overhead_amount + profit_amount, 2)

    # ── 12. Methodology notes ──
    methodology_lines = [
        f"Estimate based on {tier} tier cabinets.",
        (
            f"Base: {base_lf:.1f} LF, "
            f"Wall: {wall_lf:.1f} LF, "
            f"Tall: {tall_count} EA"
        ),
        (
            f"Multipliers: "
            f"Labor(ZIP {zip_code})={labor_mult}"
        ),
        f"Combined multiplier: {total_mult:.2f}",
        (
            f"O&P: {overhead_pct*100:.0f}% / "
            f"{profit_pct*100:.0f}%"
        ),
    ]
    if glass_boxes:
        methodology_lines.append(
            f"Glass doors: "
            f"{sum(b.qty for b in glass_boxes)} door(s)"
        )
    if include_crown_molding:
        methodology_lines.append(
            f"Crown molding: {wall_lf:.1f} LF"
        )
    if island_end_panel_sqft or island_back_panel_sqft:
        methodology_lines.append(
            f"Island panels: end {island_end_panel_sqft} SF, "
            f"back {island_back_panel_sqft} SF"
        )
    if include_backsplash and backsplash_type:
        methodology_lines.append(
            f"Backsplash: {backsplash_type} "
            f"({backsplash_sqft or 0} SF)"
        )
    methodology = "\n".join(methodology_lines)

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
