"""
Roofing Estimate calculator.
8-Phase calculation engine matching DMV contractor standards.
Supports multi-structure estimates (e.g., main house + detached shed).

Phases:
1. Setup & Protection / Tear-off
2. Deck Inspection / Replacement
3. Underlayment & Ice Barrier
4. Drip Edge & Flashing
5. Shingle Install
6. Ventilation & Penetrations
7. Gutter (optional)
8. Cleanup & Misc
"""

import logging
from typing import Any, Dict, List, Optional

from .dumpster import select_dumpsters
from .material_packaging import round_squares_to_bundle
from .material_portion import (
    apply_material_portions,
    derive_material_portions,
    portion_warnings,
)
from .pricing import get_material_portion
from .rate_resolver import DEFAULT_RATES, Rates

logger = logging.getLogger(__name__)

PHASE_LABELS = {
    1: "Setup & Tear-off",
    2: "Decking",
    3: "Underlayment & Ice Barrier",
    4: "Drip Edge & Flashing",
    5: "Shingle Install",
    6: "Ventilation & Penetrations",
    7: "Gutter",
    8: "Cleanup & Misc",
}


def calculate_estimate(
    estimate, material_cost_rows: Optional[List[Dict]] = None,
    rate_overrides: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Calculate all line items for a roofing estimate.

    Supports multi-structure: if eagleview_data has >1 structure,
    generates separate line items per structure with structure_index.

    `material_cost_rows` are the supplier cost rows from
    calculate_material_costs(). When given, each line item's material /
    labor split is derived from what the material actually costs instead
    of the fixed ratios in pricing.py, so a price-book edit moves markup
    and sales tax. Installed rates — and so the subtotal — are unchanged
    either way. Omit it and the ratios apply as before.

    `rate_overrides` are the edited calculation settings from
    pricing_settings.load_settings() — installed rates, multipliers,
    waste factors, tax and permit fees. Anything not overridden falls
    back to the pricing.py constant, so omitting this prices exactly as
    the code always did.

    Returns:
        Dict with line_items, structure_results,
        subtotal, markup, tax, total, etc.
    """
    # Detect structures from EagleView data
    ev_data = estimate.eagleview_data or {}
    structures = ev_data.get("structures", [])
    ev_faces = ev_data.get("faces", [])
    ev_lines = ev_data.get("lines", [])

    # Manual multi-structure
    manual_structures = estimate.manual_structures or []

    # Common estimate-level config
    config = _build_config(estimate, material_cost_rows, rate_overrides)

    if len(structures) > 1:
        return _calculate_multi_structure(
            estimate, structures, ev_faces, ev_lines, config,
        )
    elif len(manual_structures) > 1:
        return _calculate_manual_multi_structure(
            estimate, manual_structures, config,
        )
    else:
        return _calculate_single_structure(estimate, config)


def _build_config(
    estimate, material_cost_rows: Optional[List[Dict]] = None,
    rate_overrides: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Extract shared config from estimate ORM object."""
    return {
        "state": estimate.state or "MD",
        # County/city, for the NoVA tax add-on and the permit rules.
        "locality": getattr(estimate, "locality", None) or (
            (estimate.hidden_costs or {}).get("locality")),
        "year_built": estimate.year_built or 2000,
        "stories": estimate.stories or 1,
        "full_tearoff": estimate.full_tearoff,
        "layer_count": estimate.layer_count or 1,
        "existing_material": estimate.existing_material or "asphalt",
        "insurance_job": estimate.insurance_job,
        "hoa": estimate.hoa,
        "shingle_spec": estimate.shingle_spec or {},
        "decking_spec": estimate.decking_spec or {},
        "underlayment_spec": estimate.underlayment_spec or {},
        "ice_water_spec": estimate.ice_water_spec or {},
        "flashing_spec": estimate.flashing_spec or {},
        "ventilation_spec": estimate.ventilation_spec or {},
        "gutter_spec": estimate.gutter_spec or {},
        "hidden_costs": estimate.hidden_costs or {},
        "material_markup_pct": estimate.material_markup_pct if estimate.material_markup_pct is not None else 0.25,
        "labor_markup_pct": estimate.labor_markup_pct if estimate.labor_markup_pct is not None else 0.20,
        "include_overhead_profit": (
            estimate.include_overhead_profit),
        "overhead_pct": estimate.overhead_pct if estimate.overhead_pct is not None else 0.10,
        "profit_pct": estimate.profit_pct if estimate.profit_pct is not None else 0.10,
        "contingency_pct": estimate.contingency_pct if estimate.contingency_pct is not None else 0.05,
        # None -> per-category ratios; a value overrides every category.
        "material_portion_pct": getattr(
            estimate, "material_portion_pct", None),
        # Supplier cost rows, when the caller has resolved a price book.
        # Absent -> the per-category ratios in pricing.py still decide the
        # material/labor split, so calculate_estimate() keeps working for
        # callers that have no database session (tests, PDF re-renders).
        "material_cost_rows": material_cost_rows,
        # Resolves every installed rate, multiplier, tax and fee to its
        # edited value, falling through to the pricing.py constant when
        # nobody has changed it.
        "rates": Rates(rate_overrides),
        "target_total": getattr(estimate, "target_total", None),
        "roof_penetrations": getattr(estimate, "roof_penetrations", None) or [],
        "skylight_replacements": getattr(estimate, "skylight_replacements", None) or [],
    }


def _calculate_single_structure(estimate, config: Dict) -> Dict[str, Any]:
    """Original single-structure calculation."""
    rates = config.get("rates") or DEFAULT_RATES
    sf = estimate.total_sf or 0
    measurements = {
        "total_sf": sf,
        "squares": estimate.squares or sf / 100,
        "predominant_pitch": estimate.predominant_pitch or "6/12",
        "ridge_lf": estimate.ridge_lf or 0,
        "hip_lf": estimate.hip_lf or 0,
        "valley_lf": estimate.valley_lf or 0,
        "eave_lf": estimate.eave_lf or 0,
        "rake_lf": estimate.rake_lf or 0,
        "step_flashing_lf": estimate.step_flashing_lf or 0,
        "penetration_count": estimate.penetration_count or 0,
        "skylight_count": estimate.skylight_count or 0,
        "chimney_count": estimate.chimney_count or 0,
        "waste_factor": estimate.waste_factor or rates.waste_factor(
            estimate.roof_complexity or "hip"),
        "roof_complexity": estimate.roof_complexity or "hip",
    }

    items, warnings, dumpster, rounding = _generate_line_items(
        measurements, config, structure_index=0,
    )
    return _finalize_totals(items, warnings, config,
                            structure_results=None,
                            dumpster=dumpster,
                            rounding=rounding)


def _calculate_manual_multi_structure(
    estimate, manual_structures: List[Dict], config: Dict,
) -> Dict[str, Any]:
    """Calculate per-structure from manually entered measurements."""
    rates = config.get("rates") or DEFAULT_RATES
    all_items: List[Dict] = []
    all_warnings: List[str] = []
    structure_results: List[Dict] = []
    dumpster: Optional[Dict] = None
    rounding: Optional[Dict] = None

    # Pre-calc combined squares for dumpster
    total_all_sf = sum(s.get("total_sf", 0) for s in manual_structures)
    combined_squares = round(total_all_sf / 100, 2)

    for s in manual_structures:
        s_idx = s.get("index", 0)
        s_label = s.get("label", f"Structure #{s_idx + 1}")
        total_sf = s.get("total_sf", 0)
        if total_sf <= 0:
            structure_results.append({
                "structure_index": s_idx,
                "label": s_label,
                "included": False,
                "total_sf": 0,
                "subtotal": 0,
                "total": 0,
            })
            continue

        complexity = s.get("roof_complexity", estimate.roof_complexity or "hip")
        waste = s.get(
            "waste_factor",
            estimate.waste_factor or rates.waste_factor(complexity))

        measurements = {
            "total_sf": round(total_sf, 1),
            "squares": round(total_sf / 100, 2),
            "predominant_pitch": s.get("predominant_pitch", estimate.predominant_pitch or "6/12"),
            "ridge_lf": s.get("ridge_lf", 0),
            "hip_lf": s.get("hip_lf", 0),
            "valley_lf": s.get("valley_lf", 0),
            "eave_lf": s.get("eave_lf", 0),
            "rake_lf": s.get("rake_lf", 0),
            "step_flashing_lf": s.get("step_flashing_lf", 0),
            "penetration_count": s.get("penetration_count", 0),
            "skylight_count": s.get("skylight_count", 0),
            "chimney_count": s.get("chimney_count", 0),
            "waste_factor": waste,
            "roof_complexity": complexity,
        }

        struct_config = dict(config)
        struct_config["_is_multi_structure"] = True

        # Main structure: use combined squares for dumpster
        if s_idx == 0:
            struct_config["_dumpster_squares"] = combined_squares

        # Per-structure gutter config
        gutter_base = config["gutter_spec"]
        per_struct = gutter_base.get("per_structure", [])
        ps_cfg = next(
            (ps for ps in per_struct
             if ps.get("structure_index") == s_idx),
            None,
        )
        if ps_cfg is not None:
            struct_config["gutter_spec"] = {
                "included": ps_cfg.get("included", False),
                "style": gutter_base.get("style", "k_style"),
                "size": gutter_base.get("size", 5),
                "material": gutter_base.get("material", "aluminum"),
                "total_lf": ps_cfg.get("total_lf", 0),
                "downspout_count": ps_cfg.get("downspout_count", 0),
                "downspout_lf": ps_cfg.get("downspout_lf", 0),
                "downspout_size": gutter_base.get("downspout_size", "2x3"),
                "splash_blocks": ps_cfg.get("splash_blocks", 0),
                "remove_existing": ps_cfg.get("remove_existing", False),
                "gutter_guards": gutter_base.get("gutter_guards", False),
                "guard_type": gutter_base.get("guard_type", "mesh"),
            }
        elif s_idx > 0:
            struct_config["gutter_spec"] = {"included": False}

        # Secondary: skip permit/lead/dumpster
        if s_idx > 0:
            struct_config["hidden_costs"] = {
                "permit_option": "none",
                "lead_rrp": False,
                "dumpster": False,
            }

        items, warnings, s_dumpster, s_rounding = _generate_line_items(
            measurements, struct_config, structure_index=s_idx)

        struct_subtotal = sum(it["total"] for it in items)

        structure_results.append({
            "structure_index": s_idx,
            "label": s_label,
            "included": True,
            "total_sf": measurements["total_sf"],
            "squares": measurements["squares"],
            "predominant_pitch": measurements["predominant_pitch"],
            "subtotal": round(struct_subtotal, 2),
            "total": round(struct_subtotal, 2),
        })

        all_items.extend(items)
        all_warnings.extend(warnings)
        if s_dumpster and dumpster is None:
            dumpster = s_dumpster
        if s_rounding and rounding is None:
            rounding = s_rounding

    return _finalize_totals(all_items, all_warnings, config,
                            structure_results=structure_results,
                            dumpster=dumpster, rounding=rounding)


def _calculate_multi_structure(
    estimate, structures: List[Dict], ev_faces: List[Dict],
    ev_lines: List[Dict], config: Dict,
) -> Dict[str, Any]:
    """Calculate per-structure, then combine."""
    rates = config.get("rates") or DEFAULT_RATES
    all_items: List[Dict] = []
    all_warnings: List[str] = []
    structure_results: List[Dict] = []
    dumpster: Optional[Dict] = None

    selected_faces_set = set(estimate.selected_faces or [])

    # Pre-calc total squares for combined dumpster
    total_all_sf = 0.0
    for s in structures:
        sf = [
            f for f in ev_faces
            if f.get("structure_index") == s["index"]
            and not f.get("is_accessory", False)
        ]
        if selected_faces_set:
            sf = [f for f in sf
                  if f["id"] in selected_faces_set]
        total_all_sf += sum(
            f.get("area", 0) for f in sf
        )
    combined_squares = round(total_all_sf / 100, 2)

    for struct in structures:
        s_idx = struct["index"]
        s_label = struct.get("label", f"Structure #{s_idx + 1}")

        # Get faces for this structure
        struct_faces = [
            f for f in ev_faces
            if f.get("structure_index") == s_idx
            and not f.get("is_accessory", False)
        ]
        # If selected_faces is set, filter further
        if selected_faces_set:
            struct_faces = [
                f for f in struct_faces
                if f["id"] in selected_faces_set
            ]

        if not struct_faces:
            structure_results.append({
                "structure_index": s_idx,
                "label": s_label,
                "included": False,
                "total_sf": 0,
                "subtotal": 0,
                "total": 0,
            })
            continue

        # Compute measurements for this structure
        struct_ev_lines = [
            ln for ln in ev_lines
            if ln.get("structure_index") == s_idx
        ]

        total_sf = sum(
            f.get("area", 0) for f in struct_faces
        )
        pitches = {}
        for f in struct_faces:
            p = f.get("pitch", "6/12")
            if p and p != "?":
                pitches[p] = (
                    pitches.get(p, 0) + f.get("area", 0)
                )
        predominant_pitch = (
            max(pitches, key=pitches.get)
            if pitches else "6/12"
        )

        # Sum lines by type
        line_totals: Dict[str, float] = {}
        for ln in struct_ev_lines:
            lt = ln.get("type", "OTHER")
            line_totals[lt] = (
                line_totals.get(lt, 0)
                + ln.get("length", 0)
            )

        # Count accessories (penetrations)
        accessories = [
            f for f in ev_faces
            if f.get("structure_index") == s_idx
            and f.get("is_accessory", False)
        ]

        complexity = struct.get("complexity", "hip")
        waste = rates.waste_factor(complexity)

        measurements = {
            "total_sf": round(total_sf, 1),
            "squares": round(total_sf / 100, 2),
            "predominant_pitch": predominant_pitch,
            "ridge_lf": round(line_totals.get("RIDGE", 0), 1),
            "hip_lf": round(line_totals.get("HIP", 0), 1),
            "valley_lf": round(line_totals.get("VALLEY", 0), 1),
            "eave_lf": round(line_totals.get("EAVE", 0), 1),
            "rake_lf": round(line_totals.get("RAKE", 0), 1),
            "step_flashing_lf": round(
                line_totals.get("STEPFLASH", 0)
                + line_totals.get("FLASHING", 0), 1),
            "penetration_count": len(accessories),
            "skylight_count": 0,
            "chimney_count": 0,
            "waste_factor": waste,
            "roof_complexity": complexity,
        }

        struct_config = dict(config)
        struct_config["_is_multi_structure"] = True

        # Main structure: use combined squares for dumpster
        if s_idx == 0:
            struct_config["_dumpster_squares"] = combined_squares

        # Per-structure gutter config
        gutter_base = config["gutter_spec"]
        per_struct = gutter_base.get("per_structure", [])
        ps_cfg = next(
            (ps for ps in per_struct
             if ps.get("structure_index") == s_idx),
            None,
        )
        if ps_cfg is not None:
            # Use per-structure gutter settings
            struct_config["gutter_spec"] = {
                "included": ps_cfg.get("included", False),
                "style": gutter_base.get("style", "k_style"),
                "size": gutter_base.get("size", 5),
                "material": gutter_base.get("material", "aluminum"),
                "total_lf": ps_cfg.get("total_lf", 0),
                "downspout_count": ps_cfg.get("downspout_count", 0),
                "downspout_lf": ps_cfg.get("downspout_lf", 0),
                "downspout_size": gutter_base.get("downspout_size", "2x3"),
                "splash_blocks": ps_cfg.get("splash_blocks", 0),
                "remove_existing": ps_cfg.get("remove_existing", False),
                "gutter_guards": gutter_base.get("gutter_guards", False),
                "guard_type": gutter_base.get("guard_type", "mesh"),
            }
        elif s_idx > 0:
            # No per_structure config, secondary = no gutter
            struct_config["gutter_spec"] = {
                "included": False,
            }

        # Secondary: skip permit/lead/dumpster
        if s_idx > 0:
            struct_config["hidden_costs"] = {
                "permit_option": "none",
                "lead_rrp": False,
                "dumpster": False,
            }

        items, warnings, s_dumpster, s_rounding = _generate_line_items(
            measurements, struct_config, structure_index=s_idx)

        struct_subtotal = sum(it["total"] for it in items)

        structure_results.append({
            "structure_index": s_idx,
            "label": s_label,
            "included": True,
            "total_sf": measurements["total_sf"],
            "squares": measurements["squares"],
            "predominant_pitch": measurements["predominant_pitch"],
            "subtotal": round(struct_subtotal, 2),
            "total": round(struct_subtotal, 2),
        })

        all_items.extend(items)
        all_warnings.extend(warnings)
        if s_dumpster and dumpster is None:
            dumpster = s_dumpster
        if s_rounding and rounding is None:
            rounding = s_rounding

    return _finalize_totals(all_items, all_warnings, config,
                            structure_results=structure_results,
                            dumpster=dumpster, rounding=rounding)


def _generate_line_items(
    m: Dict[str, Any], config: Dict[str, Any], structure_index: int = 0,
) -> tuple:
    """Generate 8-phase line items from measurements + config.

    Returns (line_items, warnings).
    """
    line_items: List[Dict] = []
    warnings: List[str] = []
    order = 0
    rates = config.get("rates") or DEFAULT_RATES
    # Set when a dumpster is billed, so the estimate can show why that
    # size was chosen rather than just the line item.
    dumpster_pick: Optional[Dict] = None
    # Set when the billed area was stepped up to whole bundles, so the
    # quote can explain why 9.41 SQ is billed as 9.67.
    rounding_note: Optional[Dict] = None

    total_sf = m["total_sf"]
    squares = m["squares"]
    pitch = m["predominant_pitch"]
    pitch_mult = rates.pitch_multiplier(pitch)
    story_mult = rates.story_multiplier(config["stories"])

    complexity = m.get("roof_complexity", "hip")
    waste = m.get("waste_factor", rates.waste_factor(complexity))
    # Shingles are sold by the bundle, three to a square, so the billed
    # area steps in thirds: 10, 10.33, 10.67, 11. Billing the raw
    # 27.50 SQ would be 82.5 bundles — half a bundle nobody can buy, and
    # 0.17 SQ less than the material side already orders.
    squares_raw = squares * (1 + waste)
    squares_with_waste = round_squares_to_bundle(squares_raw)
    if abs(squares_with_waste - squares_raw) > 0.005:
        rounding_note = {
            "measured_squares": round(squares, 2),
            "waste_pct": round(waste * 100),
            "squares_with_waste": round(squares_raw, 2),
            "billed_squares": round(squares_with_waste, 2),
            "bundles": int(round(squares_with_waste * 3)),
        }
    else:
        rounding_note = None

    year_built = config["year_built"]
    needs_lead_rrp = year_built < 1978

    ridge_lf = m.get("ridge_lf", 0)
    hip_lf = m.get("hip_lf", 0)
    valley_lf = m.get("valley_lf", 0)
    eave_lf = m.get("eave_lf", 0)
    rake_lf = m.get("rake_lf", 0)
    step_flash_lf = m.get("step_flashing_lf", 0)
    penetrations = m.get("penetration_count", 0)
    skylights = m.get("skylight_count", 0)
    chimneys = m.get("chimney_count", 0)

    shingle = config["shingle_spec"]
    decking = config["decking_spec"]
    underlay = config["underlayment_spec"]
    ice_water = config["ice_water_spec"]
    flash = config["flashing_spec"]
    vent = config["ventilation_spec"]
    gutter = config["gutter_spec"]
    hidden = config["hidden_costs"]
    all_penetrations = config.get("roof_penetrations") or []
    # Filter penetrations for this structure
    # If structure_index is None/missing: single-structure mode → include all;
    # multi-structure mode → assign to structure 0 only
    is_multi = config.get("_is_multi_structure", False)
    roof_penetrations = [
        p for p in all_penetrations
        if p.get("structure_index") == structure_index
        or (p.get("structure_index") is None
            and (not is_multi or structure_index == 0))
    ]

    mp_override = config.get("material_portion_pct")

    def _add(phase, desc, qty, unit, rate, cost, cat, xact=None):
        nonlocal order
        line_items.append(_item(
            phase, desc, qty, unit, rate, cost, cat, xact, order,
            structure_index,
            material_portion=rates.material_portion(cat, mp_override),
        ))
        order += 1

    # ── PHASE 1: Setup & Tear-off ──

    if config["full_tearoff"]:
        layers = config["layer_count"]
        material = config["existing_material"]

        if material == "cedar_shake":
            rate = rates.tearoff("cedar_shake_per_sq")
            desc = f"Tear-off cedar shake ({layers} layer)"
        else:
            rate_key = f"{layers}_layer_per_sq"
            rate = rates.tearoff(
                rate_key, rates.tearoff("1_layer_per_sq"))
            desc = f"Tear-off asphalt shingles ({layers} layer)"

        _add(1, desc, squares, "SQ", rate,
             squares * rate, "tearoff", "RFG 220")

    if hidden.get("dumpster", True):
        # Size the can by what the tear-off actually weighs rather than
        # billing one standard size: cedar shake and multi-layer roofs
        # need a bigger can, a small single-layer roof a smaller one.
        # Use combined squares if provided (multi-structure).
        dump_sq = config.get("_dumpster_squares", squares)
        pick = select_dumpsters(
            squares=dump_sq,
            # "asphalt" is generic; when the existing roof is known to
            # be architectural the debris is materially heavier.
            material=(
                config["existing_material"]
                if config["existing_material"] != "asphalt"
                else (hidden.get("existing_shingle_type") or "asphalt")
            ),
            layers=config["layer_count"],
            # Decking replaced comes off with the roof; the estimate
            # already knows how many sheets it billed for.
            decking_sheets=max(
                0,
                (decking.get("estimated_sheets_needed", 0) or 0)
                - (decking.get("free_sheets_included", 2) or 0),
            ) if decking.get("estimated_sheets_needed") else 0,
            wet=bool(hidden.get("wet_debris")),
        )
        if pick["cans"]:
            weight = pick["weight"]["total_lb"]
            # A split load bills each size on its own line: "30 yard +
            # 10 yard" is what gets ordered and what the invoice shows.
            counts: Dict[int, int] = {}
            for can in pick["cans"]:
                counts[can["yards"]] = counts.get(can["yards"], 0) + 1
            first = True
            for yards, qty in sorted(counts.items(), reverse=True):
                rate = rates.tearoff(f"dumpster_{yards}yard")
                desc = f"Dumpster {yards} yard ({qty}x)"
                if first:
                    desc += f" — est. {weight:,.0f} lb debris"
                    first = False
                _add(1, desc, qty, "EA", rate, qty * rate, "tearoff")
            dumpster_pick = pick
            if pick.get("capacity_used_pct", 0) > 95:
                warnings.append(
                    f"Estimated debris {weight:,.0f} lb is "
                    f"{pick['capacity_used_pct']:.0f}% of the container "
                    f"capacity. Overage charges may apply if the actual "
                    f"tear-off is heavier than estimated."
                )

    # ── PHASE 2: Decking ──

    deck_material = decking.get("material", "osb_716")
    free_sheets = decking.get("free_sheets_included", 2)
    est_sheets = decking.get("estimated_sheets_needed", 0)
    deck_rate = decking.get("rate_per_sheet",
                            rates.decking(deck_material))

    if est_sheets > free_sheets:
        billable = est_sheets - free_sheets
        _add(2, f"Decking replacement ({deck_material.upper()}, "
                f"{billable} sheets beyond {free_sheets} free)",
             billable, "EA", deck_rate, billable * deck_rate,
             "decking", "RFG ROOFOSB")

    if decking.get("re_nail_existing", False):
        re_nail_sf = decking.get("re_nail_sf", total_sf)
        rate = rates.decking("re_nail_per_sf")
        _add(2, "Re-nail existing decking", re_nail_sf, "SF", rate,
             re_nail_sf * rate, "decking")

    # ── PHASE 3: Underlayment & Ice Barrier ──

    underlay_type = underlay.get("type", "synthetic")
    underlay_rate = underlay.get("rate_per_sf",
                                 rates.underlayment(underlay_type))
    underlay_sf = total_sf * 1.05
    _add(3, f"Underlayment ({underlay_type})",
         round(underlay_sf, 0), "SF", underlay_rate,
         underlay_sf * underlay_rate, "underlayment", "RFG UNDLAY")

    iw_rate = ice_water.get("rate_per_sf", rates.ice_water)
    eaves_width = ice_water.get("eaves_width_ft", 3)
    iw_total_sf = (eave_lf * eaves_width + valley_lf * 6 + penetrations * 4)
    if iw_total_sf > 0:
        _add(3, "Ice & water shield", round(iw_total_sf, 0), "SF",
             iw_rate, iw_total_sf * iw_rate, "ice_water", "RFG IWS")

    # ── PHASE 4: Drip Edge & Flashing ──

    drip_lf = eave_lf + rake_lf
    if drip_lf > 0:
        _add(4, "Drip edge (aluminum)", drip_lf, "LF", rates.drip_edge,
             drip_lf * rates.drip_edge, "drip_edge", "RFG DRIP")

    flash_lf = flash.get("step_flashing_lf", step_flash_lf)
    if flash_lf > 0:
        rate = rates.flashing("step_flashing_per_lf")
        _add(4, "Step flashing", flash_lf, "LF", rate,
             flash_lf * rate, "flashing", "RFG STEP")

    chimney_ct = flash.get("chimney_flashing", chimneys)
    for i in range(chimney_ct):
        cricket_list = flash.get("chimney_cricket", [])
        has_cricket = cricket_list[i] if i < len(cricket_list) else False
        rk = "chimney_large" if has_cricket else "chimney_small"
        rate = rates.flashing(rk)
        desc = f"Chimney flashing #{i+1}"
        if has_cricket:
            desc += " (w/ cricket)"
        _add(4, desc, 1, "EA", rate, rate, "flashing", "RFG CHIMS")

    sky_ct = flash.get("skylight_flashing_kits", skylights)
    if sky_ct > 0:
        rate = rates.flashing("skylight_flashing_kit")
        _add(4, "Skylight flashing kit", sky_ct, "EA", rate,
             sky_ct * rate, "flashing")

    # Itemized penetrations (new) or legacy pipe boot fallback
    if roof_penetrations:
        for pen in roof_penetrations:
            p_type = pen.get("type", "other")
            p_qty = pen.get("quantity", 1)
            if p_qty <= 0:
                continue
            rate = rates.penetration(p_type)
            label = p_type.replace("_", " ").title()
            notes = pen.get("notes", "")
            desc = f"{label}"
            if notes:
                desc += f" ({notes})"
            _add(4, desc, p_qty, "EA", rate,
                 p_qty * rate, "penetration", "RFG VENTPIPE")
    else:
        # Legacy: simple pipe boot count
        pipe_ct = flash.get("pipe_boots", penetrations)
        boot_type = flash.get("pipe_boot_type", "lifetime")
        if pipe_ct > 0:
            rate = rates.pipe_boot(boot_type)
            _add(4, f"Pipe boots ({boot_type})", pipe_ct, "EA",
                 rate, pipe_ct * rate, "flashing", "RFG VENTPIPE")

    # ── PHASE 5: Shingle Install ──

    shingle_type = shingle.get("type", "architectural_std")
    shingle_rate = shingle.get("rate_per_square",
                               rates.shingle(shingle_type))
    site_ops_total = (
        rates.misc("driveway_protection")
        + rates.misc("magnetic_sweep")
    )
    site_ops_per_sq = site_ops_total / max(squares_with_waste, 1)
    adjusted_rate = (shingle_rate + site_ops_per_sq) * pitch_mult * story_mult
    cost = squares_with_waste * adjusted_rate

    product = shingle.get("product", "")
    brand = shingle.get("brand", "")
    waste_pct = round(waste * 100)
    desc = f"Shingle install - {shingle_type.replace('_', ' ').title()}"
    if product:
        desc += f" ({brand} {product})".strip()
    desc += (
        f" [{squares:.2f} SQ + {waste_pct}% waste"
        f" = {squares_raw:.2f} → {squares_with_waste:.2f} SQ]"
        if abs(squares_with_waste - squares_raw) > 0.005
        else f" [{squares:.2f} SQ + {waste_pct}% waste]"
    )

    _add(5, desc, round(squares_with_waste, 2), "SQ",
         round(adjusted_rate, 2), cost, "shingle", "RFG 300")

    cap_lf = ridge_lf + hip_lf
    if cap_lf > 0:
        _add(5, "Hip & ridge cap shingle", cap_lf, "LF", rates.ridge_cap,
             cap_lf * rates.ridge_cap, "ridge_cap", "RFG RIDGC")

    # ── PHASE 6: Ventilation & Penetrations ──

    if ridge_lf > 0:
        vent_lf = vent.get("ridge_vent_lf", ridge_lf)
        rv_type = vent.get("ridge_vent_type", "shingle_over")
        rate_key = f"ridge_vent_{rv_type}_per_lf"
        rate = rates.ventilation(rate_key)
        rv_label = rv_type.replace("_", " ").title()
        _add(6, f"Continuous ridge vent — {rv_label}", vent_lf,
             "LF", rate, vent_lf * rate, "ventilation", "RFG RVENT")

    static_ct = vent.get("static_vents", 0)
    if static_ct > 0:
        rate = rates.ventilation("static_vent_each")
        _add(6, "Static box vent", static_ct, "EA", rate,
             static_ct * rate, "ventilation", "RFG VENTSTAT")

    if hidden.get("vent_cap_replace", False):
        exhaust_ct = vent.get("exhaust_vents", 2)
        rate = rates.misc("vent_cap_replace_each")
        _add(6, "Exhaust vent cap replacement", exhaust_ct, "EA", rate,
             exhaust_ct * rate, "ventilation")

    # ── PHASE 7: Gutter (optional) ──

    if gutter.get("included", False):
        g_style = gutter.get("style", "k_style")
        g_size = gutter.get("size", 5)
        g_material = gutter.get("material", "aluminum")
        g_lf = gutter.get("total_lf", 0)

        splash = gutter.get("splash_blocks", 0)
        from .pricing import GUTTER_RATES
        splash_cost = (
            splash * GUTTER_RATES.get("splash_block", 10.0)
            if splash else 0
        )

        if g_lf > 0:
            rate = rates.gutter(g_style, g_size, g_material)
            gutter_cost = g_lf * rate + splash_cost
            effective_rate = round(gutter_cost / g_lf, 2)
            desc = (f"Gutter {g_size}\" {g_style.replace('_', '-')} "
                    f"{g_material} seamless")
            if splash:
                desc += f" (incl. {splash} splash blocks)"
            _add(7, desc, g_lf, "LF", effective_rate, gutter_cost,
                 "gutter", f"GTR ALU{g_size}")

        ds_lf = gutter.get("downspout_lf", 0)
        ds_count = gutter.get("downspout_count", 0)
        ds_size = gutter.get("downspout_size", "2x3")
        if ds_lf > 0:
            rate = GUTTER_RATES.get(f"downspout_{ds_size}", 6.5)
            count_note = f" ({ds_count}x)" if ds_count else ""
            _add(7, f"Downspout {ds_size} aluminum{count_note}",
                 ds_lf, "LF", rate, ds_lf * rate, "gutter", "GTR DSPALM")

        if gutter.get("remove_existing", False):
            rem_lf = gutter.get("remove_existing_lf", g_lf)
            rate = GUTTER_RATES["removal_per_lf"]
            desc = "Detach & reset existing gutter"
            _add(7, desc, rem_lf, "LF", rate,
                 rem_lf * rate, "gutter")

        if gutter.get("gutter_guards", False):
            guard_type = gutter.get("guard_type", "mesh")
            guard_lf = gutter.get("guard_lf", g_lf)
            rate = rates.guard(guard_type)
            _add(7, f"Gutter guards ({guard_type})", guard_lf, "LF", rate,
                 guard_lf * rate, "gutter", "GTR GRD")

    # ── PHASE 8: Cleanup & Misc ──

    if needs_lead_rrp and hidden.get("lead_rrp", True):
        rate = rates.misc("lead_rrp")
        _add(8, "Lead paint RRP compliance (pre-1978)",
             1, "LS", rate, rate, "misc")
        warnings.append("Pre-1978 building: Lead RRP compliance required")

    if hidden.get("satellite_removal", False):
        rate = rates.misc("satellite_removal")
        _add(8, "Satellite dish removal", 1, "LS", rate, rate, "misc")

    if hidden.get("hoa_review", False) or config.get("hoa"):
        rate = rates.misc("hoa_review_fee")
        _add(8, "HOA architectural review fee", 1, "LS", rate, rate, "misc")

    # Warnings
    if pitch_mult > 1.0:
        warnings.append(
            f"Steep slope surcharge applied: {pitch} pitch "
            f"({pitch_mult}x labor multiplier)")
    if story_mult > 1.0:
        warnings.append(
            f"Height surcharge: {config['stories']}-story "
            f"({story_mult}x multiplier)")
    if waste > 0.15:
        warnings.append(
            f"High waste factor: {waste*100:.0f}%"
            f" (complex roof geometry)"
        )

    warnings.append(
        f"Decking allowance: {free_sheets} sheets included free. "
        f"Additional sheets: ${deck_rate:.2f} each.")

    return line_items, warnings, dumpster_pick, rounding_note


def _is_permit(item: Dict) -> bool:
    """The building permit pass-through line."""
    return item["description"].startswith("Building permit")


def _material_of(item: Dict) -> float:
    """Material half of a line item's total.

    Falls back to the category ratio for items built outside _item(),
    so a stored line item from before the split existed still resolves.
    """
    if item.get("material_cost") is not None:
        return item["material_cost"]
    portion = item.get("material_portion")
    if portion is None:
        portion = get_material_portion(item.get("category") or "misc")
    return item["total"] * portion


def _resync_costs(item: Dict) -> None:
    """Recompute an item's material/labor split after its total changed."""
    portion = item.get("material_portion")
    if portion is None:
        portion = get_material_portion(item.get("category") or "misc")
        item["material_portion"] = round(portion, 4)
    item["material_cost"] = round(item["total"] * portion, 2)
    item["labor_cost"] = round(item["total"] - item["material_cost"], 2)


def _finalize_totals(
    line_items: List[Dict], warnings: List[str],
    config: Dict, structure_results: Optional[List[Dict]],
    dumpster: Optional[Dict] = None,
    rounding: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Apply markup, tax, permit, target-total adjustment."""
    state = config["state"]
    hidden = config["hidden_costs"]
    rates = config.get("rates") or DEFAULT_RATES

    # Re-split each line into material and labor using what the material
    # actually costs, before any of the maths below reads those halves.
    # Every calculation path lands here, so this covers single, manual
    # multi- and EagleView multi-structure estimates alike.
    material_rows = config.get("material_cost_rows")
    derived_portions = {}
    if material_rows:
        derived_portions = derive_material_portions(line_items, material_rows)
        apply_material_portions(
            line_items, derived_portions, config["material_portion_pct"],
        )
        if config["material_portion_pct"] is None:
            warnings.extend(portion_warnings(derived_portions))

    # Separate gutter (phase 7) from main roofing subtotal
    roofing_subtotal = sum(
        item["total"] for item in line_items if item.get("phase") != 7
    )
    gutter_subtotal = sum(
        item["total"] for item in line_items if item.get("phase") == 7
    )
    subtotal = roofing_subtotal + gutter_subtotal

    # Material sales tax the COMPANY owes its supplier. In MD and VA a
    # roofing contractor is the final consumer of what it affixes to the
    # building, so this is a cost folded into the price — never a line
    # the customer is charged. Kept in the total, hidden on the quote.
    tax_rate = rates.sales_tax(
        state, config.get("locality"),
        (config.get("hidden_costs") or {}).get("priced_on"),
    )

    def _totals_for(items: List[Dict]) -> Dict[str, float]:
        """Markup / O&P / contingency / tax over a set of line items.

        Markup and sales tax both run off each item's own material and
        labor halves, so a labor-only line like tear-off is neither taxed
        nor marked up as though it were half material.

        The permit line is skipped: it is a pass-through fee added to the
        grand total on its own, so counting it here would mark it up and
        then add it a second time.
        """
        items = [it for it in items if not _is_permit(it)]
        base = sum(it["total"] for it in items)
        material = sum(_material_of(it) for it in items)
        labor = base - material

        markup = (
            material * config["material_markup_pct"]
            + labor * config["labor_markup_pct"]
        )
        overhead = 0.0
        profit = 0.0
        if config["include_overhead_profit"]:
            overhead = base * config["overhead_pct"]
            profit = base * config["profit_pct"]
        return {
            "subtotal": base,
            "material_cost_total": material,
            "labor_cost_total": labor,
            "markup": markup,
            "overhead": overhead,
            "profit": profit,
            "contingency": base * config["contingency_pct"],
            # Tax is on materials only, markup included: what the customer
            # is charged for material is the taxable amount.
            "tax": (material + material * config["material_markup_pct"])
            * tax_rate,
        }

    def _grand_multiplier(material_portion: float) -> float:
        """How much the grand total moves per $1 on a line item.

        One dollar of line item also carries its markup, O&P, contingency
        and — on the material share — sales tax.
        """
        mp = material_portion
        mult = 1.0
        mult += (mp * config["material_markup_pct"]
                 + (1 - mp) * config["labor_markup_pct"])
        if config["include_overhead_profit"]:
            mult += config["overhead_pct"] + config["profit_pct"]
        mult += config["contingency_pct"]
        mult += mp * (1 + config["material_markup_pct"]) * tax_rate
        return mult or 1.0

    totals = _totals_for(line_items)
    material_cost_total = totals["material_cost_total"]
    labor_cost_total = totals["labor_cost_total"]
    markup_amount = totals["markup"]
    overhead_amount = totals["overhead"]
    profit_amount = totals["profit"]
    contingency = totals["contingency"]
    tax_amount = totals["tax"]

    # Permit (once for entire estimate). Roof area drives the fee in
    # the jurisdictions that meter by the square foot.
    if not config.get("_permit_roof_sf"):
        config["_permit_roof_sf"] = round(sum(
            it["quantity"] * 100 for it in line_items
            if it.get("category") == "shingle" and it.get("unit") == "SQ"
        ), 1)
    permit_option = hidden.get("permit_option", "state")
    if permit_option is None:
        permit_option = "state" if hidden.get("permit", True) else "none"

    if permit_option == "none":
        permit_fee = 0
    elif permit_option == "custom":
        permit_fee = hidden.get("permit_custom_fee") or 0
    else:
        # A like-for-like shingle replacement is permit-exempt in most
        # DMV jurisdictions; replacing decking or touching structure is
        # not. Jurisdictions that do charge meter by roof area.
        decking_spec = config.get("decking_spec") or {}
        like_for_like = not (
            decking_spec.get("estimated_sheets_needed")
            or decking_spec.get("re_nail_existing")
            or hidden.get("structural_work")
        )
        locality = (
            config.get("locality") if permit_option == "state"
            else permit_option
        )
        permit_fee = rates.permit_fee(
            state, locality, like_for_like,
            config.get("_permit_roof_sf", 0),
        )

    if permit_fee > 0:
        permit_label = (
            permit_option.upper() if permit_option in ("MD", "VA", "DC")
            else (config.get("locality") or state)
            if permit_option == "state"
            else "Custom"
        )
        line_items.append(_item(
            8, f"Building permit ({permit_label})",
            1, "LS", permit_fee, permit_fee,
            "misc", None, len(line_items), 0,
            material_portion=rates.material_portion(
                "misc", config.get("material_portion_pct")),
        ))

    grand_total = (subtotal + markup_amount + overhead_amount
                   + profit_amount + contingency + tax_amount + permit_fee)

    # Target total adjustment (excludes gutter — gutter priced separately)
    adjustment_factor = None
    target_total = config.get("target_total")

    def _is_adjustable(it: Dict) -> bool:
        """Roofing items only: gutter and the permit are priced apart."""
        return it.get("phase") != 7 and not _is_permit(it)

    def _roofing_grand() -> tuple:
        """(grand total, subtotal) for the adjustable roofing items."""
        adjustable = [it for it in line_items if _is_adjustable(it)]
        t = _totals_for(adjustable)
        grand = (t["subtotal"] + t["markup"] + t["overhead"] + t["profit"]
                 + t["contingency"] + t["tax"] + permit_fee)
        return grand, t["subtotal"]

    if target_total and target_total > 0 and roofing_subtotal > 0:
        roofing_grand, roofing_subtotal = _roofing_grand()

        fixed_costs = permit_fee
        adjustable_target = target_total - fixed_costs
        adjustable_current = roofing_grand - fixed_costs
        if adjustable_current > 0:
            adjustment_factor = adjustable_target / adjustable_current
            # Only adjust non-gutter, non-permit items
            for item in line_items:
                if not _is_adjustable(item):
                    continue
                item["unit_price"] = round(
                    item["unit_price"] * adjustment_factor, 2,
                )
                item["total"] = round(
                    item["quantity"] * item["unit_price"], 2)
                _resync_costs(item)

            # Fix rounding drift on roofing items.
            #
            # A dollar added to a line item does not move the grand total
            # by a dollar: it also carries that line's markup, O&P,
            # contingency and (on its material half) sales tax. Solve for
            # the line delta that closes the gap instead of assuming 1:1.
            roofing_grand, roofing_subtotal = _roofing_grand()

            rounding_diff = round(target_total - roofing_grand, 2)
            if rounding_diff != 0:
                adjustable = [
                    it for it in line_items if _is_adjustable(it)
                ]
                if adjustable:
                    largest = max(adjustable, key=lambda x: x["total"])
                    mp = largest.get("material_portion")
                    if mp is None:
                        mp = rates.material_portion(
                            largest.get("category") or "misc")
                    grand_per_dollar = _grand_multiplier(mp)
                    largest["total"] = round(
                        largest["total"]
                        + rounding_diff / grand_per_dollar, 2)
                    if largest["quantity"]:
                        largest["unit_price"] = round(
                            largest["total"] / largest["quantity"], 2
                        )
                    _resync_costs(largest)
                    _, roofing_subtotal = _roofing_grand()

            warnings.append(
                f"Target total applied: ${target_total:,.2f} "
                f"(adjustment factor: {adjustment_factor:.4f})"
                f" — Gutter excluded from target")

        # Recalculate combined totals
        gutter_subtotal = sum(
            item["total"] for item in line_items
            if item.get("phase") == 7
        )
        subtotal = roofing_subtotal + gutter_subtotal
        totals = _totals_for(line_items)
        material_cost_total = totals["material_cost_total"]
        labor_cost_total = totals["labor_cost_total"]
        markup_amount = totals["markup"]
        overhead_amount = totals["overhead"]
        profit_amount = totals["profit"]
        contingency = totals["contingency"]
        tax_amount = totals["tax"]
        grand_total = (subtotal + markup_amount + overhead_amount
                       + profit_amount + contingency
                       + tax_amount + permit_fee)

    # Update structure_results subtotals after adjustment
    if structure_results:
        for sr in structure_results:
            if not sr.get("included"):
                continue
            s_idx = sr["structure_index"]
            sr_subtotal = sum(
                it["total"] for it in line_items
                if it.get("structure_index") == s_idx
                and not it["description"].startswith("Building permit")
            )
            sr["subtotal"] = round(sr_subtotal, 2)
            sr["total"] = round(sr_subtotal, 2)

    return {
        "line_items": line_items,
        "structure_results": structure_results,
        # Which categories took their material share from the price book,
        # and the cost/billed pair behind each — so the split can be
        # explained on screen instead of appearing as a bare percentage.
        "material_portions": derived_portions or None,
        # Why this can size was chosen: estimated tear-off weight and
        # the capacity it was matched against.
        "dumpster": dumpster,
        # Present when the billed area was stepped up to whole bundles;
        # the quote explains the step in a note.
        "square_rounding": rounding,
        "roofing_subtotal": round(roofing_subtotal, 2),
        "gutter_subtotal": round(gutter_subtotal, 2),
        "subtotal": round(subtotal, 2),
        "markup_amount": round(markup_amount, 2),
        "overhead_amount": round(overhead_amount, 2),
        "profit_amount": round(profit_amount, 2),
        "contingency_amount": round(contingency, 2),
        "material_cost_total": round(material_cost_total, 2),
        "labor_cost_total": round(labor_cost_total, 2),
        "tax_amount": round(tax_amount, 2),
        "permit_fee": round(permit_fee, 2),
        "total": round(grand_total, 2),
        "adjustment_factor": (
            round(adjustment_factor, 6)
            if adjustment_factor else None
        ),
        "warnings": warnings,
        "phase_summary": _build_phase_summary(line_items),
        "add_ons": _build_skylight_addons(config),
    }


def _item(phase: int, description: str, quantity: float, unit: str,
          unit_price: float, total: float, category: str,
          xactimate_code: str = None, display_order: int = 0,
          structure_index: int = 0,
          material_portion: float = None) -> Dict:
    """Build one line item, including its material/labor split.

    `material_portion` is stored per item so markup and sales tax can be
    applied to the real material half of each line rather than to one
    blended ratio across the whole estimate.
    """
    total = round(total, 2)
    if material_portion is None:
        material_portion = get_material_portion(category)
    material_cost = round(total * material_portion, 2)
    return {
        "phase": phase,
        "description": description,
        "quantity": round(quantity, 2),
        "unit": unit,
        "unit_price": round(unit_price, 2),
        "total": total,
        "category": category,
        "xactimate_code": xactimate_code,
        "display_order": display_order,
        "structure_index": structure_index,
        "material_portion": round(material_portion, 4),
        "material_cost": material_cost,
        "labor_cost": round(total - material_cost, 2),
    }


def _build_skylight_addons(config: Dict) -> List[Dict]:
    """Generate skylight replacement add-on quotes (not in base estimate)."""
    rates = config.get("rates") or DEFAULT_RATES
    skylight_spec = config.get("skylight_replacements") or []
    addons = []
    for sky in skylight_spec:
        sky_type = sky.get("type", "medium_fixed")
        qty = sky.get("quantity", 1)
        rate = rates.skylight(sky_type)
        label = sky_type.replace("_", " ").title()
        location = sky.get("location", "")
        desc = f"Skylight replacement — {label}"
        if location:
            desc += f" ({location})"
        addons.append({
            "description": desc,
            "quantity": qty,
            "unit": "EA",
            "unit_price": round(rate, 2),
            "total": round(qty * rate, 2),
            "category": "skylight_replacement",
        })
    return addons


def _build_phase_summary(line_items: List[Dict]) -> Dict[str, float]:
    """Build phase-level cost summary."""
    summary = {}
    for item in line_items:
        phase = item["phase"]
        label = PHASE_LABELS.get(phase, f"Phase {phase}")
        summary[label] = summary.get(label, 0) + item["total"]
    return {k: round(v, 2) for k, v in summary.items()}
