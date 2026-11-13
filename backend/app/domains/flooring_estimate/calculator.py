"""
Flooring estimate calculator.

Everything is measured from the sketch (geometry.measure_sketch) and priced
from pricing.py, read through the estimate's price book while it is
calculated. Nothing here touches the database: give it anything with the
estimate's fields.

Inputs on the estimate:
  sketch_data   the rooms, openings, cabinet runs and fixtures (geometry.py)
  room_scopes   per room id: {included, new_material, pattern, waste_pct,
                existing_material, items: {key: {on, qty, unit_price, note}},
                custom_items: [...], notes}
  job_scope     {defaults: {new_material, existing_material, pattern},
                 room_items: {key: {on, unit_price}},   # for every room
                 items: {key: {on, qty, unit_price, note}},  # General
                 custom_items: [...]}                   # General

The line items are always rebuilt from those inputs, so what the
estimator chose (an item switched on, a quantity or a price typed in, a
custom line) is kept in the inputs and survives every recalculation.

A price typed in is used as it is: no material tax or O&P goes on top of
it. Prices from the catalog get the material tax loaded on their material
part and, when the estimate includes O&P, overhead and profit, folded into
the unit price so neither shows as a line (as on the bathroom estimate).
"""

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from app.domains.unit_prices import catalog
from app.domains.unit_prices.tables import material_share

from . import pricing
from .geometry import (
    RoomMeasure, bounding_box, format_ft_in, is_axis_rectangle, levels_of, measure_sketch,
)
from .items import (
    CATEGORY_ORDER, GENERAL_ITEMS, MAIN_LABELS, ROOM_ITEM_MAP, ROOM_ITEMS, RULES, ItemDef,
)

PRICE_DOMAIN = "flooring"
GENERAL_ROOM_NAME = "General"


# ── Prices ──

def price_of(path: str) -> float:
    """A price by its path in pricing.py, through the active price book."""
    table_name, key = path.split(".", 1)
    return float(getattr(pricing, table_name)[key])


_DEFAULT_SHARES: Dict[str, float] = {}


def _default_share(path: str) -> float:
    if not _DEFAULT_SHARES:
        for item in catalog.get_domain(PRICE_DOMAIN).items():
            whole = item.material + item.labor
            _DEFAULT_SHARES[item.key] = item.material / whole if whole else 0.0
    return _DEFAULT_SHARES.get(path, 0.0)


def material_part(path: str, price: float) -> float:
    return price * material_share(path, _default_share(path))


def is_price_key(path: Optional[str]) -> bool:
    if not path or "." not in path:
        return False
    try:
        price_of(path)
    except (AttributeError, KeyError, TypeError, ValueError):
        return False
    return True


def _tax_rate(state: Optional[str], zip_code: Optional[str]) -> float:
    # The same internal material tax loading the bathroom estimate uses
    from app.domains.bathroom_estimate.pricing import get_material_tax_loading

    return get_material_tax_loading(state or "MD", zip_code or "")


# ── Scope ──

@dataclass
class RoomScope:
    """A room's choices with the job's defaults filled in."""

    included: bool
    new_material: Optional[str]
    pattern: str
    waste_pct: float
    existing_material: Optional[str]
    items: Dict[str, Dict[str, Any]]
    custom_items: List[Dict[str, Any]]
    notes: Optional[str]


def _valid_material(value: Any) -> Optional[str]:
    return value if value in pricing.MATERIALS else None


def resolve_scope(scope: Optional[Mapping[str, Any]], job: Mapping[str, Any]) -> RoomScope:
    scope = scope or {}
    defaults = job.get("defaults") or {}
    new = _valid_material(scope.get("new_material")) or _valid_material(defaults.get("new_material"))
    existing = (
        _valid_material(scope.get("existing_material"))
        or _valid_material(defaults.get("existing_material"))
    )
    pattern = scope.get("pattern") or defaults.get("pattern") or "straight"
    if pattern not in pricing.PATTERNS or new not in pricing.PATTERNED:
        pattern = "straight"
    waste = scope.get("waste_pct")
    if waste is None and new:
        table = pricing.WASTE_PCT.get(new, {})
        waste = table.get(pattern, table.get("straight", 10))
    return RoomScope(
        included=scope.get("included", True) is not False,
        new_material=new,
        pattern=pattern,
        waste_pct=float(waste or 0),
        existing_material=existing,
        items=dict(scope.get("items") or {}),
        custom_items=list(scope.get("custom_items") or []),
        notes=scope.get("notes"),
    )


