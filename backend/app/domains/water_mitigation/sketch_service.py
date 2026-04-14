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
        if sketch.background_image_url:
            try:
                # Extract filename from the stored URL for the delete call
                # e.g. "/uploads/wm_sketch_backgrounds/id/uuid.jpg" → "uuid.jpg"
                import posixpath
                file_id = posixpath.basename(sketch.background_image_url)
                storage.delete(file_id)
            except Exception as exc:
                # Non-fatal: log and continue with the new upload
                logger.warning(
                    "Could not delete previous background image for floor sketch "
                    "%s: %s",
                    floor_sketch_id,
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
        "toe_kick": "Toe Kick",
        "insulation": "Insulation",
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

    # Material type → item_type classification
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
        "toe_kick": "LF",
        "insulation": "SF",
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

        # Optionally clear existing scope data
        if options.clear_existing:
            existing_locations = scope_repo.get_locations_by_job(job_id, include_items=False)
            for loc in existing_locations:
                scope_repo.delete_location(loc)

        locations_created = 0
        items_created = 0

        for sketch in sketches:
            floor_label = sketch.floor_label or f"Floor {sketch.floor_order}"

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
            for zone in (sketch.demolition_zones or []):
                mt = zone.material_type or "unknown"
                st = getattr(zone, "sub_type", None) or ""
                sqft = float(zone.calculated_sqft or 0)
                key = (mt, st)
                if sqft > 0:
                    demo_groups[key] = demo_groups.get(key, 0) + sqft
                # Accumulate carpet pad area
                if mt == "carpet" and zone.include_pad and sqft > 0:
                    carpet_pad_sqft += sqft
                # Accumulate insulation area (from wall/ceiling checkbox)
                if getattr(zone, "include_insulation", False) and sqft > 0:
                    insulation_sqft += sqft

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
                elif material_type in self._WALL_MATERIAL_IDS and sub_type:
                    st_name = self._WALL_MATERIAL_SUB_TYPE_NAMES.get(
                        sub_type, sub_type,
                    )
                    name = f"{base_name} ({st_name})"
                else:
                    name = base_name
                unit = self._DEMOLITION_MATERIAL_UNITS.get(
                    material_type, "SF",
                )
                item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name=name,
                    quantity=Decimal(str(round(total_qty, 2))),
                    unit=unit,
                    include_in_debris=True,
                    display_order=item_order,
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
                pad_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Carpet Pad",
                    quantity=Decimal(str(round(carpet_pad_sqft, 2))),
                    unit="SF",
                    include_in_debris=True,
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
                ins_item = WMScopeItem(
                    location_id=location.id,
                    item_type="demolition",
                    name="Insulation",
                    quantity=Decimal(str(round(insulation_sqft, 2))),
                    unit="SF",
                    include_in_debris=True,
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

            # Warn if floor has no overlay data at all
            has_data = (
                len(sketch.demolition_zones or []) +
                len(sketch.equipment_placements or []) +
                len(sketch.containment_zones or []) +
                len(sketch.floor_protections or []) +
                len(sketch.content_protections or [])
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
