"""Business logic for Repair Specification domain."""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.repair_spec.repository import RepairSpecRepository

logger = logging.getLogger(__name__)


class RepairSpecService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = RepairSpecRepository(db)

    # ── Conditions ──

    def list_conditions(
        self,
        company_id: Optional[UUID] = None,
        category: Optional[str] = None,
    ) -> list:
        return self.repo.list_conditions(company_id=company_id, category=category)

    def get_condition(self, condition_id: UUID):
        condition = self.repo.get_condition(condition_id)
        if not condition:
            raise ValueError("Condition not found")
        return condition

    def create_condition(self, data: Dict[str, Any]):
        return self.repo.create_condition(data)

    def update_condition(self, condition_id: UUID, data: Dict[str, Any]):
        result = self.repo.update_condition(condition_id, data)
        if not result:
            raise ValueError("Condition not found")
        return result

    def delete_condition(self, condition_id: UUID) -> None:
        if not self.repo.delete_condition(condition_id):
            raise ValueError("Condition not found")

    # ── Templates ──

    def list_templates(
        self,
        company_id: Optional[UUID] = None,
        surface: Optional[str] = None,
    ) -> list:
        return self.repo.list_templates(company_id=company_id, surface=surface)

    def get_template(self, template_id: UUID):
        template = self.repo.get_template(template_id)
        if not template:
            raise ValueError("Template not found")
        return template

    def create_template(self, data: Dict[str, Any]):
        return self.repo.create_template(data)

    def update_template(self, template_id: UUID, data: Dict[str, Any]):
        result = self.repo.update_template(template_id, data)
        if not result:
            raise ValueError("Template not found")
        return result

    def delete_template(self, template_id: UUID) -> None:
        if not self.repo.delete_template(template_id):
            raise ValueError("Template not found")

    # ── Apply: condition_ids → line items ──

    def apply_template(self, template_id: UUID, condition_ids: List[UUID]) -> Dict[str, Any]:
        template = self.get_template(template_id)
        self.repo.increment_usage(template_id)

        cid_set = {str(c) for c in condition_ids}
        applied_items = []

        for item in template.items:
            if str(item.condition_id) in cid_set:
                # Look up xactimate price
                xact_info = self._lookup_xactimate(item.xactimate_item_code)
                applied_items.append({
                    "xactimate_item_code": item.xactimate_item_code,
                    "description": item.description_override or xact_info.get("description", item.xactimate_item_code),
                    "unit": item.default_unit or xact_info.get("unit"),
                    "unit_price": xact_info.get("unit_price"),
                    "condition_name": item.condition.name if item.condition else "",
                    "condition_scope": item.condition.scope if item.condition else "damaged",
                    "is_required": item.is_required,
                })

        return {
            "template_id": str(template.id),
            "template_name": template.name,
            "items": applied_items,
        }

    def _lookup_xactimate(self, item_code: str) -> Dict[str, Any]:
        """Look up latest Xactimate item info by code."""
        from app.domains.xactimate.models import XactimateItem

        row = (
            self.db.query(XactimateItem)
            .filter(XactimateItem.item_code == item_code)
            .order_by(
                XactimateItem.price_year.desc(),
                XactimateItem.price_month.desc(),
            )
            .first()
        )
        if not row:
            return {"description": item_code, "unit": None, "unit_price": None}
        return {
            "description": row.description or item_code,
            "unit": None,  # Xactimate items don't store unit directly
            "unit_price": float(row.untaxed_unit_price) if row.untaxed_unit_price else None,
        }

    # ── Compare: template items vs extraction items ──

    def compare_with_extraction(
        self,
        template_id: UUID,
        condition_ids: List[UUID],
        extraction_id: UUID,
        room_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Get template items for selected conditions
        apply_result = self.apply_template(template_id, condition_ids)
        required_items = apply_result["items"]

        # Get extraction items
        from app.domains.insurance_extraction.service import InsuranceExtractionService
        ext_service = InsuranceExtractionService(self.db)
        extraction = ext_service.get_extraction(extraction_id)
        if not extraction:
            raise ValueError("Extraction not found")

        ext_items = []
        for item in extraction.items:
            if room_name and item.room != room_name:
                continue
            ext_items.append({
                "id": str(item.id),
                "line_item": item.line_item,
                "room": item.room,
                "quantity": float(item.quantity) if item.quantity else None,
                "unit": item.unit,
                "unit_price": float(item.unit_price) if item.unit_price else None,
            })

        # Fuzzy match
        matched = []
        missing = []
        used_ext_indices = set()

        for req in required_items:
            best_idx, best_score = None, 0.0
            for i, ext in enumerate(ext_items):
                if i in used_ext_indices:
                    continue
                score = self._match_score(req["description"], ext["line_item"])
                if score > best_score:
                    best_score = score
                    best_idx = i

            if best_idx is not None and best_score >= 0.3:
                used_ext_indices.add(best_idx)
                matched.append({
                    "template_item": req,
                    "extraction_item": ext_items[best_idx],
                    "status": "ok",
                })
            else:
                missing.append(req)

        extra = [ext_items[i] for i in range(len(ext_items)) if i not in used_ext_indices]

        return {"matched": matched, "missing": missing, "extra": extra}

    @staticmethod
    def _match_score(template_desc: str, extraction_desc: str) -> float:
        """Simple keyword overlap scoring for fuzzy matching."""
        t_words = set(template_desc.lower().split())
        e_words = set(extraction_desc.lower().split())
        # Remove common stop words
        stop = {"the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "-", "&"}
        t_words -= stop
        e_words -= stop
        if not t_words or not e_words:
            return 0.0
        overlap = t_words & e_words
        return len(overlap) / max(len(t_words), len(e_words))
