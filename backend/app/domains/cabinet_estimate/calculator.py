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
    MATERIAL_SHARE,
    SCOPE_ITEMS,
    COUNTERTOP_BACKSPLASH_PER_LF,
    PREFAB_ISLAND_INSTALL,
    PREFAB_ISLAND_PRICING,
    SPECIALTY_PREMIUM,
    TALL_CABINET_TYPES,
    TALL_HEIGHT_MULTIPLIER,
    TALL_TYPE_BASE_WIDTH,
    TALL_WIDTH_MULTIPLIER,
    WALL_HEIGHT_MULTIPLIER,
    get_labor_multiplier,
    size_tier_value,
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
    unit_price: float   # material + labor combined
    total: float
    category: str       # supply / labor / scope / premium
    location: str = "perimeter"  # perimeter / island / shared
    notes: Optional[str] = None
    # Share of unit_price that is non-labor cost (material/equipment/fees).
    # The split itself is filled in once O&P is baked in, so that
    # material + labor always adds back up to the price shown on the estimate.
    material_share: float = 0.0
    material_unit_price: float = 0.0
    labor_unit_price: float = 0.0
    material_total: float = 0.0
    labor_total: float = 0.0


@dataclass
class CalculationResult:
    line_items: List[LineItem]
    subtotal: float
    overhead_pct: float
    overhead_amount: float
    profit_pct: float
    profit_amount: float
    adjustment_factor: Optional[float]
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

    # Classify wall boxes by height tier
    def _wall_height_tier(height: float) -> str:
        if height <= 27:
            return "short"
        elif height <= 30:
            return "standard"
        elif height <= 36:
            return "tall"
        else:
            return "extra_tall"

    _WALL_TIER_LABELS = {
        "short": "Short",
        "standard": "Standard",
        "tall": "Tall (36\"H)",
        "extra_tall": "Extra Tall (42\"H)",
    }

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
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    # Wall cabinets: split by height tier for pricing
    wall_by_tier: dict[str, float] = {}
    for b in wall_boxes:
        htier = _wall_height_tier(b.height_inches)
        wall_by_tier[htier] = wall_by_tier.get(
            htier, 0,
        ) + (b.width_inches * b.qty) / 12

    for htier, tier_lf in wall_by_tier.items():
        if tier_lf <= 0:
            continue
        h_mult = WALL_HEIGHT_MULTIPLIER.get(htier, 1.0)
        wall_unit = round(
            rates["wall_lf"] * total_mult * h_mult, 2,
        )
        wall_total = round(tier_lf * wall_unit, 2)
        h_label = _WALL_TIER_LABELS.get(htier, htier)
        line_items.append(LineItem(
            description=(
                f"{prefix}Wall Cabinets {h_label} - {tier}"
            ),
            quantity=round(tier_lf, 2),
            unit="LF",
            unit_price=wall_unit,
            total=wall_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    # Tall cabinets are per-EA, so the box size has to come in through a
    # multiplier - the LF-based rates already carry it for base/wall.
    def _tall_size_mult(box: BoxInput, base_width: int = 24) -> float:
        w_mult, w_approx = size_tier_value(
            TALL_WIDTH_MULTIPLIER, box.width_inches,
        )
        base_w_mult, _ = size_tier_value(
            TALL_WIDTH_MULTIPLIER, base_width,
        )
        h_mult, h_approx = size_tier_value(
            TALL_HEIGHT_MULTIPLIER, box.height_inches,
        )
        if w_approx is not None:
            warnings.append(
                f"{box.code}: {box.width_inches}\"W priced at the "
                f"{w_approx}\"W rate (nearest listed size)"
            )
        if h_approx is not None:
            warnings.append(
                f"{box.code}: {box.height_inches:g}\"H priced at the "
                f"{h_approx}\"H rate (nearest listed size)"
            )
        return round((w_mult / base_w_mult) * h_mult, 4)

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

    # Group by size so boxes of the same size share one line
    generic_by_size: dict = {}
    for b in generic_tall:
        key = (b.width_inches, b.height_inches)
        generic_by_size.setdefault(key, []).append(b)

    for (w, h), size_boxes in generic_by_size.items():
        size_qty = sum(b.qty for b in size_boxes)
        if size_qty <= 0:
            continue
        size_mult = _tall_size_mult(size_boxes[0])
        tall_unit = round(
            rates["tall_each"] * total_mult * size_mult, 2,
        )
        tall_total = round(size_qty * tall_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Tall Cabinets {w}\"W x {h:g}\"H - {tier}"
            ),
            quantity=size_qty,
            unit="EA",
            unit_price=tall_unit,
            total=tall_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location=loc,
        ))

    for box in typed_tall:
        type_prices = TALL_CABINET_TYPES[
            box.specialty_type
        ]
        type_unit = round(
            type_prices.get(tier, rates["tall_each"])
            * total_mult * _tall_size_mult(
                box,
                TALL_TYPE_BASE_WIDTH.get(
                    box.specialty_type, 24,
                ),
            ), 2,
        )
        type_total = round(box.qty * type_unit, 2)
        type_label = (
            box.specialty_type.replace("_", " ").title()
        )
        line_items.append(LineItem(
            description=(
                f"{prefix}{type_label} "
                f"{box.width_inches}\"W x {box.height_inches:g}\"H "
                f"- {tier}"
            ),
            quantity=box.qty,
            unit="EA",
            unit_price=type_unit,
            total=type_total,
            material_share=MATERIAL_SHARE["cabinet_supply"],
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
        premium_entry = SPECIALTY_PREMIUM.get(
            box.specialty_type, 0,
        )
        # Support size-based premiums (dict keyed by width_inches)
        if isinstance(premium_entry, dict):
            premium, approx_width = size_tier_value(
                premium_entry, box.width_inches,
            )
            if approx_width is not None:
                warnings.append(
                    f"{box.code}: {box.width_inches}\"W "
                    f"{box.specialty_type.replace('_', ' ')} premium "
                    f"priced at the {approx_width}\"W rate "
                    f"(nearest listed size)"
                )
        else:
            premium = premium_entry
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
                material_share=MATERIAL_SHARE["cabinet_supply"],
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
        glass_premium = GLASS_DOOR_PREMIUM.get(
            tier, GLASS_DOOR_PREMIUM["Stock"],
        )
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
                material_share=MATERIAL_SHARE["cabinet_supply"],
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
            install_base_rate = SCOPE_ITEMS[
                "install_base_per_lf"
            ].get(
                tier,
                SCOPE_ITEMS["install_base_per_lf"]["Stock"],
            )
            install_base = round(
                base_lf * install_base_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Base Cabinet Installation"
                ),
                quantity=round(base_lf, 2),
                unit="LF",
                unit_price=install_base_rate,
                total=install_base,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))
        for htier, tier_lf in wall_by_tier.items():
            if tier_lf <= 0:
                continue
            h_label = _WALL_TIER_LABELS.get(
                htier, htier,
            )
            install_wall_rate = SCOPE_ITEMS[
                "install_wall_per_lf"
            ].get(
                tier,
                SCOPE_ITEMS["install_wall_per_lf"]["Stock"],
            )
            install_wall = round(
                tier_lf * install_wall_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Wall Cabinet {h_label} "
                    f"Installation"
                ),
                quantity=round(tier_lf, 2),
                unit="LF",
                unit_price=install_wall_rate,
                total=install_wall,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))
        if tall_count > 0:
            install_tall_rate = SCOPE_ITEMS[
                "install_tall_per_each"
            ].get(
                tier,
                SCOPE_ITEMS["install_tall_per_each"]["Stock"],
            )
            install_tall = round(
                tall_count * install_tall_rate, 2,
            )
            line_items.append(LineItem(
                description=(
                    f"{prefix}Tall Cabinet Installation"
                ),
                quantity=tall_count,
                unit="EA",
                unit_price=install_tall_rate,
                total=install_tall,
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location=loc,
            ))

    # ── Hardware ──
    # Each door and drawer front gets 1 pull/knob
    if include_hardware:
        total_openings = 0
        for b in boxes:
            if b.specialty_type == "drawer_base":
                # All-drawer cabinet:
                # ≤18": 3 drawers, 21"-30": 4, 36"+: 5
                if b.width_inches <= 18:
                    openings = 3
                elif b.width_inches >= 36:
                    openings = 5
                else:
                    openings = 4
            elif b.specialty_type == "lazy_susan":
                # Single door
                openings = 1
            elif b.specialty_type == "blind_corner":
                # 1 door + 1 drawer
                openings = 2
            elif b.specialty_type == "sink_base":
                # False front drawer (1) + doors
                # ≤33": 1 false front + 2 doors = 3
                # 36"+: 1 false front + 2 doors = 3
                openings = 3
            elif b.cab_type == "base":
                # Standard base: 1 drawer + door(s)
                # ≤21": 1 drawer + 1 door = 2
                # >21": 1 drawer + 2 doors = 3
                openings = (
                    2 if b.width_inches <= 21 else 3
                )
            elif b.cab_type == "wall":
                # Wall: door(s) only, no drawers
                # ≤21": 1 door
                # >21": 2 doors
                openings = (
                    1 if b.width_inches <= 21 else 2
                )
            elif b.cab_type == "tall":
                if b.specialty_type == "oven_cabinet":
                    # 1-2 doors + 1 drawer
                    openings = 3
                elif b.specialty_type == (
                    "refrigerator_cabinet"
                ):
                    # Above-fridge panel, 1-2 doors
                    openings = 2
                else:
                    # Pantry: 2 doors (upper) + 2 doors
                    # (lower) = 4 for tall pantry
                    openings = 4
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
                material_share=MATERIAL_SHARE["cabinet_supply"],
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
                material_share=MATERIAL_SHARE["cabinet_install"],
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
            material_share=MATERIAL_SHARE["cabinet_supply"],
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
            material_share=MATERIAL_SHARE["cabinet_install"],
            category="install",
            location=loc,
        ))

    # ── Toe kick ──
    if include_toe_kick and base_lf > 0:
        tk_unit = SCOPE_ITEMS["toe_kick_per_lf"]
        tk_total = round(base_lf * tk_unit, 2)
        line_items.append(LineItem(
            description=(
                f"{prefix}Toe Kick — Install & Paint"
            ),
            quantity=round(base_lf, 2),
            unit="LF",
            unit_price=tk_unit,
            total=tk_total,
            notes="Supply, install, and paint to match",
            material_share=MATERIAL_SHARE["toe_kick"],
            category="install",
            location=loc,
        ))

    return line_items, base_lf, wall_lf, tall_count


