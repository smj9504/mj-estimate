"""
Template Management API for React PDF System
Allows users to register and manage PDF templates
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["templates"])

class TemplateRegistration(BaseModel):
    template_key: str
    template_path: str

class TemplateListResponse(BaseModel):
    templates: Dict[str, str]

@router.post("/register")
async def register_template(registration: TemplateRegistration):
    """Register a new template"""
    try:
        from app.common.services.template_manager import get_template_manager
        
        template_manager = get_template_manager()
        template_manager.register_template(
            registration.template_key, 
            registration.template_path
        )
        
        return {"message": f"Template '{registration.template_key}' registered successfully"}
        
    except Exception as e:
        logger.error(f"Error registering template: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/list", response_model=TemplateListResponse)
async def list_templates():
    """List all registered templates"""
    try:
        from app.common.services.template_manager import get_template_manager
        
        template_manager = get_template_manager()
        templates = template_manager.list_registered_templates()
        
        return TemplateListResponse(templates=templates)
        
    except Exception as e:
        logger.error(f"Error listing templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{template_key}")
async def remove_template(template_key: str):
    """Remove a registered template"""
    try:
        from app.common.services.template_manager import get_template_manager
        
        template_manager = get_template_manager()
        template_manager.remove_template(template_key)
        
        return {"message": f"Template '{template_key}' removed successfully"}
        
    except Exception as e:
        logger.error(f"Error removing template: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{template_key}/exists")
async def check_template_exists(template_key: str):
    """Check if a template exists"""
    try:
        from app.common.services.template_manager import get_template_manager
        
        template_manager = get_template_manager()
        exists = template_manager.template_exists(template_key)
        
        return {"template_key": template_key, "exists": exists}
        
    except Exception as e:
        logger.error(f"Error checking template: {e}")
        raise HTTPException(status_code=500, detail=str(e))