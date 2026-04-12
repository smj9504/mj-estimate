"""
Water Mitigation Sketch PDF Report Service.

Generates a PDF report from floor sketch data, including:
- Jobsite information (homeowner, insurance, dates)
- SVG rendering of each floor plan overlay
- Material summary tables per floor
"""

import base64
import html as html_lib
import io
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session

from app.domains.water_mitigation.models import WaterMitigationJob
from app.domains.water_mitigation.sketch_models import (
    WMContainmentZone,
    WMContentProtection,
    WMDemolitionZone,
    WMEquipmentPlacement,
    WMFloorProtection,
    WMFloorSketch,
)
from app.domains.water_mitigation.sketch_service import SketchService

logger = logging.getLogger(__name__)

# Matches frontend EQUIPMENT_CONFIG in wmSketch.ts
EQUIPMENT_CONFIG: Dict[str, Dict[str, str]] = {
    "air_mover":    {"display": "Air Mover",     "color": "#2196F3", "shape": "circle"},
    "air_scrubber": {"display": "Air Scrubber",  "color": "#4CAF50", "shape": "triangle"},
    "dehumidifier": {"display": "Dehumidifier",  "color": "#FF9800", "shape": "cylinder"},
}


def _containment_type_display(containment_type: Optional[str]) -> str:
    """Legacy default 'Standard' should read as Containment in PDF labels."""
    t = (containment_type or "").strip()
    if not t or t == "Standard":
        return "Containment"
    return t

# Linear LF demolition types (matches DEFAULT_DEMO_MATERIAL_TYPES in wmSketch.ts)
_LF_DEMOLITION_MATERIALS = frozenset(
    {"baseboard", "baseboard_quarter_round", "toe_kick"}
)

# Wall SF types drawn as lines when height is implicit (dimension2_ft == 0)
_WALL_LINE_SF_MATERIALS = frozenset(
    {"wall_drywall", "wall_drywall_2ft", "wall_drywall_4ft", "insulation"}
)

# Display names for PDF legend / summary (aligned with frontend defaults)
_DEMO_MATERIAL_LABELS: Dict[str, str] = {
    "wood_floor": "Wood Floor",
    "carpet": "Carpet",
    "tile": "Tile",
    "ceiling": "Ceiling",
    "wall_drywall": "Wall/Drywall",
    "wall_drywall_2ft": "Wall - Drywall 2ft",
    "wall_drywall_4ft": "Wall - Drywall 4ft",
    "insulation": "Insulation",
    "baseboard": "Baseboard",
    "baseboard_quarter_round": "Baseboard+Quarter Round",
    "toe_kick": "Toe Kick",
}

_DEMO_MATERIAL_UNITS: Dict[str, str] = {
    "baseboard": "LF",
    "baseboard_quarter_round": "LF",
    "toe_kick": "LF",
}


