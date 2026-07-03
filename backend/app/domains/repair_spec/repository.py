"""Data access layer for Repair Specification domain."""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.domains.repair_spec.models import (
    RepairCondition,
    RepairConditionSuggestion,
    RepairTemplate,
    RepairTemplateCondition,
    RepairTemplateItem,
)

logger = logging.getLogger(__name__)


class RepairSpecRepository:
    def __init__(self, db: Session):
        self.db = db

    # ── Conditions ──

    def list_conditions(
        self,
        company_id: Optional[UUID] = None,
        category: Optional[str] = None,
        active_only: bool = True,
    ) -> List[RepairCondition]:
        q = self.db.query(RepairCondition)
        if company_id:
            q = q.filter(
                or_(
                    RepairCondition.company_id == str(company_id),
                    RepairCondition.company_id.is_(None),
                )
            )
        else:
            q = q.filter(RepairCondition.company_id.is_(None))
        if category:
            q = q.filter(RepairCondition.category == category)
        if active_only:
            q = q.filter(RepairCondition.is_active.is_(True))
        return q.order_by(RepairCondition.sort_order, RepairCondition.name).all()

    def get_condition(self, condition_id: UUID) -> Optional[RepairCondition]:
        return self.db.query(RepairCondition).filter(RepairCondition.id == str(condition_id)).first()

    def create_condition(self, data: Dict[str, Any]) -> RepairCondition:
        condition = RepairCondition(**data)
        self.db.add(condition)
        self.db.flush()
        return condition

    def update_condition(self, condition_id: UUID, data: Dict[str, Any]) -> Optional[RepairCondition]:
        condition = self.get_condition(condition_id)
        if not condition:
            return None
        for k, v in data.items():
            if v is not None:
                setattr(condition, k, v)
        self.db.flush()
        return condition

    def delete_condition(self, condition_id: UUID) -> bool:
        condition = self.get_condition(condition_id)
        if not condition:
            return False
        self.db.delete(condition)
        self.db.flush()
        return True

    # ── Templates ──

    def list_templates(
        self,
        company_id: Optional[UUID] = None,
        surface: Optional[str] = None,
        active_only: bool = True,
    ) -> List[RepairTemplate]:
        q = self.db.query(RepairTemplate)
        if company_id:
            q = q.filter(
                or_(
                    RepairTemplate.company_id == str(company_id),
                    RepairTemplate.company_id.is_(None),
                )
            )
        else:
            q = q.filter(RepairTemplate.company_id.is_(None))
        if surface:
            q = q.filter(RepairTemplate.surface == surface)
        if active_only:
            q = q.filter(RepairTemplate.is_active.is_(True))
        return q.order_by(RepairTemplate.name).all()

    def get_template(self, template_id: UUID) -> Optional[RepairTemplate]:
        return (
            self.db.query(RepairTemplate)
            .options(
                joinedload(RepairTemplate.template_conditions).joinedload(
                    RepairTemplateCondition.condition
                ),
                joinedload(RepairTemplate.items).joinedload(RepairTemplateItem.condition),
                joinedload(RepairTemplate.suggestions).joinedload(
                    RepairConditionSuggestion.from_condition
                ),
                joinedload(RepairTemplate.suggestions).joinedload(
                    RepairConditionSuggestion.to_condition
                ),
            )
            .filter(RepairTemplate.id == str(template_id))
            .first()
        )

    def create_template(self, data: Dict[str, Any]) -> RepairTemplate:
        conditions_data = data.pop("conditions", [])
        items_data = data.pop("items", [])
        suggestions_data = data.pop("suggestions", [])

        template = RepairTemplate(**data)
        self.db.add(template)
        self.db.flush()

        for c in conditions_data:
            self.db.add(
                RepairTemplateCondition(
                    template_id=template.id,
                    condition_id=str(c["condition_id"]),
                    sort_order=c.get("sort_order", 0),
                )
            )

        for item in items_data:
            self.db.add(
                RepairTemplateItem(
                    template_id=template.id,
                    condition_id=str(item["condition_id"]),
                    xactimate_item_code=item["xactimate_item_code"],
                    description_override=item.get("description_override"),
                    default_unit=item.get("default_unit"),
                    is_required=item.get("is_required", True),
                    sort_order=item.get("sort_order", 0),
                )
            )

        for s in suggestions_data:
            self.db.add(
                RepairConditionSuggestion(
                    template_id=template.id,
                    from_condition_id=str(s["from_condition_id"]),
                    to_condition_id=str(s["to_condition_id"]),
                )
            )

        self.db.flush()
        return self.get_template(template.id)

    def update_template(self, template_id: UUID, data: Dict[str, Any]) -> Optional[RepairTemplate]:
        template = self.get_template(template_id)
        if not template:
            return None

        conditions_data = data.pop("conditions", None)
        items_data = data.pop("items", None)
        suggestions_data = data.pop("suggestions", None)

        for k, v in data.items():
            if v is not None:
                setattr(template, k, v)

        if conditions_data is not None:
            self.db.query(RepairTemplateCondition).filter(
                RepairTemplateCondition.template_id == str(template_id)
            ).delete()
            for c in conditions_data:
                self.db.add(
                    RepairTemplateCondition(
                        template_id=str(template_id),
                        condition_id=str(c["condition_id"]),
                        sort_order=c.get("sort_order", 0),
                    )
                )

        if items_data is not None:
            self.db.query(RepairTemplateItem).filter(
                RepairTemplateItem.template_id == str(template_id)
            ).delete()
            for item in items_data:
                self.db.add(
                    RepairTemplateItem(
                        template_id=str(template_id),
                        condition_id=str(item["condition_id"]),
                        xactimate_item_code=item["xactimate_item_code"],
                        description_override=item.get("description_override"),
                        default_unit=item.get("default_unit"),
                        is_required=item.get("is_required", True),
                        sort_order=item.get("sort_order", 0),
                    )
                )

        if suggestions_data is not None:
            self.db.query(RepairConditionSuggestion).filter(
                RepairConditionSuggestion.template_id == str(template_id)
            ).delete()
            for s in suggestions_data:
                self.db.add(
                    RepairConditionSuggestion(
                        template_id=str(template_id),
                        from_condition_id=str(s["from_condition_id"]),
                        to_condition_id=str(s["to_condition_id"]),
                    )
                )

        self.db.flush()
        return self.get_template(template_id)

    def delete_template(self, template_id: UUID) -> bool:
        template = self.db.query(RepairTemplate).filter(
            RepairTemplate.id == str(template_id)
        ).first()
        if not template:
            return False
        self.db.delete(template)
        self.db.flush()
        return True

    def increment_usage(self, template_id: UUID) -> None:
        self.db.query(RepairTemplate).filter(
            RepairTemplate.id == str(template_id)
        ).update({"usage_count": RepairTemplate.usage_count + 1})
        self.db.flush()
