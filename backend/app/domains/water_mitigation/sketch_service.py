"""
Water Mitigation Sketch Service.

Business logic layer for floor sketches, overlay management,
and background image upload/removal.
"""

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.domains.storage.factory import StorageFactory
from app.domains.water_mitigation.sketch_models import WMFloorSketch
from app.domains.water_mitigation.sketch_repository import SketchRepository
from app.domains.water_mitigation.sketch_schemas import (
    GenerateScopeRequest,
    GenerateScopeResponse,
    GeneratedScopeItemSummary,
    WMFloorSketchCreate,
    WMFloorSketchUpdate,
    WMOverlayData,
)

logger = logging.getLogger(__name__)

# Folder name used when storing background images in the storage provider
_BACKGROUND_IMAGE_FOLDER = "wm_sketch_backgrounds"


class SketchService:
    """Service for WM Sketch operations"""

    def __init__(self, db: Session):
        self.db = db
        self.repository = SketchRepository(db)

    # =========================================================================
    # Floor Sketch CRUD
    # =========================================================================

    def get_floor_sketches(self, job_id: UUID) -> List[WMFloorSketch]:
        """Return all floor sketches for a job ordered by floor_order."""
        return self.repository.get_floor_sketches_by_job(job_id)

    def get_floor_sketch(self, floor_sketch_id: UUID) -> Optional[WMFloorSketch]:
        """Return a single floor sketch with overlay child rows."""
        return self.repository.get_floor_sketch(floor_sketch_id)

    def create_floor_sketch(
        self,
        job_id: UUID,
        data: WMFloorSketchCreate,
    ) -> WMFloorSketch:
        """
        Create a new floor sketch for a job.

        Automatically assigns floor_order to max+1 when floor_order is 0
        (default) so callers do not need to manage ordering explicitly.
        """
        sketch_data = data.dict()

        # Ensure job_id is consistent (overwrite whatever was in the body)
        sketch_data["job_id"] = job_id

        if sketch_data.get("floor_order", 0) == 0:
            sketch_data["floor_order"] = self.repository.get_next_floor_order(job_id)

        return self.repository.create_floor_sketch(sketch_data)

    def update_floor_sketch(
        self,
        floor_sketch_id: UUID,
        data: WMFloorSketchUpdate,
    ) -> WMFloorSketch:
        """Update metadata fields on an existing floor sketch."""
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.update_floor_sketch(
            sketch,
            data.dict(exclude_unset=True),
        )

    def delete_floor_sketch(self, floor_sketch_id: UUID) -> bool:
        """Delete a floor sketch and all child overlay rows."""
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.delete_floor_sketch(sketch)

    # =========================================================================
    # Overlay Data
    # =========================================================================

    def save_overlay_data(
        self,
        floor_sketch_id: UUID,
        overlay_data: WMOverlayData,
    ) -> WMFloorSketch:
        """
        Validate and atomically save all overlay elements.

        Delegates bulk delete + insert to the repository, which also
        updates the JSONB snapshot column.
        """
        # Confirm sketch exists before delegating
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        return self.repository.save_overlay_data(floor_sketch_id, overlay_data)

    # =========================================================================
    # Background Image
    # =========================================================================

    async def upload_background_image(
        self,
        floor_sketch_id: UUID,
        file: UploadFile,
        storage_factory: StorageFactory,
    ) -> WMFloorSketch:
        """
        Upload a background image file and store its URL on the sketch.

        Uses StorageFactory to persist the file through the configured
        storage provider (local filesystem, Google Drive, etc.).
        The old image is removed from storage before the new one is saved.
        """
        import io

        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        storage = storage_factory.get_instance()

        # Remove the previous background image if one exists
        old_file_id = getattr(sketch, "storage_file_id", None)
        if old_file_id:
            try:
                storage.delete(old_file_id)
            except Exception as exc:
                # Non-fatal: log and continue with the new upload
                logger.warning(
                    "Could not delete previous background image for floor sketch "
                    "%s (file_id=%s): %s",
                    floor_sketch_id,
                    old_file_id,
                    exc,
                )

        # Upload new file via StorageProvider.upload()
        file_content = await file.read()
        result = storage.upload(
            file_data=io.BytesIO(file_content),
            filename=file.filename or "background.jpg",
            context=_BACKGROUND_IMAGE_FOLDER,
            context_id=str(floor_sketch_id),
            content_type=file.content_type or "image/jpeg",
        )

        # Determine the storage provider name
        from app.core.config import settings
        provider_name = getattr(settings, "STORAGE_PROVIDER", "local")

        # For local dev, serve via /uploads/ static mount.
        # For cloud storage, the frontend will use the proxy endpoint.
        if provider_name == "local":
            image_url = result.file_url
            if not image_url.startswith(("http://", "https://", "/")):
                image_url = f"/uploads/{image_url}"
        else:
            # Use the backend proxy endpoint so the frontend doesn't need
            # direct access to cloud storage.
            image_url = (
                f"/api/water-mitigation/sketch/floors/"
                f"{floor_sketch_id}/background-image/preview"
            )

        # Persist URL + storage metadata for proxy retrieval
        return self.repository.update_floor_sketch(
            sketch,
            {
                "background_image_url": image_url,
                "source_type": "image",
                "storage_file_id": result.file_id,
                "storage_provider": provider_name,
            },
        )

    async def remove_background_image(
        self,
        floor_sketch_id: UUID,
        storage_factory: StorageFactory,
    ) -> WMFloorSketch:
        """
        Remove the background image from storage and clear the URL on the sketch.
        """
        sketch = self.repository.get_floor_sketch(floor_sketch_id)
        if not sketch:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        if sketch.background_image_url:
            try:
                import posixpath
                storage = storage_factory.get_instance()
                file_id = posixpath.basename(sketch.background_image_url)
                storage.delete(file_id)
            except Exception as exc:
                logger.warning(
                    "Could not delete background image for floor sketch %s: %s",
                    floor_sketch_id,
                    exc,
                )

        return self.repository.update_floor_sketch(
            sketch,
            {"background_image_url": None, "source_type": "sketch"},
        )

    # =========================================================================
    # Generate Scope of Work from Sketch
    # =========================================================================

    # ── Sketch material type → default DB material_type mapping ──
    # The sketch uses simplified types (e.g. "carpet", "wall_drywall")
    # while the material_weights DB uses specific types (e.g. "carpet_residential", "drywall_1_2").
    # (sketch_material_type, sub_type) → db material_type
    _SKETCH_TO_DB_MATERIAL: dict[tuple[str, str], str] = {
        # Flooring
        ("carpet", ""):                "carpet_residential",
        ("carpet_pad", ""):            "carpet_pad_8lb",
        ("wood_floor", ""):            "hardwood_floor_3_4",
        ("wood_floor", "hardwood"):    "hardwood_floor_3_4",
        ("wood_floor", "engineered"):  "engineered_hardwood",
        ("wood_floor", "laminate"):    "laminate_flooring",
        ("wood_floor", "lvp"):         "lvp_standard",
        ("tile", ""):                  "ceramic_tile",
        # Drywall / Wall
        ("wall_drywall", ""):          "drywall_1_2",
        ("wall_drywall", "drywall"):   "drywall_1_2",
        ("wall_drywall", "wall_panel"): "wainscoting_panel",
        ("wall_drywall", "plaster"):   "drywall_1_2",
        ("wall_drywall", "wood_panel"): "wainscoting_panel",
        ("wall_drywall_2ft", ""):      "drywall_1_2",
        ("wall_drywall_2ft", "drywall"): "drywall_1_2",
        ("wall_drywall_2ft", "wall_panel"): "wainscoting_panel",
        ("wall_drywall_2ft", "plaster"): "drywall_1_2",
        ("wall_drywall_2ft", "wood_panel"): "wainscoting_panel",
        ("wall_drywall_4ft", ""):      "drywall_1_2",
        ("wall_drywall_4ft", "drywall"): "drywall_1_2",
        ("wall_drywall_4ft", "wall_panel"): "wainscoting_panel",
        ("wall_drywall_4ft", "plaster"): "drywall_1_2",
        ("wall_drywall_4ft", "wood_panel"): "wainscoting_panel",
        ("ceiling", ""):               "drywall_1_2",
        # Trim / Baseboard
        ("baseboard", ""):             "baseboard_3",
        ("baseboard_quarter_round", ""): "baseboard_3",
        ("quarter_round", ""):         "quarter_round",
        ("toe_kick", ""):              "baseboard_3",
        # Insulation
        ("insulation", ""):            "fiberglass_r13",
        # Trim demos
        ("window_trim_demo", ""):      "window_casing",
        ("window_trim_demo", "small"): "window_casing",
        ("window_trim_demo", "medium"): "window_casing",
        ("window_trim_demo", "large"): "window_casing",
        ("window_trim_demo", "x_large"): "window_casing",
        ("door_trim_demo", ""):        "door_casing",
        ("door_trim_demo", "small"):   "door_casing",
        ("door_trim_demo", "medium"):  "door_casing",
        ("door_trim_demo", "large"):   "door_casing",
        ("door_trim_demo", "x_large"): "door_casing",
        # Door demos
        ("door_demo", ""):             "door_interior_hollow",
        ("door_demo", "small"):        "door_interior_hollow",
        ("door_demo", "medium"):       "door_interior_solid",
        ("door_demo", "large"):        "door_exterior_wood",
        ("door_demo", "x_large"):      "door_exterior_wood",
        # Stair
        ("stair_demo", ""):            "hardwood_floor_3_4",
    }

    @staticmethod
    def _resolve_material_weight_id(
        material_weight_map: dict,
        item_name: str,
        sketch_material_type: str,
        sub_type: str,
    ) -> "UUID | None":
        """
        Resolve material_weight_id for a demolition scope item.

        Tries multiple matching strategies against the material_weights table:
        0. Explicit sketch→DB mapping (handles simplified sketch types → specific DB types)
        1. Exact match by generated item name
        2. Exact match by sketch material_type key
        3. Case-insensitive match by item name
        4. Partial/prefix match
        """
        if not material_weight_map:
            return None

        # Strategy 0: Explicit sketch→DB mapping (most reliable)
        _MAP = SketchService._SKETCH_TO_DB_MATERIAL
        db_type = _MAP.get((sketch_material_type, sub_type))
        if db_type is None:
            # Try without sub_type as fallback
            db_type = _MAP.get((sketch_material_type, ""))
        if db_type and db_type in material_weight_map:
            return material_weight_map[db_type]

        # Strategy 1: Exact match by item name
        if item_name in material_weight_map:
            return material_weight_map[item_name]

        # Strategy 2: Exact match by sketch material_type key
        if sketch_material_type in material_weight_map:
            return material_weight_map[sketch_material_type]

        # Strategy 3: Case-insensitive match
        name_lower = item_name.lower()
        for mt, mw_id in material_weight_map.items():
            if mt.lower() == name_lower:
                return mw_id

        # Strategy 4: Partial match - check if item name starts with material_type name
        for mt, mw_id in material_weight_map.items():
            if name_lower.startswith(mt.lower()) or mt.lower().startswith(name_lower):
                return mw_id

        logger.warning(
            f"[SCOPE GEN] No material weight match for '{item_name}' "
            f"(sketch_type='{sketch_material_type}', sub_type='{sub_type}')"
        )
        return None

    # Material type → human-readable name mapping (matches frontend wmSketch.ts)
    _MATERIAL_TYPE_NAMES = {
        "wood_floor": "Wood Floor",
        "carpet": "Carpet",
        "tile": "Tile",
        "ceiling": "Ceiling",
        "wall_drywall": "Wall/Drywall",
        "wall_drywall_2ft": "Wall - Drywall 2ft",
        "wall_drywall_4ft": "Wall - Drywall 4ft",
        "baseboard": "Baseboard",
        "baseboard_quarter_round": "Baseboard+Quarter Round",
        "quarter_round": "Quarter Round",
        "toe_kick": "Toe Kick",
        "insulation": "Insulation",
        "window_trim_demo": "Window Trim Demo",
        "door_trim_demo": "Door Trim Demo",
        "door_demo": "Door Demo",
        "stair_demo": "Stair Tread Demo",
    }

    # Wood floor sub-type display names
    _WOOD_FLOOR_SUB_TYPE_NAMES = {
        "hardwood": "Hardwood",
        "engineered": "Engineered Wood",
        "laminate": "Laminate",
        "lvp": "LVP",
    }

    # Wall material sub-type display names
    _WALL_MATERIAL_SUB_TYPE_NAMES = {
        "drywall": "Drywall",
        "wall_panel": "Wall Panel",
        "plaster": "Plaster",
        "wood_panel": "Wood Panel",
    }

    # Wall demolition material IDs that support wall material sub-types
    _WALL_MATERIAL_IDS = frozenset({
        "wall_drywall", "wall_drywall_2ft", "wall_drywall_4ft",
    })

    # Trim / door size sub-type display names
    _TRIM_SIZE_SUB_TYPE_NAMES = {
        "small": "Small",
        "medium": "Medium",
        "large": "Large",
        "x_large": "X-Large",
    }

    # Material IDs that support trim size sub-types
    _TRIM_SIZE_MATERIAL_IDS = frozenset({
        "window_trim_demo", "door_trim_demo", "door_demo",
    })

    # Material type → unit classification
    # Material IDs that support partial trim removal
    _TRIM_REMOVAL_MATERIAL_IDS = {"window_trim_demo", "door_trim_demo"}

    # Standard trim perimeter in LF by (material_type, sub_type)
    # Window: 4 sides (2*W + 2*H), Door: 3 sides (2*H + W)
    _TRIM_LF_TABLE: dict[tuple[str, str], float] = {
        ("window_trim_demo", ""):        9.0,
        ("window_trim_demo", "small"):   9.0,
        ("window_trim_demo", "medium"):  14.0,
        ("window_trim_demo", "large"):   20.0,
        ("window_trim_demo", "x_large"): 26.0,
        ("door_trim_demo", ""):          16.0,
        ("door_trim_demo", "small"):     16.0,
        ("door_trim_demo", "medium"):    16.0,
        ("door_trim_demo", "large"):     18.0,
        ("door_trim_demo", "x_large"):   22.0,
    }

    @staticmethod
    def _calc_trim_lf(
        material_type: str,
        sub_type: str,
        removal: str = "full",
        custom_lf: float | None = None,
    ) -> float:
        """Calculate trim LF based on size, removal extent, and optional custom value."""
        if removal == "custom" and custom_lf and custom_lf > 0:
            return custom_lf
        full_lf = SketchService._TRIM_LF_TABLE.get(
            (material_type, sub_type),
            SketchService._TRIM_LF_TABLE.get((material_type, ""), 0.0),
        )
        if removal == "half":
            return round(full_lf / 2, 1)
        if removal == "quarter":
            return round(full_lf / 4, 1)
        return full_lf

    _DEMOLITION_MATERIAL_UNITS = {
        "wood_floor": "SF",
        "carpet": "SF",
        "tile": "SF",
        "ceiling": "SF",
        "wall_drywall": "SF",
        "wall_drywall_2ft": "SF",
        "wall_drywall_4ft": "SF",
        "baseboard": "LF",
        "baseboard_quarter_round": "LF",
        "quarter_round": "LF",
        "toe_kick": "LF",
        "insulation": "SF",
        "window_trim_demo": "LF",
        "door_trim_demo": "LF",
        "door_demo": "EA",
        "stair_demo": "EA",
    }

    def generate_scope_from_sketch(
        self,
        job_id: UUID,
        options: GenerateScopeRequest,
    ) -> GenerateScopeResponse:
        """
        Generate Scope of Work locations and items from sketch overlay data.

        For each floor sketch in the job:
        - Creates a WMScopeLocation for the floor
        - Creates WMScopeItems for each category:
          - Demolition zones: grouped by material_type, quantities summed
          - Equipment placements: counted by type (Air Mover, Air Scrubber, Dehumidifier)
          - Containment zones: total SF + zipper count as separate EA item
          - Floor protection: total SF
          - Content protection: total SF
        """
        from decimal import Decimal

        from sqlalchemy import select
        from app.domains.reconstruction_estimate.models import MaterialWeight
        from app.domains.water_mitigation.models import (
            WMScopeItem,
            WMScopeLocation,
        )
        from app.domains.water_mitigation.scope_repository import ScopeRepository

        sketches = self.repository.get_floor_sketches_by_job(job_id)
        if not sketches:
            return GenerateScopeResponse(
                success=False,
                message="No floor sketches found for this job.",
            )

        scope_repo = ScopeRepository(self.db)
        warnings: list[str] = []
        all_items: list[GeneratedScopeItemSummary] = []

        # Build material_type → material_weight_id lookup from DB
        material_weight_map: dict[str, UUID] = {}
        try:
            rows = self.db.execute(
                select(MaterialWeight.material_type, MaterialWeight.id)
                .where(MaterialWeight.active.is_(True))
            ).all()
            material_weight_map = {row.material_type: row.id for row in rows}
            logger.info(
                f"[SCOPE GEN] Loaded {len(material_weight_map)} material weights: "
                f"{list(material_weight_map.keys())}"
            )
        except Exception as e:
            logger.warning(f"[SCOPE GEN] Failed to load material weights: {e}")

        # Optionally clear existing scope data
        if options.clear_existing:
            existing_locations = scope_repo.get_locations_by_job(job_id, include_items=False)
            for loc in existing_locations:
                scope_repo.delete_location(loc)

        locations_created = 0
        items_created = 0

        for sketch in sketches:
            floor_label = sketch.floor_label or f"Floor {sketch.floor_order}"

            # Use JSONB overlay_data as source of truth — it preserves ALL
            # frontend fields (baseboard_type, polygon_points, etc.) that the
            # normalised DB rows may not have.
            _overlay = sketch.overlay_data if isinstance(sketch.overlay_data, dict) else {}
            _jsonb_demo_zones = _overlay.get("demolition_zones") or []

            # Create scope location for this floor
            location = WMScopeLocation(
                job_id=job_id,
                name=floor_label,
                floor=floor_label,
                description=f"Auto-generated from sketch: {floor_label}",
                display_order=sketch.floor_order,
            )
            self.db.add(location)
            self.db.flush()  # Get location.id
            locations_created += 1

            item_order = 0

            # --- Demolition zones: group by (material_type, sub_type) ---
            # Key = (material_type, sub_type or "")
            demo_groups: dict[tuple[str, str], float] = {}
            carpet_pad_sqft: float = 0.0
            insulation_sqft: float = 0.0
            glue_down_carpet_sqft: float = 0.0
            glue_down_floor_sqft: float = 0.0
            # Baseboard/trim LF accumulated from wall drywall zones with baseboard_type
            baseboard_lf: dict[str, float] = {}  # key = baseboard_type, value = total LF
            for zone in _jsonb_demo_zones:
                mt = zone.get("material_type") or "unknown"
                st = zone.get("sub_type") or ""
                sqft = float(zone.get("calculated_sqft") or 0)

                # Trim items: ensure value is in LF, not EA count
                if mt in self._TRIM_REMOVAL_MATERIAL_IDS:
                    trim_removal = zone.get("trim_removal") or "full"
                    trim_lf_custom = zone.get("trim_lf")
                    sqft = self._calc_trim_lf(mt, st, trim_removal, float(trim_lf_custom) if trim_lf_custom else None)

                key = (mt, st)
                if sqft > 0:
                    demo_groups[key] = demo_groups.get(key, 0) + sqft
                # Accumulate carpet pad area
                if mt == "carpet" and zone.get("include_pad") and sqft > 0:
                    carpet_pad_sqft += sqft
                # Accumulate insulation area (from wall/ceiling checkbox)
                if zone.get("include_insulation") and sqft > 0:
                    insulation_sqft += sqft
                # Accumulate glue down area — split by carpet vs other floor materials
                if zone.get("glue_down") and sqft > 0:
                    if mt == "carpet":
                        glue_down_carpet_sqft += sqft
                    else:
                        glue_down_floor_sqft += sqft
                # Accumulate baseboard/trim LF from wall drywall zones
                bb_type = zone.get("baseboard_type")
                if bb_type and float(zone.get("dimension1_ft") or 0) > 0:
                    wall_lf = float(zone.get("dimension1_ft"))
                    baseboard_lf[bb_type] = baseboard_lf.get(bb_type, 0) + wall_lf

            for (material_type, sub_type), total_qty in demo_groups.items():
                base_name = self._MATERIAL_TYPE_NAMES.get(
                    material_type, material_type,
                )
                # Append sub-type for wood floor
                if material_type == "wood_floor" and sub_type:
                    st_name = self._WOOD_FLOOR_SUB_TYPE_NAMES.get(
                        sub_type, sub_type,
                    )
                    name = f"{base_name} ({st_name})"
                # Append sub-type for wall materials
                elif (
                    material_type in self._WALL_MATERIAL_IDS
                    and sub_type
                ):
                    st_name = self._WALL_MATERIAL_SUB_TYPE_NAMES.get(
                        sub_type, sub_type,
                    )
                    name = f"{base_name} ({st_name})"
                # Append size sub-type for trim/door
                elif (
                    material_type in self._TRIM_SIZE_MATERIAL_IDS
                    and sub_type
                ):
                    st_name = self._TRIM_SIZE_SUB_TYPE_NAMES.get(
                        sub_type, sub_type,
                    )
                    name = f"{base_name} ({st_name})"
                else:
                    name = base_name
                unit = self._DEMOLITION_MATERIAL_UNITS.get(
                    material_type, "SF",
                )
                # Auto-map material_weight_id from DB
                mw_id = self._resolve_material_weight_id(
                    material_weight_map, name, material_type, sub_type,
                )
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name=name,
                    quantity=Decimal(str(round(total_qty, 2))),
                    unit=unit,
                    include_in_debris=True,
                    material_weight_id=mw_id,
                    display_order=item_order,
                )
                if not mw_id:
                    warnings.append(
                        f"No material weight mapping found for '{name}'"
                    )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name=name, item_type="demolition",
                    quantity=round(total_qty, 2), unit=unit,
                    floor_label=floor_label,
                ))

            # Carpet Pad — separate line item
            if carpet_pad_sqft > 0:
                pad_mw_id = self._resolve_material_weight_id(
                    material_weight_map, "Carpet Pad", "carpet_pad", "",
                )
                pad_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Carpet Pad",
                    quantity=Decimal(str(round(carpet_pad_sqft, 2))),
                    unit="SF",
                    include_in_debris=True,
                    material_weight_id=pad_mw_id,
                    display_order=item_order,
                )
                self.db.add(pad_item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Carpet Pad", item_type="demolition",
                    quantity=round(carpet_pad_sqft, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # Insulation — separate line item from checkbox
            if insulation_sqft > 0:
                ins_mw_id = self._resolve_material_weight_id(
                    material_weight_map, "Insulation", "insulation", "",
                )
                ins_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Insulation",
                    quantity=Decimal(str(round(insulation_sqft, 2))),
                    unit="SF",
                    include_in_debris=True,
                    material_weight_id=ins_mw_id,
                    display_order=item_order,
                )
                self.db.add(ins_item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Insulation", item_type="demolition",
                    quantity=round(insulation_sqft, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # Glue Down Carpet Removal — separate add-on line item
            if glue_down_carpet_sqft > 0:
                gd_carpet_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Glue Down Carpet Removal",
                    quantity=Decimal(str(round(glue_down_carpet_sqft, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(gd_carpet_item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Glue Down Carpet Removal", item_type="demolition",
                    quantity=round(glue_down_carpet_sqft, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # Glue Down Floor Removal — separate add-on line item (wood, tile, etc.)
            if glue_down_floor_sqft > 0:
                gd_floor_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Glue Down Floor Removal",
                    quantity=Decimal(str(round(glue_down_floor_sqft, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(gd_floor_item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Glue Down Floor Removal", item_type="demolition",
                    quantity=round(glue_down_floor_sqft, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # Baseboard / Quarter Round — separate line items from wall drywall zones
            # Expand baseboard_quarter_round into two separate items (Baseboard + Quarter Round)
            expanded_bb: dict[str, float] = {}
            for bb_type, total_lf in baseboard_lf.items():
                if total_lf <= 0:
                    continue
                if bb_type == "baseboard_quarter_round":
                    expanded_bb["baseboard"] = expanded_bb.get("baseboard", 0) + total_lf
                    expanded_bb["quarter_round"] = expanded_bb.get("quarter_round", 0) + total_lf
                else:
                    expanded_bb[bb_type] = expanded_bb.get(bb_type, 0) + total_lf

            _BB_NAMES = {
                "baseboard": "Baseboard",
                "quarter_round": "Quarter Round",
            }
            for bb_type, total_lf in expanded_bb.items():
                if total_lf <= 0:
                    continue
                bb_name = _BB_NAMES.get(bb_type, bb_type)
                bb_mw_id = self._resolve_material_weight_id(
                    material_weight_map, bb_name, bb_type, "",
                )
                bb_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name=bb_name,
                    quantity=Decimal(str(round(total_lf, 2))),
                    unit="LF",
                    include_in_debris=True,
                    material_weight_id=bb_mw_id,
                    display_order=item_order,
                )
                if not bb_mw_id:
                    warnings.append(
                        f"No material weight mapping found for '{bb_name}'"
                    )
                self.db.add(bb_item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name=bb_name, item_type="demolition",
                    quantity=round(total_lf, 2), unit="LF",
                    floor_label=floor_label,
                ))

            # --- Equipment placements: count by type ---
            equip_counts: dict[str, int] = {}
            for eq in (sketch.equipment_placements or []):
                et = eq.equipment_type or "unknown"
                equip_counts[et] = equip_counts.get(et, 0) + 1

            equip_name_map = {
                "air_mover": "Air Mover",
                "air_scrubber": "Air Scrubber",
                "dehumidifier": "Dehumidifier",
            }
            for equip_type, count in equip_counts.items():
                name = equip_name_map.get(equip_type, equip_type)
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name=name,
                    quantity=Decimal(str(count)),
                    unit="EA",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name=name, item_type="standard",
                    quantity=float(count), unit="EA",
                    floor_label=floor_label,
                ))

            # --- Containment zones: total SF + zipper count ---
            total_containment_sf = 0.0
            total_zippers = 0
            for cz in (sketch.containment_zones or []):
                total_containment_sf += float(cz.calculated_sqft or 0)
                total_zippers += (cz.zipper_count or 0)

            if total_containment_sf > 0:
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name="Containment",
                    quantity=Decimal(str(round(total_containment_sf, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Containment", item_type="standard",
                    quantity=round(total_containment_sf, 2), unit="SF",
                    floor_label=floor_label,
                ))

            if total_zippers > 0:
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name="Containment Zipper",
                    quantity=Decimal(str(total_zippers)),
                    unit="EA",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Containment Zipper", item_type="standard",
                    quantity=float(total_zippers), unit="EA",
                    floor_label=floor_label,
                ))

            # --- Floor protection: total SF ---
            total_floor_prot = 0.0
            for fp in (sketch.floor_protections or []):
                total_floor_prot += float(fp.calculated_sqft or 0)

            if total_floor_prot > 0:
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name="Floor Protection",
                    quantity=Decimal(str(round(total_floor_prot, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Floor Protection", item_type="standard",
                    quantity=round(total_floor_prot, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # --- Content protection: total SF ---
            total_content_prot = 0.0
            for cp in (sketch.content_protections or []):
                total_content_prot += float(cp.calculated_sqft or 0)

            if total_content_prot > 0:
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name="Content Protection",
                    quantity=Decimal(str(round(total_content_prot, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Content Protection", item_type="standard",
                    quantity=round(total_content_prot, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # --- Content manipulation: total SF ---
            total_content_manip = 0.0
            for cm in (sketch.content_manipulations or []):
                total_content_manip += float(cm.calculated_sqft or 0)

            if total_content_manip > 0:
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="standard",
                    name="Content Manipulation",
                    quantity=Decimal(str(round(total_content_manip, 2))),
                    unit="SF",
                    include_in_debris=False,
                    display_order=item_order,
                )
                self.db.add(item)
                items_created += 1
                item_order += 1
                all_items.append(GeneratedScopeItemSummary(
                    name="Content Manipulation", item_type="standard",
                    quantity=round(total_content_manip, 2), unit="SF",
                    floor_label=floor_label,
                ))

            # Warn if floor has no overlay data at all
            has_data = (
                len(sketch.demolition_zones or []) +
                len(sketch.equipment_placements or []) +
                len(sketch.containment_zones or []) +
                len(sketch.floor_protections or []) +
                len(sketch.content_protections or []) +
                len(sketch.content_manipulations or [])
            )
            if has_data == 0:
                warnings.append(
                    f"Floor '{floor_label}' has no overlay data — "
                    "location created with no scope items."
                )

        return GenerateScopeResponse(
            success=True,
            message=(
                f"Generated {items_created} scope items "
                f"across {locations_created} locations from sketch data."
            ),
            locations_created=locations_created,
            items_created=items_created,
            items=all_items,
            warnings=warnings,
        )
