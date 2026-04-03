from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.domains.insurance_extraction.models import (
    InsurancePdfExtraction,
    InsurancePdfExtractionItem,
)


class InsuranceExtractionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_extraction(self, payload: dict) -> InsurancePdfExtraction:
        extraction = InsurancePdfExtraction(**payload)
        self.db.add(extraction)
        self.db.flush()
        return extraction

    def bulk_create_items(self, extraction_id: UUID, items: List[dict]) -> None:
        for item in items:
            self.db.add(InsurancePdfExtractionItem(extraction_id=extraction_id, **item))
        self.db.flush()

    def get_extraction(self, extraction_id: UUID) -> Optional[InsurancePdfExtraction]:
        stmt = (
            select(InsurancePdfExtraction)
            .where(InsurancePdfExtraction.id == extraction_id)
            .options(selectinload(InsurancePdfExtraction.items))
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_extractions(self, limit: int = 50) -> List[InsurancePdfExtraction]:
        stmt = (
            select(InsurancePdfExtraction)
            .order_by(InsurancePdfExtraction.created_at.desc())
            .limit(limit)
            .options(selectinload(InsurancePdfExtraction.items))
        )
        return list(self.db.execute(stmt).scalars().all())

    def replace_items(self, extraction_id: UUID, items: List[dict]) -> None:
        self.db.execute(
            delete(InsurancePdfExtractionItem).where(
                InsurancePdfExtractionItem.extraction_id == extraction_id
            )
        )
        self.bulk_create_items(extraction_id, items)

    def delete_extraction(self, extraction: InsurancePdfExtraction) -> None:
        self.db.delete(extraction)
        self.db.flush()
