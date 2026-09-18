"""
Editable default supplier costs for roofing materials.

`material_cost.py` holds the constants as a last-resort fallback; this
module puts the same values in the database so they can be maintained
from the UI as supplier pricing moves.

Estimates snapshot the costs in force when they are created, so editing
a default here changes what *new* estimates start from and never
rewrites the profit already recorded on past jobs.
"""

import re
import uuid
from typing import Any, Dict, List, Optional

from .material_cost import (
    CHIMNEY_FLASHING_MATERIAL_COST,
    CONSUMABLES,
    DECKING_MATERIAL_COSTS,
    DOWNSPOUT_MATERIAL_COSTS,
    DRIP_EDGE_MATERIAL_COST,
    GUTTER_GUARD_MATERIAL_COSTS,
    GUTTER_MATERIAL_COSTS,
    ICE_WATER_MATERIAL_COST,
    PIPE_BOOT_MATERIAL_COSTS,
    RIDGE_CAP_MATERIAL_COST,
    RIDGE_VENT_MATERIAL_COSTS,
    SHINGLE_MATERIAL_COSTS,
    SKYLIGHT_FLASHING_KIT_COST,
    STATIC_VENT_MATERIAL_COST,
    STEP_FLASHING_LABEL,
    STEP_FLASHING_MATERIAL_COST,
    UNDERLAYMENT_MATERIAL_COSTS,
)
from .models import RoofingMaterialPrice


def _title(value: str) -> str:
    return value.replace("_", " ").title()


def build_default_catalog() -> List[Dict[str, Any]]:
    """Every price-book entry, keyed to match material_cost.py rows.

    Materials that come in grades get one entry per grade, keyed
    "<material>:<variant>", so each grade carries its own cost.
    """
    entries: List[Dict[str, Any]] = []

    def add(key, label, category, unit, cost):
        entries.append({
            "material_key": key,
            "label": label,
            "category": category,
            "unit": unit,
            "unit_cost": float(cost),
        })

    for variant, cost in SHINGLE_MATERIAL_COSTS.items():
        add(f"shingle:{variant}", f"Shingle — {_title(variant)}",
            "shingle", "BD", cost)

    add("ridge_cap", "Hip & ridge cap shingle", "ridge_cap", "BD",
        RIDGE_CAP_MATERIAL_COST)

    for variant, cost in UNDERLAYMENT_MATERIAL_COSTS.items():
        add(f"underlayment:{variant}", f"Underlayment — {_title(variant)}",
            "underlayment", "RL", cost)

    add("ice_water", "Ice & water shield", "ice_water", "RL",
        ICE_WATER_MATERIAL_COST)
    add("drip_edge", "Drip edge (aluminum)", "drip_edge", "PC",
        DRIP_EDGE_MATERIAL_COST)

    for variant, cost in DECKING_MATERIAL_COSTS.items():
        add(f"decking:{variant}", f"Decking — {variant.upper()}",
            "decking", "EA", cost)

    add("step_flashing", STEP_FLASHING_LABEL, "flashing", "BD",
        STEP_FLASHING_MATERIAL_COST)
    add("chimney_flashing", "Chimney flashing", "flashing", "EA",
        CHIMNEY_FLASHING_MATERIAL_COST)
    add("skylight_flashing", "Skylight flashing kit", "flashing", "EA",
        SKYLIGHT_FLASHING_KIT_COST)

    for variant, cost in RIDGE_VENT_MATERIAL_COSTS.items():
        add(f"ridge_vent:{variant}", f"Ridge vent — {_title(variant)}",
            "ventilation", "PC", cost)
    add("static_vent", "Static box vent", "ventilation", "EA",
        STATIC_VENT_MATERIAL_COST)

    # Pipe boots are keyed both as the legacy single row and as the
    # itemized penetration rows, which share the same boot costs.
    for variant, cost in PIPE_BOOT_MATERIAL_COSTS.items():
        add(f"pipe_boots:{variant}", f"Pipe boot — {_title(variant)}",
            "penetration", "EA", cost)

    for variant, cost in GUTTER_MATERIAL_COSTS.items():
        add(f"gutter:{variant}", f"Gutter — {_title(variant)}",
            "gutter", "PC", cost)
    for variant, cost in DOWNSPOUT_MATERIAL_COSTS.items():
        add(f"downspout:{variant}", f"Downspout {variant}",
            "gutter", "PC", cost)
    for variant, cost in GUTTER_GUARD_MATERIAL_COSTS.items():
        add(f"gutter_guard:{variant}", f"Gutter guard — {_title(variant)}",
            "gutter", "PC", cost)

    # Consumables, one row each rather than a single "accessories" lump,
    # so each can be priced against its own supplier line.
    for key, spec in CONSUMABLES.items():
        add(key, spec["label"], "accessories", spec["unit"], spec["cost"])

    return entries


def seed_material_prices(session, company_id=None) -> int:
    """Create any missing price-book rows. Idempotent.

    Existing rows are left alone so a seed run never overwrites a cost
    the user has edited. Returns the number of rows created.
    """
    query = session.query(RoofingMaterialPrice.material_key)
    if company_id:
        query = query.filter(RoofingMaterialPrice.company_id == company_id)
    else:
        query = query.filter(RoofingMaterialPrice.company_id.is_(None))
    existing = {k for (k,) in query.all()}

    created = 0
    for entry in build_default_catalog():
        if entry["material_key"] in existing:
            continue
        session.add(RoofingMaterialPrice(
            **entry, is_taxable=True, is_active=True, company_id=company_id,
        ))
        created += 1

    if created:
        session.flush()
    return created