def _override(choices: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = choices.get(key)
    return value if isinstance(value, Mapping) else {}


def _switch(room_choice: Mapping[str, Any], job_choice: Mapping[str, Any], default: bool) -> Tuple[bool, str]:
    if room_choice.get("on") is not None:
        return bool(room_choice["on"]), "room"
    if job_choice.get("on") is not None:
        return bool(job_choice["on"]), "job"
    return default, "default"


# ── Rows: every line a room could have, with what decides it ──

@dataclass
class Row:
    key: str
    label: str
    group: str
    category: str
    unit: str
    basis: str
    on: bool
    default_on: bool
    on_source: str          # room / job / default
    auto_qty: float
    qty: float
    qty_typed: bool
    unit_price: float       # before material tax and O&P
    material_unit: float
    price_typed: bool
    price_key: Optional[str] = None
    notes: Optional[str] = None
    source: str = "item"    # auto (the room's own floor lines) / item / custom

    @property
    def billed(self) -> bool:
        return self.on and self.qty > 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key, "label": self.label, "group": self.group, "category": self.category,
            "unit": self.unit, "basis": self.basis, "on": self.on, "default_on": self.default_on,
            "on_source": self.on_source, "auto_qty": round(self.auto_qty, 2), "qty": round(self.qty, 2),
            "qty_typed": self.qty_typed, "unit_price": round(self.unit_price, 2),
            "price_typed": self.price_typed, "price_key": self.price_key, "notes": self.notes,
            "source": self.source,
            "estimated_total": round(self.qty * self.unit_price, 2) if self.billed else 0.0,
        }


def _priced_row(
    item: ItemDef, auto_qty: float, default_on: bool,
    room_choice: Mapping[str, Any], job_choice: Mapping[str, Any], notes: Optional[str] = None,
) -> Row:
    on, source = _switch(room_choice, job_choice, default_on)
    typed_qty = room_choice.get("qty")
    typed_price = room_choice.get("unit_price")
    if typed_price is None:
        typed_price = job_choice.get("unit_price")
    price = price_of(item.price)
    return Row(
        key=item.key, label=item.label, group=item.group, category=item.category,
        unit=item.unit, basis=item.basis, on=on, default_on=default_on, on_source=source,
        auto_qty=auto_qty, qty=float(typed_qty) if typed_qty is not None else auto_qty,
        qty_typed=typed_qty is not None,
        unit_price=float(typed_price) if typed_price is not None else price,
        material_unit=0.0 if typed_price is not None else material_part(item.price, price),
        price_typed=typed_price is not None, price_key=item.price,
        notes=room_choice.get("note") or notes,
    )


def _basis_qty(item: ItemDef, values: Mapping[str, float]) -> float:
    if item.basis == "manual":
        return float(item.manual_qty)
    return float(values.get(item.basis, 0.0)) * item.factor


def _carpet_quantity(m: RoomMeasure, scope: RoomScope) -> Tuple[float, str]:
    """SY of carpet. A plain rectangular room that takes most of the roll's
    width is cut from it in one piece, and that cut is what is ordered. A
    narrow room (a hall, a closet) comes from the leftovers, and a room wider
    than the roll is seamed: both are priced by waste."""
    roll = pricing.CARPET_ROLL_WIDTH_FT
    x0, y0, x1, y1 = bounding_box(m.points)
    across, along = sorted((x1 - x0, y1 - y0))
    if not m.subroom_of and is_axis_rectangle(m.points) and roll * pricing.CARPET_ROLL_MIN_USE <= across <= roll:
        cut = along + pricing.CARPET_TRIM_FT
        return cut * roll / 9, f"{roll:g}' roll · 1 cut {format_ft_in(cut)} incl. trim · no seam"
    reason = "seamed" if across > roll else "cut from roll remnant"
    return m.floor_sf * (1 + scope.waste_pct / 100) / 9, f"Incl. {scope.waste_pct:g}% waste · {reason}"


