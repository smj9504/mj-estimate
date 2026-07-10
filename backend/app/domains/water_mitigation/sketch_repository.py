"""
Water Mitigation Sketch Repository.

Data access layer for floor sketches and all overlay child tables.
Follows the same patterns used in scope_repository.py.
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.domains.water_mitigation.sketch_models import (
    WMContainmentZone,
    WMContentManipulation,
    WMContentProtection,
    WMDemolitionZone,
    WMEquipmentPlacement,
    WMFloorProtection,
    WMFloorSketch,
)
from app.domains.water_mitigation.sketch_schemas import WMOverlayData


class SketchRepository:
    """Repository for WM Sketch operations"""

    def __init__(self, db: Session):
        self.db = db

    # =========================================================================
    # Floor Sketch CRUD
    # =========================================================================

    def get_floor_sketches_by_job(self, job_id: UUID) -> List[WMFloorSketch]:
        """Return all floor sketches for a job ordered by floor_order,
        with child overlay rows eager-loaded so callers always get
        authoritative data (not stale JSONB snapshots)."""
        query = (
            select(WMFloorSketch)
            .where(WMFloorSketch.job_id == job_id)
            .order_by(WMFloorSketch.floor_order)
            .options(
                selectinload(WMFloorSketch.demolition_zones),
                selectinload(WMFloorSketch.equipment_placements),
                selectinload(WMFloorSketch.containment_zones),
                selectinload(WMFloorSketch.floor_protections),
                selectinload(WMFloorSketch.content_protections),
                selectinload(WMFloorSketch.content_manipulations),
            )
        )
        result = self.db.execute(query)
        return list(result.scalars().all())

    def get_floor_sketch(self, floor_sketch_id: UUID) -> Optional[WMFloorSketch]:
        """Return a single floor sketch with all child overlay rows eager-loaded."""
        query = (
            select(WMFloorSketch)
            .where(WMFloorSketch.id == floor_sketch_id)
            .options(
                selectinload(WMFloorSketch.demolition_zones),
                selectinload(WMFloorSketch.equipment_placements),
                selectinload(WMFloorSketch.containment_zones),
                selectinload(WMFloorSketch.floor_protections),
                selectinload(WMFloorSketch.content_protections),
                selectinload(WMFloorSketch.content_manipulations),
            )
        )
        result = self.db.execute(query)
        return result.scalar_one_or_none()

    def create_floor_sketch(self, data: dict) -> WMFloorSketch:
        """Create a new floor sketch row."""
        sketch = WMFloorSketch(**data)
        self.db.add(sketch)
        self.db.flush()
        return sketch

    def update_floor_sketch(
        self, sketch: WMFloorSketch, data: dict
    ) -> WMFloorSketch:
        """Apply a partial dict update to a floor sketch row."""
        for key, value in data.items():
            if hasattr(sketch, key):
                setattr(sketch, key, value)
        self.db.flush()
        return sketch

    def delete_floor_sketch(self, sketch: WMFloorSketch) -> bool:
        """Delete a floor sketch (child rows cascade via FK)."""
        self.db.delete(sketch)
        self.db.flush()
        return True

    # =========================================================================
    # Overlay Data
    # =========================================================================

    def save_overlay_data(
        self,
        floor_sketch_id: UUID,
        overlay_data: WMOverlayData,
    ) -> WMFloorSketch:
        """
        Atomically replace all overlay child rows for a floor sketch.

        Execution order:
        1. Delete all existing child rows for the given floor_sketch_id.
        2. Insert new child rows from overlay_data.
        3. Serialise overlay_data to a plain dict and store in the JSONB column
           for fast single-query reads.
        4. Flush (caller commits the outer transaction).
        """
        # --- Step 1: delete existing child rows ---
        self.db.execute(
            delete(WMDemolitionZone).where(
                WMDemolitionZone.floor_sketch_id == floor_sketch_id
            )
        )
        self.db.execute(
            delete(WMEquipmentPlacement).where(
                WMEquipmentPlacement.floor_sketch_id == floor_sketch_id
            )
        )
        self.db.execute(
            delete(WMContainmentZone).where(
                WMContainmentZone.floor_sketch_id == floor_sketch_id
            )
        )
        self.db.execute(
            delete(WMFloorProtection).where(
                WMFloorProtection.floor_sketch_id == floor_sketch_id
            )
        )
        self.db.execute(
            delete(WMContentProtection).where(
                WMContentProtection.floor_sketch_id == floor_sketch_id
            )
        )
        self.db.execute(
            delete(WMContentManipulation).where(
                WMContentManipulation.floor_sketch_id == floor_sketch_id
            )
        )

        # Fields that exist only on the frontend / JSONB, not in the DB table
        _DEMO_ZONE_SKIP = {"pixel_width", "pixel_height", "polygon_points", "combined_from", "group_id", "baseboard_type"}

        # --- Step 2: insert new child rows (DB tables for relational queries) ---
        for zone_data in overlay_data.demolition_zones:
            d = {
                k: v for k, v in zone_data.dict().items()
                if k not in _DEMO_ZONE_SKIP
            }
            self.db.add(WMDemolitionZone(
                floor_sketch_id=floor_sketch_id, **d,
            ))

        for equip_data in overlay_data.equipment_placements:
            self.db.add(WMEquipmentPlacement(
                floor_sketch_id=floor_sketch_id,
                **equip_data.dict(),
            ))

        for contain_data in overlay_data.containment_zones:
            self.db.add(WMContainmentZone(
                floor_sketch_id=floor_sketch_id,
                **contain_data.dict(),
            ))

        for protect_data in overlay_data.floor_protections:
            self.db.add(WMFloorProtection(
                floor_sketch_id=floor_sketch_id,
                **protect_data.dict(),
            ))

        for content_data in overlay_data.content_protections:
            self.db.add(WMContentProtection(
                floor_sketch_id=floor_sketch_id,
                **content_data.dict(),
            ))

        for manip_data in overlay_data.content_manipulations:
            self.db.add(WMContentManipulation(
                floor_sketch_id=floor_sketch_id,
                **manip_data.dict(),
            ))

        self.db.flush()

        # --- Step 3: build JSONB snapshot directly from frontend input ---
        # This preserves ALL frontend-only fields (polygon_points, pixel_width,
        # combined_from, group_id, etc.) without fragile index-based merging.
        from decimal import Decimal as _Dec

        def _safe(v):
            """Convert Decimal / UUID to JSON-safe types, recurse into dicts/lists."""
            if isinstance(v, _Dec):
                return float(v)
            if isinstance(v, UUID):
                return str(v)
            if isinstance(v, dict):
                return {k: _safe(vv) for k, vv in v.items()}
            if isinstance(v, list):
                return [_safe(i) for i in v]
            return v

        def _pydantic_to_dict(obj):
            d = obj.dict() if hasattr(obj, 'dict') else (obj if isinstance(obj, dict) else {})
            return _safe(d)

        fsi = str(floor_sketch_id)
        snapshot = {
            "demolition_zones": [
                {**_pydantic_to_dict(z), "floor_sketch_id": fsi}
                for z in overlay_data.demolition_zones
            ],
            "equipment_placements": [
                {**_pydantic_to_dict(e), "floor_sketch_id": fsi}
                for e in overlay_data.equipment_placements
            ],
            "containment_zones": [
                {**_pydantic_to_dict(c), "floor_sketch_id": fsi}
                for c in overlay_data.containment_zones
            ],
            "floor_protections": [
                {**_pydantic_to_dict(fp), "floor_sketch_id": fsi}
                for fp in overlay_data.floor_protections
            ],
            "content_protections": [
                {**_pydantic_to_dict(cp), "floor_sketch_id": fsi}
                for cp in overlay_data.content_protections
            ],
            "content_manipulations": [
                {**_pydantic_to_dict(cm), "floor_sketch_id": fsi}
                for cm in (overlay_data.content_manipulations or [])
            ],
            "text_annotations": [
                {**_pydantic_to_dict(ta), "floor_sketch_id": fsi}
                for ta in (overlay_data.text_annotations or [])
            ],
            "shapes": [
                {**_pydantic_to_dict(s), "floor_sketch_id": fsi}
                for s in (overlay_data.shapes or [])
            ],
            "walls": [
                {**_pydantic_to_dict(w), "floor_sketch_id": fsi}
                for w in (overlay_data.walls or [])
            ],
            "rooms": [
                {**_pydantic_to_dict(r), "floor_sketch_id": fsi}
                for r in (overlay_data.rooms or [])
            ],
        }
        if overlay_data.element_order:
            snapshot["element_order"] = overlay_data.element_order
        if overlay_data.bg_offset_x is not None:
            snapshot["bg_offset_x"] = overlay_data.bg_offset_x
        if overlay_data.bg_offset_y is not None:
            snapshot["bg_offset_y"] = overlay_data.bg_offset_y

        sketch = self.db.execute(
            select(WMFloorSketch)
            .where(WMFloorSketch.id == floor_sketch_id)
            .options(
                selectinload(WMFloorSketch.demolition_zones),
                selectinload(WMFloorSketch.equipment_placements),
                selectinload(WMFloorSketch.containment_zones),
                selectinload(WMFloorSketch.floor_protections),
                selectinload(WMFloorSketch.content_protections),
                selectinload(WMFloorSketch.content_manipulations),
            )
        ).scalar_one_or_none()
        if sketch is None:
            raise ValueError(f"Floor sketch {floor_sketch_id} not found")

        sketch.overlay_data = snapshot
        self.db.flush()
        return sketch

    # =========================================================================
    # Helpers
    # =========================================================================

    def get_next_floor_order(self, job_id: UUID) -> int:
        """Return the next floor_order value for a job."""
        from sqlalchemy import func as sa_func
        query = select(sa_func.max(WMFloorSketch.floor_order)).where(
            WMFloorSketch.job_id == job_id
        )
        result = self.db.execute(query)
        max_order = result.scalar()
        return (max_order or 0) + 1
