"""
AI-powered overview note generator for bathroom estimates.
Generates contextual project descriptions based on estimate specs.
Falls back to template-based generation if AI is unavailable.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def generate_overview_note(estimate) -> str:
    """Generate an overview note for the estimate.
    Tries AI generation first, falls back to template.
    """
    try:
        return _generate_ai_note(estimate)
    except Exception as e:
        logger.warning(f"AI note generation failed, using template: {e}")
        return _generate_template_note(estimate)


def _generate_ai_note(estimate) -> str:
    """Use Claude API to generate a professional overview note."""
    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    # Build context from estimate
    context = _build_context(estimate)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": f"""Write a professional bathroom remodel estimate overview note (2-3 paragraphs, max 200 words) for a client-facing document. Be concise and professional.

Project details:
{context}

Requirements:
- Start with "This estimate covers..." or "This proposal outlines..."
- Mention the specific scope of work (what's being replaced/remodeled)
- Note any special considerations (water damage, lead paint, cast iron tub, mold, etc.)
- Mention the finish quality level if applicable
- End with a brief note about exclusions (structural changes, HVAC, etc.)
- Use professional contractor language
- Do NOT include pricing or dollar amounts
- Do NOT use bullet points - use flowing prose paragraphs"""
        }]
    )

    return message.content[0].text.strip()


def _generate_template_note(estimate) -> str:
    """Template-based overview note generation (no AI needed)."""
    parts = []

    # Opening
    designation = (estimate.designation or "").replace("_", " ")
    bath_fn = (estimate.bath_function or "full").replace("_", " ")
    address = estimate.property_address or "the subject property"

    scope_items = []
    if estimate.replace_tub:
        tub_spec = estimate.bathtub_spec or {}
        tub_type = (tub_spec.get("type", "alcove")).replace("_", " ")
        tub_mat = (tub_spec.get("material", "acrylic")).replace("_", " ")
        tub_desc = f"{tub_type} bathtub ({tub_mat})"
        if tub_spec.get("surround_tile"):
            tub_desc += " with tiled surround"
        scope_items.append(tub_desc)
    elif getattr(estimate, 'detach_reset_tub', False):
        tub_spec = estimate.bathtub_spec or {}
        tub_type = (tub_spec.get("type", "alcove")).replace("_", " ")
        tub_mat = (tub_spec.get("material", "acrylic")).replace("_", " ")
        tub_desc = f"bathtub D&R ({tub_type}, {tub_mat})"
        if tub_spec.get("surround_tile"):
            tub_desc += " — surround tile replaced"
        scope_items.append(tub_desc)
    if estimate.replace_shower:
        shower_spec = estimate.shower_spec or {}
        s_type = (shower_spec.get("type", "")).replace("_", " ")
        if s_type:
            scope_items.append(f"{s_type} shower")
    if estimate.replace_vanity:
        van = estimate.vanity_spec or {}
        v_width = van.get("width", "")
        scope_items.append(f'{v_width}" vanity' if v_width else "vanity")
    if estimate.replace_toilet:
        scope_items.append("toilet")
    floor_spec = estimate.floor_spec or {}
    if floor_spec.get("material"):
        f_mat = floor_spec["material"].replace("_", " ")
        scope_items.append(f"{f_mat} flooring")

    demo_areas = []
    if estimate.demo_floor: demo_areas.append("floor")
    if estimate.demo_walls: demo_areas.append("walls")
    if estimate.demo_ceiling: demo_areas.append("ceiling")

    parts.append(
        f"This estimate covers a like-for-like {designation} {bath_fn} bathroom "
        f"remodel at {address}."
    )

    if scope_items:
        scope_str = ", ".join(scope_items[:-1])
        if len(scope_items) > 1:
            scope_str += f", and {scope_items[-1]}"
        else:
            scope_str = scope_items[0]
        demo_desc = f", with {', '.join(demo_areas)} demolition" if demo_areas else ""
        parts.append(
            f"The scope of work includes replacement of {scope_str}{demo_desc}."
        )

    # Substrate & waterproofing
    sub = estimate.substrate_spec or {}
    wp_type = sub.get("waterproof_type", "none")
    if wp_type != "none":
        wp_names = {"redgard": "RedGard", "kerdi": "Schluter Kerdi", "hydroban": "HydroBan"}
        parts.append(
            f"Wet area substrate will be cement board with {wp_names.get(wp_type, wp_type)} "
            f"waterproofing membrane applied per manufacturer specifications."
        )

    # Special considerations
    specials = []
    if estimate.water_damage:
        if getattr(estimate, 'demo_already_done', False):
            specials.append(
                "demolition completed by mitigation team (repair/rebuild scope)"
            )
        else:
            specials.append(
                "restoration scope (conditions to be verified upon demo)"
            )
    repair_areas = []
    if getattr(estimate, 'repair_drywall_walls', False):
        repair_areas.append("wall drywall")
    if getattr(estimate, 'repair_drywall_ceiling', False):
        repair_areas.append("ceiling drywall")
    if getattr(estimate, 'repair_subfloor', False):
        repair_areas.append("subfloor")
    if getattr(estimate, 'install_insulation_walls', False):
        repair_areas.append("wall insulation")
    if getattr(estimate, 'install_insulation_ceiling', False):
        repair_areas.append("ceiling insulation")
    if repair_areas:
        specials.append(
            f"repair/replacement of {', '.join(repair_areas)}"
        )
    if getattr(estimate, 'demo_cement_board', False):
        cb_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        specials.append(
            f"cement board ({cb_sf:.0f}SF) — partial removal and replacement"
            if cb_sf else
            "cement board requiring partial demo and replacement"
        )
    if estimate.mold_suspected:
        specials.append("moisture conditions identified (separate remediation if required)")
    year = estimate.year_built or 2000
    if year < 1978:
        specials.append(f"lead paint compliance (built {year}, EPA RRP rule applies)")
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron":
        specials.append("cast iron tub removal requiring specialized labor")

    if specials:
        parts.append(
            f"Special considerations include: {'; '.join(specials)}."
        )

    # Accessories
    acc = estimate.accessories_spec or {}
    acc_finish = (acc.get("finish", "")).replace("_", " ")
    acc_grade = acc.get("grade", "")
    if acc_finish:
        parts.append(
            f"All bathroom accessories will be {acc_grade} grade in {acc_finish} finish."
        )

    # Exclusions
    parts.append(
        "This estimate excludes structural changes, wall relocation, "
        "HVAC modifications, window or door replacement, and mold "
        "remediation. Any unforeseen conditions discovered during "
        "demolition will be addressed via change order."
    )

    return " ".join(parts)


def _build_context(estimate) -> str:
    """Build context string from estimate for AI prompt."""
    lines = []

    address = estimate.property_address or "N/A"
    lines.append(f"Address: {address}")
    lines.append(f"Building type: {estimate.building_type or 'N/A'}")
    lines.append(f"Year built: {estimate.year_built or 'N/A'}")
    lines.append(f"Bathroom: {estimate.designation or 'N/A'} ({estimate.bath_function or 'full'})")

    if estimate.length_ft and estimate.width_ft:
        lines.append(f"Dimensions: {estimate.length_ft}'x{estimate.width_ft}' (H: {estimate.height_ft or 8}')")

    # Demo scope
    demo_parts = []
    if estimate.demo_floor: demo_parts.append("floor")
    if estimate.demo_walls: demo_parts.append("walls")
    if estimate.demo_ceiling: demo_parts.append("ceiling")
    lines.append(f"Demo areas: {', '.join(demo_parts) or 'none'}")

    # What's being replaced
    replacements = []
    if estimate.replace_tub: replacements.append("bathtub")
    elif getattr(estimate, 'detach_reset_tub', False): replacements.append("bathtub (D&R)")
    if estimate.replace_shower: replacements.append("shower")
    if estimate.replace_vanity: replacements.append("vanity")
    if estimate.replace_toilet: replacements.append("toilet")
    if (estimate.floor_spec or {}).get("material"): replacements.append("flooring")
    lines.append(f"Replacing: {', '.join(replacements) or 'N/A'}")

    # Specs summary
    shower = estimate.shower_spec or {}
    if shower:
        lines.append(f"Shower: type={shower.get('type')}, enclosure={shower.get('enclosure')}, "
                      f"head={shower.get('showerhead_type')}")

    tub = estimate.bathtub_spec or {}
    if tub:
        tub_info = f"Bathtub: type={tub.get('type')}, material={tub.get('material')}"
        if tub.get("surround_tile"):
            tub_info += f", surround_tile={tub.get('surround_tile_sf')}SF {tub.get('surround_tile_material', 'porcelain')}"
        lines.append(tub_info)

    van = estimate.vanity_spec or {}
    if van:
        lines.append(f"Vanity: {van.get('width')}\" {van.get('source')}, top={van.get('top_material')}")

    floor = estimate.floor_spec or {}
    if floor:
        lines.append(f"Floor: {floor.get('material')}, pattern={floor.get('pattern')}")

    # Special conditions
    if estimate.water_damage:
        if getattr(estimate, 'demo_already_done', False):
            lines.append("SCOPE: Restoration — demo completed by mitigation team")
        else:
            lines.append("SCOPE: Restoration — conditions to be verified upon demo")
    repair_items = []
    if getattr(estimate, 'repair_drywall_walls', False):
        sf = getattr(estimate, 'repair_drywall_walls_sf', 0) or 0
        repair_items.append(f"wall drywall{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'repair_drywall_ceiling', False):
        sf = getattr(estimate, 'repair_drywall_ceiling_sf', 0) or 0
        repair_items.append(f"ceiling drywall{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'repair_subfloor', False):
        sf = getattr(estimate, 'repair_subfloor_sf', 0) or 0
        repair_items.append(f"subfloor{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'install_insulation_walls', False):
        sf = getattr(estimate, 'install_insulation_walls_sf', 0) or 0
        repair_items.append(f"wall insulation{f' {sf}SF' if sf else ''}")
    if getattr(estimate, 'install_insulation_ceiling', False):
        sf = getattr(estimate, 'install_insulation_ceiling_sf', 0) or 0
        repair_items.append(f"ceiling insulation{f' {sf}SF' if sf else ''}")
    if repair_items:
        lines.append(f"REPAIR: {', '.join(repair_items)}")
    if getattr(estimate, 'demo_cement_board', False):
        cb_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        lines.append(f"REPAIR: Cement board — partial removal and replacement {cb_sf}SF")
    if estimate.mold_suspected: lines.append("SCOPE: Moisture conditions identified")
    if (estimate.year_built or 2000) < 1978: lines.append("CONDITION: Pre-1978 (lead paint risk)")
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron": lines.append("CONDITION: Cast iron tub")

    acc = estimate.accessories_spec or {}
    if acc.get("finish"):
        lines.append(f"Accessories: {acc.get('grade', 'mid')} grade, {acc.get('finish')} finish")

    return "\n".join(lines)
