"""
Water Mitigation Report Template Repository
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, desc

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

from .models import WMReportTemplate, WMReportTemplateSection


class WMReportTemplateRepository(SQLAlchemyRepository[WMReportTemplate, UUID]):
    """Report template repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMReportTemplate)

    def find_by_type(
        self,
        template_type: str,
        company_id: Optional[UUID] = None,
        is_active: bool = True
    ) -> List[WMReportTemplate]:
        """Find all templates by type and optionally company

        Args:
            template_type: Template type filter
            company_id: Company ID filter (None for system templates)
            is_active: Only return active templates (default: True)

        Returns:
            List of matching templates
        """
        query = self.db_session.query(WMReportTemplate).filter(
            WMReportTemplate.template_type == template_type
        )

        if is_active:
            query = query.filter(WMReportTemplate.is_active.is_(True))

        if company_id:
            query = query.filter(WMReportTemplate.company_id == company_id)

        return query.order_by(
            desc(WMReportTemplate.is_default),
            desc(WMReportTemplate.created_at)
        ).all()

    def find_default_template(
        self,
        template_type: str,
        company_id: Optional[UUID] = None
    ) -> Optional[WMReportTemplate]:
        """Find default template by type

        Args:
            template_type: Template type
            company_id: Company ID (None for system templates)

        Returns:
            Default template or None
        """
        query = self.db_session.query(WMReportTemplate).filter(
            WMReportTemplate.template_type == template_type,
            WMReportTemplate.is_default.is_(True),
            WMReportTemplate.is_active.is_(True)
        )

        if company_id:
            query = query.filter(WMReportTemplate.company_id == company_id)
        else:
            query = query.filter(WMReportTemplate.company_id.is_(None))

        return query.first()

    def find_all_paginated(
        self,
        template_type: Optional[str] = None,
        company_id: Optional[UUID] = None,
        is_active: Optional[bool] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[List[WMReportTemplate], int]:
        """Find all templates with pagination

        Args:
            template_type: Optional template type filter
            company_id: Optional company ID filter
            is_active: Optional active status filter
            page: Page number (1-indexed)
            page_size: Items per page

        Returns:
            Tuple of (templates, total_count)
        """
        query = self.db_session.query(WMReportTemplate)

        # Apply filters
        conditions = []
        if template_type:
            conditions.append(WMReportTemplate.template_type == template_type)

        if company_id:
            conditions.append(WMReportTemplate.company_id == company_id)

        if is_active is not None:
            conditions.append(WMReportTemplate.is_active == is_active)

        if conditions:
            query = query.filter(and_(*conditions))

        # Get total count
        total = query.count()

        # Apply sorting and pagination
        query = query.order_by(
            desc(WMReportTemplate.is_default),
            desc(WMReportTemplate.created_at)
        )

        offset = (page - 1) * page_size
        templates = query.offset(offset).limit(page_size).all()

        return templates, total

    def set_default_template(
        self,
        template_id: UUID,
        template_type: str,
        company_id: Optional[UUID] = None
    ) -> bool:
        """Set a template as default (and unset others)

        This ensures only one default template per type per company.

        Args:
            template_id: Template to set as default
            template_type: Template type
            company_id: Company ID (None for system templates)

        Returns:
            True if successful
        """
        # First, unset all other defaults of same type for this company
        query = self.db_session.query(WMReportTemplate).filter(
            WMReportTemplate.template_type == template_type,
            WMReportTemplate.id != template_id
        )

        if company_id:
            query = query.filter(WMReportTemplate.company_id == company_id)
        else:
            query = query.filter(WMReportTemplate.company_id.is_(None))

        query.update(
            {"is_default": False},
            synchronize_session='fetch'
        )

        # Now set the target template as default
        template = self.get_by_id(template_id)
        if template:
            template.is_default = True
            return True

        return False


class WMReportTemplateSectionRepository(SQLAlchemyRepository[WMReportTemplateSection, UUID]):
    """Report template section repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMReportTemplateSection)

    def find_by_template(self, template_id: UUID) -> List[WMReportTemplateSection]:
        """Find all sections for a template

        Args:
            template_id: Template ID

        Returns:
            List of sections ordered by display_order
        """
        return self.db_session.query(WMReportTemplateSection).filter(
            WMReportTemplateSection.template_id == template_id
        ).order_by(WMReportTemplateSection.display_order).all()

    def bulk_create_sections(
        self,
        sections_data: List[Dict[str, Any]]
    ) -> List[WMReportTemplateSection]:
        """Create multiple sections in bulk

        Args:
            sections_data: List of section data dictionaries

        Returns:
            List of created sections
        """
        sections = []
        for section_data in sections_data:
            section = WMReportTemplateSection(**section_data)
            self.db_session.add(section)
            sections.append(section)

        self.db_session.flush()
        return sections

    def delete_by_template(self, template_id: UUID) -> int:
        """Delete all sections for a template

        Args:
            template_id: Template ID

        Returns:
            Number of sections deleted
        """
        result = self.db_session.query(WMReportTemplateSection).filter(
            WMReportTemplateSection.template_id == template_id
        ).delete(synchronize_session='fetch')

        return result

    def reorder_sections(
        self,
        template_id: UUID,
        section_orders: Dict[UUID, int]
    ) -> bool:
        """Reorder sections by updating display_order

        Args:
            template_id: Template ID
            section_orders: Dict mapping section_id to new display_order

        Returns:
            True if successful
        """
        for section_id, display_order in section_orders.items():
            section = self.get_by_id(section_id)
            if section and section.template_id == template_id:
                section.display_order = display_order

        return True
