"""
Bathroom Remodel Estimate calculator.
7-Phase calculation engine matching DMV contractor standards.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from .pricing import (
    get_permit_info,
    ACCESSORY_FINISH_MULTIPLIER,
    ACCESSORY_GRADE_MULTIPLIER,
    ACCESSORY_PRICES,
    BASEBOARD_PRICES,
    BATHTUB_EXTRAS,
    TILE_BASEBOARD_PRICES,
    QUARTER_ROUND_PRICES,
    BATHTUB_INSTALL,
    BATHTUB_PRICES,
    DEMO_RATES,
    ELECTRICAL_RATES,
    HIDDEN_COSTS,
    MIRROR_INSTALL,
    MIRROR_PRICES,
    PAINT_GRADE_MULTIPLIER,
    PAINT_RATES,
    PLUMBING_RATES,
    NEO_ANGLE_BASE_INSTALL,
    NEO_ANGLE_BASE_PRICES,
    NEO_ANGLE_DOOR_INSTALL,
    NEO_ANGLE_DOOR_PRICES,
    NEO_ANGLE_KIT_INSTALL,
    NEO_ANGLE_KIT_PRICES,
    NEO_ANGLE_WALL_SURROUND_INSTALL,
    NEO_ANGLE_WALL_SURROUND_PRICES,
    SHOWER_CUSTOM_EXTRAS,
    SHOWER_DOOR_INSTALL,
    SHOWER_DOOR_PRICES,
    SHOWER_ENCLOSURE_PRICES,
    SHOWER_INSERT_INSTALL,
    SHOWER_INSERT_PRICES,
    SHOWER_PAN_COSTS,
    SHOWER_VALVE_PRICES,
    SHOWERHEAD_PRICES,
    SUBSTRATE_RATES,
    TILE_EXTRAS,
    TILE_LABOR_RATES,
    TILE_MATERIAL_RATES,
    TILE_PATTERN_MULTIPLIER,
    TILE_SIZE_MULTIPLIER,
    TOILET_EXTRAS,
    TOILET_PRICES,
    TRIM_GRADE_MULTIPLIER,
    DETACH_RESET_COSTS,
    VANITY_EXTRAS,
    VANITY_INSTALL,
    VANITY_PRICES,
    VANITY_TOP_PRICES,
    SINK_PRICES,
    SINK_INSTALL,
    SINK_FAUCET,
    SINK_FAUCET_INSTALL,
    get_labor_multiplier,
    get_sales_tax_rate,
)

logger = logging.getLogger(__name__)

_DOLLAR_RE = re.compile(r'\$([0-9,]+(?:\.[0-9]+)?)')


def _scale_dollar_amounts(text: str, factor: float) -> str:
    """Scale every $amount in a note string by factor."""
    def _replace(m: re.Match) -> str:
        raw = float(m.group(1).replace(',', ''))
        return f"${round(raw * factor, 2):,.2f}"
    return _DOLLAR_RE.sub(_replace, text)


def calculate_estimate(estimate) -> Dict[str, Any]:
    """Calculate all line items for a bathroom estimate.

    Args:
        estimate: BathroomEstimate ORM object

    Returns:
        Dict with line_items, subtotal, overhead, profit, tax, total, etc.
    """
    line_items: List[Dict] = []
    warnings: List[str] = []
    zip_code = estimate.zip_code or ""
    labor_mult = get_labor_multiplier(zip_code)

    floor_sf = estimate.floor_sf or 0
    wall_sf = estimate.wall_sf or 0

    # Derive "replace floor" from floor_spec having a material
    _floor_spec = estimate.floor_spec or {}
    replace_floor = bool(_floor_spec.get("material"))

    # Auto-compute floor/wall SF if dimensions provided
    if not floor_sf and estimate.length_ft and estimate.width_ft:
        floor_sf = estimate.length_ft * estimate.width_ft

    height = estimate.height_ft or 8.0
    if not wall_sf and estimate.length_ft and estimate.width_ft:
        perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        wall_sf = perimeter * height
        # Subtract ~20 SF for door opening
        wall_sf = max(wall_sf - 20, 0)

    # ── Tile floor SF: subtract fixture footprints from total floor ──
    # Shower & bathtub (except freestanding) sit on subfloor — no tile
    # Built-in (freestanding-mount) vanity: no tile under cabinet
    # Wall-mounted vanity: tile goes under (no floor contact)
    tile_floor_sf = floor_sf
    _sketch = estimate.sketch_data or {}
    _sk_fix = _sketch.get("fixtures", [])

    _tub_spec = estimate.bathtub_spec or {}
    if estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False):
        if _tub_spec.get("type", "alcove") != "freestanding":
            _sk_tub = next((f for f in _sk_fix
                            if f.get("type") == "bathtub"), None)
            if _sk_tub:
                _d = _sk_tub.get("dimensions", {})
                _tl = max(_d.get("width", 60), _d.get("height", 32))
                _td = min(_d.get("width", 60), _d.get("height", 32))
            else:
                _tl = _tub_spec.get("tub_length_in") or 60
                _td = _tub_spec.get("tub_depth_in") or 32
            tile_floor_sf -= (_tl * _td) / 144

    _shower_spec = estimate.shower_spec or {}
    if estimate.replace_shower or getattr(
            estimate, 'detach_reset_shower', False):
        _sk_sh = next((f for f in _sk_fix
                       if f.get("type") == "shower"), None)
        if _sk_sh:
            _sd = _sk_sh.get("dimensions", {})
            _sw, _sdp = _sd.get("width", 36), _sd.get("height", 36)
        else:
            _sw = _shower_spec.get("width_in") or 36
            _sdp = _shower_spec.get("depth_in") or 36
        tile_floor_sf -= (_sw * _sdp) / 144

    _vanity_spec = estimate.vanity_spec or {}
    if estimate.replace_vanity or getattr(
            estimate, 'detach_reset_vanity', False):
        _vi_list = _vanity_spec.get("items") or [_vanity_spec]
        _v_mount_default = _vanity_spec.get("mounting", "freestanding")
        for _vi in _vi_list:
            if _vi.get("mounting", _v_mount_default) != "wall_mount":
                _sk_vans = [f for f in _sk_fix
                            if f.get("type") == "vanity"]
                _vw = _vi.get("width") or 36
                _vd = 22  # standard vanity depth (inches)
                if _sk_vans:
                    _sv = _sk_vans[0]
                    _vw = _sv.get("dimensions", {}).get("width", _vw)
                    _vd = _sv.get("dimensions", {}).get("height", _vd)
                tile_floor_sf -= (_vw * _vd) / 144

    tile_floor_sf = max(round(tile_floor_sf, 1), 0)

    # Water damage source — plumber already repaired this fixture's plumbing
    wd_source = getattr(estimate, 'water_damage_source', None) or ""
    plumber_fixed_shower = wd_source in ("shower", "bathtub")
    plumber_fixed_tub = wd_source in ("bathtub",)
    plumber_fixed_vanity = wd_source in ("vanity",)
    plumber_fixed_toilet = wd_source in ("toilet",)

    # ── Auto-derive demo flags from scope ──
    # demo_floor: new floor tile requires removing old tile first
    # demo_walls: custom tile shower or tub surround requires removing old wall surface
    _shower_spec_demo = estimate.shower_spec or {}
    _tub_spec_demo = estimate.bathtub_spec or {}
    demo_floor = replace_floor or getattr(estimate, 'demo_floor', False)
    demo_walls = (
        (estimate.replace_shower
         and _shower_spec_demo.get("type") in ("custom_tile", "curbless"))
        or (_tub_spec_demo.get("surround_tile", False)
            and (estimate.replace_tub
                 or getattr(estimate, 'detach_reset_tub', False)))
        or getattr(estimate, 'demo_walls', False)
    )
    demo_ceiling = getattr(estimate, 'demo_ceiling', False)

    # Demo-specific SF (override or fallback to bathroom SF)
    demo_floor_sf = getattr(estimate, 'demo_floor_sf', None) or floor_sf
    demo_wall_sf = getattr(estimate, 'demo_wall_sf', None) or wall_sf
    demo_ceiling_sf = getattr(estimate, 'demo_ceiling_sf', None) or floor_sf

    # Lead RRP check
    year_built = estimate.year_built or 2000
    needs_lead_rrp = year_built < 1978

    # Demo already done? (mitigation team completed demo before remodel)
    demo_already_done = getattr(estimate, 'demo_already_done', False) or False

    # ────────────────────────────────────────
    # Phase 1: Demo & Disposal (consolidated into single line item + dumpster)
    # ────────────────────────────────────────
    demo_total = 0
    demo_parts = []

    # Skip surface/tile demo costs if mitigation already completed demo
    if not demo_already_done:
        if demo_floor and demo_floor_sf > 0:
            cost = round(demo_floor_sf * DEMO_RATES["floor_tile_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Floor tile {demo_floor_sf:.0f}SF ${cost:,.2f}")

        if demo_walls and demo_wall_sf > 0:
            cost = round(demo_wall_sf * DEMO_RATES["wall_tile_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Wall tile {demo_wall_sf:.0f}SF ${cost:,.2f}")

        if demo_ceiling and demo_ceiling_sf > 0:
            cost = round(demo_ceiling_sf * DEMO_RATES["ceiling_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Ceiling {demo_ceiling_sf:.0f}SF ${cost:,.2f}")
    else:
        if demo_floor or demo_walls or demo_ceiling:
            areas = []
            if demo_floor: areas.append("floor")
            if demo_walls: areas.append("walls")
            if demo_ceiling: areas.append("ceiling")
            demo_parts.append(f"Demo already completed by mitigation: {', '.join(areas)}")

    if estimate.replace_tub:
        tub_mat = (estimate.bathtub_spec or {}).get("material", "acrylic")
        if tub_mat == "cast_iron":
            cost = round(DEMO_RATES["bathtub_cast_iron"] * labor_mult, 2)
            demo_parts.append(f"Cast iron tub ${cost:,.2f}")
        else:
            cost = round(DEMO_RATES["bathtub_standard"] * labor_mult, 2)
            demo_parts.append(f"Bathtub ${cost:,.2f}")
        demo_total += cost

    if estimate.replace_shower:
        shower_spec = estimate.shower_spec or {}
        stype = shower_spec.get("type", "one_piece")
        if stype in ("custom_tile", "curbless", "neo_angle_custom"):
            cost = round(
                DEMO_RATES["shower_custom_tile"]
                * labor_mult, 2)
            demo_parts.append(f"Tile shower ${cost:,.2f}")
        else:
            cost = round(
                DEMO_RATES["shower_surround"]
                * labor_mult, 2)
            demo_parts.append(
                f"Shower surround ${cost:,.2f}")
        demo_total += cost

    if estimate.replace_vanity:
        _van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        for _vi in _van_items:
            if not _vi or not isinstance(_vi, dict):
                continue
            _sink_t = _vi.get("sink_type", "cabinet")
            _demo_key = _sink_t if _sink_t in DEMO_RATES else "vanity"
            _demo_label = {
                "pedestal_sink": "Pedestal sink",
                "wall_mount_sink": "Wall-mount sink",
            }.get(_sink_t, "Vanity")
            cost = round(DEMO_RATES[_demo_key] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"{_demo_label} ${cost:,.2f}")

    # Mirror demo only if replacing with new mirror (not D&R, not None)
    if getattr(estimate, 'replace_mirror', False):
        mirror_van_count = len(
            (estimate.vanity_spec or {}).get("items", [])
        ) or 1
        mirror_cost = round(mirror_van_count * DEMO_RATES["mirror"] * labor_mult, 2)
        demo_total += mirror_cost
        demo_parts.append(f"Mirror x{mirror_van_count} ${mirror_cost:,.2f}")

    if estimate.replace_toilet:
        cost = round(DEMO_RATES["toilet"] * labor_mult, 2)
        demo_total += cost
        demo_parts.append(f"Toilet ${cost:,.2f}")

    # Cement board: demo section requiring replacement
    cb_repair_sf = 0
    if estimate.water_damage and getattr(estimate, 'demo_cement_board', False):
        cb_repair_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        if cb_repair_sf > 0:
            cost = round(cb_repair_sf * DEMO_RATES["durock_per_sf"] * labor_mult, 2)
            demo_total += cost
            demo_parts.append(f"Cement board {cb_repair_sf:.0f}SF ${cost:,.2f}")

    if demo_total > 0:
        _add(line_items, 1, "Demo & removal - complete",
             1, "LS", demo_total, "demo",
             notes=" | ".join(demo_parts))

    # Dumpster / disposal (separate line - disposal is distinct from labor)
    # Size is estimated by cubic yard volume of debris:
    #   - Tile/surface demo: ~0.5 CY per 100 SF (thin-set + tile ≈ 0.5" thick)
    #   - Bathtub: ~2 CY (standard acrylic), ~2.5 CY (cast iron)
    #   - Shower surround: ~1.5 CY, custom tile shower: ~2 CY
    #   - Vanity: ~1 CY each (cabinet + countertop)
    #   - Toilet: ~0.5 CY
    #   - Cement board: ~0.3 CY per 100 SF
    #   - D&R fixtures: ~0.2 CY each (packaging, old hardware, sealant)
    hc = estimate.hidden_costs or {}

    has_tile_demo = demo_floor or demo_walls or demo_ceiling
    has_fixture_replace = (estimate.replace_tub or estimate.replace_shower
                           or estimate.replace_vanity or estimate.replace_toilet)
    has_dr = (getattr(estimate, 'detach_reset_tub', False)
              or getattr(estimate, 'detach_reset_shower', False)
              or getattr(estimate, 'detach_reset_vanity', False)
              or getattr(estimate, 'detach_reset_toilet', False))
    has_demo = has_tile_demo or has_fixture_replace or has_dr

    if has_demo:
        debris_cy = 0.0

        # Tile/surface demo volume
        if demo_floor:
            debris_cy += demo_floor_sf * 0.005  # 0.5 CY per 100 SF
        if demo_walls:
            debris_cy += demo_wall_sf * 0.005
        if demo_ceiling:
            debris_cy += demo_ceiling_sf * 0.003  # thinner than tile

        # Fixture demo volume
        if estimate.replace_tub:
            tub_mat = (estimate.bathtub_spec or {}).get("material", "acrylic")
            debris_cy += 2.5 if tub_mat == "cast_iron" else 2.0
        if estimate.replace_shower:
            shower_spec_d = estimate.shower_spec or {}
            stype_d = shower_spec_d.get("type", "one_piece")
            debris_cy += 2.0 if stype_d in ("custom_tile", "curbless") else 1.5
        if estimate.replace_vanity:
            van_ct = len((estimate.vanity_spec or {}).get("items", [])) or 1
            debris_cy += 1.0 * van_ct
        if estimate.replace_toilet:
            debris_cy += 0.5
        if getattr(estimate, 'replace_mirror', False):
            debris_cy += 0.2

        # Cement board demo (water damage repair)
        if cb_repair_sf > 0:
            debris_cy += cb_repair_sf * 0.003

        # D&R fixtures (small debris: old hardware, sealant, packing)
        dr_count = sum([
            getattr(estimate, 'detach_reset_tub', False),
            getattr(estimate, 'detach_reset_shower', False),
            getattr(estimate, 'detach_reset_vanity', False),
            getattr(estimate, 'detach_reset_toilet', False),
        ])
        debris_cy += 0.2 * dr_count

        # Determine disposal method based on volume
        if debris_cy <= 1.5:
            # Small job: debris bags only (no dumpster needed)
            bag_count = max(int(debris_cy / 0.15) + 1, 2)  # ~4 cu ft per bag
            _add(line_items, 1,
                 f"Debris disposal ({bag_count} bags, {debris_cy:.1f} CY est.)",
                 bag_count, "EA",
                 DEMO_RATES.get("debris_bag", 25) * labor_mult,
                 "demo",
                 notes="Heavy-duty contractor bags + haul-away")
        elif debris_cy <= 5:
            _add(line_items, 1,
                 f"Dumpster rental (10yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_10yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")
        elif debris_cy <= 10:
            _add(line_items, 1,
                 f"Dumpster rental (15yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_15yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")
        else:
            _add(line_items, 1,
                 f"Dumpster rental (20yard, {debris_cy:.1f} CY est.)",
                 1, "EA",
                 DEMO_RATES["dumpster_20yard"]
                 + DEMO_RATES["dump_tip_fee"],
                 "demo")

    # ────────────────────────────────────────
    # Phase 2: Plumbing Rough
    # ────────────────────────────────────────
    plumb = estimate.plumbing_spec or {}

    valve_count = plumb.get("valve_replace_count") or 0
    if valve_count > 0:
        _add(line_items, 2, "Shut-off valve replacement", valve_count, "EA",
             PLUMBING_RATES["shutoff_valve_each"] * labor_mult, "plumbing")

    supply_count = plumb.get("supply_line_count") or 0
    if supply_count > 0:
        _add(line_items, 2, "Supply line replacement (braided SS)", supply_count, "EA",
             PLUMBING_RATES["supply_line_each"] * labor_mult, "plumbing")

    p_trap_count = plumb.get("p_trap_count") or 0
    if p_trap_count > 0:
        _add(line_items, 2, "P-trap replacement", p_trap_count, "EA",
             PLUMBING_RATES["p_trap_each"] * labor_mult, "plumbing")

    if plumb.get("drain_modification"):
        _add(line_items, 2, "Drain line modification", 1, "EA",
             PLUMBING_RATES["drain_modification"] * labor_mult, "plumbing")

    if plumb.get("pressure_balance_valve"):
        _add(line_items, 2, "Pressure balance valve (code required)", 1, "EA",
             PLUMBING_RATES["pressure_balance_valve"] * labor_mult, "plumbing")

    if plumb.get("rough_inspection"):
        _add(line_items, 2, "Plumbing rough inspection fee", 1, "EA",
             PLUMBING_RATES["rough_inspection_fee"], "plumbing")

    # ────────────────────────────────────────
    # Phase 3: Substrate
    # ────────────────────────────────────────
    sub = estimate.substrate_spec or {}

    # Auto-calculate wet-area SF from shower/tub tile areas if not manually specified
    auto_wet_sf = 0
    shower_spec = estimate.shower_spec or {}
    tub_spec_sub = estimate.bathtub_spec or {}

    # Shower wall tile SF
    if estimate.replace_shower and shower_spec.get("type") in (
            "custom_tile", "curbless"):
        s_tile = shower_spec.get("tile_spec", {})
        s_sf = s_tile.get("sf", 0)
        if not s_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get("tile_height_in", 0) or 0
            if sw and sd and sh:
                s_sf = (sw + 2 * sd) * sh / 144
        auto_wet_sf += s_sf or 0

        # Shower floor SF (also needs waterproofing)
        s_floor_w = shower_spec.get("width_in", 0) or 0
        s_floor_d = shower_spec.get("depth_in", 0) or 0
        if s_floor_w and s_floor_d:
            auto_wet_sf += s_floor_w * s_floor_d / 144

    # Tub surround tile SF
    if tub_spec_sub.get("surround_tile") and tub_spec_sub.get("type") == "drop_in":
        t_sf = tub_spec_sub.get("surround_tile_sf", 0)
        if not t_sf:
            tl = tub_spec_sub.get("tub_length_in", 0) or 0
            tsh = tub_spec_sub.get("surround_height_in", 0) or 0
            td = tub_spec_sub.get("tub_depth_in", 30) or 30
            if tl and tsh:
                t_sf = (tl + 2 * td) * tsh / 144
        auto_wet_sf += t_sf or 0

    # Durock: use manual value if provided, else auto from wet areas
    durock_sf = sub.get("durock_sf", 0) or auto_wet_sf
    if durock_sf > 0:
        _add(line_items, 3, "Cement board (Durock) - wet area", durock_sf, "SF",
             SUBSTRATE_RATES["durock_per_sf"] * labor_mult, "substrate")

    # Floor cement board (1/4") — only when demo removed the old substrate
    # If existing cement board is intact (no demo), tile directly over it
    if replace_floor and demo_floor and tile_floor_sf > 0:
        floor_spec_sub = estimate.floor_spec or {}
        floor_mat = floor_spec_sub.get("material", "porcelain")
        if floor_mat in ("porcelain", "ceramic", "natural_stone",
                        "glass_mosaic"):
            _add(line_items, 3, "Cement board (1/4\") - floor underlayment",
                 tile_floor_sf, "SF",
                 SUBSTRATE_RATES["durock_floor_per_sf"] * labor_mult,
                 "substrate")

    greenboard_sf = sub.get("greenboard_sf") or 0
    if greenboard_sf > 0:
        _add(line_items, 3, "Moisture-resistant drywall (greenboard)", greenboard_sf, "SF",
             SUBSTRATE_RATES["greenboard_per_sf"] * labor_mult, "substrate")

    # Waterproofing: use manual value if provided, else same as durock (wet areas)
    wp_type = sub.get("waterproof_type", "redgard")
    wp_sf = sub.get("waterproof_sf", 0) or durock_sf
    if wp_sf > 0 and wp_type != "none":
        wp_rate = SUBSTRATE_RATES.get(f"{wp_type}_per_sf", SUBSTRATE_RATES["redgard_per_sf"])
        wp_label = {"redgard": "RedGard", "kerdi": "Schluter Kerdi", "hydroban": "HydroBan"}.get(wp_type, wp_type)
        _add(line_items, 3, f"Waterproofing membrane - {wp_label}", wp_sf, "SF",
             wp_rate * labor_mult, "substrate")

    # Subfloor repair — manual SF if specified, else auto-include when demo floor
    # Skip auto-include if repair_subfloor is explicitly set (handled separately below)
    has_explicit_repair_subfloor = getattr(estimate, 'repair_subfloor', False)
    subfloor_repair_sf = sub.get("subfloor_repair_sf") or 0
    subfloor_explicit = sub.get("subfloor_repair", None)
    if not has_explicit_repair_subfloor and subfloor_explicit is True and subfloor_repair_sf > 0:
        # Explicit: user specified repair area
        _add(line_items, 3, "Subfloor repair allowance (plywood)", subfloor_repair_sf, "SF",
             SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
             notes="Subfloor integrity verification + replacement as needed per industry standard")
    elif not has_explicit_repair_subfloor and subfloor_explicit is not False and demo_floor and floor_sf > 0:
        # Auto-include: demo floor → standard allowance for subfloor condition verification
        auto_repair_sf = round(floor_sf * 0.3, 1)
        _add(line_items, 3, "Subfloor repair allowance (plywood)", auto_repair_sf, "SF",
             SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
             notes=f"Standard allowance ~30% of {floor_sf:.0f}SF — "
                   f"subfloor condition to be verified upon demo; adjust per actual findings")

    # Self-leveling compound — auto-include when demo floor + tile install
    leveling_explicit = sub.get("self_leveling", None)
    leveling_sf = sub.get("self_leveling_sf") or 0
    if leveling_explicit is True and leveling_sf > 0:
        _add(line_items, 3, "Self-leveling compound", leveling_sf, "SF",
             SUBSTRATE_RATES["self_leveling_per_sf"] * labor_mult, "substrate")
    elif leveling_explicit is not False and demo_floor and replace_floor and tile_floor_sf > 0:
        _add(line_items, 3, "Self-leveling compound", tile_floor_sf, "SF",
             SUBSTRATE_RATES["self_leveling_per_sf"] * labor_mult, "substrate",
             notes="Level subfloor after old tile removal — "
                   "required for proper tile adhesion + prevent lippage")

    # Cement board replacement — same SF as demo (partial repair)
    if cb_repair_sf > 0:
        _add(line_items, 3,
             "Cement board replacement",
             cb_repair_sf, "SF",
             SUBSTRATE_RATES["durock_per_sf"] * labor_mult,
             "substrate",
             notes="Replace section per code-compliant installation; "
                   "overlap to nearest studs; reuse serviceable board")

    # ── Substrate Repair: Drywall & Subfloor ──
    # Wall drywall replacement (hang + tape + mud + sand + prime)
    if getattr(estimate, 'repair_drywall_walls', False):
        repair_wall_sf = getattr(estimate, 'repair_drywall_walls_sf', None) or demo_wall_sf
        if repair_wall_sf > 0:
            use_moisture = estimate.water_damage or estimate.mold_suspected
            rate_key = "drywall_replace_moisture_per_sf" if use_moisture else "drywall_replace_per_sf"
            board_label = "moisture-resistant" if use_moisture else "standard"
            _add(line_items, 3,
                 f"Drywall replacement - walls ({board_label})",
                 repair_wall_sf, "SF",
                 SUBSTRATE_RATES[rate_key] * labor_mult, "substrate",
                 notes=f"Hang + tape + mud + sand + prime | "
                       f"{'Greenboard per code for wet area' if use_moisture else 'Standard 1/2\" drywall'}")

    # Ceiling drywall replacement
    if getattr(estimate, 'repair_drywall_ceiling', False):
        repair_ceil_sf = getattr(estimate, 'repair_drywall_ceiling_sf', None) or floor_sf
        if repair_ceil_sf > 0:
            use_mold = estimate.water_damage or estimate.mold_suspected
            if use_mold:
                _add(line_items, 3,
                     "Drywall replacement - ceiling (moisture-resistant)",
                     repair_ceil_sf, "SF",
                     SUBSTRATE_RATES["mold_resistant_drywall_per_sf"] * labor_mult,
                     "substrate",
                     notes="Moisture-resistant drywall per code for wet area | Hang + tape + mud + prime")
            else:
                _add(line_items, 3,
                     "Drywall replacement - ceiling",
                     repair_ceil_sf, "SF",
                     SUBSTRATE_RATES["drywall_replace_per_sf"] * labor_mult,
                     "substrate",
                     notes="Standard 1/2\" drywall | Hang + tape + mud + prime")

    # Subfloor replacement (explicit repair flag)
    if getattr(estimate, 'repair_subfloor', False):
        repair_floor_sf = getattr(estimate, 'repair_subfloor_sf', None) or floor_sf
        if repair_floor_sf > 0:
            _add(line_items, 3,
                 "Subfloor replacement (plywood)",
                 repair_floor_sf, "SF",
                 SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
                 notes="Plywood replacement per code-compliant installation + fasteners")

    # ────────────────────────────────────────
    # Phase 4: Tile & Flooring
    # ────────────────────────────────────────
    # Floor tile (consolidated: material + labor + supplies → 1 item)
    floor_spec = estimate.floor_spec or {}
    if not replace_floor and demo_floor and tile_floor_sf > 0:
        # Floor is being demoed but no replacement material specified —
        # flag as TBD so the estimator doesn't miss it.
        _add(line_items, 4, "Floor finish - NOT SPECIFIED (TBD)",
             tile_floor_sf, "SF", 0, "tile",
             notes=(
                 "Floor demo is included but finish material has not been "
                 "selected. Please specify floor tile/flooring to complete "
                 "this section (existing finish kept or new material)."
             ))
    if replace_floor and tile_floor_sf > 0:
        tile_mat = floor_spec.get("material", "porcelain")
        pattern = floor_spec.get("pattern", "straight")
        tile_size = floor_spec.get("size", "12x24")
        mat_rate = TILE_MATERIAL_RATES.get(tile_mat, 7.50)
        labor_rate = TILE_LABOR_RATES["floor_per_sf"] * labor_mult
        pat_mult = TILE_PATTERN_MULTIPLIER.get(pattern, 1.0)
        size_mult = TILE_SIZE_MULTIPLIER.get(tile_size, 1.0)
        waste = TILE_EXTRAS["waste_factor"]
        supply_rate = TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"]

        ft_mat_cost = round(tile_floor_sf * (1 + waste) * mat_rate, 2)
        ft_labor_cost = round(tile_floor_sf * labor_rate * pat_mult * size_mult, 2)
        ft_supply_cost = round(tile_floor_sf * supply_rate, 2)
        ft_sealer_cost = 0
        if tile_mat == "natural_stone":
            ft_sealer_cost = round(tile_floor_sf * TILE_EXTRAS["sealer_per_sf"], 2)

        ft_total = ft_mat_cost + ft_labor_cost + ft_supply_cost + ft_sealer_cost

        ft_parts = [
            f"Material: {tile_mat} ${mat_rate:.2f}/SF allowance, {tile_floor_sf*(1+waste):.0f}SF ${ft_mat_cost:,.2f} (incl {int(waste*100)}% waste)",
            f"Install: {pattern} ${ft_labor_cost:,.2f}",
            f"Supplies: ${ft_supply_cost:,.2f}",
        ]
        if ft_sealer_cost:
            ft_parts.append(f"Sealer: ${ft_sealer_cost:,.2f}")
        if tile_floor_sf < floor_sf:
            ft_parts.append(
                f"Tile area: {tile_floor_sf:.1f}SF "
                f"(room {floor_sf:.0f}SF minus fixture footprints)")

        _add(line_items, 4,
             f"Floor tile complete - {tile_mat} ({tile_size}, {pattern})",
             tile_floor_sf, "SF", round(ft_total / tile_floor_sf, 2), "tile",
             notes=" | ".join(ft_parts))

    # Shower wall tile (consolidated)
    shower_spec = estimate.shower_spec or {}
    _shower_tile_types = (
        "custom_tile", "curbless", "neo_angle_custom")
    _s_wall_mat = shower_spec.get("wall_material", "tile")
    if (estimate.replace_shower
            and shower_spec.get("type") in _shower_tile_types
            and _s_wall_mat == "tile"):
        tile_spec = shower_spec.get("tile_spec", {})
        shower_wall_sf = tile_spec.get("sf", 0)
        if not shower_wall_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get(
                "tile_height_in", 0) or 0
            _s_layout = shower_spec.get(
                "layout", "alcove")
            if sw and sd and sh:
                if _s_layout in (
                        "neo_angle",
                        "neo_angle_right",
                        "corner",
                        "corner_right"):
                    # 2 walls only
                    shower_wall_sf = (
                        (sw + sd) * sh / 144)
                else:
                    shower_wall_sf = (
                        (sw + 2 * sd) * sh / 144)
        if shower_wall_sf > 0:
            stile_mat = tile_spec.get("material", "porcelain")
            spattern = tile_spec.get("pattern", "straight")
            stile_size = tile_spec.get("size", "12x24")
            smat_rate = TILE_MATERIAL_RATES.get(stile_mat, 7.50)
            slabor_rate = TILE_LABOR_RATES["shower_wall_per_sf"] * labor_mult
            spat_mult = TILE_PATTERN_MULTIPLIER.get(spattern, 1.0)
            ssize_mult = TILE_SIZE_MULTIPLIER.get(stile_size, 1.0)
            swaste = TILE_EXTRAS["waste_factor"]
            ssupply_rate = TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"]

            st_mat_cost = round(shower_wall_sf * (1 + swaste) * smat_rate, 2)
            st_labor_cost = round(shower_wall_sf * slabor_rate * spat_mult * ssize_mult, 2)
            st_supply_cost = round(shower_wall_sf * ssupply_rate, 2)
            st_sealer_cost = 0
            if stile_mat == "natural_stone":
                st_sealer_cost = round(shower_wall_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            st_total = st_mat_cost + st_labor_cost + st_supply_cost + st_sealer_cost

            st_parts = [
                f"Material: {stile_mat} ${smat_rate:.2f}/SF allowance, {shower_wall_sf*(1+swaste):.0f}SF ${st_mat_cost:,.2f} (incl {int(swaste*100)}% waste)",
                f"Install: {spattern} ${st_labor_cost:,.2f}",
                f"Supplies: ${st_supply_cost:,.2f}",
            ]
            if st_sealer_cost:
                st_parts.append(f"Sealer: ${st_sealer_cost:,.2f}")

            _add(line_items, 4,
                 f"Shower wall tile complete - {stile_mat} ({stile_size}, {spattern})",
                 shower_wall_sf, "SF", round(st_total / shower_wall_sf, 2), "tile",
                 notes=" | ".join(st_parts))

        # Shower floor tile
        shower_floor_sf = 0
        sf_w = shower_spec.get("width_in", 0) or 0
        sf_d = shower_spec.get("depth_in", 0) or 0
        if sf_w and sf_d:
            if _s_layout in (
                    "neo_angle", "neo_angle_right"):
                # Pentagon: rect minus corner triangle
                cut_w = sf_w * 0.5
                cut_d = sf_d * 0.5
                shower_floor_sf = (
                    sf_w * sf_d
                    - 0.5 * cut_w * cut_d) / 144
            else:
                shower_floor_sf = sf_w * sf_d / 144

        if shower_floor_sf > 0:
            sf_tile_mat = tile_spec.get("material", "porcelain")
            sf_pattern = tile_spec.get("pattern", "straight")
            sf_tile_size = tile_spec.get("size", "12x24")
            sf_mat_rate = TILE_MATERIAL_RATES.get(sf_tile_mat, 7.50)
            sf_labor_rate = TILE_LABOR_RATES["shower_floor_per_sf"] * labor_mult
            sf_pat_mult = TILE_PATTERN_MULTIPLIER.get(sf_pattern, 1.0)
            sf_size_mult = TILE_SIZE_MULTIPLIER.get(sf_tile_size, 1.0)
            sf_waste = TILE_EXTRAS["waste_factor"]
            sf_supply_rate = TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"]

            sf_mat_cost = round(shower_floor_sf * (1 + sf_waste) * sf_mat_rate, 2)
            sf_labor_cost = round(shower_floor_sf * sf_labor_rate * sf_pat_mult * sf_size_mult, 2)
            sf_supply_cost = round(shower_floor_sf * sf_supply_rate, 2)
            sf_sealer_cost = 0
            if sf_tile_mat == "natural_stone":
                sf_sealer_cost = round(shower_floor_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            sf_total = sf_mat_cost + sf_labor_cost + sf_supply_cost + sf_sealer_cost

            sf_parts = [
                f"Material: {sf_tile_mat} ${sf_mat_rate:.2f}/SF allowance, {shower_floor_sf*(1+sf_waste):.0f}SF ${sf_mat_cost:,.2f} (incl {int(sf_waste*100)}% waste)",
                f"Install: {sf_pattern} ${sf_labor_cost:,.2f} (slope to drain)",
                f"Supplies: ${sf_supply_cost:,.2f}",
            ]
            if sf_sealer_cost:
                sf_parts.append(f"Sealer: ${sf_sealer_cost:,.2f}")

            _add(line_items, 4,
                 f"Shower floor tile complete - {sf_tile_mat} ({sf_tile_size}, {sf_pattern})",
                 shower_floor_sf, "SF", round(sf_total / shower_floor_sf, 2), "tile",
                 notes=" | ".join(sf_parts))

        # Shower pan liner + pre-slope (required for custom tile / curbless)
        shower_floor_w = shower_spec.get("width_in", 0) or 0
        shower_floor_d = shower_spec.get("depth_in", 0) or 0
        pan_sf = (shower_floor_w * shower_floor_d / 144) if (shower_floor_w and shower_floor_d) else 0
        if pan_sf > 0:
            pan_preslope = round(pan_sf * SHOWER_PAN_COSTS["mortar_preslope_per_sf"] * labor_mult, 2)
            pan_liner = round(SHOWER_PAN_COSTS["pan_liner"] * labor_mult, 2)
            pan_curb_wp = round(SHOWER_PAN_COSTS["curb_waterproof"] * labor_mult, 2) if stype != "curbless" else 0
            pan_total = pan_preslope + pan_liner + pan_curb_wp

            pan_parts = [
                f"Mortar pre-slope {pan_sf:.1f}SF ${pan_preslope:,.2f}",
                f"PVC liner + drain ${pan_liner:,.2f}",
            ]
            if pan_curb_wp:
                pan_parts.append(f"Curb waterproof ${pan_curb_wp:,.2f}")

            _add(line_items, 3,
                 "Shower pan (pre-slope + liner + drain)",
                 1, "LS", pan_total, "substrate",
                 notes=" | ".join(pan_parts))

    # Bathtub surround tile (consolidated: material + labor + supplies → 1 item)
    # Uses sketch fixture dimensions when available for accurate wall tile calc
    tub_spec = estimate.bathtub_spec or {}
    sketch = estimate.sketch_data or {}
    sk_fixtures = sketch.get("fixtures", [])
    sk_tub = next((f for f in sk_fixtures if f.get("type") == "bathtub"), None)

    # Determine if surround tile is needed:
    # 1) sketch hasSurround property, or 2) legacy surround_tile flag in spec
    has_surround = False
    if sk_tub:
        has_surround = sk_tub.get("properties", {}).get("hasSurround", False)
    if not has_surround:
        has_surround = tub_spec.get("surround_tile", False)

    if has_surround and tub_spec.get("type") not in (None, "none", "freestanding"):
        surround_sf = tub_spec.get("surround_tile_sf", 0)
        # Always resolve dimensions for notes (even if surround_sf is manual)
        if sk_tub:
            sk_dims = sk_tub.get("dimensions", {})
            sk_props = sk_tub.get("properties", {})
            dim_a = sk_dims.get("width", 60)
            dim_b = sk_dims.get("height", 32)
            # Tub length is always the longer side, depth the shorter
            tl = max(dim_a, dim_b)
            td = min(dim_a, dim_b)
            sh = sk_props.get("surroundHeight", 60)
            wall_count = sk_props.get("surroundWallCount", 3)
        else:
            raw_l = tub_spec.get("tub_length_in", 0) or 60
            raw_d = tub_spec.get("tub_depth_in", 0) or 32
            tl = max(raw_l, raw_d)
            td = min(raw_l, raw_d)
            sh = tub_spec.get("surround_height_in", 0) or 60
            wall_count = tub_spec.get("surround_wall_count", 3) or 3
        # Auto-calculate SF from dimensions if not manually provided
        if not surround_sf and tl and sh:
            if wall_count >= 3:
                surround_sf = (tl + 2 * td) * sh / 144
            elif wall_count == 2:
                surround_sf = (tl + td) * sh / 144
            else:
                surround_sf = tl * sh / 144
        if surround_sf > 0:
            sur_mat = tub_spec.get("surround_tile_material", "porcelain")
            sur_pattern = tub_spec.get("surround_tile_pattern", "straight")
            sur_size = tub_spec.get("surround_tile_size", "12x24")
            sur_mat_rate = TILE_MATERIAL_RATES.get(sur_mat, 7.50)
            sur_labor_rate = BATHTUB_EXTRAS["surround_tile_labor_per_sf"] * labor_mult
            sur_pat_mult = TILE_PATTERN_MULTIPLIER.get(sur_pattern, 1.0)
            sur_size_mult = TILE_SIZE_MULTIPLIER.get(sur_size, 1.0)
            sur_waste = TILE_EXTRAS["waste_factor"]
            sur_supply_rate = TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"]

            bt_mat_cost = round(surround_sf * (1 + sur_waste) * sur_mat_rate, 2)
            bt_labor_cost = round(surround_sf * sur_labor_rate * sur_pat_mult * sur_size_mult, 2)
            bt_supply_cost = round(surround_sf * sur_supply_rate, 2)
            bt_sealer_cost = 0
            if sur_mat == "natural_stone":
                bt_sealer_cost = round(surround_sf * TILE_EXTRAS["sealer_per_sf"], 2)
            bt_total = bt_mat_cost + bt_labor_cost + bt_supply_cost + bt_sealer_cost

            # Build wall dimension note
            wall_dim_note = f"{wall_count} walls: {tl:.0f}\"L × {td:.0f}\"D × {sh:.0f}\"H = {surround_sf:.1f}SF"

            bt_parts = [
                wall_dim_note,
                f"Material: {sur_mat} ${sur_mat_rate:.2f}/SF allowance, {surround_sf*(1+sur_waste):.0f}SF ${bt_mat_cost:,.2f} (incl {int(sur_waste*100)}% waste)",
                f"Install: {sur_pattern} ${bt_labor_cost:,.2f}",
                f"Supplies: ${bt_supply_cost:,.2f}",
            ]
            if bt_sealer_cost:
                bt_parts.append(f"Sealer: ${bt_sealer_cost:,.2f}")

            _add(line_items, 4,
                 f"Bathtub surround tile complete - {sur_mat} ({sur_size}, {sur_pattern})",
                 surround_sf, "SF", round(bt_total / surround_sf, 2), "tile",
                 notes=" | ".join(bt_parts))

    # Bathtub deck tile (platform top surface)
    if estimate.replace_tub and tub_spec.get("deck_tile"):
        deck_sf = tub_spec.get("deck_tile_sf", 0) or 0
        deck_sides = tub_spec.get("deck_tile_sides", 2)
        if deck_sf > 0:
            _add(line_items, 4,
                 f"Bathtub deck tile ({deck_sides} sides)",
                 deck_sf, "SF", round(14.00 * labor_mult, 2), "tile",
                 notes=f"Deck top surface, bullnose edges")

    # Bathtub front panel tile (vertical face)
    if estimate.replace_tub and tub_spec.get("front_panel_tile"):
        panel_sf = tub_spec.get("front_panel_sf", 0) or 0
        if panel_sf > 0:
            _add(line_items, 4,
                 "Bathtub front panel tile",
                 panel_sf, "SF", round(16.00 * labor_mult, 2), "tile",
                 notes="Vertical face of platform/deck")

    if floor_spec.get("heated_floor") and tile_floor_sf > 0:
        _add(line_items, 4, "Heated floor mat + installation", tile_floor_sf, "SF",
             ELECTRICAL_RATES["heated_floor_per_sf"] * labor_mult, "electrical")
        _add(line_items, 4, "Heated floor thermostat", 1, "EA",
             ELECTRICAL_RATES["heated_floor_thermostat"], "electrical")
        _add(line_items, 4, "Dedicated 20A circuit for heated floor", 1, "EA",
             ELECTRICAL_RATES["heated_floor_circuit"] * labor_mult, "electrical")

    # ────────────────────────────────────────
    # Phase 5: Fixtures Install
    # ────────────────────────────────────────

    # Bathtub (consolidated into single line item)
    tub_spec = estimate.bathtub_spec or {}
    if estimate.replace_tub and tub_spec.get("type") and tub_spec["type"] != "none":
        tub_type = tub_spec["type"]
        tub_mat = tub_spec.get("material", "acrylic")
        tub_prices = BATHTUB_PRICES.get(tub_type, {})
        tub_price = tub_prices.get(tub_mat, 450)
        tub_type_label = tub_type.replace("_", " ").title()
        tub_mat_label = tub_mat.replace("_", " ").title()

        tub_install = round(BATHTUB_INSTALL.get(tub_type, 425) * labor_mult, 2)
        tub_jetted = 0
        if tub_spec.get("jetted"):
            tub_jetted = BATHTUB_EXTRAS["whirlpool_upgrade"]

        # Tub spout/faucet — skip if plumber already fixed bathtub plumbing
        tub_faucet = 0
        if not plumber_fixed_tub:
            tub_faucet = round(PLUMBING_RATES["tub_faucet_install"] * labor_mult, 2)

        tub_combined = tub_price + tub_install + tub_faucet + tub_jetted

        tub_parts = [
            f"Unit: {tub_mat_label} ${tub_price:,.2f} allowance",
            f"Install: ${tub_install:,.2f}",
        ]
        if tub_faucet:
            tub_parts.append(f"Tub spout + faucet install: ${tub_faucet:,.2f}")
        else:
            tub_parts.append("Tub spout/faucet: plumber completed (excluded)")
        if tub_jetted:
            tub_parts.append(f"Whirlpool upgrade: ${tub_jetted:,.2f}")

        _add(line_items, 5,
             f"Bathtub complete - {tub_type_label} ({tub_mat_label})",
             1, "EA", tub_combined, "fixture",
             notes=" | ".join(tub_parts))

        # Shower valve & trim — auto-include when tub has surround tile
        # Skip if plumber already fixed shower/tub valve (water damage source)
        _has_tub_surround = tub_spec.get("surround_tile", False)
        if not _has_tub_surround and sk_tub:
            _has_tub_surround = sk_tub.get("properties", {}).get("hasSurround", False)

        if _has_tub_surround and tub_type not in ("freestanding",):
            if not plumber_fixed_shower:
                valve_cost = round(BATHTUB_EXTRAS["shower_valve_body_trim"] * labor_mult, 2)
                sh_head_cost = round(BATHTUB_EXTRAS["showerhead_install"] * labor_mult, 2)
                valve_total = valve_cost + sh_head_cost
                _add(line_items, 5,
                     "Shower valve + trim kit replacement (tub/shower combo)",
                     1, "EA", valve_total, "plumbing",
                     notes=f"Pressure-balance valve body + trim ${valve_cost:,.2f} | "
                           f"Shower head + arm ${sh_head_cost:,.2f} | "
                           f"Replace while wall is open to prevent future leak")
            else:
                warnings.append(
                    f"Shower valve excluded — plumber already repaired "
                    f"(water damage source: {wd_source})"
                )

    # Shower (consolidated: body → 1 item, door → 1 item, max 2 items)
    if estimate.replace_shower:
        stype = shower_spec.get("type", "one_piece")
        shower_total = 0
        shower_parts = []

        # --- Unit (insert) or custom tile extras ---
        if stype in ("one_piece", "multi_piece_kit"):
            insert_price = SHOWER_INSERT_PRICES.get(stype, 650)
            insert_install = round(
                SHOWER_INSERT_INSTALL * labor_mult, 2)
            shower_total += insert_price + insert_install
            shower_parts.append(
                f"Unit: {stype.replace('_', ' ')} "
                f"${insert_price:,.2f}")
            shower_parts.append(
                f"Install: ${insert_install:,.2f}")

        elif stype == "neo_angle_kit":
            # Complete neo-angle kit (base+walls+door)
            s_w = shower_spec.get("width_in", 36) or 36
            kit_grade = shower_spec.get(
                "neo_angle_kit_grade", "basic_fiberglass")
            kit_prices = NEO_ANGLE_KIT_PRICES.get(
                kit_grade, {})
            sizes = sorted(kit_prices.keys()) if kit_prices else [36]
            sz = min(sizes, key=lambda x: abs(x - s_w))
            kit_price = kit_prices.get(sz, 900)
            kit_install = round(
                NEO_ANGLE_KIT_INSTALL * labor_mult, 2)
            shower_total += kit_price + kit_install
            grade_label = kit_grade.replace("_", " ")
            shower_parts.append(
                f"Neo-angle kit ({grade_label}, {sz}\"): "
                f"${kit_price:,.2f}")
            shower_parts.append(
                f"Kit install: ${kit_install:,.2f}")

        elif stype == "neo_angle_custom":
            # Neo-angle custom: separate base + wall + door
            s_w = shower_spec.get("width_in", 36) or 36
            wall_mat = shower_spec.get(
                "wall_material", "tile")

            # Base pan
            base_sizes = sorted(NEO_ANGLE_BASE_PRICES.keys())
            bsz = min(base_sizes, key=lambda x: abs(x - s_w))
            base_price = NEO_ANGLE_BASE_PRICES.get(bsz, 220)
            base_install = round(
                NEO_ANGLE_BASE_INSTALL * labor_mult, 2)
            shower_total += base_price + base_install
            shower_parts.append(
                f"Neo-angle base ({bsz}\"): "
                f"${base_price:,.2f}")
            shower_parts.append(
                f"Base install: ${base_install:,.2f}")

            # Wall surround (if not tile)
            if wall_mat != "tile":
                ws_prices = NEO_ANGLE_WALL_SURROUND_PRICES.get(
                    wall_mat, {})
                ws_sizes = sorted(ws_prices.keys()) if ws_prices else [36]
                wsz = min(ws_sizes, key=lambda x: abs(x - s_w))
                ws_price = ws_prices.get(wsz, 325)
                ws_install = round(
                    NEO_ANGLE_WALL_SURROUND_INSTALL
                    * labor_mult, 2)
                shower_total += ws_price + ws_install
                ws_label = wall_mat.replace("_", " ")
                shower_parts.append(
                    f"Wall surround ({ws_label}): "
                    f"${ws_price:,.2f}")
                shower_parts.append(
                    f"Surround install: ${ws_install:,.2f}")

            # Custom tile extras (niches, bench, curb)
            niches = shower_spec.get("niches", 0)
            if niches > 0:
                niche_cost = round(
                    niches
                    * SHOWER_CUSTOM_EXTRAS["niche_each"]
                    * labor_mult, 2)
                shower_total += niche_cost
                shower_parts.append(
                    f"Niche x{niches}: ${niche_cost:,.2f}")
            if shower_spec.get("bench"):
                bench_cost = round(
                    SHOWER_CUSTOM_EXTRAS["bench"]
                    * labor_mult, 2)
                shower_total += bench_cost
                shower_parts.append(
                    f"Bench: ${bench_cost:,.2f}")
            curb_cost = round(
                SHOWER_CUSTOM_EXTRAS["curb"]
                * labor_mult, 2)
            shower_total += curb_cost
            shower_parts.append(
                f"Curb: ${curb_cost:,.2f}")

        if stype in ("custom_tile", "curbless"):
            niches = shower_spec.get("niches", 0)
            if niches > 0:
                niche_cost = round(
                    niches
                    * SHOWER_CUSTOM_EXTRAS["niche_each"]
                    * labor_mult, 2)
                shower_total += niche_cost
                shower_parts.append(
                    f"Niche x{niches}: ${niche_cost:,.2f}")
            if shower_spec.get("bench"):
                bench_cost = round(
                    SHOWER_CUSTOM_EXTRAS["bench"]
                    * labor_mult, 2)
                shower_total += bench_cost
                shower_parts.append(
                    f"Bench: ${bench_cost:,.2f}")
            if stype == "curbless":
                drain_cost = round(
                    SHOWER_CUSTOM_EXTRAS["curbless_drain"]
                    * labor_mult, 2)
                shower_total += drain_cost
                shower_parts.append(
                    f"Linear drain: ${drain_cost:,.2f}")
            else:
                curb_cost = round(
                    SHOWER_CUSTOM_EXTRAS["curb"]
                    * labor_mult, 2)
                shower_total += curb_cost
                shower_parts.append(
                    f"Curb: ${curb_cost:,.2f}")

        # --- Showerhead ---
        sh_type = shower_spec.get("showerhead_type", "standard")
        sh_price = SHOWERHEAD_PRICES.get(sh_type, 65)
        grade_mult = TRIM_GRADE_MULTIPLIER.get(shower_spec.get("trim_grade", "mid"), 1.0)
        sh_cost = round(sh_price * grade_mult, 2)
        shower_total += sh_cost
        shower_parts.append(f"Showerhead: {sh_type} ${sh_cost:,.2f}")

        # --- Valve (skip if plumber already repaired shower plumbing) ---
        if plumber_fixed_shower:
            shower_parts.append("Valve/trim: plumber completed (excluded)")
        elif shower_spec.get("valve_replace"):
            valve_type = (
                "thermostatic"
                if shower_spec.get("trim_grade") == "premium"
                else "pressure_balance"
            )
            valve_cost = round(
                SHOWER_VALVE_PRICES.get(valve_type, 275) * labor_mult, 2
            )
            shower_total += valve_cost
            vt_label = valve_type.replace('_', ' ')
            shower_parts.append(
                f"Valve body + trim: {vt_label} ${valve_cost:,.2f}"
            )
        elif stype in ("custom_tile", "curbless"):
            # Trim-only (retain existing valve body)
            trim_cost = round(
                PLUMBING_RATES["shower_valve_trim"] * labor_mult, 2
            )
            shower_total += trim_cost
            shower_parts.append(
                f"Trim only (valve body retained): "
                f"${trim_cost:,.2f}"
            )

        # --- Trim install (when valve replaced) ---
        if shower_spec.get("valve_replace"):
            trim_cost = round(
                PLUMBING_RATES["shower_valve_trim"] * labor_mult, 2
            )
            shower_total += trim_cost
            shower_parts.append(
                f"Trim install labor: ${trim_cost:,.2f}"
            )

        stype_label = stype.replace("_", " ")
        _add(line_items, 5,
             f"Shower complete - {stype_label}",
             1, "EA", shower_total, "fixture",
             notes=" | ".join(shower_parts))

        # --- Shower door (separate line item) ---
        door_type = shower_spec.get("door_type")
        door_width = shower_spec.get("door_width_in", 0) or 0
        s_w_door = shower_spec.get("width_in", 36) or 36

        # Neo-angle door types
        if (door_type
                and door_type in NEO_ANGLE_DOOR_PRICES):
            na_prices = NEO_ANGLE_DOOR_PRICES[door_type]
            na_sizes = sorted(na_prices.keys())
            na_sz = min(
                na_sizes,
                key=lambda x: abs(x - s_w_door))
            mat_price = na_prices[na_sz]
            door_install = round(
                NEO_ANGLE_DOOR_INSTALL.get(
                    door_type, 375) * labor_mult, 2)
            door_combined = mat_price + door_install
            door_label = door_type.replace(
                "_", " ").title()
            door_note = (
                f"Door: ${mat_price:,.2f} | "
                f"Install: ${door_install:,.2f} | "
                f"{na_sz}\" neo-angle")
            _add(
                line_items, 5,
                f"Neo-angle door - {door_label}",
                1, "EA", door_combined, "fixture",
                notes=door_note)

        # Standard door types
        elif door_type and door_type in SHOWER_DOOR_PRICES:
            prices = SHOWER_DOOR_PRICES[door_type]
            if "any" in prices:
                mat_price = prices["any"]
            else:
                widths = sorted(prices.keys())
                w = (min(widths,
                         key=lambda x: abs(x - door_width))
                     if door_width
                     else widths[len(widths) // 2])
                mat_price = prices[w]
            door_label = door_type.replace(
                "_", " ").title()

            if door_type == "curtain":
                _add(
                    line_items, 5,
                    "Shower curtain rod + curtain",
                    1, "EA", mat_price, "fixture")
            else:
                door_install = round(
                    SHOWER_DOOR_INSTALL.get(
                        door_type, 250
                    ) * labor_mult, 2)
                door_combined = mat_price + door_install
                door_note = (
                    f"Door: ${mat_price:,.2f} | "
                    f"Install: ${door_install:,.2f}")
                if door_width:
                    door_note += (
                        f" | {door_width}\" opening")
                _add(
                    line_items, 5,
                    f"Shower door - {door_label}",
                    1, "EA", door_combined, "fixture",
                    notes=door_note)
        else:
            # Legacy fallback: enclosure field
            enclosure = shower_spec.get("enclosure")
            if enclosure and enclosure != "curtain":
                enc_price = SHOWER_ENCLOSURE_PRICES.get(enclosure, 350)
                _add(line_items, 5, f"Shower enclosure - {enclosure.replace('_', ' ')}",
                     1, "EA", enc_price, "fixture")
            elif enclosure == "curtain":
                _add(line_items, 5, "Shower curtain rod + curtain", 1, "EA",
                     SHOWER_ENCLOSURE_PRICES["curtain"], "fixture")

    # --- Shower curb tile ---
    if estimate.replace_shower and shower_spec.get("type") in ("custom_tile", "curbless"):
        curb_h = shower_spec.get("curb_height", 4) or 0
        if curb_h > 0:
            s_w = shower_spec.get("width_in", 36) or 36
            curb_depth = 4  # standard curb depth
            curb_sf = round((s_w * curb_depth + 2 * s_w * curb_h) / 144, 1)
            if curb_sf > 0:
                _add(line_items, 4, "Shower curb tile",
                     curb_sf, "SF", round(12.00 * labor_mult, 2), "tile",
                     notes=f"Top + front/back faces, {curb_h}\" curb height")

    # --- Fixed glass panel (shower) ---
    if estimate.replace_shower:
        panel_cfg = shower_spec.get("fixed_panel_config", "none")
        layout = shower_spec.get("layout", "alcove")
        s_w = shower_spec.get("width_in", 36) or 36
        s_d = shower_spec.get("depth_in", 36) or 36
        panel_width_in = 0
        panel_count = 0

        if layout in ("corner", "corner_right"):
            panel_width_in += s_d  # full side glass
            panel_count += 1
        if panel_cfg == "left" or panel_cfg == "both":
            panel_width_in += s_w * 0.25
            panel_count += 1
        if panel_cfg == "right" or panel_cfg == "both":
            panel_width_in += s_w * 0.25
            panel_count += 1

        if panel_count > 0 and panel_width_in > 0:
            panel_sf = round(panel_width_in * 72 / 144, 1)  # 72" standard height
            panel_cost = round(25.00 * panel_sf * labor_mult, 2)
            _add(line_items, 5, f"Fixed glass panel ({panel_count})",
                 panel_count, "EA", panel_cost, "fixture",
                 notes=f"{panel_sf} SF tempered glass, installed")

    # Tile edge trim (Schluter/metal) for custom tile showers
    if (estimate.replace_shower
            and shower_spec.get("type") in ("custom_tile", "curbless")):
        # Estimate trim LF: perimeter of shower opening + niche edges
        s_w = shower_spec.get("width_in", 36) or 36
        s_d = shower_spec.get("depth_in", 36) or 36
        trim_lf = (s_w + 2 * s_d) / 12  # interior perimeter
        niches = shower_spec.get("niches", 0)
        trim_lf += niches * 3  # ~3 LF per niche
        if trim_lf > 0:
            _add(line_items, 4,
                 "Tile edge trim (Schluter Jolly/Rondec)",
                 round(trim_lf, 1), "LF",
                 round(8.50 * labor_mult, 2), "tile",
                 notes="Metal edge trim at exposed tile edges")

    # Vanity (supports multiple vanities via items array)
    # Each vanity is consolidated into a single line item
    van_raw = estimate.vanity_spec or {}
    if estimate.replace_vanity and van_raw:
        # Backward compat: old format has no 'items' key
        vanity_items = van_raw.get("items") or [van_raw]

        for vi, van in enumerate(vanity_items):
            if not van or not isinstance(van, dict):
                continue
            label = f" #{vi + 1}" if len(vanity_items) > 1 else ""
            sink_type = van.get("sink_type", "cabinet")

            # ── Pedestal / Wall-Mount Sink path ──
            if sink_type in ("pedestal_sink", "wall_mount_sink"):
                sink_label = "Pedestal sink" if sink_type == "pedestal_sink" else "Wall-mount sink"
                fixture_price = SINK_PRICES.get(sink_type, 350)
                install_price = round(SINK_INSTALL.get(sink_type, 375) * labor_mult, 2)

                faucet = van.get("faucet_type", "centerset")
                faucet_price = SINK_FAUCET.get(faucet, 175)
                faucet_label = faucet.replace('_', ' ')
                faucet_connect = 0
                if not plumber_fixed_vanity:
                    faucet_connect = round(SINK_FAUCET_INSTALL * labor_mult, 2)
                faucet_total = round(faucet_price + faucet_connect, 2)

                mirror_total = 0
                mirror_price = 0
                mirror_label = ""
                if getattr(estimate, 'replace_mirror', False):
                    mirror = van.get("mirror_type", "framed")
                    mirror_price = MIRROR_PRICES.get(mirror, 175)
                    mirror_label = mirror.replace('_', ' ')
                    mirror_total = round(mirror_price + MIRROR_INSTALL * labor_mult, 2)

                combined = fixture_price + install_price + faucet_total + mirror_total

                parts = [
                    f"{sink_label}: ${fixture_price:,.2f} allowance",
                    f"Install: ${install_price:,.2f}",
                ]
                if faucet_connect:
                    parts.append(f"Faucet: {faucet_label} ${faucet_price:,.2f} + plumbing connect ${faucet_connect:,.2f}")
                else:
                    parts.append(f"Faucet: {faucet_label} ${faucet_price:,.2f} (plumbing: plumber completed)")
                if getattr(estimate, 'replace_mirror', False):
                    mirror_install_cost = round(MIRROR_INSTALL * labor_mult, 2)
                    parts.append(f"Mirror: {mirror_label} ${mirror_price:,.2f} + install ${mirror_install_cost:,.2f}")
                elif getattr(estimate, 'detach_reset_mirror', False):
                    parts.append("Mirror: D&R (separate line)")
                else:
                    parts.append("Mirror: not included")

                _add(line_items, 5,
                     f"{sink_label}{label} complete",
                     1, "EA", combined, "fixture",
                     notes=" | ".join(parts))
                continue

            # ── Cabinet Vanity path (existing logic) ──
            v_width = van.get("width", 36)
            v_source = van.get("source", "stock_rta")
            v_prices = VANITY_PRICES.get(
                v_source, VANITY_PRICES["stock_rta"])
            v_price = v_prices.get(
                v_width, v_prices.get(36, 500))
            src_label = v_source.replace('_', ' ')

            # --- Countertop ---
            v_top = van.get("top_material", "quartz")
            top_rate = VANITY_TOP_PRICES.get(v_top, 14)
            top_label = v_top.replace('_', ' ')
            top_total = round(v_width * top_rate, 2)

            # --- Installation ---
            install_price = round(VANITY_INSTALL * labor_mult, 2)

            # --- Wall mount blocking ---
            wall_mount_price = 0
            if van.get("mounting") == "wall_mount":
                wall_mount_price = round(
                    VANITY_EXTRAS["wall_mount_blocking"] * labor_mult, 2)

            # --- Faucet (allowance) + plumbing connection ---
            faucet = van.get("faucet_type", "single_hole")
            faucet_key = f"faucet_{faucet}"
            faucet_price = VANITY_EXTRAS.get(faucet_key, 195)
            faucet_label = faucet.replace('_', ' ')
            sink_count = van.get("sinks", 1)
            faucet_total = round(faucet_price * sink_count, 2)

            # Plumbing connection labor (unless plumber already fixed vanity)
            faucet_connect = 0
            if not plumber_fixed_vanity:
                faucet_connect = round(
                    PLUMBING_RATES["vanity_faucet_install"] * labor_mult, 2)
            faucet_total += faucet_connect

            # --- Mirror (only if replace_mirror is set) ---
            mirror_total = 0
            mirror_label = ""
            mirror_price = 0
            if getattr(estimate, 'replace_mirror', False):
                mirror = van.get("mirror_type", "framed")
                mirror_price = MIRROR_PRICES.get(mirror, 175)
                mirror_label = mirror.replace('_', ' ')
                mirror_total = round(
                    mirror_price + MIRROR_INSTALL * labor_mult, 2)

            # --- Combined total ---
            combined = (
                v_price + top_total + install_price
                + wall_mount_price + faucet_total + mirror_total
            )

            # Build breakdown note with allowance info
            parts = [
                f"Cabinet: {src_label} ({v_width}\") "
                f"${v_price:,.2f} allowance",
                f"Top: {top_label} ${top_rate}/in "
                f"${top_total:,.2f}",
                f"Install: ${install_price:,.2f}",
            ]
            if wall_mount_price:
                parts.append(
                    f"Wall-mount blocking: "
                    f"${wall_mount_price:,.2f}"
                )
            # Faucet note: show per-unit price × count when double-sink
            _fa_each = faucet_price  # allowance per faucet
            _fa_total = round(_fa_each * sink_count, 2)
            if sink_count > 1:
                _fa_str = (
                    f"${_fa_each:,.2f} ×{sink_count}"
                    f" = ${_fa_total:,.2f} allowance"
                )
            else:
                _fa_str = f"${_fa_total:,.2f} allowance"
            if faucet_connect:
                parts.append(
                    f"Faucet: {faucet_label} "
                    f"{_fa_str} + "
                    f"plumbing connect ${faucet_connect:,.2f}"
                )
            else:
                parts.append(
                    f"Faucet: {faucet_label} "
                    f"{_fa_str} "
                    f"(plumbing: plumber completed)"
                )
            if getattr(estimate, 'replace_mirror', False):
                mirror_install_cost = round(
                    MIRROR_INSTALL * labor_mult, 2)
                parts.append(
                    f"Mirror: {mirror_label} "
                    f"${mirror_price:,.2f} allowance + "
                    f"install ${mirror_install_cost:,.2f}"
                )
            elif getattr(estimate, 'detach_reset_mirror', False):
                parts.append("Mirror: D&R (separate line)")
            else:
                parts.append("Mirror: not included")

            _add(line_items, 5,
                 f"Vanity{label} complete"
                 f" - {src_label} ({v_width}\")",
                 1, "EA", combined, "fixture",
                 notes=" | ".join(parts))

    # Toilet (consolidated: toilet + install + supplies → 1 item, bidet → separate)
    tlt = estimate.toilet_spec or {}
    if estimate.replace_toilet and tlt:
        t_type = tlt.get("type", "two_piece_standard")
        t_price = TOILET_PRICES.get(t_type, 225)
        t_install = round(PLUMBING_RATES["toilet_set"] * labor_mult, 2)

        # Plumbing supplies — skip supply line if plumber already fixed toilet
        if plumber_fixed_toilet:
            t_supplies = round(TOILET_EXTRAS["wax_ring"], 2)
        else:
            t_supplies = round(
                TOILET_EXTRAS["wax_ring"] + PLUMBING_RATES["supply_line_each"], 2)

        t_flange = 0
        if tlt.get("flange_repair"):
            t_flange = round(TOILET_EXTRAS["flange_repair"] * labor_mult, 2)

        t_combined = t_price + t_install + t_supplies + t_flange
        t_type_label = t_type.replace('_', ' ')

        t_parts = [
            f"Unit: {t_type_label} ${t_price:,.2f} allowance",
            f"Install: ${t_install:,.2f}",
        ]
        if plumber_fixed_toilet:
            t_parts.append(f"Wax ring: ${t_supplies:,.2f} (supply line: plumber completed)")
        else:
            t_parts.append(f"Wax ring + supply: ${t_supplies:,.2f}")
        if t_flange:
            t_parts.append(f"Flange repair: ${t_flange:,.2f}")

        _add(line_items, 5,
             f"Toilet complete - {t_type_label}",
             1, "EA", t_combined, "fixture",
             notes=" | ".join(t_parts))

        if tlt.get("bidet_seat"):
            _add(line_items, 5, "Bidet seat installation", 1, "EA",
                 TOILET_PRICES["bidet_seat"], "fixture")
            warnings.append("Bidet seat requires GFCI outlet nearby")

    # ────────────────────────────────────────
    # Detach & Reset (labor only, no material)
    # ────────────────────────────────────────
    if getattr(estimate, 'detach_reset_tub', False):
        tub_mat = (estimate.bathtub_spec or {}).get("material", "acrylic")
        dr_key = "bathtub_cast_iron" if tub_mat == "cast_iron" else "bathtub_standard"
        _add(line_items, 5,
             f"Detach & Reset - Bathtub"
             f" ({tub_mat.replace('_', ' ').title()})",
             1, "EA", DETACH_RESET_COSTS[dr_key] * labor_mult, "fixture",
             notes="Labor only: remove, store, reinstall")

    if getattr(estimate, 'detach_reset_shower', False):
        shower_spec_dr = estimate.shower_spec or {}
        stype_dr = shower_spec_dr.get("type", "one_piece")
        if stype_dr in ("one_piece", "multi_piece_kit"):
            _add(line_items, 5, "Detach & Reset - Shower surround",
                 1, "EA", DETACH_RESET_COSTS["shower_surround"] * labor_mult,
                 "fixture", notes="Labor only: remove panels, store, reinstall")
        else:
            _add(line_items, 5, "Detach & Reset - Shower door/enclosure",
                 1, "EA", DETACH_RESET_COSTS["shower_door"] * labor_mult,
                 "fixture", notes="Labor only: remove, store, reinstall")

    if getattr(estimate, 'detach_reset_vanity', False):
        _dr_van_items = (estimate.vanity_spec or {}).get("items") or [estimate.vanity_spec or {}]
        for _dv in _dr_van_items:
            if not _dv or not isinstance(_dv, dict):
                continue
            _dr_sink_t = _dv.get("sink_type", "cabinet")
            _dr_label = {
                "pedestal_sink": "Detach & Reset - Pedestal sink",
                "wall_mount_sink": "Detach & Reset - Wall-mount sink",
            }.get(_dr_sink_t, "Detach & Reset - Vanity & sink")
            _add(line_items, 5, _dr_label,
                 1, "EA",
                 DETACH_RESET_COSTS["vanity"] * labor_mult,
                 "fixture",
                 notes="Labor only: disconnect, remove, reinstall")

    if getattr(estimate, 'detach_reset_toilet', False):
        _add(line_items, 5, "Detach & Reset - Toilet",
             1, "EA", DETACH_RESET_COSTS["toilet"] * labor_mult, "fixture",
             notes="Labor only: remove, store, reinstall w/ new wax ring")

    if getattr(estimate, 'detach_reset_mirror', False):
        dr_mirror_count = len(
            (estimate.vanity_spec or {}).get("items", [])
        ) or 1
        _add(line_items, 5, "Detach & Reset - Mirror",
             dr_mirror_count, "EA",
             DETACH_RESET_COSTS["mirror"] * labor_mult, "fixture",
             notes="Labor only: careful removal, store, reinstall")

    # Mirror standalone install (when replacing mirror WITHOUT replacing vanity)
    if (getattr(estimate, 'replace_mirror', False)
            and not estimate.replace_vanity):
        van_raw_m = estimate.vanity_spec or {}
        vanity_items_m = van_raw_m.get("items") or [van_raw_m]
        for vi, van in enumerate(vanity_items_m):
            if not van or not isinstance(van, dict):
                continue
            label = f" #{vi + 1}" if len(vanity_items_m) > 1 else ""
            mirror_type = van.get("mirror_type", "framed")
            mirror_price = MIRROR_PRICES.get(mirror_type, 175)
            mirror_label = mirror_type.replace('_', ' ')
            mirror_install = round(MIRROR_INSTALL * labor_mult, 2)
            mirror_combined = mirror_price + mirror_install
            _add(line_items, 5,
                 f"Mirror{label} - {mirror_label} (supply + install)",
                 1, "EA", mirror_combined, "fixture",
                 notes=f"Mirror: ${mirror_price:,.2f} allowance | "
                       f"Install: ${mirror_install:,.2f}")

    # ────────────────────────────────────────
    # Phase 3 (Electrical - grouped with trades)
    # ────────────────────────────────────────
    elec = estimate.electrical_spec or {}

    gfci_count = elec.get("gfci_count") or 0
    if gfci_count > 0:
        _add(line_items, 2, "GFCI outlet installation", gfci_count, "EA",
             ELECTRICAL_RATES["gfci_outlet_each"] * labor_mult, "electrical")

    # Vanity light — explicit replace or D&R takes priority over electrical_spec count
    if getattr(estimate, 'replace_vanity_light', False):
        vl_count = (elec.get("vanity_lights") or 0) or 1
        _add(line_items, 2, "Vanity light fixture installation", vl_count, "EA",
             ELECTRICAL_RATES["vanity_light_install"] * labor_mult, "electrical")
    elif getattr(estimate, 'detach_reset_vanity_light', False):
        vl_count = (elec.get("vanity_lights") or 0) or 1
        _add(line_items, 2, "Detach & Reset - Vanity light fixture", vl_count, "EA",
             DETACH_RESET_COSTS.get("vanity_light", 85) * labor_mult, "electrical",
             notes="Labor only: careful removal, store, reinstall")
    elif (elec.get("vanity_lights") or 0) > 0:
        _add(line_items, 2, "Vanity light fixture installation", elec["vanity_lights"], "EA",
             ELECTRICAL_RATES["vanity_light_install"] * labor_mult, "electrical")

    if elec.get("ceiling_fixture"):
        _add(line_items, 2, "Ceiling light fixture installation", 1, "EA",
             ELECTRICAL_RATES["ceiling_fixture_install"] * labor_mult, "electrical")

    fan_cfm = elec.get("exhaust_fan_cfm")
    if fan_cfm:
        fan_prices = ELECTRICAL_RATES["exhaust_fan"]
        fan_price = fan_prices.get(fan_cfm, fan_prices.get(80, 425))
        _add(line_items, 2, f"Exhaust fan ({fan_cfm} CFM) + installation", 1, "EA",
             fan_price * labor_mult, "electrical")

        switch_type = elec.get("exhaust_fan_switch", "standard")
        switch_price = ELECTRICAL_RATES["exhaust_fan_switch"].get(switch_type, 35)
        if switch_type != "standard":
            _add(line_items, 2, f"Exhaust fan switch - {switch_type}", 1, "EA",
                 switch_price, "electrical")

    if elec.get("inspection"):
        _add(line_items, 2, "Electrical inspection fee", 1, "EA",
             ELECTRICAL_RATES["electrical_inspection_fee"], "electrical")

    # ────────────────────────────────────────
    # Phase 6: Finish (Paint, Trim, Caulk)
    # ────────────────────────────────────────
    walls = estimate.walls_spec or {}
    paint_grade = walls.get("paint_grade")  # None if not specified
    wall_finish = walls.get("wall_finish", "paint" if walls.get("paint_walls") else None)
    paint_ceiling = walls.get("paint_ceiling", False)
    pg_mult = PAINT_GRADE_MULTIPLIER.get(paint_grade, 1.0) if paint_grade else 1.0
    do_paint = wall_finish in ("paint", "paint_and_tile")
    do_tile_walls = wall_finish in ("tile", "paint_and_tile")

    # Wall painting
    if do_paint and paint_grade and wall_sf > 0:
        # Subtract non-paintable wall areas (tile, surround, tub alcove)
        wall_deductions: List[tuple] = []  # (label, sf)

        # 1) Custom tile / curbless shower walls
        if estimate.replace_shower:
            s_spec = estimate.shower_spec or {}
            s_type = s_spec.get("type", "")
            if s_type in ("custom_tile", "curbless"):
                ts = (s_spec.get("tile_spec") or {}).get("sf", 0)
                if not ts:
                    sw = s_spec.get("width_in", 0) or 0
                    sd = s_spec.get("depth_in", 0) or 0
                    sh = s_spec.get("tile_height_in", 0) or 0
                    if sw and sd and sh:
                        ts = (sw + 2 * sd) * sh / 144
                if ts:
                    wall_deductions.append(("Shower tile walls", round(ts, 1)))
            elif s_type in ("one_piece", "multi_piece_kit"):
                sw = s_spec.get("width_in", 36) or 36
                sd = s_spec.get("depth_in", 36) or 36
                sh = s_spec.get("tile_height_in", 72) or 72
                ps = (sw + 2 * sd) * sh / 144
                wall_deductions.append(
                    ("Shower surround area", round(ps, 1)))

        # 2) Bathtub surround (tile or prefab)
        t_spec = estimate.bathtub_spec or {}
        tub_type = t_spec.get("type", "")
        if t_spec.get("surround_tile"):
            ts2 = t_spec.get("surround_tile_sf", 0)
            if not ts2:
                tl = t_spec.get("tub_length_in", 0) or 0
                tsh = t_spec.get("surround_height_in", 0) or 0
                td = t_spec.get("tub_depth_in", 30) or 30
                if tl and tsh:
                    ts2 = (tl + 2 * td) * tsh / 144
            if ts2:
                wall_deductions.append(
                    ("Tub surround tile", round(ts2, 1)))
        elif tub_type == "alcove" and estimate.replace_tub:
            tl = t_spec.get("tub_length_in", 60) or 60
            td = t_spec.get("tub_depth_in", 30) or 30
            surround_h = 60
            alcove_sf = (tl + 2 * td) * surround_h / 144
            wall_deductions.append(
                ("Tub alcove surround", round(alcove_sf, 1)))

        total_deduct = sum(sf for _, sf in wall_deductions)
        paint_wall_sf = max(wall_sf - total_deduct, 0)

        # In paint_and_tile mode, use sketch-provided paint_wall_sf if available
        if wall_finish == "paint_and_tile":
            sketch_paint_sf = walls.get("paint_wall_sf")
            if sketch_paint_sf and sketch_paint_sf > 0:
                paint_wall_sf = sketch_paint_sf

        # Only add original wall paint if full_paint_wall_sf not set (drywall repair handles it below)
        _full_paint_wall_sf = walls.get("full_paint_wall_sf", 0) or 0
        if paint_wall_sf > 0 and not _full_paint_wall_sf:
            deduct_note = None
            if wall_deductions:
                parts = [f"Total wall {wall_sf:.0f} SF"]
                for label, sf in wall_deductions:
                    parts.append(f"- {label} {sf:.0f} SF")
                parts.append(f"= Paintable {paint_wall_sf:.0f} SF")
                deduct_note = " | ".join(parts)
            _add(line_items, 6,
                 f"Wall painting ({paint_grade} grade)",
                 paint_wall_sf, "SF",
                 PAINT_RATES["wall_per_sf"] * pg_mult * labor_mult,
                 "finish", notes=deduct_note)

    # Wall tile (when wall_finish is 'tile' or 'paint_and_tile')
    if do_tile_walls and wall_sf > 0:
        tile_wall_sf = walls.get("tile_wall_sf", 0) or 0
        if wall_finish == "tile":
            # Full tile: use paint_wall_sf (available after deductions) or wall_sf
            tile_wall_sf = tile_wall_sf or paint_wall_sf if 'paint_wall_sf' in dir() else wall_sf
        if tile_wall_sf > 0:
            tile_mat = walls.get("tile_material", "porcelain")
            tile_pat = walls.get("tile_pattern", "straight")
            tile_sz = walls.get("tile_size", "12x24")
            # Material + labor per SF
            mat_rate = 5.50  # default porcelain
            lab_rate = 10.00
            tile_cost = round((mat_rate + lab_rate) * labor_mult, 2)
            _add(line_items, 4,
                 f"Wall tile - {tile_mat} ({tile_sz}, {tile_pat})",
                 round(tile_wall_sf, 1), "SF", tile_cost, "tile",
                 notes="Bathroom wall tile (non-shower/tub areas)")

    # ── Seal & prime (repaired drywall areas only) ──
    seal_prime_wall_sf = walls.get("seal_prime_wall_sf", 0) or 0
    seal_prime_ceil_sf = walls.get("seal_prime_ceiling_sf", 0) or 0
    total_seal_sf = seal_prime_wall_sf + seal_prime_ceil_sf
    if total_seal_sf > 0:
        seal_parts = []
        if seal_prime_wall_sf > 0:
            seal_parts.append(f"Wall {seal_prime_wall_sf:.0f} SF")
        if seal_prime_ceil_sf > 0:
            seal_parts.append(f"Ceiling {seal_prime_ceil_sf:.0f} SF")
        _add(line_items, 6,
             "Seal & prime - repaired drywall",
             round(total_seal_sf, 1), "SF",
             PAINT_RATES["seal_prime_per_sf"] * labor_mult,
             "finish",
             notes=f"PVA primer on new drywall only ({' + '.join(seal_parts)})")

    # ── Full wall painting (entire paintable wall when any drywall repair) ──
    full_paint_wall_sf = walls.get("full_paint_wall_sf", 0) or 0
    if full_paint_wall_sf > 0 and paint_grade:
        _add(line_items, 6,
             f"Wall painting - 2 coats ({paint_grade} grade)",
             round(full_paint_wall_sf, 1), "SF",
             PAINT_RATES["wall_per_sf"] * pg_mult * labor_mult,
             "finish",
             notes="Full wall paint (excl. tub/shower areas) — required when any wall drywall repair")
    elif do_paint and paint_grade and wall_sf > 0:
        # Fallback: no drywall repair, no full_paint_wall_sf — use wall_sf directly
        _add(line_items, 6,
             f"Wall painting ({paint_grade} grade)",
             wall_sf, "SF",
             PAINT_RATES["wall_per_sf"] * pg_mult * labor_mult,
             "finish")

    # ── Ceiling painting ──
    full_paint_ceil_sf = walls.get("full_paint_ceiling_sf", 0) or 0
    if full_paint_ceil_sf > 0 and paint_grade:
        _add(line_items, 6,
             f"Ceiling painting - 2 coats ({paint_grade} grade)",
             round(full_paint_ceil_sf, 1), "SF",
             PAINT_RATES["ceiling_per_sf"] * pg_mult * labor_mult,
             "finish",
             notes="Full ceiling paint — required when any ceiling drywall repair")
    elif paint_ceiling and paint_grade and floor_sf > 0:
        _add(line_items, 6,
             f"Ceiling painting ({paint_grade} grade)",
             floor_sf, "SF",
             PAINT_RATES["ceiling_per_sf"] * pg_mult * labor_mult,
             "finish")

    # Baseboard — perimeter minus fixture wall-contact widths from sketch
    # Auto-default to PVC when replacing floor (baseboard must be removed/replaced)
    bb_mat = walls.get("baseboard_material")
    if not bb_mat and replace_floor:
        bb_mat = "pvc"
    add_quarter_round = walls.get("quarter_round", False)
    if bb_mat:
        # Compute perimeter from dimensions, or estimate from floor_sf
        if estimate.length_ft and estimate.width_ft:
            perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        elif floor_sf > 0:
            import math
            side = math.sqrt(floor_sf)
            perimeter = 4 * side
        else:
            perimeter = 0

        # Extract fixture wall-contact widths from sketch_data (actual drawn sizes)
        sketch = estimate.sketch_data or {}
        sketch_fixtures = sketch.get("fixtures", [])

        deductions = []
        # Door: from sketch or default 3'
        doors = [f for f in sketch_fixtures if f.get("type") == "door"]
        if doors:
            for d in doors:
                d_w = round((d.get("dimensions", {}).get("width", 36)) / 12, 1)
                deductions.append(("door", d_w))
        else:
            deductions.append(("door", 3.0))

        # Bathtub: long side (wall contact) or spec or default 60"
        if estimate.replace_tub or getattr(estimate, 'detach_reset_tub', False):
            sk_tub = next((f for f in sketch_fixtures if f.get("type") == "bathtub"), None)
            if sk_tub:
                sk_d = sk_tub.get("dimensions", {})
                tub_w = round(max(sk_d.get("width", 60), sk_d.get("height", 32)) / 12, 1)
            else:
                tub_w = round(((estimate.bathtub_spec or {}).get("tub_length_in") or 60) / 12, 1)
            deductions.append(("bathtub", tub_w))

        # Shower: sketch width or spec or default 36"
        if estimate.replace_shower or getattr(estimate, 'detach_reset_shower', False):
            sk_shower = next((f for f in sketch_fixtures if f.get("type") == "shower"), None)
            if sk_shower:
                sh_w = round(sk_shower.get("dimensions", {}).get("width", 36) / 12, 1)
            else:
                sh_w = round(((estimate.shower_spec or {}).get("width_in") or 36) / 12, 1)
            deductions.append(("shower", sh_w))

        # Vanity: each from sketch or spec or default 36"
        if estimate.replace_vanity or getattr(estimate, 'detach_reset_vanity', False):
            sk_vanities = [f for f in sketch_fixtures if f.get("type") == "vanity"]
            if sk_vanities:
                for sv in sk_vanities:
                    v_w = round(sv.get("dimensions", {}).get("width", 36) / 12, 1)
                    deductions.append(("vanity", v_w))
            else:
                van_items = (estimate.vanity_spec or {}).get("items", [])
                for vi in (van_items or [{}]):
                    v_w = round((vi.get("width") or 36) / 12, 1)
                    deductions.append(("vanity", v_w))

        total_deduct = sum(d[1] for d in deductions)
        bb_lf = round(max(perimeter - total_deduct, 0), 1)
        deduct_parts = ", ".join(f"{n} {v:.1f}'" for n, v in deductions)
        bb_notes = (f"Perimeter {perimeter:.1f}' - {deduct_parts} = {bb_lf}' net")

        if bb_lf > 0 and bb_mat == "tile":
            floor_tile_mat = (estimate.floor_spec or {}).get("material", "porcelain")
            tb_rate = TILE_BASEBOARD_PRICES.get(floor_tile_mat, 12.00)
            tile_label = floor_tile_mat.replace("_", " ").title()
            _add(line_items, 6, f"Tile base - {tile_label} (supply + install)", bb_lf, "LF",
                 tb_rate * labor_mult, "finish",
                 notes=bb_notes)
            _add(line_items, 6, "Tile base supplies (thinset, grout)", bb_lf, "LF",
                 1.50 * labor_mult, "finish")
        elif bb_lf > 0:
            bb_rate = BASEBOARD_PRICES.get(bb_mat, 6.50)
            bb_label = {"pvc": "PVC", "mdf": "MDF"}.get(bb_mat, bb_mat.replace('_', ' ').title())
            _add(line_items, 6, f"Baseboard - {bb_label} (supply + install)", bb_lf, "LF",
                 bb_rate * labor_mult, "finish",
                 notes=bb_notes)
            bb_pg_mult = PAINT_GRADE_MULTIPLIER.get(paint_grade, 1.0) if paint_grade else 1.0
            _add(line_items, 6, "Baseboard painting", bb_lf, "LF",
                 PAINT_RATES["trim_per_lf"] * bb_pg_mult * labor_mult, "finish")
            if add_quarter_round:
                qr_rate = QUARTER_ROUND_PRICES.get(bb_mat, 3.75)
                _add(line_items, 6, f"Quarter round - {bb_label} (supply + install)", bb_lf, "LF",
                     qr_rate * labor_mult, "finish",
                     notes="Covers floor-to-baseboard gap; moisture seal at floor transition")
                _add(line_items, 6, "Quarter round painting", bb_lf, "LF",
                     PAINT_RATES["trim_per_lf"] * bb_pg_mult * labor_mult, "finish")

    # ────────────────────────────────────────
    # Phase 7: Accessories + Punch/Cleanup
    # ────────────────────────────────────────
    acc = estimate.accessories_spec or {}
    acc_finish = acc.get("finish", "chrome")
    acc_grade = acc.get("grade", "mid")
    af_mult = ACCESSORY_FINISH_MULTIPLIER.get(acc_finish, 1.0)
    ag_mult = ACCESSORY_GRADE_MULTIPLIER.get(acc_grade, 1.0)

    # Accessories (consolidated into single line item)
    acc_items = [
        ("towel_bars", "Towel bar", "towel_bar"),
        ("hand_towel_rings", "Hand towel ring", "hand_towel_ring"),
        ("tp_holders", "TP holder", "tp_holder"),
        ("robe_hooks", "Robe hook", "robe_hook"),
        ("corner_shelves", "Corner shelf", "corner_shelf"),
        ("grab_bars", "Grab bar", "grab_bar"),
        ("toilet_brush_holders", "Brush holder", "toilet_brush_holder"),
        ("soap_dispensers", "Soap dispenser", "soap_dispenser"),
    ]
    acc_total = 0
    acc_parts = []
    for key, label, price_key in acc_items:
        qty = acc.get(key) or 0
        if qty > 0:
            base_price = ACCESSORY_PRICES.get(price_key, 50)
            item_cost = round(
                qty * base_price * af_mult * ag_mult * labor_mult, 2)
            acc_total += item_cost
            acc_parts.append(f"{label} x{qty} ${item_cost:,.2f}")

    # Curtain rod rolls into accessories line item
    if tub_spec.get("curtain_rod"):
        cr_cost = round(
            BATHTUB_EXTRAS["curtain_rod"] * af_mult * ag_mult * labor_mult,
            2,
        )
        acc_total += cr_cost
        acc_parts.append(f"Curtain rod + rings ${cr_cost:,.2f}")

    if acc_total > 0:
        finish_label = acc_finish.replace('_', ' ')
        _add(line_items, 7,
             f"Bathroom accessories - {finish_label} ({acc_grade})",
             1, "LS", acc_total, "finish",
             notes=" | ".join(acc_parts))

    if (acc.get("grab_bars") or 0) > 0:
        warnings.append("Grab bars require wood blocking in wall framing")

    # Hidden costs
    # ── Hidden costs — assigned to correct phases by trade ──

    # Phase 1: Demo-related
    if (estimate.bathtub_spec or {}).get("material") == "cast_iron" and estimate.replace_tub:
        _add(line_items, 1, "Cast iron tub disposal surcharge", 1, "EA",
             HIDDEN_COSTS["cast_iron_disposal"], "demo")

    if needs_lead_rrp:
        _add(line_items, 1, "Lead paint RRP compliance (pre-1978)", 1, "LS",
             HIDDEN_COSTS["lead_rrp"], "demo")
        warnings.append(
            "Property built before 1978 - EPA RRP rule applies. "
            "Certified renovator required.")

    _add(line_items, 1, "Floor/surface protection", 1, "LS",
         HIDDEN_COSTS["floor_protection"], "demo")

    if hc.get("mobilization", False):
        _add(line_items, 1, "Mobilization / setup", 1, "LS",
             HIDDEN_COSTS["mobilization"], "demo")

    # Phase 3: Substrate — drywall patch/replacement (hidden cost)
    #   Skip when repair_drywall_walls is set — Path A already covers it.
    drywall_patch_sf = hc.get("drywall_patch_sf") or 0
    _repair_walls_explicit = getattr(
        estimate, 'repair_drywall_walls', False)
    if (hc.get("drywall_patch") and drywall_patch_sf > 0
            and not _repair_walls_explicit):
        drywall_patch_full = hc.get("drywall_patch_full", False)
        if drywall_patch_full:
            use_moisture = estimate.water_damage or estimate.mold_suspected
            rate_key = ("drywall_replace_moisture_per_sf"
                        if use_moisture else "drywall_replace_per_sf")
            board_label = "moisture-resistant" if use_moisture else "standard"
            _add(line_items, 3,
                 f"Drywall replacement ({board_label}) "
                 f"- hang, tape, mud, prime",
                 drywall_patch_sf, "SF",
                 SUBSTRATE_RATES[rate_key] * labor_mult, "substrate",
                 notes="Full replacement: hang new drywall "
                       "+ tape + mud + sand + prime")
        else:
            _add(line_items, 3,
                 "Drywall patching (around tile edges)",
                 drywall_patch_sf, "SF",
                 HIDDEN_COSTS["drywall_patch_per_sf"] * labor_mult,
                 "substrate")

    # Phase 6: Finish — caulk, trim paint
    _add(line_items, 6, "Caulking - silicone & latex (all joints)",
         1, "LS", HIDDEN_COSTS["caulk_day"] * labor_mult, "finish")

    trim_paint_lf = hc.get("trim_paint_lf") or 0
    if hc.get("trim_paint") and trim_paint_lf > 0:
        _add(line_items, 6, "Trim paint (post-install touch-up)",
             trim_paint_lf, "LF",
             HIDDEN_COSTS["trim_paint_per_lf"] * labor_mult, "finish")

    # Phase 7: Accessories, cleanup, permit
    _add(line_items, 7, "Final cleaning (move-in ready)", 1, "LS",
         HIDDEN_COSTS["final_clean"], "misc")

    # Mold warning
    if estimate.mold_suspected:
        warnings.append(
            "Mold suspected during initial assessment. A separate mold remediation "
            "estimate is required before remodel work can commence. Remediation must be "
            "completed and cleared by a certified inspector prior to substrate installation."
        )

    if estimate.water_damage:
        warnings.append(
            "Conditions identified during scope assessment require restoration. Demolition may reveal "
            "additional underlying conditions not visible during initial inspection. Any required "
            "additional work will be documented with photos and presented as a written change order "
            "for approval prior to proceeding."
        )

    # ────────────────────────────────────────
    # Auto-include: commonly missing items
    # ────────────────────────────────────────
    # These fire automatically based on scope to prevent change orders.
    # Can be disabled via hidden_costs flags (set to false).

    # 1) Drywall skim coat after wall tile removal
    # Use actual tiled-wall area, NOT full room wall SF.
    # demo_wall_sf is the whole-room perimeter×height fallback — far too large.
    if (demo_walls and hc.get("drywall_skim_coat") is True):
        # If estimator explicitly entered an override, honour it.
        if getattr(estimate, 'demo_wall_sf', None):
            skim_coat_sf = demo_wall_sf
            skim_note_area = f"{skim_coat_sf:.0f}SF (manual override)"
        else:
            # Build from actual tile removal areas only.
            skim_coat_sf = 0.0
            skim_parts = []

            # Shower surround: (width + 2×depth) × tile_height
            _sc_shower = estimate.shower_spec or {}
            if (estimate.replace_shower
                    and _sc_shower.get("type") in ("custom_tile", "curbless")):
                _sc_w = _sc_shower.get("width_in", 36) or 36
                _sc_d = _sc_shower.get("depth_in", 36) or 36
                _sc_h = _sc_shower.get("tile_height_in", 72) or 72
                _sc_sf = round((_sc_w + 2 * _sc_d) * _sc_h / 144, 1)
                skim_coat_sf += _sc_sf
                skim_parts.append(f"shower surround {_sc_sf:.0f}SF")

            # Tub surround: 3 walls of alcove (back + 2 ends) × surround height
            _sc_tub = estimate.bathtub_spec or {}
            if (_sc_tub.get("surround_tile", False)
                    and (estimate.replace_tub
                         or getattr(estimate, 'detach_reset_tub', False))):
                _st_l = _sc_tub.get("tub_length_in", 60) or 60
                _st_end = 32  # standard alcove end-wall depth
                _st_h = _sc_tub.get("surround_height_in", 60) or 60
                _st_sf = round((_st_l + 2 * _st_end) * _st_h / 144, 1)
                skim_coat_sf += _st_sf
                skim_parts.append(f"tub surround {_st_sf:.0f}SF")

            # Explicit demo_walls flag with no dimension source → cap at 25% of wall_sf
            if skim_coat_sf == 0 and demo_walls:
                skim_coat_sf = round(wall_sf * 0.25, 1)
                skim_parts.append(
                    f"est. 25% of room walls {skim_coat_sf:.0f}SF"
                    f" (no tile dims — verify on site)")

            skim_coat_sf = max(round(skim_coat_sf, 1), 0)
            skim_note_area = " + ".join(skim_parts) if skim_parts else ""

        if skim_coat_sf > 0:
            _add(line_items, 6, "Drywall prep/skim coat (post tile removal)",
                 skim_coat_sf, "SF",
                 HIDDEN_COSTS["drywall_skim_coat_per_sf"] * labor_mult, "finish",
                 notes=(
                     "Skim coat + primer on substrate exposed after tile demo"
                     + (f" | Area: {skim_note_area}" if skim_note_area else "")
                 ))

    # 2) Subfloor allowance when water damage is reported.
    #    Skip when demo_floor=True — Phase 3 auto-30% already covers it.
    sub_spec = estimate.substrate_spec or {}
    if (estimate.water_damage
            and not sub_spec.get("subfloor_repair")
            and not demo_floor  # Phase 3 auto-30% already covers
            and hc.get("subfloor_allowance") is True):
        allowance_sf = min(floor_sf, 20)  # conservative 20 SF allowance
        if allowance_sf > 0:
            _add(line_items, 3, "Subfloor repair allowance (plywood)",
                 allowance_sf, "SF",
                 SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate",
                 notes="Allowance for subfloor condition verification upon demo")

    # 3) Auto-include GFCI if not explicitly specified (code requirement)
    elec_spec = estimate.electrical_spec or {}
    if (gfci_count == 0 and hc.get("auto_gfci") is True
            and (estimate.replace_vanity or estimate.replace_toilet)):
        _add(line_items, 2, "GFCI outlet (code required)", 1, "EA",
             ELECTRICAL_RATES["gfci_outlet_each"] * labor_mult, "electrical",
             notes="NEC code requires GFCI within 6ft of water source")

    # 4) Auto-include exhaust fan if not specified (code requirement for windowless bath)
    if (not elec_spec.get("exhaust_fan_cfm") and hc.get("auto_exhaust_fan") is True
            and has_demo):
        _add(line_items, 2, "Exhaust fan inspection/replacement (80 CFM)",
             1, "EA",
             ELECTRICAL_RATES["exhaust_fan"][80] * labor_mult, "electrical",
             notes="IRC code requires ventilation; inspect existing, replace if needed")

    # 5) Vanity light auto-include is now handled by replace_vanity_light flag
    # in the electrical section above (no longer needs hidden_costs.auto_vanity_light)

    # 6) Permit fee — county-specific matrix logic
    plumb_spec = estimate.plumbing_spec or {}
    has_rough_change = (
        plumb_spec.get("drain_modification")
        or plumb_spec.get("pressure_balance_valve")
        or hc.get("fixture_relocation")
        or hc.get("new_plumbing_line")
        or hc.get("new_electrical_circuit")
        or hc.get("valve_body_replace")
    )
    est_state = estimate.state or ""
    permit_info = get_permit_info(est_state, has_rough_change)

    if hc.get("permit", False):
        if permit_info["required"]:
            _add(line_items, 7,
                 "Building permit (required)",
                 1, "EA", HIDDEN_COSTS["permit_fee"], "misc",
                 notes=permit_info["note"])
        elif permit_info["group"] in ("B", "C"):
            # Stricter jurisdictions: include as allowance
            _add(line_items, 7,
                 "Permit allowance (verify required)",
                 1, "EA", HIDDEN_COSTS["permit_fee"], "misc",
                 notes=permit_info["note"])
        else:
            # Group A like-for-like exempt: no cost, just note
            warnings.append(permit_info["note"])

    # 7) Auto-include ceiling paint for bathroom remodels
    #    Bathrooms almost always need ceiling paint (moisture prevention per code).
    #    Use moisture-resistant if water_damage or mold_suspected.
    walls_spec = estimate.walls_spec or {}
    paint_ceiling_explicit = walls_spec.get("paint_ceiling", False)
    if (not paint_ceiling_explicit and has_demo
            and floor_sf > 0 and hc.get("auto_ceiling_paint") is True):
        if estimate.water_damage or estimate.mold_suspected:
            ceil_rate = PAINT_RATES["ceiling_per_sf"] * 1.20  # moisture-resistant premium
            _add(line_items, 6,
                 "Ceiling painting (moisture-resistant)",
                 floor_sf, "SF", ceil_rate * labor_mult, "finish",
                 notes="Moisture-resistant paint per code for wet area")
        else:
            _add(line_items, 6,
                 "Ceiling painting (bathroom grade)",
                 floor_sf, "SF",
                 PAINT_RATES["ceiling_per_sf"] * labor_mult, "finish",
                 notes="Moisture-resistant ceiling paint")

    # 8) Moisture-resistant drywall for ceiling
    #    Skip if repair_drywall_ceiling is explicitly set (handled in repair section)
    if (estimate.water_damage and demo_ceiling
            and not getattr(estimate, 'repair_drywall_ceiling', False)
            and floor_sf > 0 and hc.get("mold_resistant_drywall") is True):
        _add(line_items, 3,
             "Moisture-resistant drywall - ceiling",
             floor_sf, "SF",
             SUBSTRATE_RATES["mold_resistant_drywall_per_sf"] * labor_mult,
             "substrate",
             notes="Moisture-resistant drywall per code for wet area")

    # ────────────────────────────────────────
    # Totals
    # ────────────────────────────────────────
    subtotal = sum(li["total"] for li in line_items)

    # O&P (optional per user request)
    include_op = getattr(estimate, "include_overhead_profit", False) or False
    overhead_pct = estimate.overhead_pct if estimate.overhead_pct is not None else 0.10
    profit_pct = estimate.profit_pct if estimate.profit_pct is not None else 0.10

    if include_op:
        overhead_amount = round(subtotal * overhead_pct, 2)
        profit_amount = round(subtotal * profit_pct, 2)
    else:
        overhead_amount = 0
        profit_amount = 0

    # Sales tax on material portion (~50% of subtotal is material)
    state = estimate.state or "MD"
    tax_rate = get_sales_tax_rate(state, zip_code)
    material_portion = subtotal * 0.50  # rough split
    tax_amount = round(material_portion * tax_rate, 2)

    total = round(subtotal + overhead_amount + profit_amount + tax_amount, 2)

    # ────────────────────────────────────────
    # Target total adjustment (reverse pricing)
    # ────────────────────────────────────────
    adjustment_factor = None
    target_total = getattr(estimate, "target_total", None)
    if target_total and target_total > 0 and subtotal > 0 and total > 0:
        adjustment_factor = target_total / total

        for item in line_items:
            item["unit_price"] = round(
                item["unit_price"] * adjustment_factor, 2,
            )
            item["total"] = round(item["quantity"] * item["unit_price"], 2)
            if item.get("notes"):
                item["notes"] = _scale_dollar_amounts(
                    item["notes"], adjustment_factor
                )

        # Recalculate totals with adjusted line items
        subtotal = sum(item["total"] for item in line_items)
        if include_op:
            overhead_amount = round(subtotal * overhead_pct, 2)
            profit_amount = round(subtotal * profit_pct, 2)
        material_portion = subtotal * 0.50
        tax_amount = round(material_portion * tax_rate, 2)
        total = round(subtotal + overhead_amount + profit_amount + tax_amount, 2)

        # Fix rounding drift: adjust largest line item to hit target exactly
        rounding_diff = round(target_total - total, 2)
        if rounding_diff != 0 and line_items:
            largest = max(line_items, key=lambda x: x["total"])
            _old_largest_total = largest["total"]
            largest["total"] = round(largest["total"] + rounding_diff, 2)
            if largest["quantity"]:
                largest["unit_price"] = round(
                    largest["total"] / largest["quantity"], 2
                )
            # Scale notes by the secondary correction factor
            if largest.get("notes") and _old_largest_total > 0:
                _sec_factor = largest["total"] / _old_largest_total
                largest["notes"] = _scale_dollar_amounts(
                    largest["notes"], _sec_factor
                )
            subtotal = sum(item["total"] for item in line_items)
            if include_op:
                overhead_amount = round(subtotal * overhead_pct, 2)
                profit_amount = round(subtotal * profit_pct, 2)
            material_portion = subtotal * 0.50
            tax_amount = round(material_portion * tax_rate, 2)
            total = round(subtotal + overhead_amount + profit_amount + tax_amount, 2)

    # Methodology notes
    method_parts = [
        f"DMV region pricing ({state}), labor multiplier: {labor_mult:.2f}",
        f"Sales tax: {tax_rate*100:.1f}% on estimated material portion",
    ]
    if include_op:
        method_parts.append(f"O&P: {overhead_pct*100:.0f}% overhead + {profit_pct*100:.0f}% profit")
    else:
        method_parts.append("O&P: Not included (contractor direct pricing)")
    if adjustment_factor:
        method_parts.append(f"Target total: ${target_total:,.2f} (adjusted)")
        # Factor stored in DB for internal reference, not exposed on PDF

    # Renumber phases to eliminate gaps (e.g. if phase 2 is empty, 3→2, 4→3, ...)
    used_phases = sorted(set(item["phase"] for item in line_items))
    phase_map = {old: new for new, old in enumerate(used_phases, start=1)}
    for item in line_items:
        item["phase"] = phase_map[item["phase"]]

    return {
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "overhead_amount": overhead_amount,
        "profit_amount": profit_amount,
        "tax_amount": tax_amount,
        "total": total,
        "adjustment_factor": round(adjustment_factor, 6) if adjustment_factor else None,
        "methodology_notes": " | ".join(method_parts),
        "warning_flags": warnings,
    }


def _add(
    items: List[Dict],
    phase: int,
    description: str,
    quantity: float,
    unit: str,
    unit_price: float,
    category: str,
    notes: Optional[str] = None,
):
    """Add a line item to the list."""
    total = round(quantity * unit_price, 2)
    items.append({
        "phase": phase,
        "description": description,
        "quantity": round(quantity, 2),
        "unit": unit,
        "unit_price": round(unit_price, 2),
        "total": total,
        "category": category,
        "notes": notes,
    })
