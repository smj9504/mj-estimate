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
import tempfile
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

# ── Local disk cache for cloud-downloaded images ──
# Avoids re-downloading the same image on every PDF regeneration.
_IMAGE_CACHE_DIR = Path(tempfile.gettempdir()) / "mj_sketch_image_cache"
_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Matches frontend EQUIPMENT_CONFIG in wmSketch.ts
EQUIPMENT_CONFIG: Dict[str, Dict[str, str]] = {
    "air_mover":    {"display": "Air Mover",     "color": "#2196F3", "shape": "circle",   "abbreviation": "AM"},
    "air_scrubber": {"display": "Air Scrubber",  "color": "#4CAF50", "shape": "triangle", "abbreviation": "AS"},
    "dehumidifier": {"display": "Dehumidifier",  "color": "#FF9800", "shape": "cylinder", "abbreviation": "DH"},
}


def _containment_type_display(containment_type: Optional[str]) -> str:
    """Legacy default 'Standard' should read as Containment in PDF labels."""
    t = (containment_type or "").strip()
    if not t or t == "Standard":
        return "Containment"
    return t

# Linear LF demolition types (matches DEFAULT_DEMO_MATERIAL_TYPES in wmSketch.ts)
_LF_DEMOLITION_MATERIALS = frozenset(
    {"baseboard", "baseboard_quarter_round", "quarter_round", "toe_kick"}
)

# EA (each) demolition types — trim, door, stair
_EA_DEMOLITION_MATERIALS = frozenset(
    {"window_trim_demo", "door_trim_demo", "door_demo", "stair_demo"}
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
    "quarter_round": "Quarter Round",
    "toe_kick": "Toe Kick",
    "window_trim_demo": "Window Trim Demo",
    "door_trim_demo": "Door Trim Demo",
    "door_demo": "Door Demo",
    "stair_demo": "Stair Tread Demo",
}

# Wood floor sub-type display names for PDF
_WOOD_FLOOR_SUB_TYPE_LABELS: Dict[str, str] = {
    "hardwood": "Hardwood",
    "engineered": "Engineered Wood",
    "laminate": "Laminate",
    "lvp": "LVP",
}

# Wall material sub-type display names for PDF
_WALL_MATERIAL_SUB_TYPE_LABELS: Dict[str, str] = {
    "drywall": "Drywall",
    "wall_panel": "Wall Panel",
    "plaster": "Plaster",
    "wood_panel": "Wood Panel",
}

# Wall demolition material IDs that support sub-types
_WALL_MATERIAL_IDS = frozenset({
    "wall_drywall",
    "wall_drywall_2ft",
    "wall_drywall_4ft",
})

# Trim / door size sub-type display names for PDF
_TRIM_SIZE_SUB_TYPE_LABELS: Dict[str, str] = {
    "small": "Small",
    "medium": "Medium",
    "large": "Large",
    "x_large": "X-Large",
}

# Material IDs that support trim size sub-types
_TRIM_SIZE_MATERIAL_IDS = frozenset({
    "window_trim_demo",
    "door_trim_demo",
    "door_demo",
})

_DEMO_MATERIAL_UNITS: Dict[str, str] = {
    "baseboard": "LF",
    "baseboard_quarter_round": "LF",
    "quarter_round": "LF",
    "toe_kick": "LF",
    "window_trim_demo": "EA",
    "door_trim_demo": "EA",
    "door_demo": "EA",
    "stair_demo": "EA",
}


def _get_svg_style(variant: str = "a") -> Dict[str, Any]:
    """Return SVG drawing style configuration for a sketch variant.

    Each variant produces a visually distinct floor plan so that reports
    from different companies do not look identical.

    Variants:
        a (default) - Clean, modern: Arial, thin lines, light grid
        b           - Classical: serif fonts, thicker walls, dotted grid
        c           - Blue-accent: bold borders, colored scale bar, sans-serif
    """
    return {
        "a": {
            "font_primary": "Arial",
            "font_label": "Inter, Segoe UI, Arial, sans-serif",
            "canvas_bg": "#fafafa",
            "canvas_border_color": "#d0d0d0",
            "canvas_border_width": "1.5",
            "canvas_border_rx": "2",
            # ── structural rendering modes ──
            "grid_mode": "lines",        # lines | dots | crosshairs
            "scale_mode": "ticks",       # ticks | blocks | arrow_box
            "equip_mode": "filled",      # filled | outline | badge
            "wall_label_mode": "plain",  # plain | boxed | offset
            "demo_fill_mode": "solid",   # solid | hatch | dotted
            # ── colors/sizes ──
            "grid_color": "#888",
            "grid_opacity_major": "0.18",
            "grid_opacity_minor": "0.07",
            "grid_stroke_width": "0.5",
            "wall_default_color": "#333333",
            "wall_label_color": "#595959",
            "wall_label_size": "10",
            "room_stroke_color": "#0066cc",
            "room_stroke_width": "1",
            "room_opacity": "0.6",
            "room_name_size": "13",
            "room_name_color": "#333",
            "room_area_size": "11",
            "room_area_color": "#666",
            "equip_radius": 11,
            "equip_stroke": "#fff",
            "equip_stroke_width": "1.5",
            "equip_font_size": "10",
            "scale_bar_color": "#888",
            "scale_bar_width": "1.5",
            "scale_text_color": "#777",
            "scale_font_size": "10",
            "demo_label_size": "10",
            "demo_dim_color": "#555",
            "demo_sqft_color": "#666",
        },
        "b": {
            "font_primary": "Palatino Linotype, Book Antiqua, Palatino, serif",
            "font_label": "Palatino Linotype, Book Antiqua, Palatino, serif",
            "canvas_bg": "#f5f4f0",
            "canvas_border_color": "#999",
            "canvas_border_width": "2",
            "canvas_border_rx": "0",
            # ── structural rendering modes ──
            "grid_mode": "dots",
            "scale_mode": "blocks",
            "equip_mode": "outline",
            "wall_label_mode": "boxed",
            "demo_fill_mode": "hatch",
            # ── colors/sizes ──
            "grid_color": "#aaa",
            "grid_opacity_major": "0.25",
            "grid_opacity_minor": "0.10",
            "grid_stroke_width": "0.4",
            "wall_default_color": "#1a1a1a",
            "wall_label_color": "#444",
            "wall_label_size": "11",
            "room_stroke_color": "#556B2F",
            "room_stroke_width": "1.5",
            "room_opacity": "0.5",
            "room_name_size": "14",
            "room_name_color": "#2c2c2c",
            "room_area_size": "11",
            "room_area_color": "#555",
            "equip_radius": 12,
            "equip_stroke": "#f5f4f0",
            "equip_stroke_width": "2",
            "equip_font_size": "9",
            "scale_bar_color": "#555",
            "scale_bar_width": "2",
            "scale_text_color": "#444",
            "scale_font_size": "11",
            "demo_label_size": "11",
            "demo_dim_color": "#444",
            "demo_sqft_color": "#555",
        },
        "c": {
            "font_primary": "Trebuchet MS, Calibri, sans-serif",
            "font_label": "Trebuchet MS, Calibri, sans-serif",
            "canvas_bg": "#fafafa",
            "canvas_border_color": "#555",
            "canvas_border_width": "1.5",
            "canvas_border_rx": "0",
            # ── structural rendering modes ──
            "grid_mode": "crosshairs",
            "scale_mode": "arrow_box",
            "equip_mode": "badge",
            "wall_label_mode": "offset",
            "demo_fill_mode": "dotted",
            # ── colors/sizes ──
            "grid_color": "#bbb",
            "grid_opacity_major": "0.3",
            "grid_opacity_minor": "0.1",
            "grid_stroke_width": "0.5",
            "wall_default_color": "#2c2c2c",
            "wall_label_color": "#444",
            "wall_label_size": "10",
            "room_stroke_color": "#666",
            "room_stroke_width": "1.5",
            "room_opacity": "0.4",
            "room_name_size": "13",
            "room_name_color": "#333",
            "room_area_size": "11",
            "room_area_color": "#666",
            "equip_radius": 11,
            "equip_stroke": "#e0e0e0",
            "equip_stroke_width": "2",
            "equip_font_size": "10",
            "scale_bar_color": "#555",
            "scale_bar_width": "2",
            "scale_text_color": "#444",
            "scale_font_size": "10",
            "demo_label_size": "10",
            "demo_dim_color": "#444",
            "demo_sqft_color": "#666",
        },
    }.get(variant, {})  # Falls back to empty dict → code uses defaults