def build_material_key(
    session, label: str, category: str, company_id=None,
) -> str:
    """A stable, unique key for a user-created material.

    Seeded keys look like "shingle:architectural_std"; custom ones get a
    "custom:" prefix so they can never collide with a catalog key that a
    later seed run might introduce.
    """
    slug = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    slug = slug[:60] or "material"
    base = f"custom:{category}:{slug}"

    taken = {
        k for (k,) in session.query(RoofingMaterialPrice.material_key)
        .filter(RoofingMaterialPrice.material_key.like(f"{base}%"))
        .all()
    }
    if base not in taken:
        return base
    for n in range(2, 1000):
        candidate = f"{base}_{n}"
        if candidate not in taken:
            return candidate
    return f"{base}_{uuid.uuid4().hex[:8]}"


def price_entry_dict(row) -> Dict[str, Any]:
    """One price-book row as the API and the costing both consume it."""
    return {
        "id": str(row.id),
        "material_key": row.material_key,
        "label": row.label,
        "category": row.category,
        "unit": row.unit,
        "unit_cost": float(row.unit_cost or 0),
        "is_taxable": bool(row.is_taxable),
        "is_active": bool(row.is_active),
        "notes": row.notes or "",
        "company_id": str(row.company_id) if row.company_id else None,
        "manufacturer": row.manufacturer,
        "product_name": row.product_name,
        "color": row.color,
        "size_spec": row.size_spec,
        "supplier": row.supplier,
        "sku": row.sku,
        # Quantity formula: an expression, or basis/coverage/floor.
        "qty_formula": row.qty_formula,
        "qty_basis": row.qty_basis,
        "coverage_per_unit": (
            float(row.coverage_per_unit)
            if row.coverage_per_unit is not None else None
        ),
        "coverage_unit": row.coverage_unit,
        "qty_minimum": (
            float(row.qty_minimum) if row.qty_minimum is not None else None
        ),
        "is_custom": bool(row.is_custom),
    }


def load_price_book(
    session, company_id=None, include_inactive: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """Price book as {material_key: {unit_cost, is_taxable, ...}}.

    A company's own row wins over the shared default for the same key,
    so a company can diverge on individual materials without having to
    restate the whole catalog.

    Pure read: the shared defaults are inserted by migration
    rfg20260917pb03, and `seed_material_prices` repairs the table on the
    write path if that insert was skipped. Callers get an empty book on
    an unseeded database, which `material_cost.py` covers with its
    constants.
    """
    query = session.query(RoofingMaterialPrice)
    if not include_inactive:
        query = query.filter(RoofingMaterialPrice.is_active.is_(True))
    rows = query.all()

    book: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if row.company_id is not None and str(row.company_id) != str(
            company_id or ""
        ):
            continue
        existing = book.get(row.material_key)
        # Company-specific rows take precedence over the shared default.
        if existing and existing.get("company_id") and row.company_id is None:
            continue
        book[row.material_key] = price_entry_dict(row)
    return book


def snapshot_for_estimate(
    price_book: Dict[str, Dict[str, Any]],
    rows: List[Dict[str, Any]],
    existing_overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Freeze today's defaults onto an estimate.

    Called once, when an estimate's material costs are first viewed, so
    that later edits to the price book leave this estimate's numbers —
    and the profit computed from them — untouched. Anything the user has
    already overridden by hand is preserved as-is.

    The unit is stored alongside the cost because a cost only means
    anything in its unit: $45 is right per bundle and badly wrong per
    square. `drop_stale_snapshot_entries` relies on it.
    """
    snapshot: Dict[str, Any] = dict(existing_overrides or {})
    for row in rows:
        key = row["key"]
        if key in snapshot:
            continue
        snapshot[key] = {
            "unit_cost": row["unit_cost"],
            "taxable": row["taxable"],
            "from_price_book": row.get("price_key"),
            "unit": row.get("unit"),
        }
    return snapshot


def drop_stale_snapshot_entries(
    overrides: Optional[Dict[str, Any]],
    rows: List[Dict[str, Any]],
) -> tuple:
    """Discard snapshot costs that are no longer in the row's unit.

    Migration pu05 restated the price book from per-SQ/SF rates into
    purchase units (bundles, rolls, sticks). Estimates costed before that
    hold a snapshot in the old unit, and keeping it multiplies a per-SQ
    rate by a bundle count — a shingle line triples, an underlayment line
    falls to a thousandth.

    Such an entry is dropped so the material re-resolves against the
    current price book. An entry with no recorded unit predates the fix
    and is also dropped: a cost whose unit is unknown cannot be trusted.
    Hand-entered costs already in the right unit are kept.

    Returns (cleaned_overrides, dropped_keys).
    """
    if not overrides:
        return overrides, []

    units = {
        row["key"]: row.get("unit") for row in rows
    }
    cleaned: Dict[str, Any] = {}
    dropped: List[str] = []

    for key, entry in overrides.items():
        current_unit = units.get(key)
        # A material no longer produced by this estimate keeps its entry:
        # it costs nothing here and may matter if the scope comes back.
        if current_unit is None:
            cleaned[key] = entry
            continue
        if not isinstance(entry, dict) or entry.get("unit_cost") is None:
            cleaned[key] = entry
            continue
        if entry.get("unit") == current_unit:
            cleaned[key] = entry
        else:
            dropped.append(key)

    return cleaned, dropped
