"""
Cabinet Estimate Sketch Service.

Thin wrapper over the repository — no scope-generation/PDF/AI logic,
unlike water mitigation's sketch service, since cabinet sketch is a
lightweight optional layout aid, not a priced-line-item source.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.cabinet_estimate.sketch_models import CabinetSketch
from app.domains.cabinet_estimate.sketch_repository import CabinetSketchRepository
from app.domains.cabinet_estimate.sketch_schemas import (
    CabinetSketchOverlayData,
    CabinetSketchUpdate,
)


class CabinetSketchService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = CabinetSketchRepository(db)

    def get_or_create(self, estimate_id: UUID) -> CabinetSketch:
        return self.repository.get_or_create(estimate_id)

    def update_meta(
        self, estimate_id: UUID, data: CabinetSketchUpdate
    ) -> CabinetSketch:
        fields = data.model_dump(exclude_unset=True)
        return self.repository.update_canvas_meta(estimate_id, **fields)

    def save_overlay(
        self, estimate_id: UUID, overlay: CabinetSketchOverlayData
    ) -> CabinetSketch:
        return self.repository.save_overlay(estimate_id, overlay)
