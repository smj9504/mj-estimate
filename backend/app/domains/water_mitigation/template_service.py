"""
Water Mitigation Report Template Service Layer
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.interfaces import DatabaseSession

from .models import WMReportTemplate, WMReportTemplateSection
from .schemas import (
    CreateConfigFromTemplateRequest,
    ReportConfigCreate,
    ReportTemplateCloneRequest,
    ReportTemplateCreate,
    ReportTemplateUpdate,
    TemplateSectionCreate,
    TemplateSectionUpdate,
)
from .template_repository import (
    WMReportTemplateRepository,
    WMReportTemplateSectionRepository,
)

logger = logging.getLogger(__name__)


class WMReportTemplateService:
    """Water mitigation report template business logic"""

    def __init__(self, session: DatabaseSession):
        self.session = session
        self.template_repo = WMReportTemplateRepository(session)
        self.section_repo = WMReportTemplateSectionRepository(session)

    # Template operations
    def create_template(
        self,
        data: ReportTemplateCreate,
        created_by_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """Create new template with sections

        Args:
            data: Template creation data
            created_by_id: User ID creating the template

        Returns:
            Created template with sections
        """
        template_data = data.dict(exclude={'sections'})
        template_data['created_by_id'] = created_by_id

        # Validate only one default per type per company
        if data.is_default:
            self._ensure_single_default(
                template_type=data.template_type,
                company_id=data.company_id
            )

        # Create template
        created_template = self.template_repo.create(template_data)
        template_id = created_template.id if hasattr(created_template, 'id') else created_template['id']

        # Create sections if provided
        if data.sections:
            sections_data = []
            for idx, section in enumerate(data.sections):
                section_dict = section.dict()
                section_dict['template_id'] = template_id
                # Auto-assign display_order if not set
                if section_dict.get('display_order', 0) == 0:
                    section_dict['display_order'] = idx
                sections_data.append(section_dict)

            self.section_repo.bulk_create_sections(sections_data)

        # Fetch complete template with sections
        return self.get_template(template_id)

    def get_template(self, template_id: UUID) -> Optional[Dict[str, Any]]:
        """Get template by ID with sections

        Args:
            template_id: Template ID

        Returns:
            Template with sections or None
        """
        template = self.template_repo.get_by_id(template_id)
        if not template:
            return None

        template_dict = self.template_repo._convert_to_dict(template)

        # Add sections
        sections = self.section_repo.find_by_template(template_id)
        template_dict['sections'] = [
            self.section_repo._convert_to_dict(s) for s in sections
        ]

        return template_dict

    def list_templates(
        self,
        template_type: Optional[str] = None,
        company_id: Optional[UUID] = None,
        is_active: Optional[bool] = True,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[List[Dict[str, Any]], int]:
        """List templates with pagination

        Args:
            template_type: Optional template type filter
            company_id: Optional company ID filter
            is_active: Optional active status filter
            page: Page number
            page_size: Items per page

        Returns:
            Tuple of (templates, total_count)
        """
        templates, total = self.template_repo.find_all_paginated(
            template_type=template_type,
            company_id=company_id,
            is_active=is_active,
            page=page,
            page_size=page_size
        )

        # Convert to dicts and add sections
        template_dicts = []
        for template in templates:
            template_dict = self.template_repo._convert_to_dict(template)

            # Add sections - handle both dict and object return types
            template_id = template_dict.get('id') if isinstance(template_dict, dict) else template_dict.id
            sections = self.section_repo.find_by_template(template_id)
            template_dict['sections'] = [
                self.section_repo._convert_to_dict(s) for s in sections
            ]

            template_dicts.append(template_dict)

        return template_dicts, total

    def update_template(
        self,
        template_id: UUID,
        data: ReportTemplateUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update template

        Args:
            template_id: Template ID
            data: Update data

        Returns:
            Updated template or None
        """
        template = self.template_repo.get_by_id(template_id)
        if not template:
            return None

        update_data = data.dict(exclude_unset=True)

        # Extract sections before updating template (sections is not a template field)
        sections_data = update_data.pop('sections', None)

        # If setting as default, ensure only one default per type per company
        if update_data.get('is_default'):
            # Handle both dict and object return types from get_by_id
            template_type = template['template_type'] if isinstance(template, dict) else template.template_type
            company_id = template['company_id'] if isinstance(template, dict) else template.company_id

            self._ensure_single_default(
                template_type=template_type,
                company_id=company_id,
                exclude_template_id=template_id
            )

        # Update template fields (if any)
        if update_data:
            self.template_repo.update(template_id, update_data)

        # Update sections if provided (replace all sections)
        if sections_data is not None:
            # Delete existing sections
            existing_sections = self.section_repo.find_by_template(template_id)
            for section in existing_sections:
                section_id = section['id'] if isinstance(section, dict) else section.id
                self.section_repo.delete(section_id)

            # Create new sections
            for idx, section in enumerate(sections_data):
                section_dict = section if isinstance(section, dict) else section.dict()
                section_dict['template_id'] = template_id
                section_dict['display_order'] = idx
                # Map 'layout' to 'photo_layout' if needed
                if 'layout' in section_dict and 'photo_layout' not in section_dict:
                    section_dict['photo_layout'] = section_dict.pop('layout')
                self.section_repo.create(section_dict)

        return self.get_template(template_id)

    def delete_template(self, template_id: UUID) -> bool:
        """Delete template (cascade deletes sections)

        Args:
            template_id: Template ID

        Returns:
            True if deleted
        """
        return self.template_repo.delete(template_id)

    def clone_template(
        self,
        template_id: UUID,
        request: ReportTemplateCloneRequest,
        created_by_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """Clone/duplicate a template with all its sections

        Args:
            template_id: Source template ID
            request: Clone request with new name and settings
            created_by_id: User ID creating the clone

        Returns:
            Cloned template with sections
        """
        # Get source template
        source_template = self.template_repo.get_by_id(template_id)
        if not source_template:
            raise ValueError(f"Template {template_id} not found")

        # Handle both dict and object return types from get_by_id
        description = source_template['description'] if isinstance(source_template, dict) else source_template.description
        template_type = source_template['template_type'] if isinstance(source_template, dict) else source_template.template_type

        # Create new template with same settings but new name
        new_template_data = {
            'name': request.new_name,
            'description': description,
            'template_type': template_type,
            'is_default': False,  # Clones are never default by default
            'is_active': True,
            'company_id': request.company_id,
            'created_by_id': created_by_id
        }

        created_template = self.template_repo.create(new_template_data)
        new_template_id = created_template.id if hasattr(created_template, 'id') else created_template['id']

        # Clone sections if requested
        if request.include_sections:
            source_sections = self.section_repo.find_by_template(template_id)

            sections_data = []
            for section in source_sections:
                # Handle both dict and object return types
                section_dict = {
                    'template_id': new_template_id,
                    'title': section['title'] if isinstance(section, dict) else section.title,
                    'summary': section['summary'] if isinstance(section, dict) else section.summary,
                    'photo_layout': section['photo_layout'] if isinstance(section, dict) else section.photo_layout,
                    'default_photos_per_page': section['default_photos_per_page'] if isinstance(section, dict) else section.default_photos_per_page,
                    'display_order': section['display_order'] if isinstance(section, dict) else section.display_order,
                    'placeholders': section.get('placeholders') if isinstance(section, dict) else section.placeholders
                }
                sections_data.append(section_dict)

            if sections_data:
                self.section_repo.bulk_create_sections(sections_data)

        logger.info(f"Cloned template {template_id} to {new_template_id}")

        return self.get_template(new_template_id)

    def get_default_template(
        self,
        template_type: str = 'photo_report',
        company_id: Optional[UUID] = None
    ) -> Optional[Dict[str, Any]]:
        """Get default template for a type

        Args:
            template_type: Template type
            company_id: Company ID (None for system templates)

        Returns:
            Default template or None
        """
        template = self.template_repo.find_default_template(
            template_type=template_type,
            company_id=company_id
        )

        if not template:
            return None

        # Handle both dict and object return types
        template_id = template['id'] if isinstance(template, dict) else template.id
        return self.get_template(template_id)

    # Section operations
    def create_section(
        self,
        template_id: UUID,
        data: TemplateSectionCreate
    ) -> Dict[str, Any]:
        """Create new section for template

        Args:
            template_id: Template ID
            data: Section data

        Returns:
            Created section
        """
        # Verify template exists
        template = self.template_repo.get_by_id(template_id)
        if not template:
            raise ValueError(f"Template {template_id} not found")

        section_data = data.dict()
        section_data['template_id'] = template_id

        created_section = self.section_repo.create(section_data)
        return self.section_repo._convert_to_dict(created_section)

    def update_section(
        self,
        section_id: UUID,
        data: TemplateSectionUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update section

        Args:
            section_id: Section ID
            data: Update data

        Returns:
            Updated section or None
        """
        section = self.section_repo.get_by_id(section_id)
        if not section:
            return None

        update_data = data.dict(exclude_unset=True)
        updated_section = self.section_repo.update(section_id, update_data)

        return self.section_repo._convert_to_dict(updated_section)

    def delete_section(self, section_id: UUID) -> bool:
        """Delete section

        Args:
            section_id: Section ID

        Returns:
            True if deleted
        """
        return self.section_repo.delete(section_id)

    # Report config creation from template
    def create_config_from_template(
        self,
        job_id: UUID,
        request: CreateConfigFromTemplateRequest,
        created_by_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """Create report config from template

        This copies the template sections to a report config and
        applies any placeholder values (like monitoring dates).

        Args:
            job_id: Water mitigation job ID
            request: Request with template_id and placeholder values
            created_by_id: User ID creating the config

        Returns:
            Created report config
        """
        from .repository import WaterMitigationJobRepository
        from .repository import WMReportConfigRepository

        # Get template
        template = self.get_template(request.template_id)
        if not template:
            raise ValueError(f"Template {request.template_id} not found")

        # Get job for date prefilling
        job_repo = WaterMitigationJobRepository(self.session)
        job = job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Extract dates from job
        job_dict = job_repo._convert_to_dict(job)
        start_date = job_dict.get('mitigation_start_date')
        end_date = job_dict.get('mitigation_end_date')

        # Convert template sections to config sections
        config_sections = []
        for idx, section in enumerate(template.get('sections', [])):
            section_dict = {
                'id': f"section-{idx + 1}",
                'title': section['title'],
                'summary': self._process_section_summary(
                    section['summary'],
                    section['title'],
                    start_date,
                    end_date,
                    request.placeholder_values
                ),
                'photos': [],
                'layout': section['photo_layout'],
                'display_order': section['display_order']
            }
            config_sections.append(section_dict)

        # Create report config
        config_repo = WMReportConfigRepository(self.session)

        # Use provided or default cover title
        cover_title = request.cover_title or template.get('name', 'Water Mitigation Photos')
        cover_description = request.cover_description or template.get('description', '')

        config_data = {
            'job_id': job_id,
            'template_id': request.template_id,
            'cover_title': cover_title,
            'cover_description': cover_description,
            'sections': config_sections,
            'created_by_id': created_by_id
        }

        # Check if config already exists for this job
        existing = config_repo.find_by_job_id(job_id)
        if existing:
            # Update existing config
            config_id = existing.id if hasattr(existing, 'id') else existing['id']
            updated_config = config_repo.update(config_id, config_data)
            return config_repo._convert_to_dict(updated_config)
        else:
            # Create new config
            created_config = config_repo.create(config_data)
            return config_repo._convert_to_dict(created_config)

    # Helper methods
    def _ensure_single_default(
        self,
        template_type: str,
        company_id: Optional[UUID] = None,
        exclude_template_id: Optional[UUID] = None
    ):
        """Ensure only one default template per type per company

        Args:
            template_type: Template type
            company_id: Company ID
            exclude_template_id: Template ID to exclude from update
        """
        query = self.session.query(WMReportTemplate).filter(
            WMReportTemplate.template_type == template_type,
            WMReportTemplate.is_default.is_(True)
        )

        if company_id:
            query = query.filter(WMReportTemplate.company_id == company_id)
        else:
            query = query.filter(WMReportTemplate.company_id.is_(None))

        if exclude_template_id:
            query = query.filter(WMReportTemplate.id != exclude_template_id)

        # Unset all other defaults
        query.update(
            {"is_default": False},
            synchronize_session='fetch'
        )

    def _process_section_summary(
        self,
        summary: Optional[str],
        section_title: str,
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        placeholder_values: Optional[Dict[str, str]] = None
    ) -> str:
        """Process section summary with date prefilling logic

        Special logic for monitoring sections:
        - "Monitoring - Day 1" → use start_date
        - "Monitoring - Day 2" → use start_date + 1 day
        - "Monitoring - Day 3" → use end_date

        Args:
            summary: Section summary template
            section_title: Section title
            start_date: Job mitigation start date
            end_date: Job mitigation end date
            placeholder_values: Optional placeholder values from user

        Returns:
            Processed summary with dates filled in
        """
        # Start with original summary or empty string
        result = summary or ""

        # Apply user-provided placeholder values first
        if placeholder_values:
            for key, value in placeholder_values.items():
                result = result.replace(f"{{{{{key}}}}}", value)

        # Special monitoring date logic
        if "Monitoring - Day" in section_title:
            if "Day 1" in section_title and start_date:
                date_str = start_date.strftime("%B %d, %Y")
                if not result:
                    result = f"Monitoring completed on {date_str}"
                else:
                    result = result.replace("{{date}}", date_str)

            elif "Day 2" in section_title and start_date:
                day_2_date = start_date + timedelta(days=1)
                date_str = day_2_date.strftime("%B %d, %Y")
                if not result:
                    result = f"Monitoring completed on {date_str}"
                else:
                    result = result.replace("{{date}}", date_str)

            elif "Day 3" in section_title and end_date:
                date_str = end_date.strftime("%B %d, %Y")
                if not result:
                    result = f"Monitoring completed on {date_str}"
                else:
                    result = result.replace("{{date}}", date_str)

        return result
