from typing import List, Optional, Dict, Any
from uuid import UUID

from app.domains.template.repository import TemplateRepository
from app.domains.template.schemas import (
    TemplateCreate,
    TemplateUpdate,
    TemplateResponse,
    TemplateListResponse,
    TemplateSearchFilters,
    TemplateContentResponse
)
from app.domains.template.models import Template


class TemplateService:
    def __init__(self, repository: TemplateRepository):
        self.repository = repository

    def get_templates_by_company(
        self,
        company_id: str,
        filters: TemplateSearchFilters = None
    ) -> List[TemplateListResponse]:
        """Get all templates for a company with filtering"""
        templates = self.repository.get_by_company(company_id, filters)
        return [
            TemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=template.type,
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_templates_by_type(self, company_id: str, template_type: str) -> List[TemplateListResponse]:
        """Get templates by company and type, ordered by usage"""
        templates = self.repository.get_by_type(company_id, template_type)
        return [
            TemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=template.type,
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_quick_templates(self, company_id: str, template_type: str) -> List[TemplateListResponse]:
        """Get top 3 most used templates for quick selection"""
        templates = self.repository.get_most_used(company_id, template_type, limit=3)
        return [
            TemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=template.type,
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_template(self, template_id: str) -> Optional[TemplateResponse]:
        """Get a specific template by ID"""
        template = self.repository.get(template_id)
        if not template:
            return None

        return TemplateResponse(
            id=str(template.id),
            company_id=str(template.company_id),
            name=template.name,
            type=template.type,
            content=template.content,
            description=template.description,
            is_active=template.is_active,
            usage_count=template.usage_count,
            created_at=template.created_at,
            updated_at=template.updated_at
        )

    def create_template(
        self,
        company_id: str,
        user_id: str,
        template_data: TemplateCreate
    ) -> TemplateResponse:
        """Create a new template"""
        template_dict = template_data.model_dump()
        template_dict.update({
            "company_id": company_id,
            "created_by": user_id
        })

        template = self.repository.create(template_dict)

        return TemplateResponse(
            id=str(template.id),
            company_id=str(template.company_id),
            name=template.name,
            type=template.type,
            content=template.content,
            description=template.description,
            is_active=template.is_active,
            usage_count=template.usage_count,
            created_at=template.created_at,
            updated_at=template.updated_at
        )

    def update_template(
        self,
        template_id: str,
        company_id: str,
        update_data: TemplateUpdate
    ) -> Optional[TemplateResponse]:
        """Update an existing template"""
        template = self.repository.get(template_id)
        if not template or str(template.company_id) != company_id:
            return None

        updated_template = self.repository.update(template_id, update_data.model_dump(exclude_unset=True))

        return TemplateResponse(
            id=str(updated_template.id),
            company_id=str(updated_template.company_id),
            name=updated_template.name,
            type=updated_template.type,
            content=updated_template.content,
            description=updated_template.description,
            is_active=updated_template.is_active,
            usage_count=updated_template.usage_count,
            created_at=updated_template.created_at,
            updated_at=updated_template.updated_at
        )

    def delete_template(self, template_id: str, company_id: str) -> bool:
        """Delete a template (soft delete by setting is_active to False)"""
        template = self.repository.get(template_id)
        if not template or str(template.company_id) != company_id:
            return False

        self.repository.update(template_id, {"is_active": False})
        return True

    def use_template(
        self,
        template_id: str,
        company_id: str,
        user_id: str,
        report_id: Optional[str] = None
    ) -> Optional[TemplateContentResponse]:
        """Use a template and track usage"""
        template = self.repository.get(template_id)
        if not template or str(template.company_id) != company_id or not template.is_active:
            return None

        # Increment usage count
        self.repository.increment_usage_count(template_id)

        # Log usage for analytics
        self.repository.log_template_usage(template_id, user_id, report_id)

        return TemplateContentResponse(
            content=template.content,
            template_id=str(template.id),
            template_name=template.name
        )

    def duplicate_template(
        self,
        template_id: str,
        company_id: str,
        new_name: str
    ) -> Optional[TemplateResponse]:
        """Duplicate an existing template"""
        template = self.repository.get(template_id)
        if not template or str(template.company_id) != company_id:
            return None

        new_template = self.repository.duplicate_template(template_id, new_name)
        if not new_template:
            return None

        return TemplateResponse(
            id=str(new_template.id),
            company_id=str(new_template.company_id),
            name=new_template.name,
            type=new_template.type,
            content=new_template.content,
            description=new_template.description,
            is_active=new_template.is_active,
            usage_count=new_template.usage_count,
            created_at=new_template.created_at,
            updated_at=new_template.updated_at
        )

    def get_usage_statistics(self, company_id: str) -> Dict[str, Any]:
        """Get template usage statistics for a company"""
        return self.repository.get_usage_stats(company_id)