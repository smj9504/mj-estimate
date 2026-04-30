"""
Cabinet Estimate calculation engine.
Converts box-level measurements to LF-based estimates with multipliers.
Supports perimeter vs island location separation.
"""

import logging
from dataclasses import dataclass
from typing import List, Optional

from .pricing import (
    APPLIANCE_RR_PRICING,
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
    location: str       # perimeter / island
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
    location: str = "perimeter"  # perimeter / island / shared
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


def _calc_location_cabinets(
    boxes: List[BoxInput],
    loc: str,
    tier: str,
    rates: dict,
    total_mult: float,
    include_install: bool,
    include_hardware: bool,
    include_crown_molding: bool,
    include_toe_kick: bool,
    warnings: List[str],
) -> tuple[List[LineItem], float, float, int]:
    """Calculate cabinet supply/install items for a location."""
    line_items: List[LineItem] = []
    loc_label = "Island" if loc == "island" else ""
    prefix = f"{loc_label} " if loc_label else ""

    base_boxes = [b for b in boxes if b.cab_type == "base"]
    wall_boxes = [b for b in boxes if b.cab_type == "wall"]
    tall_boxes = [b for b in boxes if b.cab_type == "tall"]

    base_lf = sum(
        b.width_inches * b.qty for b in base_boxes
    ) / 12
    wall_lf = sum(
        b.width_inches * b.qty for b in wall_boxes
    ) / 12
    tall_count = sum(b.qty for b in tall_boxes)

    # ── Cabinet supply ──
    if base_lf > 0:
        base_unit = round(rates["base_lf"] * total_mult, 2)
        base_total = round(base_lf * base_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Base Cabinets - {tier}"
            ),
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=base_unit,
            total=base_total,
            category="supply",
            location=loc,
        ))

    if wall_lf > 0:
        wall_unit = round(rates["wall_lf"] * total_mult, 2)
        wall_total = round(wall_lf * wall_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Wall Cabinets - {tier}"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=wall_unit,
            total=wall_total,
            category="supply",
            location=loc,
        ))

    # Tall cabinets: split by type
    generic_tall = [
        b for b in tall_boxes
        if not b.specialty_type
        or b.specialty_type not in TALL_CABINET_TYPES
    ]
    typed_tall = [
        b for b in tall_boxes
        if b.specialty_type
        and b.specialty_type in TALL_CABINET_TYPES
    ]

    generic_tall_count = sum(b.qty for b in generic_tall)
    if generic_tall_count > 0:
        tall_unit = round(
            rates["tall_each"] * total_mult, 2,
        )
        tall_total = round(
            generic_tall_count * tall_unit, 2,
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}Tall Cabinets - {tier}"
            ),
            quantity=generic_tall_count,
            unit="EA",
            unit_price=tall_unit,
            total=tall_total,
            category="supply",
            location=loc,
        ))

    for box in typed_tall:
        type_prices = TALL_CABINET_TYPES[
            box.specialty_type
        ]
        type_unit = round(
            type_prices.get(tier, rates["tall_each"])
            * total_mult, 2,
        )
        type_total = round(box.qty * type_unit, 2)
        type_label = (
            box.specialty_type.replace("_", " ").title()
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}{type_label} - {tier}"
            ),
            quantity=box.qty,
            unit="EA",
            unit_price=type_unit,
            total=type_total,
            category="supply",
            location=loc,
            notes=f"{box.code} — {type_label}",
        ))

    # ── Specialty premiums ──
    specialty_boxes = [
        b for b in boxes
        if b.is_specialty and b.specialty_type
    ]
    for box in specialty_boxes:
        premium = SPECIALTY_PREMIUM.get(
            box.specialty_type, 0,
        )
        if premium > 0:
            item_total = round(premium * box.qty, 2)
            sp_type = box.specialty_type.replace(
                "_", " ",
            )
            line_items.append(LineItem(
                description=(
                    f"Specialty Premium - {box.code} "
                    f"({sp_type.title()})"
                ),
                quantity=box.qty,
                unit="EA",
                unit_price=premium,
                total=item_total,
                category="premium",
                location=loc,
                notes=(
                    f"Additional cost for {sp_type} "
                    f"cabinet"
                ),
            ))
            warnings.append(
                f"{sp_type.title()} premium applied: "
                f"{box.code}"
            )

    # ── Glass door premiums ──
    glass_boxes = [b for b in boxes if b.has_glass_door]
    if glass_boxes:
        glass_premium = GLASS_DOOR_PREMIUM.get(tier, 100)
        for box in glass_boxes:
            glass_total = round(
                glass_premium * box.qty, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"Glass Door - {box.code}"
                ),
                quantity=box.qty,
                unit="EA",
                unit_price=glass_premium,
                total=glass_total,
                category="premium",
                location=loc,
                notes=f"{tier} tier glass door insert",
            ))
        warnings.append(
            f"Glass door upgrade applied to "
            f"{sum(b.qty for b in glass_boxes)} door(s)"
            + (f" ({loc_label})" if loc_label else "")
        )

    # ── Installation ──
    if include_install:
        if base_lf > 0:
            install_base = round(
                base_lf
                * SCOPE_ITEMS["install_base_per_lf"], 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Base Cabinet Installation"
                ),
                quantity=round(base_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS[
                    "install_base_per_lf"
                ],
                total=install_base,
                category="install",
                location=loc,
            ))
        if wall_lf > 0:
            install_wall = round(
                wall_lf
                * SCOPE_ITEMS["install_wall_per_lf"], 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Wall Cabinet Installation"
                ),
                quantity=round(wall_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS[
                    "install_wall_per_lf"
                ],
                total=install_wall,
                category="install",
                location=loc,
            ))
        if tall_count > 0:
            install_tall = round(
                tall_count
                * SCOPE_ITEMS["install_tall_per_each"],
                2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Tall Cabinet Installation"
                ),
                quantity=tall_count,
                unit="EA",
                unit_price=SCOPE_ITEMS[
                    "install_tall_per_each"
                ],
                total=install_tall,
                category="install",
                location=loc,
            ))

    # ── Hardware ──
    # Each opening (door/drawer front) gets 1 pull
    if include_hardware:
        total_openings = 0
        for b in boxes:
            if b.specialty_type == "drawer_base":
                # Drawer banks: ~1 per 6", typically 3-5
                openings = max(3, b.width_inches // 6)
            elif b.specialty_type == "lazy_susan":
                openings = 1  # single door or bi-fold
            elif b.specialty_type == "blind_corner":
                openings = 1  # single door
            elif b.specialty_type == "sink_base":
                # False front + door(s)
                openings = (
                    2 if b.width_inches <= 30 else 3
                )
            elif b.cab_type == "base":
                # Single door ≤21", double door >21"
                # +1 drawer for standard base
                openings = (
                    1 if b.width_inches <= 21 else 2
                )
            elif b.cab_type == "wall":
                openings = (
                    1 if b.width_inches <= 21 else 2
                )
            elif b.cab_type == "tall":
                # Pantry: typically 2 doors (upper+lower)
                # Oven/fridge cabinet: 1-2 doors
                if b.specialty_type in (
                    "oven_cabinet",
                    "refrigerator_cabinet",
                ):
                    openings = 1
                else:
                    openings = 2
            else:
                openings = 1
            total_openings += openings * b.qty
        if total_openings > 0:
            hw_supply_unit = SCOPE_ITEMS[
                "hardware_per_opening"
            ]
            hw_install_unit = SCOPE_ITEMS[
                "hardware_install_per_opening"
            ]
            hw_supply_total = round(
                total_openings * hw_supply_unit, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Cabinet Hardware "
                    f"(Knobs/Pulls)"
                ),
                quantity=total_openings,
                unit="EA",
                unit_price=hw_supply_unit,
                total=hw_supply_total,
                category="supply",
                location=loc,
                notes="Mid-grade brushed nickel",
            ))
            hw_install_total = round(
                total_openings * hw_install_unit, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Hardware Installation"
                ),
                quantity=total_openings,
                unit="EA",
                unit_price=hw_install_unit,
                total=hw_install_total,
                category="install",
                location=loc,
            ))

    # ── Crown molding (perimeter only) ──
    if include_crown_molding and wall_lf > 0:
        molding_mat = CROWN_MOLDING_PRICING.get(
            tier, 15,
        )
        molding_inst = CROWN_MOLDING_PRICING[
            "install_per_lf"
        ]
        molding_mat_total = round(
            wall_lf * molding_mat, 2,
        )
        molding_inst_total = round(
            wall_lf * molding_inst, 2,
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}Crown Molding - {tier} "
                f"(Material)"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_mat,
            total=molding_mat_total,
            category="supply",
            location=loc,
        ))
        line_items.append(LineItem(
            description=(
                f"{prefix}Crown Molding Installation"
            ),
            quantity=round(wall_lf, 2),
            unit="LF",
            unit_price=molding_inst,
            total=molding_inst_total,
            category="install",
            location=loc,
        ))

    # ── Toe kick ──
    if include_toe_kick and base_lf > 0:
        tk_unit = SCOPE_ITEMS["toe_kick_per_lf"]
        tk_total = round(base_lf * tk_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Install Matching Toe Kick"
            ),
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=tk_unit,
            total=tk_total,
            category="install",
            location=loc,
        ))

    return line_items, base_lf, wall_lf, tall_count


