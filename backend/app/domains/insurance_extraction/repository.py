from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete, func, select
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

    def list_extractions(self, limit: int = 50) -> List[Dict[str, Any]]:
        """List extractions with item_count — does NOT load items."""
        count_sub = (
            select(func.count(InsurancePdfExtractionItem.id))
            .where(
                InsurancePdfExtractionItem.extraction_id
                == InsurancePdfExtraction.id
            )
            .correlate(InsurancePdfExtraction)
            .scalar_subquery()
            .label("item_count")
        )
        stmt = (
            select(InsurancePdfExtraction, count_sub)
            .order_by(InsurancePdfExtraction.created_at.desc())
            .limit(limit)
        )
        results = []
        for row in self.db.execute(stmt):
            extraction = row[0]
            item_count = row[1]
            results.append({
                "id": extraction.id,
                "file_id": extraction.file_id,
                "carrier": extraction.carrier,
                "status": extraction.status,
                "pages": extraction.pages,
                "item_count": item_count,
                "parser_metadata": extraction.parser_metadata or {},
                "created_at": extraction.created_at,
            })
        return results

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

    def bulk_delete_extractions(self, ids: List[UUID]) -> None:
        if not ids:
            return
        self.db.execute(
            delete(InsurancePdfExtractionItem).where(
                InsurancePdfExtractionItem.extraction_id.in_(ids)
            )
        )
        self.db.execute(
            delete(InsurancePdfExtraction).where(
                InsurancePdfExtraction.id.in_(ids)
            )
        )
        self.db.flush()