def _install_row(m: RoomMeasure, scope: RoomScope, choice: Mapping[str, Any]) -> Optional[Row]:
    new = scope.new_material
    if not new:
        return None
    spec = pricing.MATERIALS[new]
    labor_mult = pricing.PATTERN_LABOR_MULTIPLIER.get(scope.pattern, 1.0)
    material = float(pricing.FLOORING_MATERIAL[new])
    labor = float(pricing.FLOORING_INSTALL_LABOR[new]) * labor_mult
    if new == "carpet":
        auto_qty, note = _carpet_quantity(m, scope)
        label = spec["line"]
    else:
        auto_qty = m.floor_sf * (1 + scope.waste_pct / 100)
        note = f"Incl. {scope.waste_pct:g}% waste"
        label = f"{spec['line']}, {pricing.PATTERNS[scope.pattern]}" if new in pricing.PATTERNED else spec["line"]
    on, source = _switch(choice, {}, True)
    typed_qty = choice.get("qty")
    qty = float(typed_qty) if typed_qty is not None else auto_qty
    coverage = pricing.BOX_COVERAGE_SF.get(new)
    if coverage and qty > 0:
        boxes = math.ceil(round(qty / coverage, 6))
        note = f"{note} · order {boxes} boxes @ {coverage:g} SF" if typed_qty is None else f"Order {boxes} boxes @ {coverage:g} SF"
    elif typed_qty is not None:
        note = None
    typed_price = choice.get("unit_price")
    return Row(
        key="install", label=label, group="Flooring", category="install", unit=spec["unit"],
        basis="floor_sf", on=on, default_on=True, on_source=source, auto_qty=auto_qty, qty=qty,
        qty_typed=typed_qty is not None,
        unit_price=float(typed_price) if typed_price is not None else material + labor,
        material_unit=0.0 if typed_price is not None else material,
        price_typed=typed_price is not None, notes=choice.get("note") or note, source="auto",
    )


def _removal_row(m: RoomMeasure, scope: RoomScope, choice: Mapping[str, Any]) -> Optional[Row]:
    existing = scope.existing_material
    if not existing:
        return None
    on, source = _switch(choice, {}, True)
    typed_qty = choice.get("qty")
    typed_price = choice.get("unit_price")
    price = float(pricing.REMOVAL_RATES[existing])
    return Row(
        key="removal", label=pricing.REMOVAL_LABELS[existing], group="Flooring", category="removal",
        unit="SF", basis="floor_sf", on=on, default_on=True, on_source=source,
        auto_qty=m.floor_sf, qty=float(typed_qty) if typed_qty is not None else m.floor_sf,
        qty_typed=typed_qty is not None,
        unit_price=float(typed_price) if typed_price is not None else price,
        material_unit=0.0, price_typed=typed_price is not None,
        price_key=f"REMOVAL_RATES.{existing}", notes=choice.get("note"), source="auto",
    )


def _pad_row(m: RoomMeasure, scope: RoomScope, choice: Mapping[str, Any]) -> Optional[Row]:
    if scope.new_material != "carpet":
        return None
    on, source = _switch(choice, {}, True)
    auto_qty = m.floor_sf * (1 + pricing.PAD_WASTE_PCT / 100) / 9
    typed_qty = choice.get("qty")
    typed_price = choice.get("unit_price")
    price = float(pricing.PAD_PRICES["rebond_7_16"])
    return Row(
        key="pad", label='Carpet pad - 7/16" rebond', group="Flooring", category="install",
        unit="SY", basis="floor_sf", on=on, default_on=True, on_source=source,
        auto_qty=auto_qty, qty=float(typed_qty) if typed_qty is not None else auto_qty,
        qty_typed=typed_qty is not None,
        unit_price=float(typed_price) if typed_price is not None else price,
        material_unit=0.0 if typed_price is not None else material_part("PAD_PRICES.rebond_7_16", price),
        price_typed=typed_price is not None, price_key="PAD_PRICES.rebond_7_16",
        notes=choice.get("note") or (f"Incl. {pricing.PAD_WASTE_PCT}% waste" if typed_qty is None else None),
        source="auto",
    )