def calculate_estimate(
    boxes: List[BoxInput],
    tier: str,
    zip_code: str,
    include_demo: bool = True,
    include_install: bool = True,
    include_delivery: bool = True,
    include_plumbing: bool = False,
    sink_type: Optional[str] = "single",
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
    island_countertop_material: Optional[str] = None,
    island_countertop_sqft: Optional[float] = None,
    include_drywall_repair: bool = False,
    drywall_repair_sqft: Optional[float] = None,
    include_painting: bool = False,
    painting_sqft: Optional[float] = None,
    include_appliance_rr: bool = False,
    appliance_list: Optional[List[dict]] = None,
    include_dumpster: bool = True,
    delivery_floor: int = 1,
    island_end_panel_sqft: float = 0,
    island_back_panel_sqft: float = 0,
    overhead_pct: float = DEFAULT_OVERHEAD_PCT,
    profit_pct: float = DEFAULT_PROFIT_PCT,
) -> CalculationResult:
    """
    Main calculation: Box inputs -> LF-based estimate.

    Algorithm:
    1. Split boxes by location (perimeter / island)
    2. Calculate each location independently
    3. Add shared scope items (demo, delivery, etc.)
    4. Calculate O&P
    """
    warnings: List[str] = []
    line_items: List[LineItem] = []

    # ── 1. Get rates & multipliers ──
    rates = BASE_RATES.get(tier)
    if not rates:
        raise ValueError(f"Unknown tier: {tier}")

    labor_mult = get_labor_multiplier(zip_code)
    total_mult = labor_mult

    # ── 2. Split by location ──
    perimeter_boxes = [
        b for b in boxes if b.location != "island"
    ]
    island_boxes = [
        b for b in boxes if b.location == "island"
    ]

    # ── 3. Calculate perimeter cabinets ──
    p_items, p_base_lf, p_wall_lf, p_tall = (
        _calc_location_cabinets(
            perimeter_boxes, "perimeter", tier, rates,
            total_mult, include_install,
            include_hardware, include_crown_molding,
            include_toe_kick, warnings,
        )
    )
    line_items.extend(p_items)

    # ── 4. Calculate island cabinets ──
    i_base_lf = i_wall_lf = 0.0
    i_tall = 0
    if island_boxes:
        i_items, i_base_lf, i_wall_lf, i_tall = (
            _calc_location_cabinets(
                island_boxes, "island", tier, rates,
                total_mult, include_install,
                include_hardware,
                False,  # no crown molding on island
                include_toe_kick, warnings,
            )
        )
        line_items.extend(i_items)

    # Totals across locations
    base_lf = p_base_lf + i_base_lf
    wall_lf = p_wall_lf + i_wall_lf
    tall_count = p_tall + i_tall
    total_lf = base_lf + wall_lf

    # ── 5. Island panels (SF-based) ──
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
            location="island",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description="Island End Panel Installation",
            quantity=ep_sqft,
            unit="SF",
            unit_price=ep_inst,
            total=ep_inst_total,
            category="install",
            location="island",
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
                f"Island Back Panel - {tier} "
                f"(Material)"
            ),
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_mat,
            total=bp_mat_total,
            category="supply",
            location="island",
            notes="Finished panel to match cabinet",
        ))
        line_items.append(LineItem(
            description=(
                "Island Back Panel Installation"
            ),
            quantity=bp_sqft,
            unit="SF",
            unit_price=bp_inst,
            total=bp_inst_total,
            category="install",
            location="island",
        ))

    # ── 6. Shared scope items ──

    # Demolition
    if include_demo and total_lf > 0:
        # Perimeter demo
        if p_base_lf + p_wall_lf > 0:
            p_demo_lf = p_base_lf + p_wall_lf
            p_demo_cost = round(max(
                p_demo_lf
                * SCOPE_ITEMS["demo_per_lf"],
                SCOPE_ITEMS["demo_min"],
            ), 2)
            line_items.append(LineItem(
                description=(
                    "Cabinet Demolition & Removal"
                ),
                quantity=round(p_demo_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["demo_per_lf"],
                total=p_demo_cost,
                category="demo",
                location="perimeter",
            ))
        # Island demo (no minimum — small scope)
        if i_base_lf + i_wall_lf > 0:
            i_demo_lf = i_base_lf + i_wall_lf
            i_demo_cost = round(
                i_demo_lf
                * SCOPE_ITEMS["demo_per_lf"], 2,
            )
            line_items.append(LineItem(
                description=(
                    "Island Cabinet Demolition & "
                    "Removal"
                ),
                quantity=round(i_demo_lf, 2),
                unit="LF",
                unit_price=SCOPE_ITEMS["demo_per_lf"],
                total=i_demo_cost,
                category="demo",
                location="island",
            ))

    # Delivery
    if include_delivery:
        floor_extra = max(0, (delivery_floor or 1) - 1)
        floor_surcharge = (
            floor_extra
            * SCOPE_ITEMS["delivery_floor_surcharge"]
        )
        delivery_cost = round(max(
            SCOPE_ITEMS["delivery_base"]
            + total_lf * SCOPE_ITEMS["delivery_per_lf"]
            + floor_surcharge,
            SCOPE_ITEMS["delivery_min"],
        ), 2)
        floor_note = (
            f", +${floor_surcharge} "
            f"({delivery_floor}F carry-up)"
            if floor_extra > 0 else ""
        )
        line_items.append(LineItem(
            description="Cabinet Delivery",
            quantity=1,
            unit="EA",
            unit_price=delivery_cost,
            total=delivery_cost,
            category="misc",
            location="shared",
            notes=(
                f"Base ${SCOPE_ITEMS['delivery_base']}"
                f" + "
                f"${SCOPE_ITEMS['delivery_per_lf']}/LF"
                f"{floor_note}"
            ),
        ))

    # Plumbing
    if include_plumbing:
        plumbing_items = [
            (
                "Plumbing Disconnect",
                SCOPE_ITEMS["plumbing_disconnect"],
            ),
            (
                "Plumbing Reconnect",
                SCOPE_ITEMS["plumbing_reconnect"],
            ),
            (
                (
                    "Undermount SS Double Bowl "
                    "Sink (33\") - supply + install"
                    if sink_type == "double"
                    else "Undermount SS Single Bowl "
                    "Sink (30\") - supply + install"
                ),
                SCOPE_ITEMS.get(
                    "sink_double_supply_install"
                    if sink_type == "double"
                    else "sink_single_supply_install",
                    445,
                ),
            ),
            (
                "Pull-Down Kitchen Faucet "
                "- supply + install",
                SCOPE_ITEMS["faucet_supply_install"],
            ),
            (
                "Garbage Disposal 3/4 HP "
                "- supply + install",
                SCOPE_ITEMS["disposal_supply_install"],
            ),
        ]
        for desc, cost in plumbing_items:
            line_items.append(LineItem(
                description=desc,
                quantity=1,
                unit="EA",
                unit_price=cost,
                total=cost,
                category="plumbing",
                location="shared",
            ))

    # Countertop reset
    if include_countertop_reset:
        line_items.append(LineItem(
            description="Countertop Reset",
            quantity=1,
            unit="EA",
            unit_price=SCOPE_ITEMS["countertop_reset"],
            total=SCOPE_ITEMS["countertop_reset"],
            category="countertop",
            location="shared",
        ))

    # Site protection & cleanup
    site_prot_cost = round(
        SCOPE_ITEMS["site_protection_base"]
        + total_lf
        * SCOPE_ITEMS["site_protection_per_lf"], 2,
    )
    line_items.append(LineItem(
        description=(
            "Site Protection "
            "(floor, countertop, walls)"
        ),
        quantity=1,
        unit="EA",
        unit_price=site_prot_cost,
        total=site_prot_cost,
        category="misc",
        location="shared",
    ))

    cleanup_cost = round(
        SCOPE_ITEMS["cleanup_base"]
        + total_lf * SCOPE_ITEMS["cleanup_per_lf"], 2,
    )
    line_items.append(LineItem(
        description="Final Cleanup & Debris Removal",
        quantity=1,
        unit="EA",
        unit_price=cleanup_cost,
        total=cleanup_cost,
        category="misc",
        location="shared",
    ))

    # ── 7. Backsplash ──
    if (
        include_backsplash
        and backsplash_type
        and backsplash_sqft
    ):
        bs_info = BACKSPLASH_TYPES.get(backsplash_type)
        if bs_info:
            bs_sqft = round(backsplash_sqft, 2)
            misc_per_sf = SCOPE_ITEMS[
                "backsplash_misc_per_sf"
            ]
            bs_combined_unit = round(
                bs_info["material_per_sf"]
                + bs_info["install_per_sf"]
                + misc_per_sf, 2,
            )
            bs_total = round(
                bs_sqft * bs_combined_unit, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"Backsplash - {bs_info['label']} "
                    f"(supply + install)"
                ),
                quantity=bs_sqft,
                unit="SF",
                unit_price=bs_combined_unit,
                total=bs_total,
                category="supply",
                location="perimeter",
                notes=(
                    "Incl. miscellaneous materials "
                    "(grout, thinset, tape, etc.)"
                ),
            ))

    # ── 8. Countertop (perimeter) ──
    if include_countertop and countertop_sqft:
        ct_mat = countertop_material or "Laminate"
        ct_info = COUNTERTOP_MATERIALS.get(
            ct_mat, {"rate": 35, "label": ct_mat},
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
            category="countertop",
            location="perimeter",
        ))

    # ── 8b. Countertop (island) ──
    if include_countertop and island_countertop_sqft:
        ict_mat = island_countertop_material or "Laminate"
        ict_info = COUNTERTOP_MATERIALS.get(
            ict_mat, {"rate": 35, "label": ict_mat},
        )
        ict_rate = ict_info["rate"]
        ict_label = ict_info["label"]
        ict_sqft = round(island_countertop_sqft, 2)
        ict_total = round(ict_sqft * ict_rate, 2)
        line_items.append(LineItem(
            description=(
                f"Island Countertop - {ict_label} "
                f"(supply + install)"
            ),
            quantity=ict_sqft,
            unit="SF",
            unit_price=ict_rate,
            total=ict_total,
            category="countertop",
            location="island",
        ))

    # ── 9. Drywall repair ──
    if include_drywall_repair and drywall_repair_sqft:
        dw_sqft = round(drywall_repair_sqft, 2)
        dw_rate = SCOPE_ITEMS["drywall_rr_per_sf"]
        dw_total = round(dw_sqft * dw_rate, 2)
        line_items.append(LineItem(
            description=(
                "R&R Sheetrock (behind cabinets)"
            ),
            quantity=dw_sqft,
            unit="SF",
            unit_price=dw_rate,
            total=dw_total,
            category="finishing",
            location="perimeter",
        ))

    # ── 10. Painting ──
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
            category="finishing",
            location="perimeter",
        ))
        line_items.append(LineItem(
            description="Primer & Paint; Color Match",
            quantity=p_sqft,
            unit="SF",
            unit_price=paint_rate,
            total=paint_total,
            category="finishing",
            location="perimeter",
        ))

    # ── 11. Appliance Detach & Reset ──
    if include_appliance_rr and appliance_list:
        app_total = 0
        app_labels = []
        for appl in appliance_list:
            atype = appl.get("type", "")
            aqty = appl.get("qty", 1)
            info = APPLIANCE_RR_PRICING.get(atype)
            if not info or aqty <= 0:
                continue
            item_cost = info["cost"] * aqty
            app_total += item_cost
            label = info["label"]
            if aqty > 1:
                label = f"{label} x{aqty}"
            app_labels.append(label)
        if app_total > 0:
            desc = (
                "Detach & Reset Appliances "
                f"({', '.join(app_labels)})"
            )
            line_items.append(LineItem(
                description=desc,
                quantity=1,
                unit="SET",
                unit_price=app_total,
                total=app_total,
                category="misc",
                location="shared",
            ))

    # ── 12. Dumpster ──
    if include_dumpster:
        demo_cuft = (
            base_lf * 5.75
            + wall_lf * 2.5
            + tall_count * 28
        )
        if include_countertop and countertop_sqft:
            demo_cuft += countertop_sqft * 0.15
        if include_countertop and island_countertop_sqft:
            demo_cuft += island_countertop_sqft * 0.15
        if include_backsplash and backsplash_sqft:
            demo_cuft += backsplash_sqft * 0.3
        demo_cuyd = (demo_cuft * 1.3) / 27

        if demo_cuyd <= 5:
            dump_size = 10
            dump_key = "dumpster_10yard"
        elif demo_cuyd <= 8:
            dump_size = 15
            dump_key = "dumpster_15yard"
        elif demo_cuyd <= 12:
            dump_size = 20
            dump_key = "dumpster_20yard"
        else:
            dump_size = 30
            dump_key = "dumpster_30yard"

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
            category="demo",
            location="shared",
            notes=(
                f"Est. {demo_cuyd:.1f} cu yd "
                f"demo volume"
            ),
        ))

    # ── 13. Calculate totals ──
    subtotal = round(
        sum(item.total for item in line_items), 2,
    )
    overhead_amount = round(subtotal * overhead_pct, 2)
    profit_amount = round(subtotal * profit_pct, 2)
    total = round(
        subtotal + overhead_amount + profit_amount, 2,
    )

    # ── 14. Methodology notes ──
    methodology_lines = [
        f"Estimate based on {tier} tier cabinets.",
    ]
    if perimeter_boxes:
        methodology_lines.append(
            f"Perimeter: Base {p_base_lf:.1f} LF, "
            f"Wall {p_wall_lf:.1f} LF, "
            f"Tall {p_tall} EA"
        )
    if island_boxes:
        methodology_lines.append(
            f"Island: Base {i_base_lf:.1f} LF, "
            f"Wall {i_wall_lf:.1f} LF, "
            f"Tall {i_tall} EA"
        )
    methodology_lines.extend([
        (
            f"Multipliers: "
            f"Labor(ZIP {zip_code})={labor_mult}"
        ),
        f"Combined multiplier: {total_mult:.2f}",
        (
            f"O&P: {overhead_pct*100:.0f}% / "
            f"{profit_pct*100:.0f}%"
        ),
    ])
    if island_end_panel_sqft or island_back_panel_sqft:
        methodology_lines.append(
            f"Island panels: "
            f"end {island_end_panel_sqft} SF, "
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