class SketchPdfService:
    """Generates PDF sketch reports for water mitigation jobs."""

    def __init__(self, db: Session):
        self.db = db

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────

    def generate_sketch_report(self, job_id: UUID) -> bytes:
        """
        Generate a PDF report for all floor sketches belonging to a WM job.

        Returns raw PDF bytes suitable for streaming to the client.
        """
        # Load the job
        job: Optional[WaterMitigationJob] = (
            self.db.query(WaterMitigationJob)
            .filter(WaterMitigationJob.id == job_id)
            .first()
        )
        if not job:
            raise ValueError(f"Water mitigation job {job_id} not found")

        # Load all floor sketches (with relationships)
        sketch_service = SketchService(self.db)
        floor_summaries = sketch_service.get_floor_sketches(job_id)
        sorted_floors = sorted(floor_summaries, key=lambda f: f.floor_order)

        floor_data: List[Dict[str, Any]] = []
        for summary in sorted_floors:
            detail = sketch_service.get_floor_sketch(summary.id)
            if not detail:
                continue
            svg = self._generate_floor_svg(detail)
            summary_data = self._compute_floor_summary(detail)
            floor_data.append(
                {
                    "floor_label": detail.floor_label,
                    "svg": svg,
                    "summary": summary_data,
                    "notes": detail.notes,
                }
            )

        html_content = self._render_html(job, floor_data)
        return self._html_to_pdf(html_content)

    # ──────────────────────────────────────────────────────────────────────
    # SVG Generation
    # ──────────────────────────────────────────────────────────────────────

    def _load_background_image_data_uri(self, floor: WMFloorSketch) -> Optional[str]:
        """
        Load the background image for a floor sketch and return a base64
        data-URI suitable for embedding in SVG/HTML.

        Returns None if there is no background image or it cannot be loaded.
        """
        bg_url = getattr(floor, "background_image_url", None)
        if not bg_url:
            return None

        provider = getattr(floor, "storage_provider", None) or "local"
        file_id = getattr(floor, "storage_file_id", None)

        image_bytes: Optional[bytes] = None

        # Cloud storage
        if provider != "local" and file_id:
            try:
                from app.domains.storage.factory import StorageFactory
                storage = StorageFactory.get_instance(provider)
                image_bytes = storage.download(file_id)
            except Exception as exc:
                logger.warning(
                    "Could not download background image for sketch %s "
                    "from %s: %s", floor.id, provider, exc,
                )

        # Local storage fallback
        if image_bytes is None and bg_url:
            local_path = None
            if bg_url.startswith("/uploads/"):
                from app.core.config import settings as app_settings
                rel = bg_url.replace("/uploads/", "", 1)
                base = getattr(app_settings, "STORAGE_BASE_DIR", "uploads")
                candidate = Path(base) / rel
                if candidate.exists():
                    local_path = candidate
                else:
                    candidate = (
                        Path(__file__).parent.parent.parent / "uploads" / rel
                    )
                    if candidate.exists():
                        local_path = candidate
            if local_path:
                try:
                    image_bytes = local_path.read_bytes()
                except Exception as exc:
                    logger.warning(
                        "Could not read local background image %s: %s",
                        local_path, exc,
                    )

        if not image_bytes:
            return None

        # Detect MIME type
        mime = mimetypes.guess_type(bg_url or "image.jpg")[0] or "image/jpeg"
        b64 = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{mime};base64,{b64}"

    def _generate_floor_svg(self, floor: WMFloorSketch) -> str:
        """
        Render a floor sketch as an inline SVG string.

        The coordinate system matches the Konva canvas:
          x / y are in canvas pixels.
          Dimensions are in feet, converted to pixels via scale.
        """
        canvas_w: float = float(floor.canvas_width or 1200)
        canvas_h: float = float(floor.canvas_height or 900)
        scale: float = float(floor.scale_pixels_per_foot or 20.0)

        parts: List[str] = []

        # Background: uploaded image or plain fill
        bg_data_uri = self._load_background_image_data_uri(floor)
        if bg_data_uri:
            parts.append(
                f'<image href="{bg_data_uri}" '
                f'x="0" y="0" width="{canvas_w}" height="{canvas_h}" '
                f'preserveAspectRatio="xMidYMid meet"/>'
            )
        else:
            parts.append(
                f'<rect width="{canvas_w}" height="{canvas_h}" fill="#fafafa" rx="4"/>'
            )

        # Subtle grid (only when no background image)
        if not bg_data_uri:
            parts.extend(self._build_grid(canvas_w, canvas_h, scale))

        # Canvas border
        parts.append(
            f'<rect width="{canvas_w}" height="{canvas_h}" fill="none" '
            f'stroke="#d0d0d0" stroke-width="1.5" rx="2"/>'
        )

        # Demolition zones (filled rectangles)
        for zone in (floor.demolition_zones or []):
            parts.extend(self._render_demo_zone(zone, scale))

        # Containment zones (dashed rectangles)
        for zone in (floor.containment_zones or []):
            parts.extend(self._render_containment_zone(zone, scale))

        # Floor protection strips
        for prot in (floor.floor_protections or []):
            parts.extend(self._render_floor_protection(prot, scale))

        # Content protection areas
        for cp in (floor.content_protections or []):
            parts.extend(self._render_content_protection(cp, scale))

        # Equipment icons
        for equip in (floor.equipment_placements or []):
            parts.extend(self._render_equipment(equip))

        # Scale indicator (bottom-right)
        parts.extend(self._build_scale_indicator(canvas_w, canvas_h, scale))

        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'viewBox="0 0 {canvas_w:.0f} {canvas_h:.0f}" '
            f'width="{canvas_w:.0f}" height="{canvas_h:.0f}" '
            f'style="max-width:100%;height:auto;display:block;">'
            + "".join(parts)
            + "</svg>"
        )

    def _build_grid(self, w: float, h: float, scale: float) -> List[str]:
        lines: List[str] = []
        x = scale
        col = 1
        while x < w:
            opacity = "0.18" if col % 5 == 0 else "0.07"
            lines.append(
                f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{h:.0f}" '
                f'stroke="#888" stroke-width="0.5" opacity="{opacity}"/>'
            )
            x += scale
            col += 1
        y = scale
        row = 1
        while y < h:
            opacity = "0.18" if row % 5 == 0 else "0.07"
            lines.append(
                f'<line x1="0" y1="{y:.1f}" x2="{w:.0f}" y2="{y:.1f}" '
                f'stroke="#888" stroke-width="0.5" opacity="{opacity}"/>'
            )
            y += scale
            row += 1
        return lines

    def _build_scale_indicator(self, w: float, h: float, scale: float) -> List[str]:
        """Draw a '10 ft' scale bar in the bottom-right corner."""
        bar_px = scale * 10  # 10 feet
        margin = 14.0
        bx = w - margin - bar_px
        by = h - margin - 6
        return [
            f'<line x1="{bx:.1f}" y1="{by:.1f}" x2="{bx + bar_px:.1f}" y2="{by:.1f}" '
            f'stroke="#888" stroke-width="1.5"/>',
            f'<line x1="{bx:.1f}" y1="{by - 4:.1f}" x2="{bx:.1f}" y2="{by + 4:.1f}" '
            f'stroke="#888" stroke-width="1.5"/>',
            f'<line x1="{bx + bar_px:.1f}" y1="{by - 4:.1f}" '
            f'x2="{bx + bar_px:.1f}" y2="{by + 4:.1f}" stroke="#888" stroke-width="1.5"/>',
            f'<text x="{bx + bar_px / 2:.1f}" y="{by - 7:.1f}" '
            f'text-anchor="middle" font-size="8" font-family="Arial" fill="#777">10 ft</text>',
        ]

    @staticmethod
    def _demolition_zone_is_line(zone: WMDemolitionZone) -> bool:
        """True for LF runs and wall SF segments stored as a line (d2 == 0)."""
        mt = (zone.material_type or "").strip()
        d1 = float(zone.dimension1_ft or 0)
        d2 = float(zone.dimension2_ft or 0)
        if d1 <= 0:
            return False
        if mt in _LF_DEMOLITION_MATERIALS:
            return True
        if mt in _WALL_LINE_SF_MATERIALS and d2 <= 0.0001:
            return True
        return False

    def _render_demo_line_zone(self, zone: WMDemolitionZone, scale: float) -> List[str]:
        """SVG for LF / wall line demolition (canvas pixels + length in feet)."""
        import math

        length_ft = float(zone.dimension1_ft or 0)
        if length_ft <= 0:
            return []
        length_px = length_ft * scale
        color = zone.color or "#888888"
        rotation = float(zone.rotation or 0)
        rad = math.radians(rotation)
        x1 = float(zone.x)
        y1 = float(zone.y)
        x2 = x1 + length_px * math.cos(rad)
        y2 = y1 + length_px * math.sin(rad)
        mt = zone.material_type or ""
        is_lf = mt in _LF_DEMOLITION_MATERIALS
        stroke_w = 3.5 if is_lf else 4.5
        dash_part = ' stroke-dasharray="8 4"' if is_lf else ""

        parts: List[str] = [
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="{stroke_w}" stroke-linecap="round"'
            f"{dash_part}/>",
        ]

        if length_px >= 36:
            mx = (x1 + x2) / 2
            my = (y1 + y2) / 2
            label = _DEMO_MATERIAL_LABELS.get(mt, mt)
            label_esc = html_lib.escape(label)
            unit = "LF" if is_lf else "SF"
            qty = float(zone.calculated_sqft or 0)
            parts.append(
                f'<text x="{mx:.1f}" y="{my - 6:.1f}" '
                f'text-anchor="middle" font-size="8" font-family="Arial" '
                f'fill="{color}" font-weight="600">{label_esc}</text>'
            )
            parts.append(
                f'<text x="{mx:.1f}" y="{my + 6:.1f}" '
                f'text-anchor="middle" font-size="7" font-family="Arial" fill="#555">'
                f"{length_ft:.1f}&apos; · {qty:.1f} {unit}</text>"
            )

        return parts

    def _render_demo_zone(self, zone: WMDemolitionZone, scale: float) -> List[str]:
        if self._demolition_zone_is_line(zone):
            return self._render_demo_line_zone(zone, scale)

        zone_w = float(zone.dimension1_ft) * scale
        zone_h = float(zone.dimension2_ft) * scale
        if zone_w <= 0 or zone_h <= 0:
            return []
        color = zone.color or "#FF5722"
        cx = zone.x + zone_w / 2
        cy = zone.y + zone_h / 2
        rotation = float(zone.rotation or 0)

        parts: List[str] = []
        transform_attr = (
            f' transform="rotate({rotation:.1f} {cx:.1f} {cy:.1f})"'
            if rotation != 0
            else ""
        )

        parts.append(
            f'<g{transform_attr}>'
            f'<rect x="{zone.x:.1f}" y="{zone.y:.1f}" '
            f'width="{zone_w:.1f}" height="{zone_h:.1f}" '
            f'fill="{color}" fill-opacity="0.22" '
            f'stroke="{color}" stroke-width="1.5" rx="1"/>'
        )

        # Label only if zone is large enough
        if zone_w >= 40 and zone_h >= 25:
            label = html_lib.escape(zone.material_type or "")
            dim = f'{float(zone.dimension1_ft):.1f}\'×{float(zone.dimension2_ft):.1f}\''
            sqft = f'{float(zone.calculated_sqft):.0f} SF'
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 9:.1f}" '
                f'text-anchor="middle" dominant-baseline="auto" '
                f'font-size="9" font-family="Arial" fill="{color}" font-weight="600">'
                f'{label}</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 3:.1f}" '
                f'text-anchor="middle" dominant-baseline="auto" '
                f'font-size="8" font-family="Arial" fill="#555">'
                f'{dim}</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 14:.1f}" '
                f'text-anchor="middle" dominant-baseline="auto" '
                f'font-size="8" font-family="Arial" fill="#666">'
                f'{sqft}</text>'
            )

        parts.append("</g>")
        return parts

    def _render_containment_zone(
        self, zone: WMContainmentZone, scale: float
    ) -> List[str]:
        import math

        length_ft = float(zone.length_ft or 0)
        if length_ft <= 0:
            return []

        length_px = length_ft * scale
        color = zone.color or "#0066FF"
        rotation = float(zone.rotation or 0)
        rad = math.radians(rotation)
        x1 = float(zone.x)
        y1 = float(zone.y)
        x2 = x1 + length_px * math.cos(rad)
        y2 = y1 + length_px * math.sin(rad)

        parts = [
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" '
            f'x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="4" '
            f'stroke-dasharray="10 5" '
            f'stroke-linecap="round"/>'
        ]

        # Label at midpoint
        label = zone.label or _containment_type_display(zone.containment_type)
        if label and length_px > 40:
            mx = (x1 + x2) / 2
            my = (y1 + y2) / 2
            parts.append(
                f'<text x="{mx:.1f}" y="{my - 8:.1f}" '
                f'text-anchor="middle" font-size="8" '
                f'font-family="Arial" fill="{color}">'
                f'{html_lib.escape(label)}</text>'
            )
        return parts

    def _render_content_protection(
        self, cp: WMContentProtection, scale: float
    ) -> List[str]:
        cp_w = float(cp.width_ft) * scale
        cp_h = float(cp.length_ft) * scale
        if cp_w <= 0 or cp_h <= 0:
            return []
        color = cp.color or "#8B5CF6"
        rotation = float(cp.rotation or 0)
        cx = cp.x + cp_w / 2
        cy = cp.y + cp_h / 2
        t = ""
        if rotation != 0:
            t = (
                f' transform="rotate({rotation:.1f}'
                f' {cx:.1f} {cy:.1f})"'
            )
        return [
            f'<g{t}>'
            f'<rect x="{cp.x:.1f}" y="{cp.y:.1f}" '
            f'width="{cp_w:.1f}" height="{cp_h:.1f}" '
            f'fill="{color}" fill-opacity="0.2" '
            f'stroke="{color}" stroke-width="1.5" rx="1"/>'
            f'</g>'
        ]

    def _render_floor_protection(self, prot: WMFloorProtection, scale: float) -> List[str]:
        # Match WMFloorProtectionRenderer (Konva): narrow width = paper roll,
        # height = run length; group at (x,y) rotates around top-left like Konva.
        prot_w = float(prot.paper_width_ft) * scale
        prot_h = float(prot.length_ft) * scale
        if prot_w <= 0 or prot_h <= 0:
            return []
        color = prot.color or "#FFD700"
        rotation = float(prot.rotation or 0)
        x = float(prot.x)
        y = float(prot.y)
        rot_part = f" rotate({rotation:.1f})" if abs(rotation) > 0.0001 else ""
        return [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
            f'<rect x="0" y="0" '
            f'width="{prot_w:.1f}" height="{prot_h:.1f}" '
            f'fill="{color}" fill-opacity="0.45" '
            f'stroke="{color}" stroke-width="1.5" rx="1"/>'
            f"</g>"
        ]

    def _render_equipment(self, equip: WMEquipmentPlacement) -> List[str]:
        cfg = EQUIPMENT_CONFIG.get(equip.equipment_type, {})
        color = equip.color or cfg.get("color", "#999999")
        shape = equip.icon_shape or cfg.get("shape", "circle")
        x, y = float(equip.x), float(equip.y)
        parts: List[str] = []

        if shape == "circle":
            parts += [
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" '
                f'fill="{color}" fill-opacity="0.88" stroke="#fff" stroke-width="1.5"/>',
                f'<text x="{x:.1f}" y="{y + 4:.1f}" '
                f'text-anchor="middle" font-size="9" font-family="Arial" '
                f'fill="#fff" font-weight="700">AM</text>',
            ]
        elif shape == "triangle":
            pts = f"{x:.1f},{y - 11:.1f} {x - 10:.1f},{y + 8:.1f} {x + 10:.1f},{y + 8:.1f}"
            parts += [
                f'<polygon points="{pts}" fill="{color}" fill-opacity="0.88" '
                f'stroke="#fff" stroke-width="1.5"/>',
                f'<text x="{x:.1f}" y="{y + 6:.1f}" '
                f'text-anchor="middle" font-size="8" font-family="Arial" '
                f'fill="#fff" font-weight="700">AS</text>',
            ]
        else:  # cylinder (dehumidifier)
            parts += [
                f'<rect x="{x - 10:.1f}" y="{y - 8:.1f}" width="20" height="14" '
                f'fill="{color}" fill-opacity="0.88"/>',
                f'<ellipse cx="{x:.1f}" cy="{y - 8:.1f}" rx="10" ry="4" '
                f'fill="{color}" fill-opacity="0.7" stroke="#fff" stroke-width="1"/>',
                f'<ellipse cx="{x:.1f}" cy="{y + 6:.1f}" rx="10" ry="4" '
                f'fill="{color}" fill-opacity="0.95" stroke="#fff" stroke-width="1"/>',
                f'<text x="{x:.1f}" y="{y + 3:.1f}" '
                f'text-anchor="middle" font-size="8" font-family="Arial" '
                f'fill="#fff" font-weight="700">DH</text>',
            ]

        # Custom label below icon
        if equip.label:
            parts.append(
                f'<text x="{x:.1f}" y="{y + 24:.1f}" '
                f'text-anchor="middle" font-size="8" font-family="Arial" fill="#555">'
                f'{html_lib.escape(equip.label)}</text>'
            )
        return parts

    # ──────────────────────────────────────────────────────────────────────
    # Summary Calculation
    # ──────────────────────────────────────────────────────────────────────

    def _compute_floor_summary(self, floor: WMFloorSketch) -> Dict[str, Any]:
        """Aggregate overlay data into report-friendly summary dicts."""
        demo_by_material: Dict[str, Dict] = {}
        carpet_pad_sqft: float = 0.0
        insulation_sqft: float = 0.0
        total_demo_sf: float = 0.0
        total_demo_lf: float = 0.0

        for zone in (floor.demolition_zones or []):
            key = zone.material_type or "Unknown"
            unit = _DEMO_MATERIAL_UNITS.get(key, "SF")
            if key not in demo_by_material:
                demo_by_material[key] = {
                    "material": key,
                    "material_name": _DEMO_MATERIAL_LABELS.get(
                        key, key.replace("_", " ").title()
                    ),
                    "surface": zone.surface or "",
                    "color": zone.color or "#888888",
                    "count": 0,
                    "total_sqft": 0.0,
                    "unit": unit,
                }
            demo_by_material[key]["count"] += 1
            qty = float(zone.calculated_sqft or 0)
            demo_by_material[key]["total_sqft"] += qty
            if unit == "LF":
                total_demo_lf += qty
            else:
                total_demo_sf += qty
            if key == "carpet" and getattr(zone, "include_pad", False) and qty > 0:
                carpet_pad_sqft += qty
            if getattr(zone, "include_insulation", False) and qty > 0:
                insulation_sqft += qty

        equip_counts: Dict[str, int] = {}
        for equip in (floor.equipment_placements or []):
            cfg = EQUIPMENT_CONFIG.get(equip.equipment_type, {})
            display = cfg.get("display", equip.equipment_type)
            equip_counts[display] = equip_counts.get(display, 0) + 1

        containment_sqft = sum(
            float(z.calculated_sqft or 0)
            for z in (floor.containment_zones or [])
        )
        protection_sqft = sum(
            float(p.calculated_sqft or 0)
            for p in (floor.floor_protections or [])
        )
        content_prot_sqft = sum(
            float(cp.calculated_sqft or 0)
            for cp in (floor.content_protections or [])
        )

        return {
            "demo_by_material": list(demo_by_material.values()),
            "equip_counts": equip_counts,
            "containment_sqft": containment_sqft,
            "protection_sqft": protection_sqft,
            "content_protection_sqft": content_prot_sqft,
            "total_demo_sqft": total_demo_sf,
            "total_demo_sf": total_demo_sf,
            "total_demo_lf": total_demo_lf,
            "carpet_pad_sqft": carpet_pad_sqft,
            "insulation_sqft": insulation_sqft,
        }

    # ──────────────────────────────────────────────────────────────────────
    # HTML → PDF
    # ──────────────────────────────────────────────────────────────────────

    def _render_html(self, job: WaterMitigationJob, floor_data: List[Dict]) -> str:
        template_dir = (
            Path(__file__).parent.parent.parent / "templates" / "water-mitigation"
        )
        env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=False,  # We escape manually where needed
        )

        _MONTH_NAMES = [
            "", "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        _MONTH_ABBR = [
            "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ]

        def _format_en(dt: datetime, fmt: str) -> str:
            """Format a datetime using explicit English month names.

            Windows Korean locale makes strftime('%B') return '4월' etc.,
            which corrupts in PDF rendering.  We handle %B and %b ourselves
            and delegate the rest to strftime.
            """
            result = fmt.replace("%B", _MONTH_NAMES[dt.month])
            result = result.replace("%b", _MONTH_ABBR[dt.month])
            return dt.strftime(result)

        def _fmt_date(value, fmt: str = "%B %d, %Y") -> str:
            """Safe date formatter that handles datetime, date, string, and None."""
            if value is None:
                return "—"
            if isinstance(value, str):
                for pattern in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                    try:
                        return _format_en(datetime.strptime(value, pattern), fmt)
                    except ValueError:
                        continue
                return value
            try:
                return _format_en(value, fmt)
            except (AttributeError, TypeError):
                return str(value)

        env.filters["fmt_date"] = _fmt_date

        template = env.get_template("sketch_report.html")
        return template.render(
            job=job,
            floor_data=floor_data,
            report_date=datetime.now(),
        )

    def _html_to_pdf(self, html_content: str) -> bytes:
        """Convert HTML to PDF using Playwright (headless Chromium).

        Runs in a dedicated thread to avoid event loop conflicts with FastAPI/AnyIO.
        """
        import asyncio
        import concurrent.futures

        # Define everything inside run_in_thread so the coroutine is created
        # fresh within the worker thread (avoids cross-thread coroutine issues).
        def run_in_thread() -> bytes:
            import sys

            # On Windows, asyncio.run() creates a SelectorEventLoop by default,
            # which does NOT support subprocesses. Playwright needs subprocess
            # support, so we must switch to ProactorEventLoop.
            if sys.platform == "win32":
                asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

            async def _generate() -> bytes:
                from playwright.async_api import async_playwright

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    try:
                        page = await browser.new_page()
                        await page.set_content(html_content, wait_until="networkidle")
                        pdf_bytes = await page.pdf(
                            format="Letter",
                            margin={
                                "top": "1.8cm",
                                "right": "2cm",
                                "bottom": "1.8cm",
                                "left": "2cm",
                            },
                            print_background=True,
                            display_header_footer=True,
                            header_template="<span></span>",
                            footer_template=(
                                '<div style="font-size:8px;color:#999;width:100%;'
                                'text-align:center;padding-right:2cm;">'
                                "Page <span class='pageNumber'></span> of "
                                "<span class='totalPages'></span></div>"
                            ),
                        )
                    finally:
                        await browser.close()
                return pdf_bytes

            return asyncio.run(_generate())

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(run_in_thread)
                return future.result(timeout=90)
        except concurrent.futures.TimeoutError:
            raise RuntimeError("PDF generation timed out (90s)")
        except Exception as exc:
            logger.exception("Playwright PDF generation failed: %r", exc)
            raise RuntimeError(f"PDF generation failed: {exc}") from exc
