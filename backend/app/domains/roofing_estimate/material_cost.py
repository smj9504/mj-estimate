"""
Roofing material cost estimator — INTERNAL USE ONLY.

The customer-facing estimate (calculator.py) prices everything at
*installed* rates, where material and labor are baked into one number
(e.g. architectural shingle at $750/SQ). That is useless for reasoning
about profit, because it never says how much the material actually cost.

This module answers the other question: what do we pay the supplier?
Quantities are derived from the same roof measurements the estimate
already uses, so nothing here is typed in by hand — change the roof
measurement and the material quantities follow.

Nothing in this module is exported to the customer.
"""

import logging
import math
from typing import Any, Dict, List, Optional

from .formula import FormulaError, evaluate
from .material_basis import (
    apply_formula,
    basis_unit,
    build_basis_values,
    formula_variables,
)
from .material_packaging import Packaging
from .pricing import SALES_TAX_RATES, get_waste_factor

logger = logging.getLogger(__name__)

DEFAULT_TAX_RATE = 0.06


# ── Default supplier costs (before tax) ──
#
# DMV-area supplier pricing, material only — no labor, no markup.
# These are starting points; per-estimate overrides take precedence.
#
# Costs are per PURCHASE UNIT, because that is what a supplier invoices:
# shingles by the bundle (BD), underlayment and ice barrier by the roll
# (RL), drip edge and ridge vent by the stick (PC). Pricing per SQ or SF
# would quote a quantity nobody sells and would hide the rounding — a
# roof needing 2.1 rolls is still billed for 3.
#
# See material_packaging.py for the measured -> purchase unit conversion.

SHINGLE_MATERIAL_COSTS = {
    "three_tab": 35.00,            # per BD (3 BD/SQ -> $105/SQ)
    "architectural_std": 45.00,    # -> $135/SQ
    "architectural_premium": 58.33,
    "designer": 96.67,
    "impact_resistant": 70.00,
}

RIDGE_CAP_MATERIAL_COST = 132.00   # per BD (30 LF/BD -> $4.40/LF)

UNDERLAYMENT_MATERIAL_COSTS = {
    "felt_15": 90.00,              # per RL (10 SQ/RL -> $0.09/SF)
    "felt_30": 130.00,
    "synthetic": 180.00,
}

ICE_WATER_MATERIAL_COST = 136.80   # per RL (2 SQ/RL, 48 LF/RL)

DRIP_EDGE_MATERIAL_COST = 15.50    # per PC (10 LF/PC -> $1.55/LF)

DECKING_MATERIAL_COSTS = {
    "osb_716": 38.0,               # per 4x8 sheet — already a unit sold
    "osb_12": 46.0,
    "cdx_12": 58.0,
    "cdx_58": 72.0,
}

STEP_FLASHING_MATERIAL_COST = 213.33    # per BD (100 pcs, 1.5 pcs/LF)
CHIMNEY_FLASHING_MATERIAL_COST = 145.0  # per chimney
SKYLIGHT_FLASHING_KIT_COST = 165.0      # per kit

RIDGE_VENT_MATERIAL_COSTS = {
    "shingle_over": 19.20,         # per PC (4 LF/PC -> $4.80/LF)
    "aluminum": 26.00,
}
STATIC_VENT_MATERIAL_COST = 28.0       # each
PIPE_BOOT_MATERIAL_COSTS = {
    "rubber": 14.0,
    "lead": 42.0,
    "lifetime": 30.0,
}

GUTTER_MATERIAL_COSTS = {
    "k_style_5": 18.50,            # per PC (10 LF/PC -> $1.85/LF)
    "k_style_6": 24.00,
    "half_round_5": 41.00,
    "half_round_6": 52.00,
    "copper_k_style_5": 165.00,
    "copper_k_style_6": 200.00,
}
DOWNSPOUT_MATERIAL_COSTS = {
    "2x3": 19.50,                  # per PC (10 LF/PC)
    "3x4": 27.50,
}
GUTTER_GUARD_MATERIAL_COSTS = {
    "mesh": 4.80,                  # per PC (4 LF/PC)
    "micro_mesh": 17.20,
    "foam": 3.40,
    "reverse_curve": 13.60,
}

