"""
Bathroom Remodel Estimate calculator.
7-Phase calculation engine matching DMV contractor standards.
"""

import logging
from typing import Any, Dict, List, Optional

from .pricing import (
    ACCESSORY_FINISH_MULTIPLIER,
    ACCESSORY_GRADE_MULTIPLIER,
    ACCESSORY_PRICES,
    BASEBOARD_PRICES,
    BATHTUB_EXTRAS,
    TILE_BASEBOARD_PRICES,
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
    SHOWER_CUSTOM_EXTRAS,
    SHOWER_DOOR_INSTALL,
    SHOWER_DOOR_PRICES,
    SHOWER_ENCLOSURE_PRICES,
    SHOWER_INSERT_PRICES,
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
    get_labor_multiplier,
    get_sales_tax_rate,
)

logger = logging.getLogger(__name__)


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

    # Auto-compute floor/wall SF if dimensions provided
    if not floor_sf and estimate.length_ft and estimate.width_ft:
        floor_sf = estimate.length_ft * estimate.width_ft

    height = estimate.height_ft or 8.0
    if not wall_sf and estimate.length_ft and estimate.width_ft:
        perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        wall_sf = perimeter * height
        # Subtract ~20 SF for door opening
        wall_sf = max(wall_sf - 20, 0)

    # Demo-specific SF (override or fallback to bathroom SF)
    demo_floor_sf = getattr(estimate, 'demo_floor_sf', None) or floor_sf
    demo_wall_sf = getattr(estimate, 'demo_wall_sf', None) or wall_sf
    demo_ceiling_sf = getattr(estimate, 'demo_ceiling_sf', None) or floor_sf

    # Lead RRP check
    year_built = estimate.year_built or 2000
    needs_lead_rrp = year_built < 1978

    # ────────────────────────────────────────
    # Phase 1: Demo & Disposal
    # ────────────────────────────────────────
    if estimate.demo_floor and demo_floor_sf > 0:
        rate = DEMO_RATES["floor_tile_per_sf"] * labor_mult
        _add(line_items, 1, "Demo - Floor tile removal",
             demo_floor_sf, "SF", rate, "demo")

    if estimate.demo_walls and demo_wall_sf > 0:
        rate = DEMO_RATES["wall_tile_per_sf"] * labor_mult
        _add(line_items, 1, "Demo - Wall tile/surround removal",
             demo_wall_sf, "SF", rate, "demo")

    if estimate.demo_ceiling and demo_ceiling_sf > 0:
        rate = DEMO_RATES["ceiling_per_sf"] * labor_mult
        _add(line_items, 1, "Demo - Ceiling removal",
             demo_ceiling_sf, "SF", rate, "demo")

    if estimate.replace_tub:
        tub_mat = estimate.existing_tub_material or "acrylic"
        if tub_mat == "cast_iron":
            _add(line_items, 1, "Demo - Cast iron bathtub removal", 1, "EA",
                 DEMO_RATES["bathtub_cast_iron"] * labor_mult, "demo")
        else:
            _add(line_items, 1, "Demo - Bathtub removal", 1, "EA",
                 DEMO_RATES["bathtub_standard"] * labor_mult, "demo")

    if estimate.replace_shower:
        shower_spec = estimate.shower_spec or {}
        stype = shower_spec.get("type", "one_piece")
        if stype == "custom_tile":
            _add(line_items, 1, "Demo - Custom tile shower tear-out", 1, "EA",
                 DEMO_RATES["shower_custom_tile"] * labor_mult, "demo")
        else:
            _add(line_items, 1, "Demo - Shower surround removal", 1, "EA",
                 DEMO_RATES["shower_surround"] * labor_mult, "demo")

    if estimate.replace_vanity:
        _add(line_items, 1, "Demo - Vanity & top removal", 1, "EA",
             DEMO_RATES["vanity"] * labor_mult, "demo")

    if estimate.replace_toilet:
        _add(line_items, 1, "Demo - Toilet removal", 1, "EA",
             DEMO_RATES["toilet"] * labor_mult, "demo")

    # Cement board demo (water damage in tub/shower area)
    if getattr(estimate, 'demo_cement_board', False):
        cb_demo_sf = getattr(estimate, 'demo_cement_board_sf', 0) or 0
        if cb_demo_sf > 0:
            _add(line_items, 1, "Demo - Cement board removal (water damaged)",
                 cb_demo_sf, "SF", DEMO_RATES["durock_per_sf"] * labor_mult, "demo")

    # Dumpster
    hc = estimate.hidden_costs or {}
    if hc.get("dumpster", True):
        dumpster_size = "dumpster_10yard"
        if floor_sf > 60:
            dumpster_size = "dumpster_15yard"
        if floor_sf > 100:
            dumpster_size = "dumpster_20yard"
        _add(line_items, 1, f"Dumpster rental ({dumpster_size.replace('dumpster_', '')})",
             1, "EA", DEMO_RATES[dumpster_size] + DEMO_RATES["dump_tip_fee"], "demo")

    # ────────────────────────────────────────
    # Phase 2: Plumbing Rough
    # ────────────────────────────────────────
    plumb = estimate.plumbing_spec or {}

    valve_count = plumb.get("valve_replace_count", 0)
    if valve_count > 0:
        _add(line_items, 2, "Shut-off valve replacement", valve_count, "EA",
             PLUMBING_RATES["shutoff_valve_each"] * labor_mult, "plumbing")

    supply_count = plumb.get("supply_line_count", 0)
    if supply_count > 0:
        _add(line_items, 2, "Supply line replacement (braided SS)", supply_count, "EA",
             PLUMBING_RATES["supply_line_each"] * labor_mult, "plumbing")

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
    if estimate.replace_shower and shower_spec.get("type") == "custom_tile":
        s_tile = shower_spec.get("tile_spec", {})
        s_sf = s_tile.get("sf", 0)
        if not s_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get("tile_height_in", 0) or 0
            if sw and sd and sh:
                s_sf = (sw + 2 * sd) * sh / 144
        auto_wet_sf += s_sf or 0

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

    # Floor cement board (1/4") if replacing tile floor
    if estimate.replace_floor and floor_sf > 0:
        floor_spec_sub = estimate.floor_spec or {}
        floor_mat = floor_spec_sub.get("material", "porcelain")
        if floor_mat in ("porcelain", "ceramic", "natural_stone", "mosaic"):
            _add(line_items, 3, "Cement board (1/4\") - floor underlayment", floor_sf, "SF",
                 SUBSTRATE_RATES["durock_floor_per_sf"] * labor_mult, "substrate")

    greenboard_sf = sub.get("greenboard_sf", 0)
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

    if sub.get("subfloor_repair") and sub.get("subfloor_repair_sf", 0) > 0:
        _add(line_items, 3, "Subfloor repair/replacement", sub["subfloor_repair_sf"], "SF",
             SUBSTRATE_RATES["subfloor_repair_per_sf"] * labor_mult, "substrate")

    # Cement board replacement (water damage repair)
    if getattr(estimate, 'replace_cement_board', False):
        cb_sf = getattr(estimate, 'replace_cement_board_sf', 0) or 0
        if cb_sf > 0:
            _add(line_items, 3, "Cement board replacement (water damage repair)",
                 cb_sf, "SF", SUBSTRATE_RATES["durock_per_sf"] * labor_mult, "substrate")

    # ────────────────────────────────────────
    # Phase 4: Tile & Flooring
    # ────────────────────────────────────────
    floor_spec = estimate.floor_spec or {}
    if estimate.replace_floor and floor_sf > 0:
        tile_mat = floor_spec.get("material", "porcelain")
        pattern = floor_spec.get("pattern", "straight")
        tile_size = floor_spec.get("size", "12x24")
        mat_rate = TILE_MATERIAL_RATES.get(tile_mat, 7.50)
        labor_rate = TILE_LABOR_RATES["floor_per_sf"] * labor_mult
        pat_mult = TILE_PATTERN_MULTIPLIER.get(pattern, 1.0)
        size_mult = TILE_SIZE_MULTIPLIER.get(tile_size, 1.0)
        waste = TILE_EXTRAS["waste_factor"]

        # Material (with waste)
        _add(line_items, 4, f"Floor tile - {tile_mat} ({tile_size})",
             floor_sf * (1 + waste), "SF", mat_rate, "tile",
             notes=f"Includes {int(waste*100)}% waste")

        # Labor
        _add(line_items, 4, f"Floor tile installation - {pattern} lay",
             floor_sf, "SF", labor_rate * pat_mult * size_mult, "tile")

        # Grout + thinset
        _add(line_items, 4, "Thinset, grout & supplies",
             floor_sf, "SF", TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"], "tile")

        if tile_mat == "natural_stone":
            _add(line_items, 4, "Stone sealer application", floor_sf, "SF",
                 TILE_EXTRAS["sealer_per_sf"], "tile")

    # Shower wall tile (custom tile shower)
    shower_spec = estimate.shower_spec or {}
    if estimate.replace_shower and shower_spec.get("type") == "custom_tile":
        tile_spec = shower_spec.get("tile_spec", {})
        shower_wall_sf = tile_spec.get("sf", 0)
        # Auto-compute from dimensions if SF not provided
        if not shower_wall_sf:
            sw = shower_spec.get("width_in", 0) or 0
            sd = shower_spec.get("depth_in", 0) or 0
            sh = shower_spec.get("tile_height_in", 0) or 0
            if sw and sd and sh:
                shower_wall_sf = (sw + 2 * sd) * sh / 144  # 3-wall surround
        if shower_wall_sf > 0:
            stile_mat = tile_spec.get("material", "porcelain")
            spattern = tile_spec.get("pattern", "straight")
            stile_size = tile_spec.get("size", "12x24")
            smat_rate = TILE_MATERIAL_RATES.get(stile_mat, 7.50)
            slabor_rate = TILE_LABOR_RATES["shower_wall_per_sf"] * labor_mult
            spat_mult = TILE_PATTERN_MULTIPLIER.get(spattern, 1.0)
            ssize_mult = TILE_SIZE_MULTIPLIER.get(stile_size, 1.0)

            _add(line_items, 4, f"Shower wall tile - {stile_mat} ({stile_size})",
                 shower_wall_sf * (1 + TILE_EXTRAS["waste_factor"]), "SF", smat_rate, "tile")
            _add(line_items, 4, f"Shower tile installation - {spattern}",
                 shower_wall_sf, "SF", slabor_rate * spat_mult * ssize_mult, "tile")
            _add(line_items, 4, "Shower tile supplies (thinset, grout)",
                 shower_wall_sf, "SF",
                 TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"], "tile")

    # Bathtub surround tile (drop-in tub)
    tub_spec = estimate.bathtub_spec or {}
    if tub_spec.get("surround_tile") and tub_spec.get("type") == "drop_in":
        surround_sf = tub_spec.get("surround_tile_sf", 0)
        # Auto-compute from dimensions if SF not provided
        if not surround_sf:
            tl = tub_spec.get("tub_length_in", 0) or 0
            sh = tub_spec.get("surround_height_in", 0) or 0
            td = tub_spec.get("tub_depth_in", 30) or 30
            if tl and sh:
                surround_sf = (tl + 2 * td) * sh / 144
        if surround_sf > 0:
            sur_mat = tub_spec.get("surround_tile_material", "porcelain")
            sur_pattern = tub_spec.get("surround_tile_pattern", "straight")
            sur_size = tub_spec.get("surround_tile_size", "12x24")
            sur_mat_rate = TILE_MATERIAL_RATES.get(sur_mat, 7.50)
            sur_labor_rate = BATHTUB_EXTRAS["surround_tile_labor_per_sf"] * labor_mult
            sur_pat_mult = TILE_PATTERN_MULTIPLIER.get(sur_pattern, 1.0)
            sur_size_mult = TILE_SIZE_MULTIPLIER.get(sur_size, 1.0)

            _add(line_items, 4, f"Bathtub surround tile - {sur_mat} ({sur_size})",
                 surround_sf * (1 + TILE_EXTRAS["waste_factor"]), "SF", sur_mat_rate, "tile",
                 notes=f"Includes {int(TILE_EXTRAS['waste_factor']*100)}% waste")
            _add(line_items, 4, f"Bathtub surround tile installation - {sur_pattern}",
                 surround_sf, "SF", sur_labor_rate * sur_pat_mult * sur_size_mult, "tile")
            _add(line_items, 4, "Bathtub surround tile supplies (thinset, grout)",
                 surround_sf, "SF",
                 TILE_EXTRAS["grout_per_sf"] + TILE_EXTRAS["thinset_per_sf"], "tile")

    if floor_spec.get("heated_floor") and floor_sf > 0:
        _add(line_items, 4, "Heated floor mat + installation", floor_sf, "SF",
             ELECTRICAL_RATES["heated_floor_per_sf"] * labor_mult, "electrical")
        _add(line_items, 4, "Heated floor thermostat", 1, "EA",
             ELECTRICAL_RATES["heated_floor_thermostat"], "electrical")
        _add(line_items, 4, "Dedicated 20A circuit for heated floor", 1, "EA",
             ELECTRICAL_RATES["heated_floor_circuit"] * labor_mult, "electrical")

    # ────────────────────────────────────────
    # Phase 5: Fixtures Install
    # ────────────────────────────────────────

    # Bathtub
    tub_spec = estimate.bathtub_spec or {}
    if estimate.replace_tub and tub_spec.get("type") and tub_spec["type"] != "none":
        tub_type = tub_spec["type"]
        tub_mat = tub_spec.get("material", "acrylic")
        tub_prices = BATHTUB_PRICES.get(tub_type, {})
        tub_price = tub_prices.get(tub_mat, 450)
        _add(line_items, 5, f"Bathtub - {tub_type} ({tub_mat})", 1, "EA", tub_price, "fixture")

        install_price = BATHTUB_INSTALL.get(tub_type, 425) * labor_mult
        _add(line_items, 5, f"Bathtub installation - {tub_type}", 1, "EA", install_price, "fixture")

        if tub_spec.get("jetted"):
            _add(line_items, 5, "Whirlpool/jet system upgrade", 1, "EA",
                 BATHTUB_EXTRAS["whirlpool_upgrade"], "fixture")

    # Shower
    if estimate.replace_shower:
        stype = shower_spec.get("type", "one_piece")
        if stype in ("one_piece", "multi_piece_kit"):
            insert_price = SHOWER_INSERT_PRICES.get(stype, 650)
            _add(line_items, 5, f"Shower unit - {stype.replace('_', ' ')}", 1, "EA",
                 insert_price, "fixture")
            _add(line_items, 5, "Shower unit installation", 1, "EA",
                 425 * labor_mult, "fixture")

        # Shower door
        door_type = shower_spec.get("door_type")
        door_width = shower_spec.get("door_width_in", 0) or 0
        if door_type and door_type in SHOWER_DOOR_PRICES:
            prices = SHOWER_DOOR_PRICES[door_type]
            if "any" in prices:
                mat_price = prices["any"]
            else:
                # Find closest width
                widths = sorted(prices.keys())
                w = min(widths, key=lambda x: abs(x - door_width)) if door_width else widths[len(widths) // 2]
                mat_price = prices[w]
            install = SHOWER_DOOR_INSTALL.get(door_type, 250)
            label = door_type.replace("_", " ").title()
            if door_type == "curtain":
                _add(line_items, 5, "Shower curtain rod + curtain",
                     1, "EA", mat_price, "fixture")
            else:
                width_note = f"{door_width}\" opening" if door_width else None
                _add(line_items, 5, f"Shower door - {label}",
                     1, "EA", mat_price, "fixture", notes=width_note)
                _add(line_items, 5, f"Shower door installation - {label}",
                     1, "EA", install * labor_mult, "fixture")
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

        # Custom tile extras
        if stype in ("custom_tile", "curbless"):
            niches = shower_spec.get("niches", 0)
            if niches > 0:
                _add(line_items, 5, "Shower niche (recessed)", niches, "EA",
                     SHOWER_CUSTOM_EXTRAS["niche_each"] * labor_mult, "fixture")
            if shower_spec.get("bench"):
                _add(line_items, 5, "Tiled shower bench", 1, "EA",
                     SHOWER_CUSTOM_EXTRAS["bench"] * labor_mult, "fixture")
            if stype == "curbless":
                _add(line_items, 5, "Curbless/linear drain system", 1, "EA",
                     SHOWER_CUSTOM_EXTRAS["curbless_drain"] * labor_mult, "fixture")
            else:
                _add(line_items, 5, "Shower curb build", 1, "EA",
                     SHOWER_CUSTOM_EXTRAS["curb"] * labor_mult, "fixture")

        # Showerhead
        sh_type = shower_spec.get("showerhead_type", "standard")
        sh_price = SHOWERHEAD_PRICES.get(sh_type, 65)
        grade_mult = TRIM_GRADE_MULTIPLIER.get(shower_spec.get("trim_grade", "mid"), 1.0)
        _add(line_items, 5, f"Showerhead - {sh_type}", 1, "EA",
             sh_price * grade_mult, "fixture")

        # Valve
        if shower_spec.get("valve_replace"):
            valve_type = "thermostatic" if shower_spec.get("trim_grade") == "premium" else "pressure_balance"
            _add(line_items, 5, f"Shower valve - {valve_type.replace('_', ' ')}", 1, "EA",
                 SHOWER_VALVE_PRICES.get(valve_type, 275) * labor_mult, "fixture")

        # Trim install
        _add(line_items, 5, "Shower trim kit installation", 1, "EA",
             PLUMBING_RATES["shower_valve_trim"] * labor_mult, "plumbing")

    # Vanity
    van = estimate.vanity_spec or {}
    if estimate.replace_vanity and van:
        v_width = van.get("width", 36)
        v_source = van.get("source", "stock_rta")
        v_prices = VANITY_PRICES.get(v_source, VANITY_PRICES["stock_rta"])
        v_price = v_prices.get(v_width, v_prices.get(36, 500))
        _add(line_items, 5, f"Vanity cabinet - {v_source.replace('_', ' ')} ({v_width}\")",
             1, "EA", v_price, "fixture")

        # Vanity top
        v_top = van.get("top_material", "quartz")
        top_rate = VANITY_TOP_PRICES.get(v_top, 18)
        _add(line_items, 5, f"Vanity countertop - {v_top.replace('_', ' ')}",
             v_width, "IN", top_rate, "fixture",
             notes=f"{v_width}\" width")

        # Install
        _add(line_items, 5, "Vanity installation", 1, "EA",
             VANITY_INSTALL * labor_mult, "fixture")

        # Wall mount blocking
        if van.get("mounting") == "wall_mount":
            _add(line_items, 5, "Wall-mount vanity blocking", 1, "EA",
                 VANITY_EXTRAS["wall_mount_blocking"] * labor_mult, "fixture")

        # Faucet
        faucet = van.get("faucet_type", "single_hole")
        faucet_key = f"faucet_{faucet}"
        faucet_price = VANITY_EXTRAS.get(faucet_key, 195)
        _add(line_items, 5, f"Vanity faucet - {faucet.replace('_', ' ')}",
             van.get("sinks", 1), "EA", faucet_price, "fixture")

        # Mirror
        mirror = van.get("mirror_type", "framed")
        mirror_price = MIRROR_PRICES.get(mirror, 175)
        _add(line_items, 5, f"Mirror/cabinet - {mirror.replace('_', ' ')}", 1, "EA",
             mirror_price + MIRROR_INSTALL * labor_mult, "fixture")

    # Toilet
    tlt = estimate.toilet_spec or {}
    if estimate.replace_toilet and tlt:
        t_type = tlt.get("type", "two_piece_standard")
        t_price = TOILET_PRICES.get(t_type, 225)
        _add(line_items, 5, f"Toilet - {t_type.replace('_', ' ')}", 1, "EA", t_price, "fixture")
        _add(line_items, 5, "Toilet installation (set + connect)", 1, "EA",
             PLUMBING_RATES["toilet_set"] * labor_mult, "plumbing")
        _add(line_items, 5, "Wax ring + supply line", 1, "EA",
             TOILET_EXTRAS["wax_ring"] + PLUMBING_RATES["supply_line_each"], "plumbing")

        if tlt.get("flange_repair"):
            _add(line_items, 5, "Closet flange repair", 1, "EA",
                 TOILET_EXTRAS["flange_repair"] * labor_mult, "plumbing")

        if tlt.get("bidet_seat"):
            _add(line_items, 5, "Bidet seat installation", 1, "EA",
                 TOILET_PRICES["bidet_seat"], "fixture")
            # Needs GFCI
            warnings.append("Bidet seat requires GFCI outlet nearby")

    # ────────────────────────────────────────
    # Detach & Reset (labor only, no material)
    # ────────────────────────────────────────
    if getattr(estimate, 'detach_reset_tub', False):
        tub_mat = estimate.existing_tub_material or "acrylic"
        dr_key = "bathtub_cast_iron" if tub_mat == "cast_iron" else "bathtub_standard"
        _add(line_items, 5, f"Detach & Reset - Bathtub ({tub_mat})",
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
        _add(line_items, 5, "Detach & Reset - Vanity & sink",
             1, "EA", DETACH_RESET_COSTS["vanity"] * labor_mult, "fixture",
             notes="Labor only: disconnect plumbing, remove, store, reinstall")

    if getattr(estimate, 'detach_reset_toilet', False):
        _add(line_items, 5, "Detach & Reset - Toilet",
             1, "EA", DETACH_RESET_COSTS["toilet"] * labor_mult, "fixture",
             notes="Labor only: remove, store, reinstall w/ new wax ring")

    # ────────────────────────────────────────
    # Phase 3 (Electrical - grouped with trades)
    # ────────────────────────────────────────
    elec = estimate.electrical_spec or {}

    gfci_count = elec.get("gfci_count", 0)
    if gfci_count > 0:
        _add(line_items, 2, "GFCI outlet installation", gfci_count, "EA",
             ELECTRICAL_RATES["gfci_outlet_each"] * labor_mult, "electrical")

    if elec.get("vanity_lights", 0) > 0:
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
    paint_grade = walls.get("paint_grade", "mid")
    pg_mult = PAINT_GRADE_MULTIPLIER.get(paint_grade, 1.0)

    if wall_sf > 0:
        _add(line_items, 6, f"Wall painting ({paint_grade} grade)", wall_sf, "SF",
             PAINT_RATES["wall_per_sf"] * pg_mult * labor_mult, "finish")

    if floor_sf > 0:
        _add(line_items, 6, f"Ceiling painting ({paint_grade} grade)", floor_sf, "SF",
             PAINT_RATES["ceiling_per_sf"] * pg_mult * labor_mult, "finish")

    # Baseboard
    bb_mat = walls.get("baseboard_material")
    if bb_mat and estimate.length_ft and estimate.width_ft:
        perimeter = 2 * (estimate.length_ft + estimate.width_ft)
        # Subtract door opening ~3 LF
        bb_lf = max(perimeter - 3, 0)

        if bb_mat == "tile":
            # Tile baseboard - price varies by tile material (match floor tile)
            floor_tile_mat = (estimate.floor_spec or {}).get("material", "porcelain")
            tb_rate = TILE_BASEBOARD_PRICES.get(floor_tile_mat, 12.00)
            tile_label = floor_tile_mat.replace("_", " ").title()
            _add(line_items, 6, f"Tile baseboard - {tile_label} (supply + install)", bb_lf, "LF",
                 tb_rate * labor_mult, "finish",
                 notes="Matching floor tile material")
            # Tile baseboard needs grout/thinset
            _add(line_items, 6, "Tile baseboard supplies (thinset, grout)", bb_lf, "LF",
                 1.50 * labor_mult, "finish")
            # No painting needed for tile baseboard
        else:
            bb_rate = BASEBOARD_PRICES.get(bb_mat, 6.50)
            _add(line_items, 6, f"Baseboard - {bb_mat.upper()} (supply + install)", bb_lf, "LF",
                 bb_rate * labor_mult, "finish")
            _add(line_items, 6, "Baseboard painting", bb_lf, "LF",
                 PAINT_RATES["trim_per_lf"] * pg_mult * labor_mult, "finish")

    # ────────────────────────────────────────
    # Phase 7: Accessories + Punch/Cleanup
    # ────────────────────────────────────────
    acc = estimate.accessories_spec or {}
    acc_finish = acc.get("finish", "chrome")
    acc_grade = acc.get("grade", "mid")
    af_mult = ACCESSORY_FINISH_MULTIPLIER.get(acc_finish, 1.0)
    ag_mult = ACCESSORY_GRADE_MULTIPLIER.get(acc_grade, 1.0)

    acc_items = [
        ("towel_bars", "Towel bar"),
        ("hand_towel_rings", "Hand towel ring"),
        ("tp_holders", "Toilet paper holder"),
        ("robe_hooks", "Robe hook"),
        ("corner_shelves", "Corner shelf"),
        ("grab_bars", "Grab bar (w/ blocking)"),
        ("toilet_brush_holders", "Toilet brush holder"),
        ("soap_dispensers", "Soap dispenser"),
    ]
    for key, label in acc_items:
        qty = acc.get(key, 0)
        if qty > 0:
            base_price = ACCESSORY_PRICES.get(key.rstrip("s").rstrip("e") if key.endswith("es") else key.rstrip("s"), 50)
            # More reliable lookup
            price_key = key
            if price_key.endswith("s"):
                price_key = price_key[:-1]
            base_price = ACCESSORY_PRICES.get(price_key, 50)
            _add(line_items, 7, f"{label} ({acc_finish.replace('_', ' ')})", qty, "EA",
                 base_price * af_mult * ag_mult * labor_mult, "finish")

    if acc.get("grab_bars", 0) > 0:
        warnings.append("Grab bars require wood blocking in wall framing")

    # Hidden costs
    if hc.get("floor_protection", False):
        _add(line_items, 7, "Floor/surface protection", 1, "LS",
             HIDDEN_COSTS["floor_protection"], "misc")

    if hc.get("mobilization", False):
        _add(line_items, 7, "Mobilization / setup", 1, "LS",
             HIDDEN_COSTS["mobilization"], "misc")

    if hc.get("caulk", True):
        _add(line_items, 7, "Caulking - silicone & latex (all joints)", 1, "LS",
             HIDDEN_COSTS["caulk_day"] * labor_mult, "finish")

    if hc.get("final_clean", True):
        _add(line_items, 7, "Final cleaning (move-in ready)", 1, "LS",
             HIDDEN_COSTS["final_clean"], "misc")

    if hc.get("punch_list", True):
        _add(line_items, 7, "Punch list / follow-up visits", 1, "LS",
             HIDDEN_COSTS["punch_list"] * labor_mult, "misc")

    drywall_patch_sf = hc.get("drywall_patch_sf", 0)
    if hc.get("drywall_patch") and drywall_patch_sf > 0:
        _add(line_items, 7, "Drywall patching (around tile edges)", drywall_patch_sf, "SF",
             HIDDEN_COSTS["drywall_patch_per_sf"] * labor_mult, "finish")

    trim_paint_lf = hc.get("trim_paint_lf", 0)
    if hc.get("trim_paint") and trim_paint_lf > 0:
        _add(line_items, 7, "Trim paint (post-install touch-up)", trim_paint_lf, "LF",
             HIDDEN_COSTS["trim_paint_per_lf"] * labor_mult, "finish")

    if needs_lead_rrp:
        _add(line_items, 7, "Lead paint RRP compliance (pre-1978)", 1, "LS",
             HIDDEN_COSTS["lead_rrp"], "misc")
        warnings.append("Property built before 1978 - EPA RRP rule applies. Certified renovator required.")

    if estimate.existing_tub_material == "cast_iron" and estimate.replace_tub:
        _add(line_items, 7, "Cast iron tub disposal surcharge", 1, "EA",
             HIDDEN_COSTS["cast_iron_disposal"], "demo")

    # Mold warning
    if estimate.mold_suspected:
        warnings.append("Mold suspected - separate mold remediation estimate required before work begins.")

    if estimate.water_damage:
        warnings.append("Water damage reported - scope may expand once demo reveals full extent.")

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

    # Methodology notes
    method_parts = [
        f"DMV region pricing ({state}), labor multiplier: {labor_mult:.2f}",
        f"Sales tax: {tax_rate*100:.1f}% on estimated material portion",
    ]
    if include_op:
        method_parts.append(f"O&P: {overhead_pct*100:.0f}% overhead + {profit_pct*100:.0f}% profit")
    else:
        method_parts.append("O&P: Not included (contractor direct pricing)")

    return {
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "overhead_amount": overhead_amount,
        "profit_amount": profit_amount,
        "tax_amount": tax_amount,
        "total": total,
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
