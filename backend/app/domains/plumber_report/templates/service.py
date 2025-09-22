from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc, asc, func

from app.domains.plumber_report.templates.models import PlumberReportTemplate, PlumberReportTemplateUsage
from app.domains.plumber_report.templates.schemas import (
    PlumberReportTemplateCreate,
    PlumberReportTemplateUpdate,
    PlumberReportTemplateResponse,
    PlumberReportTemplateListResponse,
    PlumberReportTemplateSearchFilters,
    PlumberReportTemplateContentResponse,
    PlumberReportTemplateType
)


class PlumberReportTemplateService:
    def __init__(self, db: Session):
        self.db = db

    def get_templates_by_company(
        self,
        company_id: str,
        filters: PlumberReportTemplateSearchFilters = None
    ) -> List[PlumberReportTemplateListResponse]:
        """Get all templates for a company with filtering"""
        query = self.db.query(PlumberReportTemplate).filter(
            PlumberReportTemplate.company_id == company_id
        )

        if filters:
            # Filter by type
            if filters.type:
                query = query.filter(PlumberReportTemplate.type == filters.type.value)

            # Filter by active status
            if filters.is_active is not None:
                query = query.filter(PlumberReportTemplate.is_active == filters.is_active)

            # Search by name or description
            if filters.search:
                search_term = f"%{filters.search.lower()}%"
                query = query.filter(
                    or_(
                        func.lower(PlumberReportTemplate.name).like(search_term),
                        func.lower(PlumberReportTemplate.description).like(search_term)
                    )
                )

            # Apply sorting
            if filters.sort_by and filters.sort_order:
                sort_column = getattr(PlumberReportTemplate, filters.sort_by, PlumberReportTemplate.name)
                if filters.sort_order.lower() == "desc":
                    query = query.order_by(desc(sort_column))
                else:
                    query = query.order_by(asc(sort_column))
            else:
                query = query.order_by(PlumberReportTemplate.name)

        templates = query.all()
        return [
            PlumberReportTemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=PlumberReportTemplateType(template.type),
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_templates_by_type(self, company_id: str, template_type: str) -> List[PlumberReportTemplateListResponse]:
        """Get templates by company and type, ordered by usage"""
        templates = self.db.query(PlumberReportTemplate).filter(
            and_(
                PlumberReportTemplate.company_id == company_id,
                PlumberReportTemplate.type == template_type,
                PlumberReportTemplate.is_active == True
            )
        ).order_by(desc(PlumberReportTemplate.usage_count), PlumberReportTemplate.name).all()

        return [
            PlumberReportTemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=PlumberReportTemplateType(template.type),
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_quick_templates(self, company_id: str, template_type: str, limit: int = 3) -> List[PlumberReportTemplateListResponse]:
        """Get top 3 most used templates for quick selection"""
        templates = self.db.query(PlumberReportTemplate).filter(
            and_(
                PlumberReportTemplate.company_id == company_id,
                PlumberReportTemplate.type == template_type,
                PlumberReportTemplate.is_active == True
            )
        ).order_by(desc(PlumberReportTemplate.usage_count)).limit(limit).all()

        return [
            PlumberReportTemplateListResponse(
                id=str(template.id),
                name=template.name,
                type=PlumberReportTemplateType(template.type),
                description=template.description,
                usage_count=template.usage_count,
                updated_at=template.updated_at
            )
            for template in templates
        ]

    def get_template(self, template_id: str) -> Optional[PlumberReportTemplateResponse]:
        """Get a specific template by ID"""
        template = self.db.query(PlumberReportTemplate).filter(
            PlumberReportTemplate.id == template_id
        ).first()

        if not template:
            return None

        return PlumberReportTemplateResponse(
            id=str(template.id),
            company_id=str(template.company_id),
            name=template.name,
            type=PlumberReportTemplateType(template.type),
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
        template_data: PlumberReportTemplateCreate
    ) -> PlumberReportTemplateResponse:
        """Create a new template"""
        template = PlumberReportTemplate(
            company_id=company_id,
            name=template_data.name,
            type=template_data.type.value,
            content=template_data.content,
            description=template_data.description,
            created_by=user_id
        )

        self.db.add(template)
        self.db.commit()
        self.db.refresh(template)

        return PlumberReportTemplateResponse(
            id=str(template.id),
            company_id=str(template.company_id),
            name=template.name,
            type=PlumberReportTemplateType(template.type),
            content=template.content,
            description=template.description,
            is_active=template.is_active,
            usage_count=template.usage_count,
            created_at=template.created_at,
            updated_at=template.updated_at
        )

    def use_template(
        self,
        template_id: str,
        company_id: str,
        user_id: str,
        report_id: Optional[str] = None
    ) -> Optional[PlumberReportTemplateContentResponse]:
        """Use a template and track usage"""
        template = self.db.query(PlumberReportTemplate).filter(
            and_(
                PlumberReportTemplate.id == template_id,
                PlumberReportTemplate.company_id == company_id,
                PlumberReportTemplate.is_active == True
            )
        ).first()

        if not template:
            return None

        # Increment usage count
        template.usage_count += 1

        # Log usage for analytics
        usage_log = PlumberReportTemplateUsage(
            template_id=template_id,
            used_by=user_id,
            report_id=report_id
        )
        self.db.add(usage_log)
        self.db.commit()

        return PlumberReportTemplateContentResponse(
            content=template.content,
            template_id=str(template.id),
            template_name=template.name
        )

    def update_template(
        self,
        template_id: str,
        company_id: str,
        update_data: PlumberReportTemplateUpdate
    ) -> Optional[PlumberReportTemplateResponse]:
        """Update an existing template"""
        template = self.db.query(PlumberReportTemplate).filter(
            and_(
                PlumberReportTemplate.id == template_id,
                PlumberReportTemplate.company_id == company_id
            )
        ).first()

        if not template:
            return None

        # Update fields
        update_dict = update_data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(template, field, value)

        self.db.commit()
        self.db.refresh(template)

        return PlumberReportTemplateResponse(
            id=str(template.id),
            company_id=str(template.company_id),
            name=template.name,
            type=PlumberReportTemplateType(template.type),
            content=template.content,
            description=template.description,
            is_active=template.is_active,
            usage_count=template.usage_count,
            created_at=template.created_at,
            updated_at=template.updated_at
        )

    def delete_template(self, template_id: str, company_id: str) -> bool:
        """Delete a template (soft delete by setting is_active to False)"""
        template = self.db.query(PlumberReportTemplate).filter(
            and_(
                PlumberReportTemplate.id == template_id,
                PlumberReportTemplate.company_id == company_id
            )
        ).first()

        if not template:
            return False

        template.is_active = False
        self.db.commit()
        return True