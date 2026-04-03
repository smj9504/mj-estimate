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
        """Return all floor sketches for a job ordered by floor_order."""
        query = (
            select(WMFloorSketch)
            .where(WMFloorSketch.job_id == job_id)
            .order_by(WMFloorSketch.floor_order)
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

        # --- Step 2: insert new child rows ---
        for zone_data in overlay_data.demolition_zones:
            zone = WMDemolitionZone(
                floor_sketch_id=floor_sketch_id,
                **zone_data.dict(),
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

        # --- Step 3: flush to assign IDs, then build JSONB snapshot ---
        self.db.flush()

        query = (
            select(WMFloorSketch)
            .where(WMFloorSketch.id == floor_sketch_id)
            .options(
                selectinload(WMFloorSketch.demolition_zones),
                selectinload(WMFloorSketch.equipment_placements),
                selectinload(WMFloorSketch.containment_zones),
                selectinload(WMFloorSketch.floor_protections),
            )
        )
        sketch = self.db.execute(query).scalar_one_or_none()
        if sketch is None:
            raise ValueError(
                f"Floor sketch {floor_sketch_id} not found"
            )

        import json
        from decimal import Decimal

        def _default(obj):
            if isinstance(obj, Decimal):
                return float(obj)
            if isinstance(obj, UUID):
                return str(obj)
            raise TypeError

        # Build JSONB from actual DB records so IDs are included
        snapshot = {
            "demolition_zones": [
                {
                    "id": str(z.id),
                    "floor_sketch_id": str(z.floor_sketch_id),
                    "material_type": z.material_type,
                    "surface": z.surface,
                    "color": z.color,
                    "x": z.x,
                    "y": z.y,
                    "dimension1_ft": float(z.dimension1_ft) if z.dimension1_ft else 0,
                    "dimension2_ft": float(z.dimension2_ft) if z.dimension2_ft else 0,
                    "rotation": z.rotation,
                    "calculated_sqft": float(z.calculated_sqft) if z.calculated_sqft else 0,
                    "label": z.label,
                    "display_order": z.display_order,
                    "scope_item_id": str(z.scope_item_id) if z.scope_item_id else None,
                }
                for z in sketch.demolition_zones
            ],
            "equipment_placements": [
                {
                    "id": str(e.id),
                    "floor_sketch_id": str(e.floor_sketch_id),
                    "equipment_type": e.equipment_type,
                    "x": e.x,
                    "y": e.y,
                    "icon_shape": e.icon_shape,
                    "color": e.color,
                    "label": e.label,
                }
                for e in sketch.equipment_placements
            ],
            "containment_zones": [
                {
                    "id": str(c.id),
                    "floor_sketch_id": str(c.floor_sketch_id),
                    "containment_type": c.containment_type,
                    "x": c.x,
                    "y": c.y,
                    "width_ft": float(c.width_ft) if c.width_ft else None,
                    "height_ft": float(c.height_ft) if c.height_ft else None,
                    "calculated_sqft": float(c.calculated_sqft) if c.calculated_sqft else 0,
                    "color": c.color,
                    "label": c.label,
                }
                for c in sketch.containment_zones
            ],
            "floor_protections": [
                {
                    "id": str(fp.id),
                    "floor_sketch_id": str(fp.floor_sketch_id),
                    "protection_type": fp.protection_type,
                    "paper_width_ft": fp.paper_width_ft,
                    "x": fp.x,
                    "y": fp.y,
                    "length_ft": float(fp.length_ft) if fp.length_ft else 0,
                    "rotation": fp.rotation,
                    "calculated_sqft": float(fp.calculated_sqft) if fp.calculated_sqft else 0,
                    "color": fp.color,
                }
                for fp in sketch.floor_protections
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