# ── Consumables ──
#
# These used to be one "$18/SQ accessories" lump, which priced a thing no
# supplier sells and hid what was actually being bought. They are ordered
# individually — a carton of coil nails, a tube of caulk — so they are
# costed individually, by the package the supplier lists.
#
# Names match the supplier's line items so a price here can be checked
# against an invoice without translation.

CONSUMABLES = {
    "caulk": {
        "label": 'Vulkem #116 Caulk 10.1oz',
        "unit": "TB",
        "cost": 9.50,
        # One tube seals roughly three penetrations; never fewer than 2.
        "per": 3, "basis": "penetrations", "minimum": 2,
    },
    "staples": {
        "label": 'Staples Duofast 5/16" 5,000 Per Box',
        "unit": "BX",
        "cost": 22.00,
        "per": 15, "basis": "squares",
    },
    "coil_nails": {
        "label": '1-1/4" Coil Roofing Nails 7200 Carton',
        "unit": "CTN",
        "cost": 62.00,
        "per": 20, "basis": "squares",
    },
    "hand_nails": {
        "label": '2-1/2" Roofing Nail 5 LB',
        "unit": "BX",
        "cost": 18.00,
        # Used on edge metal, so it tracks drip edge rather than area.
        "per": 200, "basis": "drip_edge_lf", "minimum": 1,
    },
    "trim_coil": {
        "label": "Roofing Trim Coil 24X50",
        "unit": "RL",
        "cost": 135.00,
        # One 50 ft roll per 50 LF of counter/wall flashing.
        "per": 50, "basis": "flashing_lf",
    },
}

# Step flashing is sold pre-bent by the bundle, not loose by the box.
STEP_FLASHING_LABEL = '3" X 3" X 8" Pre-Bent Aluminum Step Flashing 100/BD'
STEP_FLASHING_PCS_PER_BD = 100
STEP_FLASHING_PCS_PER_LF = 1.5

# Kept so the price-book seed can still describe estimates made before
# the consumables were split apart.
ACCESSORY_MATERIAL_COST_PER_SQ = 18.0


# Human-readable labels, keyed by the category ids used below.
CATEGORY_LABELS = {
    "shingle": "Shingle",
    "ridge_cap": "Hip & Ridge Cap",
    "underlayment": "Underlayment",
    "ice_water": "Ice & Water Shield",
    "drip_edge": "Drip Edge",
    "decking": "Decking",
    "flashing": "Flashing",
    "ventilation": "Ventilation",
    "penetration": "Pipe Boots & Penetrations",
    "gutter": "Gutter",
    "accessories": "Nails & Accessories",
}

CATEGORY_ORDER = list(CATEGORY_LABELS.keys())


def get_material_tax_rate(state: Optional[str]) -> float:
    """Sales tax rate on materials for a state, defaulting to 6%."""
    if not state:
        return DEFAULT_TAX_RATE
    return SALES_TAX_RATES.get(state.upper(), DEFAULT_TAX_RATE)


def _measurements_for(estimate) -> Dict[str, float]:
    """Whole-roof measurements, since material is bought for the whole job.

    For EagleView estimates the top-level columns are already totals
    across every structure (extract_measurements sums all faces and
    lines), and the per-structure dicts carry only area and pitch — so
    those columns are used as-is.

    Manually entered multi-structure estimates are the exception: each
    structure carries its own linear measurements and the top-level
    columns describe just the main one, so they are summed.
    """
    keys = (
        "total_sf", "ridge_lf", "hip_lf", "valley_lf", "eave_lf",
        "rake_lf", "step_flashing_lf",
    )
    count_keys = ("penetration_count", "skylight_count", "chimney_count")

    manual_structures = estimate.manual_structures or []
    ev_structures = (estimate.eagleview_data or {}).get("structures", []) or []
    sum_manual = len(manual_structures) > 1 and len(ev_structures) <= 1

    if sum_manual:
        m: Dict[str, float] = {
            k: sum(float(s.get(k) or 0) for s in manual_structures)
            for k in keys
        }
        m.update({
            k: sum(int(s.get(k) or 0) for s in manual_structures)
            for k in count_keys
        })
        # Linear measurements are often left blank on manual structures;
        # fall back to the top-level column rather than dropping the
        # material entirely.
        for k in keys:
            if not m[k]:
                m[k] = float(getattr(estimate, k, 0) or 0)
    else:
        m = {k: float(getattr(estimate, k, 0) or 0) for k in keys}
        m.update({
            k: int(getattr(estimate, k, 0) or 0) for k in count_keys
        })

    total_sf = m["total_sf"] or float(estimate.total_sf or 0)
    m["total_sf"] = total_sf
    m["squares"] = (
        total_sf / 100 if total_sf else float(estimate.squares or 0)
    )
    m["waste_factor"] = (
        estimate.waste_factor
        if estimate.waste_factor is not None
        else get_waste_factor(estimate.roof_complexity or "hip")
    )
    return m