class SketchPdfService:
    """Generates PDF sketch reports for water mitigation jobs."""

    def __init__(self, db: Session):
        self.db = db
        self._svg = _get_svg_style("a")
        self._template_variant = "a"

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────

    def generate_sketch_report(self, job_id: UUID, template_variant: str = "a") -> bytes:
        """
        Generate a PDF report for all floor sketches belonging to a WM job.

        Args:
            job_id: UUID of the water mitigation job
            template_variant: Template variant to use ('a', 'b', or 'c')

        Returns raw PDF bytes suitable for streaming to the client.
        """
        self._template_variant = template_variant
        self._svg = _get_svg_style(template_variant)
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

    def _load_background_image_data_uri(
        self, floor: WMFloorSketch
    ) -> Optional[tuple]:
        """
        Load the background image for a floor sketch.

        Returns (data_uri, img_width, img_height) or None.
        """
        bg_url = getattr(floor, "background_image_url", None)
        if not bg_url:
            return None

        provider = getattr(floor, "storage_provider", None) or "local"
        file_id = getattr(floor, "storage_file_id", None)

        image_bytes: Optional[bytes] = None

        # Cloud storage — with local disk cache
        if provider != "local" and file_id:
            cache_path = _IMAGE_CACHE_DIR / f"{file_id}"
            if cache_path.exists():
                try:
                    image_bytes = cache_path.read_bytes()
                    logger.debug("Image cache HIT for file_id=%s", file_id)
                except Exception:
                    image_bytes = None

            if image_bytes is None:
                try:
                    from app.domains.storage.factory import StorageFactory
                    storage = StorageFactory.get_instance(provider)
                    image_bytes = storage.download(file_id)
                    # Save to local cache for subsequent PDF generations
                    if image_bytes:
                        try:
                            cache_path.parent.mkdir(parents=True, exist_ok=True)
                            cache_path.write_bytes(image_bytes)
                            logger.info(
                                "Image cache MISS → saved %d bytes for file_id=%s",
                                len(image_bytes), file_id,
                            )
                        except Exception as cache_exc:
                            logger.debug("Could not write image cache: %s", cache_exc)
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

        # Read actual image dimensions for contain-fit calculation
        img_w, img_h = self._get_image_dimensions(image_bytes)
        return f"data:{mime};base64,{b64}", img_w, img_h

    @staticmethod
    def _get_image_dimensions(
        image_bytes: bytes,
    ) -> tuple:
        """Read width/height from image bytes using PIL or fallback."""
        try:
            from PIL import Image as PILImage
            img = PILImage.open(io.BytesIO(image_bytes))
            return img.size  # (width, height)
        except Exception:
            return (0, 0)

    @staticmethod
    def _fit_contain(
        img_w: float, img_h: float,
        canvas_w: float, canvas_h: float,
    ) -> dict:
        """
        Replicate the frontend fitContain logic:
        scale image to fit canvas, center it.
        """
        if img_w <= 0 or img_h <= 0:
            return {"x": 0, "y": 0, "width": canvas_w, "height": canvas_h}
        scale_x = canvas_w / img_w
        scale_y = canvas_h / img_h
        s = min(scale_x, scale_y)
        w = img_w * s
        h = img_h * s
        return {
            "x": (canvas_w - w) / 2,
            "y": (canvas_h - h) / 2,
            "width": w,
            "height": h,
        }

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
        has_bg_image = False
        try:
            bg_result = self._load_background_image_data_uri(floor)
        except Exception as exc:
            logger.warning("Failed to load background image: %s", exc)
            bg_result = None

        if bg_result:
            has_bg_image = True
            bg_data_uri, img_w, img_h = bg_result
            # Use the same fitContain logic as the Konva canvas
            fit = self._fit_contain(img_w, img_h, canvas_w, canvas_h)
            parts.append(
                f'<image href="{bg_data_uri}" '
                f'x="{fit["x"]:.1f}" y="{fit["y"]:.1f}" '
                f'width="{fit["width"]:.1f}" height="{fit["height"]:.1f}" '
                f'preserveAspectRatio="none"/>'
            )
        else:
            s = self._svg
            parts.append(
                f'<rect width="{canvas_w}" height="{canvas_h}" '
                f'fill="{s.get("canvas_bg", "#fafafa")}" '
                f'rx="{s.get("canvas_border_rx", "4")}"/>'
            )

        # Subtle grid (only when no background image)
        if not has_bg_image:
            parts.extend(self._build_grid(canvas_w, canvas_h, scale))

        # Canvas border
        s = self._svg
        parts.append(
            f'<rect width="{canvas_w}" height="{canvas_h}" fill="none" '
            f'stroke="{s.get("canvas_border_color", "#d0d0d0")}" '
            f'stroke-width="{s.get("canvas_border_width", "1.5")}" '
            f'rx="{s.get("canvas_border_rx", "2")}"/>'
        )

        # ── DEBUG: log overlay_data source for troubleshooting ──
        logger.info(
            "PDF SVG for floor %s: canvas=%sx%s, scale=%.1f",
            getattr(floor, 'id', '?'), canvas_w, canvas_h, scale,
        )
        _overlay_raw = getattr(floor, "overlay_data", None)
        if isinstance(_overlay_raw, dict):
            for _k in ("demolition_zones", "equipment_placements",
                        "shapes", "walls", "rooms", "text_annotations"):
                _items = _overlay_raw.get(_k, [])
                if _items:
                    _sample = _items[0]
                    logger.info(
                        "  overlay_data.%s: %d items, first=%s",
                        _k, len(_items),
                        {k: v for k, v in _sample.items()
                         if k in ("x", "y", "start_x", "start_y",
                                  "width", "height", "dimension1_ft",
                                  "pixel_width", "pixel_height")}
                    )

        # ── Read ALL overlay elements from the JSONB snapshot ──
        # This ensures coordinates match the canvas exactly (the JSONB
        # is the source of truth written by the frontend save).
        overlay = getattr(floor, "overlay_data", None)
        if not isinstance(overlay, dict):
            overlay = {}

        # Rooms (lowest layer — floor fill)
        for room in overlay.get("rooms", []):
            parts.extend(self._render_room(room))

        # Walls (above rooms)
        for wall in overlay.get("walls", []):
            parts.extend(self._render_wall(wall))

        # Floor protection strips
        for prot in overlay.get("floor_protections", []):
            parts.extend(self._render_floor_protection_from_dict(prot, scale))

        # Content protection areas
        for cp in overlay.get("content_protections", []):
            parts.extend(self._render_content_protection_from_dict(cp, scale))

        # Content manipulation areas
        for cm in overlay.get("content_manipulations", []):
            parts.extend(self._render_content_manipulation_from_dict(cm, scale))

        # Containment zones (dashed lines)
        for zone in overlay.get("containment_zones", []):
            parts.extend(self._render_containment_from_dict(zone, scale))

        # Demolition zones (filled rectangles / lines)
        for zone in overlay.get("demolition_zones", []):
            parts.extend(self._render_demo_zone_from_dict(zone, scale))

        # Equipment icons
        for equip in overlay.get("equipment_placements", []):
            parts.extend(self._render_equipment_from_dict(equip))

        # Shape annotations (doors, cabinets, fixtures)
        for shape in overlay.get("shapes", []):
            parts.extend(self._render_shape_annotation(shape))

        # Text annotations
        for ta in overlay.get("text_annotations", []):
            parts.extend(self._render_text_annotation(ta))

        # Scale indicator (bottom-right)
        parts.extend(self._build_scale_indicator(canvas_w, canvas_h, scale))

        # Build SVG defs (hatch patterns for variant B)
        defs = ""
        demo_mode = self._svg.get("demo_fill_mode", "solid")
        if demo_mode == "hatch":
            defs = (
                '<defs>'
                '<pattern id="hatch" width="6" height="6" '
                'patternUnits="userSpaceOnUse" '
                'patternTransform="rotate(45)">'
                '<line x1="0" y1="0" x2="0" y2="6" '
                'stroke="currentColor" stroke-width="1.2"/>'
                '</pattern>'
                '</defs>'
            )

        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'viewBox="0 0 {canvas_w:.0f} {canvas_h:.0f}" '
            f'width="{canvas_w:.0f}" height="{canvas_h:.0f}" '
            f'style="max-width:100%;height:auto;display:block;">'
            + defs
            + "".join(parts)
            + "</svg>"
        )

    def _build_grid(self, w: float, h: float, scale: float) -> List[str]:
        s = self._svg
        mode = s.get("grid_mode", "lines")
        g_color = s.get("grid_color", "#888")
        g_sw = s.get("grid_stroke_width", "0.5")
        g_major = s.get("grid_opacity_major", "0.18")
        g_minor = s.get("grid_opacity_minor", "0.07")

        if mode == "dots":
            # ── Dot grid: small circles at intersections ──
            parts: List[str] = []
            x = scale
            col = 1
            while x < w:
                y = scale
                row = 1
                while y < h:
                    is_major = col % 5 == 0 and row % 5 == 0
                    r = "1.8" if is_major else "0.8"
                    op = g_major if is_major else g_minor
                    parts.append(
                        f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                        f'r="{r}" fill="{g_color}" '
                        f'opacity="{op}"/>'
                    )
                    y += scale
                    row += 1
                x += scale
                col += 1
            return parts

        if mode == "crosshairs":
            # ── Corner crosshairs only (no full grid) ──
            ch_len = scale * 2
            parts = []
            for cx, cy in [
                (0, 0), (w, 0), (0, h), (w, h),
                (w / 2, 0), (w / 2, h),
                (0, h / 2), (w, h / 2),
            ]:
                x1 = max(0, cx - ch_len / 2)
                x2 = min(w, cx + ch_len / 2)
                y1 = max(0, cy - ch_len / 2)
                y2 = min(h, cy + ch_len / 2)
                parts.append(
                    f'<line x1="{x1:.1f}" y1="{cy:.1f}" '
                    f'x2="{x2:.1f}" y2="{cy:.1f}" '
                    f'stroke="{g_color}" stroke-width="1" '
                    f'opacity="{g_major}"/>'
                )
                parts.append(
                    f'<line x1="{cx:.1f}" y1="{y1:.1f}" '
                    f'x2="{cx:.1f}" y2="{y2:.1f}" '
                    f'stroke="{g_color}" stroke-width="1" '
                    f'opacity="{g_major}"/>'
                )
            return parts

        # ── Default: line grid ──
        lines: List[str] = []
        x = scale
        col = 1
        while x < w:
            opacity = g_major if col % 5 == 0 else g_minor
            lines.append(
                f'<line x1="{x:.1f}" y1="0" '
                f'x2="{x:.1f}" y2="{h:.0f}" '
                f'stroke="{g_color}" stroke-width="{g_sw}" '
                f'opacity="{opacity}"/>'
            )
            x += scale
            col += 1
        y = scale
        row = 1
        while y < h:
            opacity = g_major if row % 5 == 0 else g_minor
            lines.append(
                f'<line x1="0" y1="{y:.1f}" '
                f'x2="{w:.0f}" y2="{y:.1f}" '
                f'stroke="{g_color}" stroke-width="{g_sw}" '
                f'opacity="{opacity}"/>'
            )
            y += scale
            row += 1
        return lines

    def _build_scale_indicator(
        self, w: float, h: float, scale: float
    ) -> List[str]:
        """Draw a '10 ft' scale bar in the bottom-right corner."""
        s = self._svg
        mode = s.get("scale_mode", "ticks")
        sc = s.get("scale_bar_color", "#888")
        sw = s.get("scale_bar_width", "1.5")
        tc = s.get("scale_text_color", "#777")
        fs = s.get("scale_font_size", "10")
        ff = s.get("font_primary", "Arial")
        bar_px = scale * 10  # 10 feet
        margin = 14.0
        bx = w - margin - bar_px
        by = h - margin - 6

        if mode == "blocks":
            # ── Alternating black/white blocks (surveyor style) ──
            seg = bar_px / 5
            parts = []
            for i in range(5):
                fill = sc if i % 2 == 0 else "#ffffff"
                stroke_attr = (
                    f'stroke="{sc}" stroke-width="0.5"'
                    if i % 2 != 0 else ""
                )
                parts.append(
                    f'<rect x="{bx + i * seg:.1f}" '
                    f'y="{by - 3:.1f}" '
                    f'width="{seg:.1f}" height="6" '
                    f'fill="{fill}" {stroke_attr}/>'
                )
            # Border around all blocks
            parts.append(
                f'<rect x="{bx:.1f}" y="{by - 3:.1f}" '
                f'width="{bar_px:.1f}" height="6" '
                f'fill="none" stroke="{sc}" '
                f'stroke-width="0.8"/>'
            )
            # Labels at 0 and 10
            parts.append(
                f'<text x="{bx:.1f}" y="{by - 7:.1f}" '
                f'text-anchor="middle" font-size="{fs}" '
                f'font-family="{ff}" fill="{tc}">0</text>'
            )
            parts.append(
                f'<text x="{bx + bar_px:.1f}" '
                f'y="{by - 7:.1f}" '
                f'text-anchor="middle" font-size="{fs}" '
                f'font-family="{ff}" fill="{tc}">'
                f'10 ft</text>'
            )
            return parts

        if mode == "arrow_box":
            # ── Arrow-ended line with background box ──
            arr = 6  # arrowhead size
            parts = [
                # Background box behind label
                f'<rect x="{bx + bar_px / 2 - 22:.1f}" '
                f'y="{by - 20:.1f}" '
                f'width="44" height="15" rx="3" '
                f'fill="{sc}" fill-opacity="0.12"/>',
                # Label
                f'<text x="{bx + bar_px / 2:.1f}" '
                f'y="{by - 9:.1f}" '
                f'text-anchor="middle" font-size="{fs}" '
                f'font-family="{ff}" fill="{tc}" '
                f'font-weight="600">10 ft</text>',
                # Main line
                f'<line x1="{bx + arr:.1f}" '
                f'y1="{by:.1f}" '
                f'x2="{bx + bar_px - arr:.1f}" '
                f'y2="{by:.1f}" '
                f'stroke="{sc}" stroke-width="{sw}"/>',
                # Left arrowhead
                f'<polygon points="'
                f'{bx:.1f},{by:.1f} '
                f'{bx + arr:.1f},{by - arr / 2:.1f} '
                f'{bx + arr:.1f},{by + arr / 2:.1f}" '
                f'fill="{sc}"/>',
                # Right arrowhead
                f'<polygon points="'
                f'{bx + bar_px:.1f},{by:.1f} '
                f'{bx + bar_px - arr:.1f},{by - arr / 2:.1f} '
                f'{bx + bar_px - arr:.1f},{by + arr / 2:.1f}" '
                f'fill="{sc}"/>',
            ]
            return parts

        # ── Default: simple ticks ──
        return [
            f'<line x1="{bx:.1f}" y1="{by:.1f}" '
            f'x2="{bx + bar_px:.1f}" y2="{by:.1f}" '
            f'stroke="{sc}" stroke-width="{sw}"/>',
            f'<line x1="{bx:.1f}" y1="{by - 4:.1f}" '
            f'x2="{bx:.1f}" y2="{by + 4:.1f}" '
            f'stroke="{sc}" stroke-width="{sw}"/>',
            f'<line x1="{bx + bar_px:.1f}" '
            f'y1="{by - 4:.1f}" '
            f'x2="{bx + bar_px:.1f}" '
            f'y2="{by + 4:.1f}" '
            f'stroke="{sc}" stroke-width="{sw}"/>',
            f'<text x="{bx + bar_px / 2:.1f}" '
            f'y="{by - 7:.1f}" '
            f'text-anchor="middle" font-size="{fs}" '
            f'font-family="{ff}" fill="{tc}">10 ft</text>',
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
            _ff = self._svg.get("font_primary", "Arial")
            parts.append(
                f'<text x="{mx:.1f}" y="{my - 6:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="{color}" font-weight="600">'
                f'{label_esc}</text>'
            )
            parts.append(
                f'<text x="{mx:.1f}" y="{my + 6:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="{self._svg.get("demo_dim_color", "#555")}">'
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
        rotation = float(zone.rotation or 0)
        x, y = float(zone.x), float(zone.y)

        rot_part = (
            f" rotate({rotation:.1f})"
            if abs(rotation) > 0.0001 else ""
        )

        parts: List[str] = []
        parts.append(
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
            f'<rect x="0" y="0" '
            f'width="{zone_w:.1f}" height="{zone_h:.1f}" '
            f'fill="{color}" fill-opacity="0.22" '
            f'stroke="{color}" stroke-width="1.5" rx="1"/>'
        )

        if zone_w >= 40 and zone_h >= 25:
            cx = zone_w / 2
            cy = zone_h / 2
            mt = zone.material_type or ""
            st = getattr(zone, "sub_type", None) or ""
            base_label = _DEMO_MATERIAL_LABELS.get(mt, mt)
            if mt == "wood_floor" and st:
                st_label = _WOOD_FLOOR_SUB_TYPE_LABELS.get(st, st)
                base_label = f"{base_label} ({st_label})"
            label = html_lib.escape(base_label)
            dim = f'{float(zone.dimension1_ft):.1f}\'×{float(zone.dimension2_ft):.1f}\''
            sqft = f'{float(zone.calculated_sqft):.0f} SF'
            _ff = self._svg.get("font_primary", "Arial")
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 9:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" fill="{color}" '
                f'font-weight="600">{label}</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 3:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="{self._svg.get("demo_dim_color", "#555")}">'
                f'{dim}</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 14:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="{self._svg.get("demo_sqft_color", "#666")}">'
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
        label = zone.label or _containment_type_display(
            zone.containment_type
        )
        if label and length_px > 40:
            mx = (x1 + x2) / 2
            my = (y1 + y2) / 2
            _ff = self._svg.get("font_primary", "Arial")
            parts.append(
                f'<text x="{mx:.1f}" y="{my - 8:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" fill="{color}">'
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
        x, y = float(cp.x), float(cp.y)
        rot_part = (
            f" rotate({rotation:.1f})"
            if abs(rotation) > 0.0001 else ""
        )
        return [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
            f'<rect x="0" y="0" '
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

    def _render_equipment(
        self, equip: WMEquipmentPlacement
    ) -> List[str]:
        sv = self._svg
        _ff = sv.get("font_primary", "Arial")
        _es = sv.get("equip_stroke", "#fff")
        _esw = sv.get("equip_stroke_width", "1.5")
        _r = sv.get("equip_radius", 11)
        cfg = EQUIPMENT_CONFIG.get(equip.equipment_type, {})
        color = equip.color or cfg.get("color", "#999999")
        shape = equip.icon_shape or cfg.get("shape", "circle")
        x, y = float(equip.x), float(equip.y)
        parts: List[str] = []

        if shape == "circle":
            parts += [
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{_r}" '
                f'fill="{color}" fill-opacity="0.88" '
                f'stroke="{_es}" stroke-width="{_esw}"/>',
                f'<text x="{x:.1f}" y="{y + 4:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="#fff" font-weight="700">AM</text>',
            ]
        elif shape == "triangle":
            pts = (
                f"{x:.1f},{y - _r:.1f} "
                f"{x - _r + 1:.1f},{y + _r - 3:.1f} "
                f"{x + _r - 1:.1f},{y + _r - 3:.1f}"
            )
            parts += [
                f'<polygon points="{pts}" '
                f'fill="{color}" fill-opacity="0.88" '
                f'stroke="{_es}" stroke-width="{_esw}"/>',
                f'<text x="{x:.1f}" y="{y + 6:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="#fff" font-weight="700">AS</text>',
            ]
        else:  # cylinder (dehumidifier)
            parts += [
                f'<rect x="{x - 10:.1f}" y="{y - 8:.1f}" '
                f'width="20" height="14" '
                f'fill="{color}" fill-opacity="0.88"/>',
                f'<ellipse cx="{x:.1f}" cy="{y - 8:.1f}" '
                f'rx="10" ry="4" fill="{color}" '
                f'fill-opacity="0.7" stroke="{_es}" '
                f'stroke-width="1"/>',
                f'<ellipse cx="{x:.1f}" cy="{y + 6:.1f}" '
                f'rx="10" ry="4" fill="{color}" '
                f'fill-opacity="0.95" stroke="{_es}" '
                f'stroke-width="1"/>',
                f'<text x="{x:.1f}" y="{y + 3:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="#fff" font-weight="700">DH</text>',
            ]

        # Custom label below icon
        if equip.label:
            parts.append(
                f'<text x="{x:.1f}" y="{y + 24:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{_ff}" '
                f'fill="{sv.get("demo_dim_color", "#555")}">'
                f'{html_lib.escape(equip.label)}</text>'
            )
        return parts

    # ──────────────────────────────────────────────────────────────────────
    # Dict-based renderers (read from overlay_data JSONB snapshot)
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _stroke_style_to_dasharray(stroke_style: str, is_lf: bool = False) -> str:
        """Convert a stroke_style value to SVG stroke-dasharray attribute."""
        if stroke_style == "dashed":
            return ' stroke-dasharray="8 4"'
        if stroke_style == "dotted":
            return ' stroke-dasharray="3 3"'
        # Default for LF is dashed
        if is_lf and stroke_style != "solid":
            return ' stroke-dasharray="8 4"'
        return ""

    def _render_demo_zone_from_dict(
        self, z: Dict[str, Any], scale: float
    ) -> List[str]:
        """SVG for a demolition zone from JSONB overlay_data."""
        import math

        sv = self._svg
        ff = sv.get("font_primary", "Arial")
        dls = sv.get("demo_label_size", "10")
        ddc = sv.get("demo_dim_color", "#555")
        dsc = sv.get("demo_sqft_color", "#666")

        mt = z.get("material_type", "")
        d1 = float(z.get("dimension1_ft", 0))
        d2 = float(z.get("dimension2_ft", 0))
        x = float(z.get("x", 0))
        y = float(z.get("y", 0))
        color = z.get("color", "#FF5722")
        rotation = float(z.get("rotation", 0))
        render_mode = z.get("render_mode", "")
        stroke_style = z.get("stroke_style", "solid") or "solid"
        custom_fill_opacity = z.get("fill_opacity")

        # Text render mode: display a styled text label
        if render_mode == "text":
            base_lbl = _DEMO_MATERIAL_LABELS.get(mt, mt.replace("_", " ").title())
            zone_label = z.get("label") or base_lbl
            sqft = float(z.get("calculated_sqft", 0))
            unit = _DEMO_MATERIAL_UNITS.get(mt, "SF")
            qty_text = ""
            if sqft > 0:
                qty_text = f" ({sqft:.1f} {unit})" if unit != "EA" else f" ({int(sqft)} {unit})"
            opacity = custom_fill_opacity if custom_fill_opacity is not None else 0.18
            escaped = html_lib.escape(f"{zone_label}{qty_text}")
            text_w = max(80, len(escaped) * 7 + 16)
            parts = [
                f'<g transform="translate({x:.1f},{y:.1f})">',
                f'<rect x="-4" y="-2" width="{text_w}" height="22" rx="4" '
                f'fill="{color}" fill-opacity="{opacity:.2f}" '
                f'stroke="{color}" stroke-width="1"/>',
                f'<text x="0" y="14" font-size="13" '
                f'font-weight="bold" font-family="{ff}" '
                f'fill="{color}">{escaped}</text>',
                '</g>',
            ]
            return parts

        # Determine render mode from zone data or material type
        is_lf = mt in _LF_DEMOLITION_MATERIALS
        is_wall_line = mt in _WALL_LINE_SF_MATERIALS and d2 <= 0.0001
        is_line = render_mode == "line" or is_lf or is_wall_line

        if is_line:
            if d1 <= 0:
                return []
            length_px = d1 * scale
            rad = math.radians(rotation)
            x1, y1 = x, y
            x2 = x1 + length_px * math.cos(rad)
            y2 = y1 + length_px * math.sin(rad)
            stroke_w = 3.5 if is_lf else 4.5
            dash_part = self._stroke_style_to_dasharray(stroke_style, is_lf=is_lf)
            parts = [
                f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                f'stroke="{color}" stroke-width="{stroke_w}" stroke-linecap="round"'
                f'{dash_part}/>'
            ]
            if length_px >= 36:
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                label = _DEMO_MATERIAL_LABELS.get(mt, mt)
                qty = float(z.get("calculated_sqft", 0))
                unit = "LF" if is_lf else "SF"
                parts.append(
                    f'<text x="{mx:.1f}" y="{my - 6:.1f}" '
                    f'text-anchor="middle" font-size="{dls}" '
                    f'font-family="{ff}" fill="{color}" '
                    f'font-weight="600">'
                    f'{html_lib.escape(label)}</text>'
                )
                parts.append(
                    f'<text x="{mx:.1f}" y="{my + 6:.1f}" '
                    f'text-anchor="middle" font-size="{dls}" '
                    f'font-family="{ff}" fill="{ddc}">'
                    f'{d1:.1f}&apos; · {qty:.1f} {unit}</text>'
                )
            return parts

        # ── Polygon zone (irregular shape with polygon_points) ──
        poly_pts = z.get("polygon_points")
        if poly_pts and isinstance(poly_pts, list) and len(poly_pts) >= 3:
            # polygon_points are relative to zone origin (x, y)
            def _pt_xy(p):
                if isinstance(p, dict):
                    return float(p.get("x", 0)), float(p.get("y", 0))
                return float(p[0]), float(p[1])

            points_str = " ".join(
                f"{_pt_xy(p)[0]:.1f},{_pt_xy(p)[1]:.1f}"
                for p in poly_pts
            )
            fill_op = custom_fill_opacity if custom_fill_opacity is not None else 0.22
            dash_part = self._stroke_style_to_dasharray(stroke_style)
            parts = [
                f'<g transform="translate({x:.1f},{y:.1f})">',
                f'<polygon points="{points_str}" '
                f'fill="{color}" fill-opacity="{fill_op:.2f}" '
                f'stroke="{color}" stroke-width="1.5"{dash_part}/>',
            ]
            # Calculate centroid for label placement
            px = [_pt_xy(p)[0] for p in poly_pts]
            py = [_pt_xy(p)[1] for p in poly_pts]
            cx = sum(px) / len(px)
            cy = sum(py) / len(py)
            sqft = float(z.get("calculated_sqft", 0))
            base_lbl = _DEMO_MATERIAL_LABELS.get(mt, mt)
            z_st = z.get("sub_type") or ""
            if mt == "wood_floor" and z_st:
                st_lbl = _WOOD_FLOOR_SUB_TYPE_LABELS.get(z_st, z_st)
                base_lbl = f"{base_lbl} ({st_lbl})"
            label = html_lib.escape(base_lbl)
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 4:.1f}" '
                f'text-anchor="middle" font-size="{dls}" '
                f'font-family="{ff}" fill="{color}" '
                f'font-weight="600">{label}</text>'
            )
            if sqft > 0:
                parts.append(
                    f'<text x="{cx:.1f}" y="{cy + 8:.1f}" '
                    f'text-anchor="middle" font-size="{dls}" '
                    f'font-family="{ff}" fill="{ddc}">'
                    f'{sqft:.1f} SF</text>'
                )
            parts.append("</g>")
            return parts

        # ── Rectangle zone — use pixel_width/pixel_height as fallback ──
        zone_w = d1 * scale if d1 > 0 else float(z.get("pixel_width") or 0)
        zone_h = d2 * scale if d2 > 0 else float(z.get("pixel_height") or 0)
        if zone_w <= 0 or zone_h <= 0:
            return []

        # Konva rotates around Group origin (top-left).
        # SVG equivalent: translate(x,y) rotate(angle)
        rot_part = (
            f" rotate({rotation:.1f})"
            if abs(rotation) > 0.0001 else ""
        )
        has_dims = d1 > 0 and d2 > 0

        # Apply custom stroke style or default behavior
        if has_dims:
            stroke_dash = self._stroke_style_to_dasharray(stroke_style)
        else:
            stroke_dash = ' stroke-dasharray="6 4"'

        if custom_fill_opacity is not None:
            fill_opacity = f"{custom_fill_opacity:.2f}"
        else:
            fill_opacity = "0.22" if has_dims else "0.15"

        demo_mode = sv.get("demo_fill_mode", "solid")
        parts = [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
        ]

        if demo_mode == "hatch":
            # ── Diagonal hatch pattern fill ──
            parts.append(
                f'<rect x="0" y="0" '
                f'width="{zone_w:.1f}" '
                f'height="{zone_h:.1f}" '
                f'fill="url(#hatch)" '
                f'style="color:{color}" '
                f'fill-opacity="0.35" '
                f'stroke="{color}" stroke-width="2" '
                f'rx="0"{stroke_dash}/>'
            )
        elif demo_mode == "dotted":
            # ── Dotted border, minimal fill ──
            parts.append(
                f'<rect x="0" y="0" '
                f'width="{zone_w:.1f}" '
                f'height="{zone_h:.1f}" '
                f'fill="{color}" fill-opacity="0.06" '
                f'stroke="{color}" stroke-width="2" '
                f'stroke-dasharray="3 3" rx="3"/>'
            )
        else:
            # ── Default: solid semi-transparent fill ──
            parts.append(
                f'<rect x="0" y="0" '
                f'width="{zone_w:.1f}" '
                f'height="{zone_h:.1f}" '
                f'fill="{color}" '
                f'fill-opacity="{fill_opacity}" '
                f'stroke="{color}" stroke-width="1.5" '
                f'rx="1"{stroke_dash}/>'
            )

        if has_dims and zone_w >= 40 and zone_h >= 25:
            cx = zone_w / 2
            cy = zone_h / 2
            sqft = float(z.get("calculated_sqft", 0))
            base_lbl = _DEMO_MATERIAL_LABELS.get(mt, mt)
            z_st = z.get("sub_type") or ""
            if mt == "wood_floor" and z_st:
                st_lbl = _WOOD_FLOOR_SUB_TYPE_LABELS.get(
                    z_st, z_st,
                )
                base_lbl = f"{base_lbl} ({st_lbl})"
            label = html_lib.escape(base_lbl)
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 9:.1f}" '
                f'text-anchor="middle" font-size="{dls}" '
                f'font-family="{ff}" fill="{color}" '
                f'font-weight="600">{label}</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 3:.1f}" '
                f'text-anchor="middle" font-size="{dls}" '
                f'font-family="{ff}" fill="{ddc}">'
                f'{d1:.1f}&apos;×{d2:.1f}&apos;</text>'
            )
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 14:.1f}" '
                f'text-anchor="middle" font-size="{dls}" '
                f'font-family="{ff}" fill="{dsc}">'
                f'{sqft:.0f} SF</text>'
            )

        parts.append("</g>")
        return parts

    def _render_containment_from_dict(self, z: Dict[str, Any], scale: float) -> List[str]:
        """SVG for a containment zone from JSONB dict."""
        import math
        length_ft = float(z.get("length_ft", 0))
        if length_ft <= 0:
            return []
        length_px = length_ft * scale
        color = z.get("color", "#0066FF")
        rotation = float(z.get("rotation", 0))
        rad = math.radians(rotation)
        x1, y1 = float(z.get("x", 0)), float(z.get("y", 0))
        x2 = x1 + length_px * math.cos(rad)
        y2 = y1 + length_px * math.sin(rad)
        parts = [
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="4" stroke-dasharray="10 5" stroke-linecap="round"/>'
        ]
        label = z.get("label") or z.get("containment_type", "")
        if label and length_px > 40:
            sv = self._svg
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            parts.append(
                f'<text x="{mx:.1f}" y="{my - 8:.1f}" '
                f'text-anchor="middle" font-size="10" '
                f'font-family="{sv.get("font_primary", "Arial")}" '
                f'fill="{color}">'
                f'{html_lib.escape(label)}</text>'
            )
        return parts

    def _render_floor_protection_from_dict(self, p: Dict[str, Any], scale: float) -> List[str]:
        """SVG for a floor protection strip from JSONB dict."""
        prot_w = float(p.get("paper_width_ft", 0)) * scale
        prot_h = float(p.get("length_ft", 0)) * scale
        if prot_w <= 0 or prot_h <= 0:
            return []
        color = p.get("color", "#FFD700")
        rotation = float(p.get("rotation", 0))
        x, y = float(p.get("x", 0)), float(p.get("y", 0))
        rot_part = f" rotate({rotation:.1f})" if abs(rotation) > 0.0001 else ""
        return [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
            f'<rect x="0" y="0" width="{prot_w:.1f}" height="{prot_h:.1f}" '
            f'fill="{color}" fill-opacity="0.45" stroke="{color}" stroke-width="1.5" rx="1"/>'
            f'</g>'
        ]

    def _render_content_protection_from_dict(self, cp: Dict[str, Any], scale: float) -> List[str]:
        """SVG for a content protection area from JSONB dict."""
        cp_w = float(cp.get("width_ft", 0)) * scale
        cp_h = float(cp.get("length_ft", 0)) * scale
        if cp_w <= 0 or cp_h <= 0:
            return []
        color = cp.get("color", "#8B5CF6")
        rotation = float(cp.get("rotation", 0))
        x, y = float(cp.get("x", 0)), float(cp.get("y", 0))
        rot_part = f" rotate({rotation:.1f})" if abs(rotation) > 0.0001 else ""
        return [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
            f'<rect x="0" y="0" '
            f'width="{cp_w:.1f}" height="{cp_h:.1f}" '
            f'fill="{color}" fill-opacity="0.2" stroke="{color}" stroke-width="1.5" rx="1"/></g>'
        ]

    def _render_content_manipulation_from_dict(self, cm: Dict[str, Any], scale: float) -> List[str]:
        """SVG for a content manipulation area from JSONB dict."""
        cm_w = float(cm.get("width_ft", 0)) * scale
        cm_h = float(cm.get("length_ft", 0)) * scale
        if cm_w <= 0 or cm_h <= 0:
            return []
        color = cm.get("color", "#F97316")
        rotation = float(cm.get("rotation", 0))
        x, y = float(cm.get("x", 0)), float(cm.get("y", 0))
        hours = float(cm.get("hours", 0))
        manip_type = cm.get("manipulation_type", "")
        rot_part = f" rotate({rotation:.1f})" if abs(rotation) > 0.0001 else ""
        label = f"{hours:.1f} hr · {manip_type}" if manip_type else f"{hours:.1f} hr"
        label_esc = html_lib.escape(label)
        cx, cy = cm_w / 2, cm_h / 2
        parts = [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">',
            f'<rect x="0" y="0" width="{cm_w:.1f}" height="{cm_h:.1f}" '
            f'fill="{color}" fill-opacity="0.15" stroke="{color}" stroke-width="1.5" '
            f'stroke-dasharray="6,3" rx="1"/>',
        ]
        if cm_w >= 40 and cm_h >= 20:
            parts += [
                f'<rect x="{cx - 28:.1f}" y="{cy - 8:.1f}" width="56" height="14" '
                f'fill="rgba(255,255,255,0.85)" rx="2"/>',
                f'<text x="{cx:.1f}" y="{cy + 3:.1f}" '
                f'text-anchor="middle" font-size="9" '
                f'font-family="{self._svg.get("font_primary", "Arial")}" '
                f'fill="#C2410C">{label_esc}</text>',
            ]
        parts.append('</g>')
        return parts

    def _render_equipment_from_dict(
        self, equip: Dict[str, Any]
    ) -> List[str]:
        """SVG for an equipment icon from JSONB dict."""
        sv = self._svg
        eq_mode = sv.get("equip_mode", "filled")
        eq_type = equip.get("equipment_type", "air_mover")
        cfg = EQUIPMENT_CONFIG.get(eq_type, {})
        color = equip.get("color") or cfg.get("color", "#999999")
        abbr = cfg.get("abbreviation", "")
        display = cfg.get("display", eq_type)
        x, y = float(equip.get("x", 0)), float(equip.get("y", 0))
        r = sv.get("equip_radius", 11)
        es = sv.get("equip_stroke", "#fff")
        esw = sv.get("equip_stroke_width", "1.5")
        efs = sv.get("equip_font_size", "10")
        ff = sv.get("font_primary", "Arial")
        parts: List[str] = []

        if eq_mode == "outline":
            # ── Outlined hollow icons (all same shape = circle) ──
            parts += [
                f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                f'r="{r}" fill="none" '
                f'stroke="{color}" stroke-width="2.5"/>',
                f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                f'r="{r - 4}" fill="none" '
                f'stroke="{color}" stroke-width="0.8"/>',
                f'<text x="{x:.1f}" y="{y + 4:.1f}" '
                f'text-anchor="middle" font-size="{efs}" '
                f'font-family="{ff}" fill="{color}" '
                f'font-weight="700">{abbr}</text>',
            ]

        elif eq_mode == "badge":
            # ── Rounded square badge ──
            bw = r * 2
            bh = r * 1.6
            parts += [
                f'<rect x="{x - bw / 2:.1f}" '
                f'y="{y - bh / 2:.1f}" '
                f'width="{bw:.1f}" height="{bh:.1f}" '
                f'rx="4" fill="{color}" '
                f'fill-opacity="0.9" '
                f'stroke="{es}" stroke-width="{esw}"/>',
                f'<text x="{x:.1f}" y="{y + 4:.1f}" '
                f'text-anchor="middle" font-size="{efs}" '
                f'font-family="{ff}" fill="#fff" '
                f'font-weight="700">{abbr}</text>',
            ]

        else:
            # ── Default: filled shapes (original) ──
            shape = equip.get("icon_shape") or cfg.get(
                "shape", "circle"
            )
            if shape == "circle":
                parts += [
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                    f'r="{r}" fill="{color}" '
                    f'fill-opacity="0.88" '
                    f'stroke="{es}" '
                    f'stroke-width="{esw}"/>',
                    f'<text x="{x:.1f}" y="{y + 4:.1f}" '
                    f'text-anchor="middle" '
                    f'font-size="{efs}" '
                    f'font-family="{ff}" fill="#fff" '
                    f'font-weight="700">{abbr}</text>',
                ]
            elif shape == "triangle":
                pts = (
                    f"{x:.1f},{y - r:.1f} "
                    f"{x - r + 1:.1f},{y + r - 3:.1f} "
                    f"{x + r - 1:.1f},{y + r - 3:.1f}"
                )
                parts += [
                    f'<polygon points="{pts}" '
                    f'fill="{color}" fill-opacity="0.88" '
                    f'stroke="{es}" '
                    f'stroke-width="{esw}"/>',
                    f'<text x="{x:.1f}" y="{y + 6:.1f}" '
                    f'text-anchor="middle" '
                    f'font-size="{efs}" '
                    f'font-family="{ff}" fill="#fff" '
                    f'font-weight="700">{abbr}</text>',
                ]
            else:
                parts += [
                    f'<rect x="{x - 10:.1f}" '
                    f'y="{y - 8:.1f}" '
                    f'width="20" height="14" '
                    f'fill="{color}" fill-opacity="0.88"/>',
                    f'<ellipse cx="{x:.1f}" '
                    f'cy="{y - 8:.1f}" rx="10" ry="4" '
                    f'fill="{color}" fill-opacity="0.7" '
                    f'stroke="{es}" stroke-width="1"/>',
                    f'<ellipse cx="{x:.1f}" '
                    f'cy="{y + 6:.1f}" rx="10" ry="4" '
                    f'fill="{color}" fill-opacity="0.95" '
                    f'stroke="{es}" stroke-width="1"/>',
                    f'<text x="{x:.1f}" y="{y + 3:.1f}" '
                    f'text-anchor="middle" '
                    f'font-size="{efs}" '
                    f'font-family="{ff}" fill="#fff" '
                    f'font-weight="700">{abbr}</text>',
                ]

        label = (equip.get("label") or "").strip()
        if label:
            parts.append(
                f'<text x="{x:.1f}" y="{y + 24:.1f}" '
                f'text-anchor="middle" font-size="{efs}" '
                f'font-family="{ff}" '
                f'fill="{sv.get("demo_dim_color", "#555")}">'
                f'{html_lib.escape(label)}</text>'
            )
        return parts

    def _render_wall(self, wall: Dict[str, Any]) -> List[str]:
        """SVG for a floor plan wall segment."""
        s = self._svg
        sx = float(wall.get("start_x", 0))
        sy = float(wall.get("start_y", 0))
        ex = float(wall.get("end_x", 0))
        ey = float(wall.get("end_y", 0))
        thickness = float(wall.get("thickness", 4))
        color = wall.get("color", s.get("wall_default_color", "#333333"))
        length_ft = float(wall.get("length_ft", 0))

        parts: List[str] = [
            f'<line x1="{sx:.1f}" y1="{sy:.1f}" '
            f'x2="{ex:.1f}" y2="{ey:.1f}" '
            f'stroke="{color}" stroke-width="{thickness:.1f}" '
            f'stroke-linecap="round"/>'
        ]

        # Length label at midpoint
        if length_ft > 0:
            mx = (sx + ex) / 2
            my = (sy + ey) / 2 - 6
            lbl_mode = s.get("wall_label_mode", "plain")
            lbl_size = s.get("wall_label_size", "10")
            lbl_color = s.get("wall_label_color", "#595959")
            lbl_ff = s.get(
                "font_label",
                "Inter, Segoe UI, Arial, sans-serif"
            )
            lbl_text = f"{length_ft:.1f}'"

            if lbl_mode == "boxed":
                # ── Text on background box ──
                tw = max(28, len(lbl_text) * 6 + 8)
                parts.append(
                    f'<rect x="{mx - tw / 2:.1f}" '
                    f'y="{my - 10:.1f}" '
                    f'width="{tw}" height="14" rx="2" '
                    f'fill="#fff" fill-opacity="0.85" '
                    f'stroke="{lbl_color}" '
                    f'stroke-width="0.5"/>'
                )
                parts.append(
                    f'<text x="{mx:.1f}" y="{my + 1:.1f}" '
                    f'font-size="{lbl_size}" '
                    f'fill="{lbl_color}" '
                    f'font-family="{lbl_ff}" '
                    f'text-anchor="middle">'
                    f'{lbl_text}</text>'
                )
            elif lbl_mode == "offset":
                # ── Offset with leader line ──
                import math
                dx = ex - sx
                dy = ey - sy
                wall_len = math.hypot(dx, dy)
                if wall_len > 0:
                    nx = -dy / wall_len * 14
                    ny = dx / wall_len * 14
                else:
                    nx, ny = 0, -14
                tx = mx + nx
                ty = my + ny
                parts.append(
                    f'<line x1="{mx:.1f}" y1="{my + 4:.1f}" '
                    f'x2="{tx:.1f}" y2="{ty + 4:.1f}" '
                    f'stroke="{lbl_color}" '
                    f'stroke-width="0.6" '
                    f'stroke-dasharray="2 2"/>'
                )
                parts.append(
                    f'<text x="{tx:.1f}" y="{ty:.1f}" '
                    f'font-size="{lbl_size}" '
                    f'fill="{lbl_color}" '
                    f'font-family="{lbl_ff}" '
                    f'text-anchor="middle" '
                    f'font-weight="600">'
                    f'{lbl_text}</text>'
                )
            else:
                # ── Default: plain text ──
                parts.append(
                    f'<text x="{mx:.1f}" y="{my:.1f}" '
                    f'font-size="{lbl_size}" '
                    f'fill="{lbl_color}" '
                    f'font-family="{lbl_ff}" '
                    f'text-anchor="middle">'
                    f'{lbl_text}</text>'
                )

        return parts

    def _render_room(self, room: Dict[str, Any]) -> List[str]:
        """SVG for a room polygon fill."""
        s = self._svg
        boundary = room.get("boundary", [])
        if not boundary or len(boundary) < 3:
            return []

        color = room.get("color", "rgba(173,216,230,0.3)")
        name = room.get("name", "")
        area = float(room.get("area_sqft", 0))

        points_str = " ".join(f'{p["x"]:.1f},{p["y"]:.1f}' for p in boundary)

        parts: List[str] = [
            f'<polygon points="{points_str}" '
            f'fill="{color}" stroke="{s.get("room_stroke_color", "#0066cc")}" '
            f'stroke-width="{s.get("room_stroke_width", "1")}" '
            f'opacity="{s.get("room_opacity", "0.6")}"/>'
        ]

        # Centroid for labels
        cx = sum(p["x"] for p in boundary) / len(boundary)
        cy = sum(p["y"] for p in boundary) / len(boundary)

        if name:
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 4:.1f}" '
                f'font-size="{s.get("room_name_size", "13")}" font-weight="700" '
                f'fill="{s.get("room_name_color", "#333")}" '
                f'font-family="{s.get("font_label", "Inter, Segoe UI, Arial, sans-serif")}" '
                f'text-anchor="middle">'
                f'{html_lib.escape(name)}</text>'
            )
        if area > 0:
            parts.append(
                f'<text x="{cx:.1f}" y="{cy + 12:.1f}" '
                f'font-size="{s.get("room_area_size", "11")}" '
                f'fill="{s.get("room_area_color", "#666")}" '
                f'font-family="{s.get("font_label", "Inter, Segoe UI, Arial, sans-serif")}" '
                f'text-anchor="middle">'
                f'{area:.0f} SF</text>'
            )

        return parts

    def _render_shape_annotation(
        self, shape: Dict[str, Any]
    ) -> List[str]:
        """SVG for a shape annotation (rectangle or circle).

        Uses translate(x,y) rotate(angle) to match Konva Group
        rotation around the top-left origin.
        """
        shape_type = shape.get("shape_type", "rectangle")
        x = float(shape.get("x", 0))
        y = float(shape.get("y", 0))
        w = float(shape.get("width", 50))
        h = float(shape.get("height", 50))
        rotation = float(shape.get("rotation", 0))
        fill = shape.get("fill_color", "#E8E8E8")
        stroke = shape.get("stroke_color", "#666666")
        stroke_w = float(shape.get("stroke_width", 2))
        opacity = float(shape.get("opacity", 0.7))
        label = (shape.get("label") or "").strip()

        rot_part = (
            f" rotate({rotation:.1f})"
            if abs(rotation) > 0.0001 else ""
        )

        parts: List[str] = [
            f'<g transform="translate({x:.1f},{y:.1f}){rot_part}">'
        ]

        preset_id = shape.get("preset_id", "")

        if preset_id == "door":
            # Industry-standard door symbol: line + quarter-circle arc
            flipped = bool(shape.get("flip_x", False))
            r = min(w, h)
            sw = max(2, stroke_w)
            arc_sw = max(1, stroke_w * 0.7)
            hinge_x = w if flipped else 0
            tip_x = 0 if flipped else w
            # Door panel line
            parts.append(
                f'<line x1="{hinge_x:.1f}" y1="{h:.1f}" '
                f'x2="{tip_x:.1f}" y2="{h:.1f}" '
                f'stroke="{stroke}" stroke-width="{sw:.1f}"/>'
            )
            # Quarter-circle arc (swing from tip sweeping up)
            if flipped:
                parts.append(
                    f'<path d="M {w - r:.1f} {h:.1f} '
                    f'A {r:.1f} {r:.1f} 0 0 1 {w:.1f} {h - r:.1f}" '
                    f'fill="none" stroke="{stroke}" '
                    f'stroke-width="{arc_sw:.1f}"/>'
                )
            else:
                parts.append(
                    f'<path d="M {r:.1f} {h:.1f} '
                    f'A {r:.1f} {r:.1f} 0 0 0 0 {h - r:.1f}" '
                    f'fill="none" stroke="{stroke}" '
                    f'stroke-width="{arc_sw:.1f}"/>'
                )
            # Hinge dot
            parts.append(
                f'<circle cx="{hinge_x:.1f}" cy="{h:.1f}" r="3" '
                f'fill="{stroke}"/>'
            )
        elif shape_type == "circle":
            rx = w / 2
            ry = h / 2
            parts.append(
                f'<ellipse cx="{rx:.1f}" cy="{ry:.1f}" '
                f'rx="{rx:.1f}" ry="{ry:.1f}" '
                f'fill="{fill}" fill-opacity="{opacity:.2f}" '
                f'stroke="{stroke}" stroke-width="{stroke_w:.1f}"/>'
            )
        else:
            parts.append(
                f'<rect x="0" y="0" '
                f'width="{w:.1f}" height="{h:.1f}" '
                f'fill="{fill}" fill-opacity="{opacity:.2f}" '
                f'stroke="{stroke}" stroke-width="{stroke_w:.1f}" '
                f'rx="2"/>'
            )
        if preset_id == "stairs" and shape_type == "rectangle" and h > 10:
            tread_count = max(2, round(h / max(w * 0.28, 8)))
            step = h / tread_count
            for i in range(1, tread_count):
                ty = i * step
                parts.append(
                    f'<line x1="0" y1="{ty:.1f}" x2="{w:.1f}" y2="{ty:.1f}" '
                    f'stroke="{stroke}" stroke-width="1" opacity="0.6"/>'
                )
            # Direction arrow (chevron pointing up)
            arrow_y = h * 0.5
            arrow_size = min(w * 0.2, 8)
            parts.append(
                f'<polyline points="{w/2 - arrow_size:.1f},{arrow_y + arrow_size:.1f} '
                f'{w/2:.1f},{arrow_y - arrow_size:.1f} '
                f'{w/2 + arrow_size:.1f},{arrow_y + arrow_size:.1f}" '
                f'stroke="{stroke}" stroke-width="1.5" fill="none" opacity="0.5"/>'
            )

        # Label centered inside the shape (local coords)
        if label:
            lx = w / 2
            ly = h / 2 + 4
            escaped = html_lib.escape(label)
            sf = self._svg.get(
                "font_label",
                "Inter, Segoe UI, Arial, sans-serif"
            )
            parts.append(
                f'<text x="{lx:.1f}" y="{ly:.1f}" '
                f'font-size="11" font-weight="700" '
                f'font-family="{sf}" '
                f'fill="{stroke}" text-anchor="middle">'
                f'{escaped}</text>'
            )

        parts.append('</g>')
        return parts

    def _render_text_annotation(
        self, ta: Dict[str, Any]
    ) -> List[str]:
        """SVG for a free-form text annotation."""
        text_val = (ta.get("text") or "").strip()
        if not text_val:
            return []
        ff = self._svg.get("font_label",
                           "Inter, Segoe UI, Arial, sans-serif")
        x = float(ta.get("x", 0))
        y = float(ta.get("y", 0))
        font_size = float(ta.get("font_size", 16))
        color = ta.get("color", "#333333")
        bold = ta.get("bold", False)
        weight = 'font-weight="700"' if bold else ""
        escaped = html_lib.escape(text_val)

        # Handle multiline text
        lines = escaped.split("\n")
        if len(lines) <= 1:
            return [
                f'<text x="{x:.1f}" y="{y + font_size:.1f}" '
                f'font-size="{font_size:.0f}" '
                f'font-family="{ff}" '
                f'fill="{color}" {weight}>'
                f'{escaped}</text>'
            ]

        parts: List[str] = []
        for i, line in enumerate(lines):
            ly = y + font_size + i * font_size * 1.3
            parts.append(
                f'<text x="{x:.1f}" y="{ly:.1f}" '
                f'font-size="{font_size:.0f}" '
                f'font-family="{ff}" '
                f'fill="{color}" {weight}>'
                f'{line}</text>'
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
        glue_down_carpet_sqft: float = 0.0
        glue_down_floor_sqft: float = 0.0
        total_demo_sf: float = 0.0
        total_demo_lf: float = 0.0
        total_demo_ea: float = 0.0

        for zone in (floor.demolition_zones or []):
            mt = zone.material_type or "Unknown"
            st = getattr(zone, "sub_type", None) or ""
            # Group key includes sub_type for wood floor and wall materials
            key = f"{mt}|{st}" if st else mt
            unit = _DEMO_MATERIAL_UNITS.get(mt, "SF")
            if key not in demo_by_material:
                base_name = _DEMO_MATERIAL_LABELS.get(
                    mt, mt.replace("_", " ").title()
                )
                if mt == "wood_floor" and st:
                    st_label = _WOOD_FLOOR_SUB_TYPE_LABELS.get(
                        st, st.replace("_", " ").title()
                    )
                    display_name = f"{base_name} ({st_label})"
                elif mt in _WALL_MATERIAL_IDS and st:
                    st_label = _WALL_MATERIAL_SUB_TYPE_LABELS.get(
                        st, st.replace("_", " ").title()
                    )
                    display_name = f"{base_name} ({st_label})"
                elif mt in _TRIM_SIZE_MATERIAL_IDS and st:
                    st_label = _TRIM_SIZE_SUB_TYPE_LABELS.get(
                        st, st.replace("_", " ").title()
                    )
                    display_name = f"{base_name} ({st_label})"
                else:
                    display_name = base_name
                demo_by_material[key] = {
                    "material": mt,
                    "sub_type": st,
                    "material_name": display_name,
                    "surface": zone.surface or "",
                    "color": zone.color or "#888888",
                    "count": 0,
                    "total_sqft": 0.0,
                    "unit": unit,
                }
            demo_by_material[key]["count"] += 1
            qty = float(zone.calculated_sqft or 0)
            demo_by_material[key]["total_sqft"] += qty
            if unit == "EA":
                total_demo_ea += qty
            elif unit == "LF":
                total_demo_lf += qty
            else:
                total_demo_sf += qty
            if mt == "carpet" and getattr(zone, "include_pad", False) and qty > 0:
                carpet_pad_sqft += qty
            if getattr(zone, "include_insulation", False) and qty > 0:
                insulation_sqft += qty
            if getattr(zone, "glue_down", False) and qty > 0:
                if mt == "carpet":
                    glue_down_carpet_sqft += qty
                else:
                    glue_down_floor_sqft += qty

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
        content_manip_hours = sum(
            float(cm.hours or 0)
            for cm in (floor.content_manipulations or [])
            if (cm.manipulation_type or "").strip() != "Move back"
        )

        return {
            "demo_by_material": list(demo_by_material.values()),
            "equip_counts": equip_counts,
            "containment_sqft": containment_sqft,
            "protection_sqft": protection_sqft,
            "content_protection_sqft": content_prot_sqft,
            "content_manipulation_hours": content_manip_hours,
            "total_demo_sqft": total_demo_sf,
            "total_demo_sf": total_demo_sf,
            "total_demo_lf": total_demo_lf,
            "total_demo_ea": total_demo_ea,
            "carpet_pad_sqft": carpet_pad_sqft,
            "insulation_sqft": insulation_sqft,
            "glue_down_carpet_sqft": glue_down_carpet_sqft,
            "glue_down_floor_sqft": glue_down_floor_sqft,
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

        variant = getattr(self, "_template_variant", "a")
        variant_suffix = f"_{variant}" if variant and variant != "a" else ""
        template_name = f"sketch_report{variant_suffix}.html"
        logger.info("Using sketch template: %s (variant=%s)", template_name, variant)
        template = env.get_template(template_name)
        return template.render(
            job=job,
            floor_data=floor_data,
            report_date=datetime.now(),
        )

    def _html_to_pdf(self, html_content: str) -> bytes:
        """Convert HTML to PDF.

        Strategy:
        1. Try Playwright (headless Chromium) — best quality
        2. Fallback to WeasyPrint — works without browser binary
        """
        # Try Playwright first (best rendering quality)
        try:
            return self._html_to_pdf_playwright(html_content)
        except Exception as exc:
            logger.warning(
                "Playwright PDF failed (%s), falling back to WeasyPrint",
                exc,
            )

        # Fallback: WeasyPrint (no browser binary needed)
        return self._html_to_pdf_weasyprint(html_content)

    def _html_to_pdf_weasyprint(self, html_content: str) -> bytes:
        """Convert HTML to PDF using WeasyPrint."""
        try:
            from weasyprint import HTML
            pdf_bytes = HTML(string=html_content).write_pdf()
            logger.info(
                "PDF generated via WeasyPrint (%d bytes)", len(pdf_bytes)
            )
            return pdf_bytes
        except ImportError:
            raise RuntimeError(
                "Neither Playwright nor WeasyPrint available for PDF"
            )
        except Exception as exc:
            logger.exception("WeasyPrint PDF generation failed: %r", exc)
            raise RuntimeError(f"PDF generation failed: {exc}") from exc

    def _html_to_pdf_playwright(self, html_content: str) -> bytes:
        """Convert HTML to PDF using Playwright (headless Chromium).

        Runs in a dedicated thread to avoid event loop conflicts.
        """
        import asyncio
        import concurrent.futures

        def run_in_thread() -> bytes:
            import sys

            if sys.platform == "win32":
                asyncio.set_event_loop_policy(
                    asyncio.WindowsProactorEventLoopPolicy()
                )

            async def _generate() -> bytes:
                from playwright.async_api import async_playwright

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    try:
                        page = await browser.new_page()
                        await page.set_content(
                            html_content, wait_until="networkidle"
                        )
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
                                '<div style="font-size:8px;color:#999;'
                                'width:100%;text-align:center;'
                                'padding-right:2cm;">'
                                "Page <span class='pageNumber'></span>"
                                " of "
                                "<span class='totalPages'></span>"
                                "</div>"
                            ),
                        )
                    finally:
                        await browser.close()
                return pdf_bytes

            return asyncio.run(_generate())

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(run_in_thread)
            return future.result(timeout=90)