def _custom_rows(custom_items: List[Mapping[str, Any]], warnings: List[str], where: str) -> List[Row]:
    rows = []
    for i, c in enumerate(custom_items):
        description = str(c.get("description") or "").strip()
        if not description:
            continue
        qty = float(c.get("quantity") if c.get("quantity") is not None else 1)
        typed_price = c.get("unit_price")
        key = c.get("price_key")
        if typed_price is None and is_price_key(key):
            price = price_of(key)
            material = material_part(key, price)
            typed = False
        else:
            price = float(typed_price or 0)
            material = 0.0
            typed = True
            if typed_price is None:
                warnings.append(f"{where}: \"{description}\" has no price.")
        rows.append(Row(
            key=str(c.get("id") or f"custom_{i + 1}"), label=description, group="Custom",
            category="custom", unit=str(c.get("unit") or "EA"), basis="manual", on=True,
            default_on=True, on_source="room", auto_qty=qty, qty=qty, qty_typed=True,
            unit_price=price, material_unit=material, price_typed=typed,
            price_key=key if not typed else None, notes=c.get("notes"), source="custom",
        ))
    return rows


# ── Transitions ──

def _floor_on_each_side(
    rooms: Mapping[str, RoomMeasure], scopes: Mapping[str, RoomScope], room_id: Optional[str],
) -> Tuple[Optional[str], bool]:
    """(the floor, whether it is new) on one side of a doorway"""
    scope = scopes.get(room_id) if room_id else None
    if scope is None:
        return None, False
    install = _override(scope.items, "install")
    if scope.included and scope.new_material and install.get("on") is not False:
        return scope.new_material, True
    return scope.existing_material, False


def transitions(
    sketch: Optional[Mapping[str, Any]], rooms: Mapping[str, RoomMeasure], scopes: Mapping[str, RoomScope],
) -> Dict[str, List[str]]:
    """Per room, the doorways it takes a transition strip at: where a new
    floor meets a different one. A doorway between two new floors goes on
    the room it is listed under first; one to a room left as it is goes on
    the side with the new floor. A doorway to the outside takes a
    threshold, not a transition."""
    found: Dict[str, List[str]] = {}
    for level in levels_of(sketch):
        for opening in level.get("openings") or []:
            ids = [str(r) if r else None for r in (opening.get("rooms") or [])][:2]
            if len(ids) < 2 or None in ids:
                continue
            sides = [_floor_on_each_side(rooms, scopes, r) for r in ids]
            if not any(new for _, new in sides):
                continue
            if sides[0][1] and sides[1][1] and sides[0][0] == sides[1][0]:
                continue
            owner = 0 if sides[0][1] else 1
            other = 1 - owner
            other_floor, other_new = sides[other]
            other_room = rooms.get(ids[other])
            other_name = other_room.name if other_room else "adjacent area"
            floor = pricing.MATERIALS[other_floor]["short"].lower() if other_floor else "existing floor"
            if other_floor and not other_new:
                floor += " - existing"
            found.setdefault(ids[owner], []).append(f"{other_name} ({floor})")
    return found


# ── A room ──