def _formula_of(entry: Dict[str, Any]):
    """(basis, per package, minimum) if this row carries a formula.

    A row without a basis keeps the built-in packaging rule, so adding
    the columns changes nothing until someone fills one in.
    """
    basis = entry.get("qty_basis")
    if not basis:
        return None
    per_pack = entry.get("coverage_per_unit")
    minimum = entry.get("qty_minimum") or 0
    if not per_pack and not minimum:
        return None
    return basis, float(per_pack or 0), float(minimum)


def _formula_note(basis: str, per_pack: float, unit: Optional[str]) -> str:
    """Human-readable "10 SQ/RL", or "3 BD/SQ" when a pack covers <1."""
    b_unit = basis_unit(basis)
    pack = unit or "EA"
    if per_pack <= 0:
        return "fixed minimum quantity"
    if per_pack < 1:
        # e.g. a bundle covers 1/3 SQ -> read it as 3 BD per SQ.
        return f"{round(1 / per_pack, 2):g} {pack}/{b_unit}"
    return f"{round(per_pack, 2):g} {b_unit}/{pack}"


def calculate_material_costs(
    estimate, price_book: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build the internal material cost breakdown for an estimate.

    Quantities always come from the roof measurements. Unit costs are
    resolved in priority order:

      1. an override saved on this estimate (hand-entered, or the
         snapshot taken when the estimate was created)
      2. `price_book` — the editable defaults from the database
      3. the module constants above, as a last resort

    Because an estimate snapshots its costs, later edits to the default
    price book do not rewrite the profit recorded on past jobs.
    """
    m = _measurements_for(estimate)
    overrides = estimate.material_cost_overrides or {}
    book = price_book or {}

    squares = m["squares"]
    waste = m["waste_factor"]
    squares_with_waste = squares * (1 + waste)
    total_sf = m["total_sf"]

    shingle = estimate.shingle_spec or {}
    decking = estimate.decking_spec or {}
    underlay = estimate.underlayment_spec or {}
    ice_water = estimate.ice_water_spec or {}
    flash = estimate.flashing_spec or {}
    vent = estimate.ventilation_spec or {}
    gutter = estimate.gutter_spec or {}

    rows: List[Dict[str, Any]] = []

    # Every measurement a stored formula can be written against.
    basis_values = build_basis_values(m, squares_with_waste, flash, gutter)
    formula_vars = formula_variables(basis_values)
    warnings: List[str] = []

    def add(key, category, description, qty, unit, fallback_cost,
            variant=None, measured=None, packaging_note=""):
        """Record one material row.

        `variant` names the spec that selects this material's grade
        (shingle type, gutter size, …). It becomes part of the price-book
        key so each grade carries its own editable default, while the
        estimate-level override stays keyed on the plain material.

        `qty` is in PURCHASE units (BD/RL/PC/…); `measured` is the roof
        quantity it was converted from, and `packaging_note` says how
        (e.g. "3 BD/SQ"), so the screen can show why 85 bundles.

        A price-book row carrying a quantity formula overrides `qty`
        entirely, so the rule can be corrected from the screen rather
        than in code.
        """
        price_key = f"{key}:{variant}" if variant else key
        entry = book.get(price_key) or {}

        expression = (entry.get("qty_formula") or "").strip()
        if expression:
            # A written formula wins: it is the only thing that can say
            # "if the valley run is long, add waste".
            try:
                qty = math.ceil(round(
                    evaluate(expression, dict(formula_vars)), 6))
                measured = None
                packaging_note = expression
            except FormulaError as exc:
                # Never fail the whole cost breakdown over one bad
                # formula — fall back and say what went wrong.
                logger.warning(
                    "roofing material %s formula failed: %s", key, exc)
                warnings.append(f"{description}: formula error — {exc}")
                expression = ""

        if not expression:
            formula = _formula_of(entry)
            if formula:
                basis, per_pack, minimum = formula
                measured_qty = basis_values.get(basis, 0)
                qty = apply_formula(measured_qty, per_pack, minimum)
                measured = (measured_qty, basis_unit(basis))
                packaging_note = _formula_note(
                    basis, per_pack, entry.get("unit"))

        if not qty or qty <= 0:
            return

        default_cost = entry.get("unit_cost")
        if default_cost is None:
            default_cost = fallback_cost
        default_taxable = entry.get("is_taxable", True)

        override = overrides.get(key) or {}
        unit_cost = override.get("unit_cost")
        if unit_cost is None:
            unit_cost = default_cost
        unit_cost = float(unit_cost)
        qty = round(float(qty), 2)
        rows.append({
            "key": key,
            "price_key": price_key,
            "category": category,
            "category_label": CATEGORY_LABELS.get(category, category),
            "description": description,
            "quantity": qty,
            "unit": unit,
            # What the roof actually measured, before packaging rounding.
            "measured_quantity": (
                round(float(measured[0]), 2) if measured else None
            ),
            "measured_unit": measured[1] if measured else None,
            "packaging_note": packaging_note,
            "unit_cost": round(unit_cost, 4),
            "default_unit_cost": round(float(default_cost), 4),
            "is_overridden": override.get("unit_cost") is not None,
            "taxable": override.get("taxable", default_taxable),
            "subtotal": round(qty * unit_cost, 2),
            "note": override.get("note") or "",
        })

        # Expose the result so a later material can be written against
        # it — hand nails are ordered from the coil-nail count, not from
        # a roof measurement. Rows are built in order, so only materials
        # added earlier are visible.
        formula_vars[f"qty_{key}"] = float(qty)

    # Packaging follows the shingle brand: bundles per square and roll
    # lengths differ between manufacturers.
    pack = Packaging(shingle.get("brand"))

    # ── Shingle ──
    shingle_type = shingle.get("type", "architectural_std")
    qty, unit, note = pack.shingle(squares_with_waste)
    add(
        "shingle", "shingle",
        f"Shingle — {shingle_type.replace('_', ' ').title()}",
        qty, unit,
        SHINGLE_MATERIAL_COSTS.get(shingle_type, 45.0),
        variant=shingle_type,
        measured=(squares_with_waste, "SQ"), packaging_note=note,
    )

    ridge_hip_lf = m["ridge_lf"] + m["hip_lf"]
    qty, unit, note = pack.hip_ridge(ridge_hip_lf)
    add(
        "ridge_cap", "ridge_cap", "Hip & ridge cap shingle",
        qty, unit, RIDGE_CAP_MATERIAL_COST,
        measured=(ridge_hip_lf, "LF"), packaging_note=note,
    )

    # ── Underlayment & ice barrier ──
    # Ice barrier comes first: felt is not laid over it, so the felt
    # formula subtracts the area those rolls cover and therefore needs
    # `qty_ice_water` to already exist.
    #
    # Ice barrier rolls are bought by length, so the run is what matters
    # — eaves plus valleys — not the square footage it ends up covering.
    eaves_width = ice_water.get("eaves_width_ft", 3)
    iw_lf = m["eave_lf"] + m["valley_lf"]
    iw_sf = (
        m["eave_lf"] * eaves_width
        + m["valley_lf"] * 6
        + m["penetration_count"] * 4
    )
    qty, unit, note = pack.ice_water(iw_lf)
    add(
        "ice_water", "ice_water", "Ice & water shield",
        qty, unit, ICE_WATER_MATERIAL_COST,
        measured=(iw_lf, "LF"),
        packaging_note=f"{note} (covers {iw_sf:,.0f} SF)",
    )

    # Underlayment is sold by roof area covered, so it converts from
    # squares rather than the SF the estimate prices it by.
    underlay_type = underlay.get("type", "synthetic")
    underlay_sq = total_sf * 1.05 / 100
    qty, unit, note = pack.underlayment(underlay_sq)
    add(
        "underlayment", "underlayment",
        f"Underlayment — {underlay_type.replace('_', ' ').title()}",
        qty, unit,
        UNDERLAYMENT_MATERIAL_COSTS.get(underlay_type, 180.0),
        variant=underlay_type,
        measured=(underlay_sq, "SQ"), packaging_note=note,
    )

    # ── Drip edge ──
    drip_lf = m["eave_lf"] + m["rake_lf"]
    qty, unit, note = pack.drip_edge(drip_lf)
    add(
        "drip_edge", "drip_edge", "Drip edge (aluminum)",
        qty, unit, DRIP_EDGE_MATERIAL_COST,
        measured=(drip_lf, "LF"), packaging_note=note,
    )

    # ── Decking: only sheets billed beyond the free allowance ──
    deck_material = decking.get("material", "osb_716")
    free_sheets = decking.get("free_sheets_included", 2) or 0
    est_sheets = decking.get("estimated_sheets_needed", 0) or 0
    add(
        "decking", "decking",
        f"Decking — {deck_material.upper()}",
        max(est_sheets - free_sheets, 0), "EA",
        DECKING_MATERIAL_COSTS.get(deck_material, 38.0),
        variant=deck_material,
    )

    # ── Flashing ──
    step_lf = flash.get("step_flashing_lf", m["step_flashing_lf"])
    qty, unit, note = pack.step_flashing(step_lf)
    add(
        "step_flashing", "flashing", STEP_FLASHING_LABEL,
        qty, unit, STEP_FLASHING_MATERIAL_COST,
        measured=(step_lf, "LF"), packaging_note=note,
    )
    add(
        "chimney_flashing", "flashing", "Chimney flashing",
        flash.get("chimney_flashing", m["chimney_count"]), "EA",
        CHIMNEY_FLASHING_MATERIAL_COST,
    )
    add(
        "skylight_flashing", "flashing", "Skylight flashing kit",
        flash.get("skylight_flashing_kits", m["skylight_count"]), "EA",
        SKYLIGHT_FLASHING_KIT_COST,
    )

    # ── Ventilation ──
    if m["ridge_lf"] > 0:
        rv_type = vent.get("ridge_vent_type", "shingle_over")
        rv_lf = vent.get("ridge_vent_lf", m["ridge_lf"])
        qty, unit, note = pack.ridge_vent(rv_lf)
        add(
            "ridge_vent", "ventilation",
            f"Ridge vent — {rv_type.replace('_', ' ').title()}",
            qty, unit,
            RIDGE_VENT_MATERIAL_COSTS.get(rv_type, 19.20),
            variant=rv_type,
            measured=(rv_lf, "LF"), packaging_note=note,
        )
    add(
        "static_vent", "ventilation", "Static box vent",
        vent.get("static_vents", 0), "EA", STATIC_VENT_MATERIAL_COST,
    )

    # ── Penetrations: itemized list when present, else the boot count ──
    penetrations = estimate.roof_penetrations or []
    boot_type = flash.get("pipe_boot_type", "lifetime")
    if penetrations:
        for idx, pen in enumerate(penetrations):
            qty = pen.get("quantity", 1) or 0
            p_type = pen.get("type", "other")
            add(
                f"penetration_{idx}", "penetration",
                p_type.replace("_", " ").title(),
                qty, "EA",
                PIPE_BOOT_MATERIAL_COSTS.get(p_type, 30.0),
                variant=p_type,
            )
    else:
        add(
            "pipe_boots", "penetration",
            f"Pipe boots ({boot_type})",
            flash.get("pipe_boots", m["penetration_count"]), "EA",
            PIPE_BOOT_MATERIAL_COSTS.get(boot_type, 30.0),
            variant=boot_type,
        )

    # ── Gutter (only when in scope) ──
    if gutter.get("included", False):
        g_style = gutter.get("style", "k_style")
        g_size = gutter.get("size", 5)
        g_material = gutter.get("material", "aluminum")
        cost_key = (
            f"copper_{g_style}_{g_size}" if g_material == "copper"
            else f"{g_style}_{g_size}"
        )
        g_lf = gutter.get("total_lf", 0)
        qty, unit, note = pack.gutter(g_lf)
        add(
            "gutter", "gutter",
            f'Gutter {g_size}" {g_style.replace("_", "-")} {g_material}',
            qty, unit,
            GUTTER_MATERIAL_COSTS.get(cost_key, 18.50),
            variant=cost_key,
            measured=(g_lf, "LF"), packaging_note=note,
        )

        ds_size = gutter.get("downspout_size", "2x3")
        ds_lf = gutter.get("downspout_lf", 0)
        qty, unit, note = pack.downspout(ds_lf)
        add(
            "downspout", "gutter", f"Downspout {ds_size}",
            qty, unit,
            DOWNSPOUT_MATERIAL_COSTS.get(ds_size, 19.50),
            variant=ds_size,
            measured=(ds_lf, "LF"), packaging_note=note,
        )

        if gutter.get("gutter_guards", False):
            guard_type = gutter.get("guard_type", "mesh")
            guard_lf = gutter.get("guard_lf", gutter.get("total_lf", 0))
            qty, unit, note = pack.gutter_guard(guard_lf)
            add(
                "gutter_guard", "gutter",
                f"Gutter guard ({guard_type.replace('_', ' ')})",
                qty, unit,
                GUTTER_GUARD_MATERIAL_COSTS.get(guard_type, 4.80),
                variant=guard_type,
                measured=(guard_lf, "LF"), packaging_note=note,
            )

    # ── Consumables ──
    # One row per item actually ordered, so a line here can be checked
    # against a supplier invoice. The defaults below are the fallback;
    # a price-book row with a formula overrides them inside add().
    for key, spec in CONSUMABLES.items():
        measured_qty = basis_values.get(spec["basis"], 0)
        minimum = spec.get("minimum", 0)
        b_unit = basis_unit(spec["basis"])
        qty = apply_formula(measured_qty, spec["per"], minimum)
        add(
            key, "accessories", spec["label"],
            qty, spec["unit"], spec["cost"],
            measured=(measured_qty, b_unit),
            packaging_note=f"{spec['per']:g} {b_unit}/{spec['unit']}",
        )

    result = _summarize(rows, estimate)
    # Surface any formula that failed, rather than silently
    # falling back and showing a number nobody expected.
    result["formula_warnings"] = warnings
    return result


def _summarize(rows: List[Dict[str, Any]], estimate) -> Dict[str, Any]:
    """Roll rows up into category groups, tax, and implied profit."""
    tax_rate = estimate.material_tax_rate
    if tax_rate is None:
        tax_rate = get_material_tax_rate(estimate.state)
    tax_rate = float(tax_rate)

    subtotal = round(sum(r["subtotal"] for r in rows), 2)
    taxable_subtotal = round(
        sum(r["subtotal"] for r in rows if r["taxable"]), 2,
    )
    tax_amount = round(taxable_subtotal * tax_rate, 2)
    total_with_tax = round(subtotal + tax_amount, 2)

    categories = []
    for cat in CATEGORY_ORDER:
        cat_rows = [r for r in rows if r["category"] == cat]
        if not cat_rows:
            continue
        cat_subtotal = round(sum(r["subtotal"] for r in cat_rows), 2)
        cat_taxable = round(
            sum(r["subtotal"] for r in cat_rows if r["taxable"]), 2,
        )
        cat_tax = round(cat_taxable * tax_rate, 2)
        categories.append({
            "category": cat,
            "label": CATEGORY_LABELS.get(cat, cat),
            "items": cat_rows,
            "subtotal": cat_subtotal,
            "tax_amount": cat_tax,
            "total_with_tax": round(cat_subtotal + cat_tax, 2),
            "pct_of_material": (
                round(cat_subtotal / subtotal * 100, 1) if subtotal else 0.0
            ),
        })

    estimate_total = float(estimate.total or 0)
    # Deliberately NOT a profit figure. Subtracting material alone counts
    # the crew and the dumpster as profit, which reported ~70% margins on
    # jobs that clear far less. Real profit needs labor and disposal too
    # and is computed in job_cost.py; this is only the share of the sale
    # that materials consume.
    material_pct_of_sale = (
        round(total_with_tax / estimate_total * 100, 1)
        if estimate_total else None
    )
    gross_profit = None
    margin_pct = None

    return {
        "items": rows,
        "categories": categories,
        "tax_rate": tax_rate,
        "subtotal_before_tax": subtotal,
        "taxable_subtotal": taxable_subtotal,
        "tax_amount": tax_amount,
        "total_with_tax": total_with_tax,
        "estimate_total": estimate_total or None,
        # Kept for API compatibility; both are None now — see above.
        "gross_profit": gross_profit,
        "margin_pct": margin_pct,
        "material_pct_of_sale": material_pct_of_sale,
    }
