"""
A shower with a prefab base: a fiberglass or acrylic pan for its floor, its
walls tiled (or a surround) all the same. The sketch's shower floor type
(shower_spec.floor_type: tile, fiberglass_pan, acrylic_pan) says which.

A pan floor takes the place of everything a tiled floor needs: no floor tile,
no mortar pre-slope and liner, no tiled curb (the base has its own threshold),
and no cement board or waterproofing on the floor. The base is one line of its
own, from Xactimate's PLM SWRB (a 36" x 36" fiberglass or acrylic base, its
drain and install): a bigger base's material by its area over that one's 9 SF
(never less), its install the same (pricing.SHOWER_BASE). A curbless shower's
floor is always tiled.
"""

from typing import Any, Dict, Optional

from .pricing import SHOWER_BASE, is_curbless

SHOWER_FLOOR_PANS: Dict[str, str] = {"fiberglass_pan": "fiberglass", "acrylic_pan": "acrylic"}

# Xactimate's PLM SWRB is a 36" x 36" base
REFERENCE_BASE_SF = 9.0


def floor_pan(shower_spec: Optional[Dict[str, Any]]) -> Optional[str]:
    """'fiberglass' or 'acrylic' when the shower's floor is a prefab base, else None"""
    spec = shower_spec or {}
    pan = SHOWER_FLOOR_PANS.get(spec.get("floor_type") or "")
    if not pan or is_curbless(spec.get("type") or ""):
        return None
    return pan


def base_area_sf(shower_spec: Dict[str, Any]) -> float:
    """The base's footprint, SF: the shower's (less the corner of a neo-angle one)"""
    w = float(shower_spec.get("width_in") or 36)
    d = float(shower_spec.get("depth_in") or 36)
    area = w * d
    if (shower_spec.get("layout") or "alcove") in ("neo_angle", "neo_angle_right"):
        area -= 0.5 * (w * 0.5) * (d * 0.5)
    return area / 144


def base_line(shower_spec: Dict[str, Any], labor_mult: float) -> Dict[str, Any]:
    """The base's line: its name, price each and note"""
    pan = floor_pan(shower_spec) or "acrylic"
    sf = base_area_sf(shower_spec)
    factor = max(1.0, sf / REFERENCE_BASE_SF)
    material = round(SHOWER_BASE["material"] * factor, 2)
    install = round(SHOWER_BASE["install"] * labor_mult, 2)
    w = shower_spec.get("width_in") or 36
    d = shower_spec.get("depth_in") or 36
    size_note = (f"{sf:.1f} SF: x {factor:.2f} a 36″ × 36″ base" if factor > 1
                 else "Up to 36″ × 36″: one base")
    return {
        "description": f"Shower base - {pan} pan ({w:g}″ × {d:g}″), supply + install",
        "unit_price": round(material + install, 2),
        "notes": (f"Base + drain: ${material:,.2f} ({size_note}) | Set, level and connect the drain: ${install:,.2f}"
                  " | In place of floor tile, pre-slope, liner and tiled curb"),
    }
