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

        # Fields that exist only on the frontend / JSONB, not in the DB table
        _DEMO_ZONE_SKIP = {"pixel_width", "pixel_height"}

        # --- Step 2: insert new child rows ---
        for zone_data in overlay_data.demolition_zones:
            d = {
                k: v for k, v in zone_data.dict().items()
                if k not in _DEMO_ZONE_SKIP
            }
            zone = WMDemolitionZone(
                floor_sketch_id=floor_sketch_id,
                **d,
            )
            self.db.add(zone)

        for equip_data in overlay_data.equipment_placements:
            equip = WMEquipmentPlacement(
                floor_sketch_id=floor_sketch_id,
                **equip_data.dict(),
            )
            self.db.add(equip)

        for contain_data in overlay_data.containment_zones:
            contain = WMContainmentZone(
                floor_sketch_id=floor_sketch_id,
                **contain_data.dict(),
            )
            self.db.add(contain)

        for protect_data in overlay_data.floor_protections:
            protect = WMFloorProtection(
                floor_sketch_id=floor_sketch_id,
                **protect_data.dict(),
            )
            self.db.add(protect)

        for content_data in overlay_data.content_protections:
            content = WMContentProtection(
                floor_sketch_id=floor_sketch_id,
                **content_data.dict(),
            )
            self.db.add(content)

        # --- Step 3: flush to assign IDs, then build JSONB snapshot ---
        self.db.flush()

        # Expire all cached objects so selectinload re-fetches the freshly
        # inserted child rows instead of returning stale relationship
        # collections from the identity map.
        self.db.expire_all()

        sketch = self.db.execute(
            select(WMFloorSketch)
            .where(WMFloorSketch.id == floor_sketch_id)
            .options(
                selectinload(WMFloorSketch.demolition_zones),
                selectinload(WMFloorSketch.equipment_placements),
                selectinload(WMFloorSketch.containment_zones),
                selectinload(WMFloorSketch.floor_protections),
                selectinload(WMFloorSketch.content_protections),
            )
        ).scalar_one_or_none()
        if sketch is None:
            raise ValueError(
                f"Floor sketch {floor_sketch_id} not found"
            )

        # ── Helper: serialise a Pydantic model to a JSON-safe dict ──
        def _to_dict(obj):
            d = obj.dict() if hasattr(obj, 'dict') else obj
            # Convert Decimal / UUID to JSON-safe types
            from decimal import Decimal as _Dec
            out = {}
            for k, v in d.items():
                if isinstance(v, _Dec):
                    out[k] = float(v)
                elif isinstance(v, UUID):
                    out[k] = str(v)
                else:
                    out[k] = v
            return out

        # ── Build JSONB snapshot ──
        # DB child records provide server-generated IDs.
        # Frontend input (overlay_data) provides pixel_width/height
        # and other canvas-only fields.
        # We merge both: DB record + frontend extras.
        def _merge_demo(db_z, idx):
            """Merge DB record with frontend overlay_data."""
            base = {
                "id": str(db_z.id),
                "floor_sketch_id": str(db_z.floor_sketch_id),
                "material_type": db_z.material_type,
                "sub_type": db_z.sub_type,
                "surface": db_z.surface,
                "color": db_z.color,
                "x": float(db_z.x),
                "y": float(db_z.y),
                "dimension1_ft": float(
                    db_z.dimension1_ft
                ) if db_z.dimension1_ft else 0,
                "dimension2_ft": float(
                    db_z.dimension2_ft
                ) if db_z.dimension2_ft else 0,
                "rotation": float(db_z.rotation or 0),
                "calculated_sqft": float(
                    db_z.calculated_sqft
                ) if db_z.calculated_sqft else 0,
                "height_ft": float(
                    db_z.height_ft
                ) if db_z.height_ft else None,
                "include_pad": db_z.include_pad or False,
                "include_insulation": (
                    db_z.include_insulation or False
                ),
                "label": db_z.label,
                "display_order": db_z.display_order,
                "scope_item_id": str(
                    db_z.scope_item_id
                ) if db_z.scope_item_id else None,
            }
            # Merge pixel dimensions from frontend input
            if idx < len(overlay_data.demolition_zones):
                src = overlay_data.demolition_zones[idx]
                pw = getattr(src, 'pixel_width', None)
                ph = getattr(src, 'pixel_height', None)
                if pw:
                    base["pixel_width"] = float(pw)
                if ph:
                    base["pixel_height"] = float(ph)
            return base

        def _equip_dict(e):
            return {
                "id": str(e.id),
                "floor_sketch_id": str(e.floor_sketch_id),
                "equipment_type": e.equipment_type,
                "x": float(e.x),
                "y": float(e.y),
                "icon_shape": e.icon_shape,
                "color": e.color,
                "label": e.label,
            }

        def _contain_dict(c):
            return {
                "id": str(c.id),
                "floor_sketch_id": str(c.floor_sketch_id),
                "containment_type": c.containment_type,
                "x": float(c.x),
                "y": float(c.y),
                "length_ft": float(
                    c.length_ft
                ) if c.length_ft else 0,
                "height_ft": float(
                    c.height_ft
                ) if c.height_ft else 0,
                "rotation": float(c.rotation or 0),
                "calculated_sqft": float(
                    c.calculated_sqft
                ) if c.calculated_sqft else 0,
                "color": c.color,
                "label": c.label,
                "zipper_count": (
                    c.zipper_count if hasattr(c, 'zipper_count')
                    else 0
                ),
            }

        def _fp_dict(fp):
            return {
                "id": str(fp.id),
                "floor_sketch_id": str(fp.floor_sketch_id),
                "protection_type": fp.protection_type,
                "paper_width_ft": float(fp.paper_width_ft),
                "x": float(fp.x),
                "y": float(fp.y),
                "length_ft": float(
                    fp.length_ft
                ) if fp.length_ft else 0,
                "rotation": float(fp.rotation or 0),
                "calculated_sqft": float(
                    fp.calculated_sqft
                ) if fp.calculated_sqft else 0,
                "color": fp.color,
            }

        def _cp_dict(cp):
            return {
                "id": str(cp.id),
                "floor_sketch_id": str(cp.floor_sketch_id),
                "protection_type": cp.protection_type,
                "x": float(cp.x),
                "y": float(cp.y),
                "width_ft": float(
                    cp.width_ft
                ) if cp.width_ft else 0,
                "length_ft": float(
                    cp.length_ft
                ) if cp.length_ft else 0,
                "rotation": float(cp.rotation or 0),
                "calculated_sqft": float(
                    cp.calculated_sqft
                ) if cp.calculated_sqft else 0,
                "color": cp.color,
            }

        snapshot = {
            "demolition_zones": [
                _merge_demo(z, i)
                for i, z in enumerate(sketch.demolition_zones)
            ],
            "equipment_placements": [
                _equip_dict(e)
                for e in sketch.equipment_placements
            ],
            "containment_zones": [
                _contain_dict(c)
                for c in sketch.containment_zones
            ],
            "floor_protections": [
                _fp_dict(fp)
                for fp in sketch.floor_protections
            ],
            "content_protections": [
                _cp_dict(cp)
                for cp in sketch.content_protections
            ],
            "text_annotations": [
                _to_dict(ta)
                for ta in (overlay_data.text_annotations or [])
            ],
            "shapes": [
                _to_dict(s)
                for s in (overlay_data.shapes or [])
            ],
            "walls": [
                _to_dict(w)
                for w in (overlay_data.walls or [])
            ],
            "rooms": [
                r.dict() if hasattr(r, 'dict') else r
                for r in (overlay_data.rooms or [])
            ],
        }
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
