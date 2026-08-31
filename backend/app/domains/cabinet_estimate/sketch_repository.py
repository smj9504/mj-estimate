"""
Cabinet Estimate Sketch Repository.

No child tables — walls and cabinets live only in the overlay_data JSONB
column, so saving is a single-column upsert rather than the
delete-then-reinsert pattern WM's child-table overlays need.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.domains.cabinet_estimate.sketch_models import CabinetSketch
from app.domains.cabinet_estimate.sketch_schemas import CabinetSketchOverlayData

EMPTY_OVERLAY = {"walls": [], "cabinets": [], "element_order": []}


class CabinetSketchRepository:
    """Repository for Cabinet Sketch operations"""

    def __init__(self, db: Session):
        self.db = db

    def get_by_estimate(self, estimate_id: UUID) -> Optional[CabinetSketch]:
        return self.db.execute(
            select(CabinetSketch).where(CabinetSketch.estimate_id == estimate_id)
        ).scalar_one_or_none()

    def get_or_create(self, estimate_id: UUID) -> CabinetSketch:
        sketch = self.get_by_estimate(estimate_id)
        if sketch is None:
            sketch = CabinetSketch(
                estimate_id=estimate_id,
                overlay_data=dict(EMPTY_OVERLAY),
            )
            self.db.add(sketch)
            self.db.flush()
        return sketch

    def save_overlay(
        self, estimate_id: UUID, overlay: CabinetSketchOverlayData
    ) -> CabinetSketch:
        sketch = self.get_or_create(estimate_id)
        sketch.overlay_data = overlay.model_dump()
        flag_modified(sketch, "overlay_data")
        self.db.flush()
        return sketch

    def update_canvas_meta(self, estimate_id: UUID, **fields) -> CabinetSketch:
        sketch = self.get_or_create(estimate_id)
        for key, value in fields.items():
            if value is not None and hasattr(sketch, key):
                setattr(sketch, key, value)
        self.db.flush()
        return sketch