def room_rows(
    m: RoomMeasure, scope: RoomScope, job: Mapping[str, Any],
    transition_to: List[str], any_removal: bool, warnings: List[str],
) -> List[Row]:
    rows: List[Row] = []
    for key, make in (("removal", _removal_row), ("install", _install_row), ("pad", _pad_row)):
        row = make(m, scope, _override(scope.items, key))
        if row is not None:
            rows.append(row)

    values = {
        "floor_sf": m.floor_sf, "base_lf": m.base_lf, "toe_kick_lf": m.toe_kick_lf,
        "cabinet_run_lf": m.cabinet_run_lf, "island_lf": m.island_lf, "island_panel_sf": m.island_panel_sf,
        "island_floored_count": m.island_floored_count,
        "door_count": m.door_count, "exterior_door_count": m.exterior_door_count,
        "toilet_count": m.toilet_count, "vanity_count": m.vanity_count,
        "pedestal_sink_count": m.pedestal_sink_count, "utility_sink_count": m.utility_sink_count,
        "register_count": m.register_count,
        "refrigerator_count": m.refrigerator_count, "range_count": m.range_count,
        "range_gas_count": m.range_gas_count, "dishwasher_count": m.dishwasher_count,
        "washer_count": m.washer_count, "dryer_count": m.dryer_count, "dryer_gas_count": m.dryer_gas_count,
        "appliance_count": m.appliance_count, "transition_count": len(transition_to),
    }
    context = {**values, "new_material": scope.new_material, "any_removal": any_removal}
    job_room_items = job.get("room_items") or {}
    # Shoe molding goes along the wall behind the base cabinets only when they come out
    cabinets_out, _ = _switch(
        _override(scope.items, "base_cabinet_detach_reset"), _override(job_room_items, "base_cabinet_detach_reset"),
        RULES[ROOM_ITEM_MAP["base_cabinet_detach_reset"].rule](context),
    )
    values["shoe_lf"] = m.shoe_lf + (m.cabinet_run_lf if cabinets_out else 0.0)
    for item in ROOM_ITEMS:
        note = None
        if item.key == "transition" and transition_to:
            note = "To " + ", ".join(transition_to)
        rows.append(_priced_row(
            item, _basis_qty(item, values), RULES[item.rule](context),
            _override(scope.items, item.key), _override(job_room_items, item.key), note,
        ))
    rows.extend(_custom_rows(scope.custom_items, warnings, m.name))
    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    rows.sort(key=lambda r: order.get(r.category, len(order)))
    return rows


def general_rows(job: Mapping[str, Any], job_floor_sf: float, any_removal: bool, warnings: List[str]) -> List[Row]:
    values = {"job_floor_sf": job_floor_sf}
    context = {"new_material": None, "any_removal": any_removal}
    choices = job.get("items") or {}
    rows = [
        _priced_row(item, _basis_qty(item, values), RULES[item.rule](context), _override(choices, item.key), {})
        for item in GENERAL_ITEMS
    ]
    rows.extend(_custom_rows(list(job.get("custom_items") or []), warnings, GENERAL_ROOM_NAME))
    return rows


# ── The whole estimate ──

def _field(estimate: Any, name: str, default: Any = None) -> Any:
    value = getattr(estimate, name, default)
    return default if value is None else value


@dataclass
class Takeoff:
    measures: List[RoomMeasure]
    scopes: Dict[str, RoomScope]
    rows: Dict[str, List[Row]]
    transitions: Dict[str, List[str]]
    general: List[Row]
    warnings: List[str] = field(default_factory=list)


def build_takeoff(estimate: Any) -> Takeoff:
    sketch = _field(estimate, "sketch_data", {})
    job = _field(estimate, "job_scope", {})
    saved = _field(estimate, "room_scopes", {})
    measures = measure_sketch(sketch)
    scopes = {m.room_id: resolve_scope(saved.get(m.room_id), job) for m in measures}
    by_id = {m.room_id: m for m in measures}
    warnings: List[str] = []
    if not measures:
        warnings.append("Draw the rooms on the sketch first: every quantity is measured from it.")

    def tears_out(m: RoomMeasure) -> bool:
        s = scopes[m.room_id]
        return s.included and bool(s.existing_material) and _override(s.items, "removal").get("on") is not False

    any_removal = any(tears_out(m) for m in measures)
    doorways = transitions(sketch, by_id, scopes)
    rows: Dict[str, List[Row]] = {}
    job_floor_sf = 0.0
    for m in measures:
        scope = scopes[m.room_id]
        rows[m.room_id] = room_rows(m, scope, job, doorways.get(m.room_id, []), any_removal, warnings)
        if not scope.included:
            continue
        install = next((r for r in rows[m.room_id] if r.key == "install"), None)
        if install is not None and install.on:
            job_floor_sf += m.floor_sf
        elif install is None and _override(scope.items, "install").get("on") is not False:
            warnings.append(f"{m.name}: pick the new floor, or switch the new floor off for a tear-out only.")
    general = general_rows(job, job_floor_sf, any_removal, warnings)
    return Takeoff(measures, scopes, rows, doorways, general, warnings)


