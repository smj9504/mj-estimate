from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database_factory import get_db_session as get_db
from app.domains.plumber_report.templates.service import PlumberReportTemplateService
from app.domains.plumber_report.templates.schemas import (
    PlumberReportTemplateCreate,
    PlumberReportTemplateUpdate,
    PlumberReportTemplateResponse,
    PlumberReportTemplateListResponse,
    PlumberReportTemplateSearchFilters,
    PlumberReportTemplateContentResponse,
    PlumberReportTemplateType
)

router = APIRouter(prefix="/plumber-report-templates", tags=["plumber-report-templates"])


def get_template_service(db: Session = Depends(get_db)) -> PlumberReportTemplateService:
    return PlumberReportTemplateService(db)


@router.get("/", response_model=List[PlumberReportTemplateListResponse])
async def get_templates(
    company_id: str = Query(..., description="Company ID"),
    template_type: Optional[PlumberReportTemplateType] = Query(None, description="Filter by template type"),
    search: Optional[str] = Query(None, description="Search in name and description"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    sort_by: Optional[str] = Query("name", description="Sort by field"),
    sort_order: Optional[str] = Query("asc", description="Sort order"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Get all plumber report templates for a company with filtering and sorting"""
    filters = PlumberReportTemplateSearchFilters(
        type=template_type,
        search=search,
        is_active=is_active,
        sort_by=sort_by,
        sort_order=sort_order
    )
    return service.get_templates_by_company(company_id, filters)


@router.get("/by-type/{template_type}", response_model=List[PlumberReportTemplateListResponse])
async def get_templates_by_type(
    template_type: PlumberReportTemplateType,
    company_id: str = Query(..., description="Company ID"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Get plumber report templates by type, ordered by usage count"""
    return service.get_templates_by_type(company_id, template_type.value)


@router.get("/quick/{template_type}", response_model=List[PlumberReportTemplateListResponse])
async def get_quick_templates(
    template_type: PlumberReportTemplateType,
    company_id: str = Query(..., description="Company ID"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Get top 3 most used templates for quick selection in plumber reports"""
    return service.get_quick_templates(company_id, template_type.value)


@router.get("/{template_id}", response_model=PlumberReportTemplateResponse)
async def get_template(
    template_id: str,
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Get a specific plumber report template by ID"""
    template = service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("/", response_model=PlumberReportTemplateResponse)
async def create_template(
    template_data: PlumberReportTemplateCreate,
    company_id: str = Query(..., description="Company ID"),
    user_id: str = Query(..., description="User ID creating the template"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Create a new plumber report template"""
    return service.create_template(company_id, user_id, template_data)


@router.put("/{template_id}", response_model=PlumberReportTemplateResponse)
async def update_template(
    template_id: str,
    update_data: PlumberReportTemplateUpdate,
    company_id: str = Query(..., description="Company ID"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Update an existing plumber report template"""
    template = service.update_template(template_id, company_id, update_data)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or access denied")
    return template


@router.delete("/{template_id}")
async def delete_template(
    template_id: str,
    company_id: str = Query(..., description="Company ID"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Delete a plumber report template (soft delete)"""
    success = service.delete_template(template_id, company_id)
    if not success:
        raise HTTPException(status_code=404, detail="Template not found or access denied")
    return {"message": "Template deleted successfully"}


@router.post("/{template_id}/use", response_model=PlumberReportTemplateContentResponse)
async def use_template(
    template_id: str,
    company_id: str = Query(..., description="Company ID"),
    user_id: str = Query(..., description="User ID using the template"),
    report_id: Optional[str] = Query(None, description="Plumber Report ID (optional)"),
    service: PlumberReportTemplateService = Depends(get_template_service)
):
    """Use a plumber report template and return its content (tracks usage)"""
    result = service.use_template(template_id, company_id, user_id, report_id)
    if not result:
        raise HTTPException(status_code=404, detail="Template not found or inactive")
    return result