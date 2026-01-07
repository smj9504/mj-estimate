"""
Water Mitigation Report Template API endpoints
"""

import logging
import math
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database_factory import get_db_session
from app.core.interfaces import DatabaseSession

from .schemas import (
    CreateConfigFromTemplateRequest,
    ReportConfigResponse,
    ReportTemplateBrief,
    ReportTemplateCloneRequest,
    ReportTemplateCreate,
    ReportTemplateListResponse,
    ReportTemplateResponse,
    ReportTemplateUpdate,
    TemplateSectionCreate,
    TemplateSectionResponse,
    TemplateSectionUpdate,
)
from .template_service import WMReportTemplateService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["Water Mitigation Templates"])


def get_template_service(db: DatabaseSession = Depends(get_db_session)) -> WMReportTemplateService:
    """Get template service instance"""
    return WMReportTemplateService(db)


# Template endpoints
@router.post("", response_model=ReportTemplateResponse)
def create_template(
    template: ReportTemplateCreate,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create new report template with sections

    Creates a new template that can be reused for multiple reports.
    Optionally include initial sections.
    """
    try:
        created_template = service.create_template(template)
        db.commit()
        return created_template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create template: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=ReportTemplateListResponse)
def list_templates(
    template_type: Optional[str] = Query(None, description="Filter by template type"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    service: WMReportTemplateService = Depends(get_template_service)
):
    """List all report templates with pagination

    Returns templates with their sections included.
    """
    try:
        templates, total = service.list_templates(
            template_type=template_type,
            company_id=company_id,
            is_active=is_active,
            page=page,
            page_size=page_size
        )

        total_pages = math.ceil(total / page_size) if total > 0 else 0

        return {
            'items': templates,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages
        }
    except Exception as e:
        logger.error(f"Failed to list templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/default", response_model=ReportTemplateResponse)
def get_default_template(
    template_type: str = Query("photo_report", description="Template type"),
    company_id: Optional[UUID] = Query(None, description="Company ID"),
    service: WMReportTemplateService = Depends(get_template_service)
):
    """Get default template for a type

    Returns the default template for the specified type and company.
    If no company-specific default exists, returns system default.
    """
    try:
        template = service.get_default_template(
            template_type=template_type,
            company_id=company_id
        )

        if not template:
            raise HTTPException(
                status_code=404,
                detail=f"No default template found for type '{template_type}'"
            )

        return template
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get default template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{template_id}", response_model=ReportTemplateResponse)
def get_template(
    template_id: UUID,
    service: WMReportTemplateService = Depends(get_template_service)
):
    """Get template by ID with all sections"""
    template = service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return template


@router.put("/{template_id}", response_model=ReportTemplateResponse)
def update_template(
    template_id: UUID,
    template_update: ReportTemplateUpdate,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update template

    Updates template metadata. To update sections, use the section endpoints.
    """
    try:
        updated_template = service.update_template(template_id, template_update)
        if not updated_template:
            raise HTTPException(status_code=404, detail="Template not found")

        db.commit()
        return updated_template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{template_id}")
def delete_template(
    template_id: UUID,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete template

    Cascade deletes all sections associated with this template.
    """
    try:
        success = service.delete_template(template_id)
        if not success:
            raise HTTPException(status_code=404, detail="Template not found")

        db.commit()
        return {"message": "Template deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{template_id}/clone", response_model=ReportTemplateResponse)
def clone_template(
    template_id: UUID,
    request: ReportTemplateCloneRequest,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Clone/duplicate a template

    Creates a copy of the template with a new name.
    Optionally includes all sections from the original template.
    """
    try:
        cloned_template = service.clone_template(template_id, request)
        db.commit()
        return cloned_template
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to clone template: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{template_id}/create-config", response_model=ReportConfigResponse)
def create_config_from_template(
    template_id: UUID,
    job_id: UUID = Query(..., description="Job ID to create config for"),
    request: Optional[CreateConfigFromTemplateRequest] = None,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create report config from template

    Creates a new report configuration for a job based on this template.
    Automatically prefills monitoring dates based on job mitigation dates:
    - "Monitoring - Day 1" → start_date
    - "Monitoring - Day 2" → start_date + 1 day
    - "Monitoring - Day 3" → end_date

    Args:
        template_id: Template ID to use
        job_id: Job ID to create config for
        request: Optional request body with placeholder values and cover settings
    """
    try:
        # If no request body provided, create default request
        if request is None:
            from .schemas import CreateConfigFromTemplateRequest
            request = CreateConfigFromTemplateRequest(template_id=template_id)
        else:
            # Ensure template_id matches
            request.template_id = template_id

        config = service.create_config_from_template(
            job_id=job_id,
            request=request
        )

        db.commit()
        return config
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create config from template: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# Section endpoints
@router.post("/{template_id}/sections", response_model=TemplateSectionResponse)
def create_section(
    template_id: UUID,
    section: TemplateSectionCreate,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Create new section for template"""
    try:
        created_section = service.create_section(template_id, section)
        db.commit()
        return created_section
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create section: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/sections/{section_id}", response_model=TemplateSectionResponse)
def update_section(
    section_id: UUID,
    section_update: TemplateSectionUpdate,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Update template section"""
    try:
        updated_section = service.update_section(section_id, section_update)
        if not updated_section:
            raise HTTPException(status_code=404, detail="Section not found")

        db.commit()
        return updated_section
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update section: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sections/{section_id}")
def delete_section(
    section_id: UUID,
    service: WMReportTemplateService = Depends(get_template_service),
    db: DatabaseSession = Depends(get_db_session)
):
    """Delete template section"""
    try:
        success = service.delete_section(section_id)
        if not success:
            raise HTTPException(status_code=404, detail="Section not found")

        db.commit()
        return {"message": "Section deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete section: {e}")
        raise HTTPException(status_code=500, detail=str(e))