def _apply_material_labor_split(line_items: List[LineItem]) -> None:
    """Fill in each item's material/labor breakdown from its material_share.

    Run this after every step that moves prices (O&P, reverse pricing) so the
    two halves always add back up to the unit price and total the estimate
    shows - the labor side is taken as the remainder rather than rounded
    independently, which is what guarantees it.
    """
    for item in line_items:
        share = min(max(item.material_share, 0.0), 1.0)
        item.material_unit_price = round(item.unit_price * share, 2)
        item.labor_unit_price = round(
            item.unit_price - item.material_unit_price, 2,
        )
        # Split the total off the total itself, not off quantity x unit price:
        # reverse pricing nudges a line's total to hit the target exactly, so
        # the two can differ by a cent or two and that drift would otherwise
        # land in - and could go negative on - the labor half.
        item.material_total = round(item.total * share, 2)
        item.labor_total = round(item.total - item.material_total, 2)


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
    include_countertop_backsplash: bool = False,
    countertop_backsplash_lf: Optional[float] = None,
    island_countertop_material: Optional[str] = None,
    island_countertop_sqft: Optional[float] = None,
    include_drywall_repair: bool = False,
    drywall_repair_type: Optional[str] = "patch",
    drywall_repair_sqft: Optional[float] = None,
    include_painting: bool = False,
    painting_sqft: Optional[float] = None,
    include_appliance_rr: bool = False,
    appliance_list: Optional[List[dict]] = None,
    include_dumpster: bool = True,
    include_electrical: bool = False,
    include_permit: bool = False,
    outlet_relocation_count: int = 0,
    delivery_floor: int = 1,
    island_type: str = "custom",
    island_prefab_size: Optional[str] = None,
    island_prefab_price: Optional[float] = None,
    island_end_panel_sqft: float = 0,
    island_back_panel_sqft: float = 0,
    overhead_pct: float = DEFAULT_OVERHEAD_PCT,
    profit_pct: float = DEFAULT_PROFIT_PCT,
    target_total: Optional[float] = None,
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

    # ── 4. Calculate island ──
    i_base_lf = i_wall_lf = 0.0
    i_tall = 0
    is_prefab = island_type == "prefab"

    if is_prefab and island_prefab_size:
        # Prefab island: EA-based pricing
        size_info = PREFAB_ISLAND_PRICING.get(
            island_prefab_size, {},
        )
        # Use user-override price, or tier default
        supply_price = (
            island_prefab_price
            if island_prefab_price is not None
            else size_info.get(tier, size_info.get("Stock", 900))
        )
        size_label = size_info.get(
            "label", island_prefab_size,
        )
        line_items.append(LineItem(
            description=(
                f"Prefab Island - {size_label} "
                f"(Supply)"
            ),
            quantity=1,
            unit="EA",
            unit_price=round(supply_price, 2),
            total=round(supply_price, 2),
            material_share=MATERIAL_SHARE["cabinet_supply"],
            category="supply",
            location="island",
            notes=(
                "Prefab island supply — actual price "
                "may vary by product selection"
            ),
        ))
        if include_install:
            inst_cost = PREFAB_ISLAND_INSTALL.get(
                island_prefab_size, 350,
            )
            line_items.append(LineItem(
                description=(
                    "Prefab Island Installation"
                ),
                quantity=1,
                unit="EA",
                unit_price=round(inst_cost, 2),
                total=round(inst_cost, 2),
                material_share=MATERIAL_SHARE["cabinet_install"],
                category="install",
                location="island",
            ))
        warnings.append(
            "Prefab island: price is an estimate "
            "based on size/tier. Actual cost may "
            "vary depending on the specific product "
            "selected."
        )
    elif island_boxes:
        # Custom build: LF-based pricing
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

    # ── 5. Island panels (SF-based, custom build only) ──
    if not is_prefab and island_end_panel_sqft > 0:
        ep_mat = ISLAND_PANEL_PRICING[
            "end_panel_per_sf"
        ].get(
            tier,
            ISLAND_PANEL_PRICING["end_panel_per_sf"]["Stock"],
        )
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
            material_share=MATERIAL_SHARE["cabinet_supply"],
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
            material_share=MATERIAL_SHARE["cabinet_install"],
            category="install",
            location="island",
        ))

    if not is_prefab and island_back_panel_sqft > 0:
        bp_mat = ISLAND_PANEL_PRICING[
            "back_panel_per_sf"
        ].get(
            tier,
            ISLAND_PANEL_PRICING["back_panel_per_sf"]["Stock"],
        )
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
            material_share=MATERIAL_SHARE["cabinet_supply"],
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
            material_share=MATERIAL_SHARE["cabinet_install"],
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
                material_share=MATERIAL_SHARE["demo"],
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
                material_share=MATERIAL_SHARE["demo"],
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
            material_share=MATERIAL_SHARE["delivery"],
            category="misc",
            location="shared",
            notes=(
                f"${SCOPE_ITEMS['delivery_base']}"
                f" + "
                f"${SCOPE_ITEMS['delivery_per_lf']}/LF"
                f"{floor_note}"
            ),
        ))

    # Plumbing
    if include_plumbing:
        plumbing_items = [
            (
                "Plumbing Disconnect "
                "(sink, disposal, DW supply/drain)",
                SCOPE_ITEMS["plumbing_disconnect"],
                None,
                0.0,
            ),
            (
                "Plumbing Reconnect "
                "(sink drain, P-trap, disposal, "
                "DW drain/supply, faucet hookup)",
                SCOPE_ITEMS["plumbing_reconnect"],
                "Includes all fixture hookups",
                0.0,
            ),
            (
                (
                    "Undermount SS Double Bowl "
                    "Sink 33\" (Kraus KHU102-33) "
                    "- supply only"
                    if sink_type == "double"
                    else "Undermount SS Single Bowl "
                    "Sink 30\" (Kraus KHU100-30) "
                    "- supply only"
                ),
                SCOPE_ITEMS.get(
                    "sink_double_supply"
                    if sink_type == "double"
                    else "sink_single_supply",
                    280,
                ),
                (
                    "16-gauge stainless steel, "
                    "sound-dampened"
                ),
                1.0,
            ),
            (
                "Pull-Down Kitchen Faucet "
                "(Moen/Delta mid-range) "
                "- supply only",
                SCOPE_ITEMS["faucet_supply"],
                None,
                1.0,
            ),
            (
                "Garbage Disposal 3/4 HP "
                "(InSinkErator Badger 5XP) "
                "- supply only",
                SCOPE_ITEMS["disposal_supply"],
                None,
                1.0,
            ),
        ]
        for desc, cost, notes, share in plumbing_items:
            line_items.append(LineItem(
                description=desc,
                quantity=1,
                unit="EA",
                unit_price=cost,
                total=cost,
                material_share=share,
                category="plumbing",
                location="shared",
                notes=notes,
            ))

    # Countertop reset
    if include_countertop_reset:
        line_items.append(LineItem(
            description="Countertop Reset",
            quantity=1,
            unit="EA",
            unit_price=SCOPE_ITEMS["countertop_reset"],
            total=SCOPE_ITEMS["countertop_reset"],
            material_share=MATERIAL_SHARE["countertop_reset"],
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
        material_share=MATERIAL_SHARE["site_protection"],
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
        material_share=MATERIAL_SHARE["cleanup"],
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
            # Real split - this table quotes material and install separately
            bs_material_share = round(
                (bs_info["material_per_sf"] + misc_per_sf)
                / bs_combined_unit, 4,
            ) if bs_combined_unit else 0.0
            line_items.append(LineItem(
                description=(
                    f"Backsplash - {bs_info['label']} "
                    f"(supply + install)"
                ),
                quantity=bs_sqft,
                unit="SF",
                unit_price=bs_combined_unit,
                total=bs_total,
                material_share=bs_material_share,
                category="backsplash",
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
            material_share=MATERIAL_SHARE["countertop"],
            category="countertop",
            location="perimeter",
        ))

    # ── 8b. Countertop (island, custom build only) ──
    if include_countertop and island_countertop_sqft and not is_prefab:
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
            material_share=MATERIAL_SHARE["countertop"],
            category="countertop",
            location="island",
        ))

    # ── 8c. 4" Countertop Backsplash ──
    if (include_countertop_backsplash
            and countertop_backsplash_lf
            and countertop_backsplash_lf > 0):
        cb_mat = countertop_material or "Laminate"
        cb_rate = COUNTERTOP_BACKSPLASH_PER_LF.get(
            cb_mat, 20,
        )
        cb_lf = round(countertop_backsplash_lf, 2)
        cb_total = round(cb_lf * cb_rate, 2)
        cb_label = COUNTERTOP_MATERIALS.get(
            cb_mat, {"label": cb_mat},
        )["label"]
        line_items.append(LineItem(
            description=(
                f"4\" Countertop Backsplash - "
                f"{cb_label} (supply + install)"
            ),
            quantity=cb_lf,
            unit="LF",
            unit_price=cb_rate,
            total=cb_total,
            material_share=MATERIAL_SHARE["countertop"],
            category="countertop",
            location="perimeter",
        ))

    # ── 9. Drywall repair ──
    if include_drywall_repair and drywall_repair_sqft:
        dw_sqft = round(drywall_repair_sqft, 2)
        dw_type = drywall_repair_type or "patch"
        if dw_type == "rr":
            dw_rate = SCOPE_ITEMS["drywall_rr_per_sf"]
            dw_share = MATERIAL_SHARE["drywall_rr"]
            dw_desc = (
                "R&R Sheetrock "
                "(behind cabinets)"
            )
        else:
            dw_rate = SCOPE_ITEMS[
                "drywall_patch_per_sf"
            ]
            dw_share = MATERIAL_SHARE["drywall_patch"]
            dw_desc = (
                "Drywall Patch & Repair "
                "(nail holes, minor damage)"
            )
        dw_total = round(dw_sqft * dw_rate, 2)
        line_items.append(LineItem(
            description=dw_desc,
            quantity=dw_sqft,
            unit="SF",
            unit_price=dw_rate,
            total=dw_total,
            material_share=dw_share,
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
            material_share=MATERIAL_SHARE["paint_prep"],
            category="finishing",
            location="perimeter",
        ))
        line_items.append(LineItem(
            description="Primer & Paint; Color Match",
            quantity=p_sqft,
            unit="SF",
            unit_price=paint_rate,
            total=paint_total,
            material_share=MATERIAL_SHARE["paint_finish"],
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
            # Skip disposal if plumbing already handles it
            if atype == "garbage_disposal" and include_plumbing:
                continue
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
                material_share=MATERIAL_SHARE["appliance_rr"],
                category="misc",
                location="shared",
            ))

    # ── 11b. Electrical Disconnect/Reconnect ──
    if include_electrical:
        elec_cost = SCOPE_ITEMS[
            "electrical_disconnect_reconnect"
        ]
        line_items.append(LineItem(
            description=(
                "Electrical Disconnect & Reconnect "
                "(DW, under-cabinet "
                "lighting, range)"
            ),
            quantity=1,
            unit="EA",
            unit_price=elec_cost,
            total=elec_cost,
            material_share=MATERIAL_SHARE["electrical"],
            category="misc",
            location="shared",
            notes="Licensed electrician",
        ))

    # ── 11c. Outlet Relocation ──
    if outlet_relocation_count and outlet_relocation_count > 0:
        outlet_unit = SCOPE_ITEMS[
            "outlet_relocation_each"
        ]
        outlet_total = round(
            outlet_relocation_count * outlet_unit, 2,
        )
        line_items.append(LineItem(
            description="Outlet Relocation",
            quantity=outlet_relocation_count,
            unit="EA",
            unit_price=outlet_unit,
            total=outlet_total,
            material_share=MATERIAL_SHARE["outlet_relocation"],
            category="misc",
            location="shared",
            notes=(
                "Relocate to match new cabinet "
                "layout; licensed electrician"
            ),
        ))

    # ── 11d. Permit Allowance ──
    if include_permit:
        permit_cost = SCOPE_ITEMS["permit_allowance"]
        line_items.append(LineItem(
            description=(
                "Permit Allowance "
                "(plumbing/electrical)"
            ),
            quantity=1,
            unit="EA",
            unit_price=permit_cost,
            total=permit_cost,
            material_share=MATERIAL_SHARE["permit"],
            category="misc",
            location="shared",
            notes=(
                "Fairfax/DMV jurisdiction; "
                "actual cost may vary"
            ),
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
            material_share=MATERIAL_SHARE["dumpster"],
            category="demo",
            location="shared",
            notes=(
                f"Est. {demo_cuyd:.1f} cu yd "
                f"demo volume"
            ),
        ))

    # ── 13. Calculate totals ──
    # Raw subtotal before O&P
    raw_subtotal = round(
        sum(item.total for item in line_items), 2,
    )
    overhead_amount = round(
        raw_subtotal * overhead_pct, 2,
    )
    profit_amount = round(
        raw_subtotal * profit_pct, 2,
    )

    # Bake O&P into line item unit prices
    # so PDF shows all-inclusive pricing
    op_mult = 1 + overhead_pct + profit_pct
    for item in line_items:
        item.unit_price = round(
            item.unit_price * op_mult, 2,
        )
        item.total = round(
            item.quantity * item.unit_price, 2,
        )

    # Subtotal now includes O&P (= total)
    subtotal = round(
        sum(item.total for item in line_items), 2,
    )
    total = subtotal

    _apply_material_labor_split(line_items)

    # ── 13b. Target total adjustment (reverse pricing) ──
    adjustment_factor = None
    if (
        target_total
        and target_total > 0
        and subtotal > 0
        and total > 0
    ):
        adjustment_factor = target_total / total

        for item in line_items:
            item.unit_price = round(
                item.unit_price * adjustment_factor, 2,
            )
            item.total = round(
                item.quantity * item.unit_price, 2,
            )

        subtotal = round(
            sum(item.total for item in line_items), 2,
        )
        total = subtotal

        # Fix rounding drift: adjust largest line item to hit target exactly
        rounding_diff = round(target_total - total, 2)
        if rounding_diff != 0 and line_items:
            largest = max(line_items, key=lambda x: x.total)
            largest.total = round(largest.total + rounding_diff, 2)
            if largest.quantity:
                largest.unit_price = round(
                    largest.total / largest.quantity, 2
                )
            subtotal = round(
                sum(item.total for item in line_items), 2,
            )
            total = subtotal

        _apply_material_labor_split(line_items)

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
    if is_prefab and island_prefab_size:
        size_info = PREFAB_ISLAND_PRICING.get(
            island_prefab_size, {},
        )
        size_label = size_info.get(
            "label", island_prefab_size,
        )
        methodology_lines.append(
            f"Island: Prefab {size_label} "
            f"(price may vary by product)"
        )
    elif island_boxes:
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
    if adjustment_factor:
        methodology_lines.append(
            f"Target total: ${target_total:,.2f} "
            f"(adjusted)"
        )
    methodology = "\n".join(methodology_lines)

    return CalculationResult(
        line_items=line_items,
        subtotal=subtotal,
        overhead_pct=overhead_pct,
        overhead_amount=overhead_amount,
        profit_pct=profit_pct,
        profit_amount=profit_amount,
        adjustment_factor=(
            round(adjustment_factor, 6)
            if adjustment_factor else None
        ),
        total=total,
        methodology_notes=methodology,
        warning_flags=warnings,
        base_lf=base_lf,
        wall_lf=wall_lf,
        tall_count=tall_count,
        total_mult=total_mult,
    )
