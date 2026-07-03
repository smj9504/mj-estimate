"""REST API endpoints for Repair Specification domain."""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.repair_spec.schemas import (
    ConditionSuggestionResponse,
    RepairConditionCreate,
    RepairConditionResponse,
    RepairConditionUpdate,
    RepairTemplateCreate,
    RepairTemplateDetailResponse,
    RepairTemplateListResponse,
    RepairTemplateUpdate,
    TemplateApplyRequest,
    TemplateApplyResponse,
    TemplateCompareRequest,
    TemplateCompareResponse,
)
from app.domains.repair_spec.service import RepairSpecService
from app.domains.staff.models import Staff

# ── Condition router ──

condition_router = APIRouter(tags=["Repair Conditions"])


@condition_router.get("/", response_model=List[RepairConditionResponse])
def list_conditions(
    company_id: Optional[UUID] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    return RepairSpecService(db).list_conditions(company_id=company_id, category=category)


@condition_router.get("/{condition_id}", response_model=RepairConditionResponse)
def get_condition(
    condition_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        return RepairSpecService(db).get_condition(condition_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@condition_router.post("/", response_model=RepairConditionResponse, status_code=status.HTTP_201_CREATED)
def create_condition(
    request: RepairConditionCreate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    return RepairSpecService(db).create_condition(request.model_dump())


@condition_router.put("/{condition_id}", response_model=RepairConditionResponse)
def update_condition(
    condition_id: UUID,
    request: RepairConditionUpdate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        return RepairSpecService(db).update_condition(
            condition_id, request.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@condition_router.delete("/{condition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_condition(
    condition_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        RepairSpecService(db).delete_condition(condition_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Template router ──

template_router = APIRouter(tags=["Repair Templates"])


@template_router.get("/", response_model=List[RepairTemplateListResponse])
def list_templates(
    company_id: Optional[UUID] = Query(None),
    surface: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    templates = RepairSpecService(db).list_templates(company_id=company_id, surface=surface)
    result = []
    for t in templates:
        result.append(
            RepairTemplateListResponse(
                id=t.id,
                name=t.name,
                surface=t.surface,
                description=t.description,
                tags=t.tags or [],
                is_active=t.is_active,
                company_id=t.company_id,
                usage_count=t.usage_count or 0,
                condition_count=len(t.template_conditions) if t.template_conditions else 0,
                item_count=len(t.items) if t.items else 0,
                created_at=t.created_at,
            )
        )
    return result


@template_router.get("/{template_id}", response_model=RepairTemplateDetailResponse)
def get_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        t = RepairSpecService(db).get_template(template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return RepairTemplateDetailResponse(
        id=t.id,
        name=t.name,
        surface=t.surface,
        description=t.description,
        tags=t.tags or [],
        is_active=t.is_active,
        company_id=t.company_id,
        usage_count=t.usage_count or 0,
        created_by=t.created_by,
        conditions=[tc.condition for tc in (t.template_conditions or []) if tc.condition],
        items=t.items or [],
        suggestions=t.suggestions or [],
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


@template_router.post("/", response_model=RepairTemplateDetailResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    request: RepairTemplateCreate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    data = request.model_dump()
    data["created_by"] = current_staff.id
    t = RepairSpecService(db).create_template(data)
    return get_template(t.id, db, current_staff)


@template_router.put("/{template_id}", response_model=RepairTemplateDetailResponse)
def update_template(
    template_id: UUID,
    request: RepairTemplateUpdate,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        RepairSpecService(db).update_template(
            template_id, request.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return get_template(template_id, db, current_staff)


@template_router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        RepairSpecService(db).delete_template(template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@template_router.post("/{template_id}/apply", response_model=TemplateApplyResponse)
def apply_template(
    template_id: UUID,
    request: TemplateApplyRequest,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        return RepairSpecService(db).apply_template(template_id, request.condition_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@template_router.post("/{template_id}/compare", response_model=TemplateCompareResponse)
def compare_template(
    template_id: UUID,
    request: TemplateCompareRequest,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    try:
        return RepairSpecService(db).compare_with_extraction(
            template_id,
            request.condition_ids,
            request.extraction_id,
            request.room_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