def takeoff_info(t: Takeoff) -> Dict[str, Any]:
    """What the estimate form shows before (and after) calculating: each
    room's measurements and every item it is offered, with its quantity,
    whether it is on and why."""
    rooms = []
    for m in t.measures:
        s = t.scopes[m.room_id]
        rooms.append({
            **m.as_dict(),
            "included": s.included, "new_material": s.new_material, "pattern": s.pattern,
            "waste_pct": s.waste_pct, "existing_material": s.existing_material,
            "transitions": t.transitions.get(m.room_id, []),
            "items": [r.as_dict() for r in t.rows[m.room_id]],
        })
    return {
        "rooms": rooms,
        "general_items": [r.as_dict() for r in t.general],
        "warnings": list(t.warnings),
    }


def _line(row: Row, room_id: Optional[str], room_name: str, level_name: Optional[str]) -> Dict[str, Any]:
    return {
        "room_id": room_id, "room_name": room_name, "level_name": level_name,
        "category": row.category, "item_key": row.key, "source": row.source,
        "description": row.label, "quantity": round(row.qty, 2), "unit": row.unit,
        "unit_price": row.unit_price, "material_unit": row.material_unit,
        "price_typed": row.price_typed, "notes": row.notes,
    }


def calculate_estimate(estimate: Any) -> Dict[str, Any]:
    t = build_takeoff(estimate)
    lines: List[Dict[str, Any]] = []
    room_totals: Dict[str, float] = {}
    for m in t.measures:
        if not t.scopes[m.room_id].included:
            continue
        for row in t.rows[m.room_id]:
            if row.billed:
                lines.append(_line(row, m.room_id, m.name, m.level_name))
    for row in t.general:
        if row.billed:
            lines.append(_line(row, None, GENERAL_ROOM_NAME, None))

    tax_rate = _tax_rate(_field(estimate, "state"), _field(estimate, "zip_code"))
    include_op = bool(_field(estimate, "include_overhead_profit", False))
    overhead_pct = float(_field(estimate, "overhead_pct", 0.10))
    profit_pct = float(_field(estimate, "profit_pct", 0.10))
    op_multiplier = (1 + overhead_pct) * (1 + profit_pct) if include_op else 1.0

    for line in lines:
        price = line["unit_price"]
        if not line["price_typed"]:
            # Material tax on the material part, then O&P on the whole
            price = (price + line["material_unit"] * tax_rate) * op_multiplier
        line["unit_price"] = round(price, 2)
        line["total"] = round(line["quantity"] * line["unit_price"], 2)
        key = line["room_id"] or GENERAL_ROOM_NAME
        room_totals[key] = room_totals.get(key, 0.0) + line["total"]
        del line["material_unit"]
        del line["price_typed"]

    subtotal = round(sum(line["total"] for line in lines), 2)
    rooms = []
    for m in t.measures:
        s = t.scopes[m.room_id]
        if not s.included:
            continue
        rooms.append({
            **m.as_dict(),
            "new_material": s.new_material, "pattern": s.pattern, "waste_pct": s.waste_pct,
            "existing_material": s.existing_material,
            "transitions": t.transitions.get(m.room_id, []),
            "total": round(room_totals.get(m.room_id, 0.0), 2),
        })

    return {
        "line_items": lines,
        "rooms": rooms,
        "general_total": round(room_totals.get(GENERAL_ROOM_NAME, 0.0), 2),
        "subtotal": subtotal,
        "overhead_amount": 0,
        "profit_amount": 0,
        "tax_amount": 0,
        "total": subtotal,
        "warning_flags": t.warnings,
        "methodology_notes": _methodology(tax_rate, include_op, overhead_pct, profit_pct),
    }


def _methodology(tax_rate: float, include_op: bool, overhead_pct: float, profit_pct: float) -> str:
    notes = [
        "Quantities are measured from the sketch, interior wall to wall.",
        "Baseboard, shoe molding and tack strip follow the perimeter less doorways and cabinet runs.",
        "New floor includes waste for cuts (more for diagonal and herringbone); carpet that takes "
        "most of a 12' roll is priced by the cut it needs.",
        f"Material tax of {tax_rate * 100:g}% is in the unit prices.",
    ]
    if include_op:
        notes.append(
            f"Overhead {overhead_pct * 100:g}% and profit {profit_pct * 100:g}% are in the unit prices."
        )
    notes.append("Prices typed in on the estimate are used as entered.")
    return " ".join(notes)
