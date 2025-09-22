from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc, asc, func
from typing import List, Optional, Dict, Any
from uuid import UUID

from app.common.base_repository import BaseRepository
from app.domains.template.models import Template, TemplateUsageLog
from app.domains.template.schemas import TemplateCreate, TemplateUpdate, TemplateSearchFilters


class TemplateRepository(BaseRepository[Template, TemplateCreate, TemplateUpdate]):
    def __init__(self, db: Session):
        super().__init__(Template, db)

    def get_by_company(
        self,
        company_id: str,
        filters: TemplateSearchFilters = None
    ) -> List[Template]:
        """Get templates by company with filtering and sorting"""
        query = self.db.query(Template).filter(Template.company_id == company_id)

        if filters:
            # Filter by type
            if filters.type:
                query = query.filter(Template.type == filters.type.value)

            # Filter by active status
            if filters.is_active is not None:
                query = query.filter(Template.is_active == filters.is_active)

            # Search by name or description
            if filters.search:
                search_term = f"%{filters.search.lower()}%"
                query = query.filter(
                    or_(
                        func.lower(Template.name).like(search_term),
                        func.lower(Template.description).like(search_term)
                    )
                )

            # Apply sorting
            if filters.sort_by and filters.sort_order:
                sort_column = getattr(Template, filters.sort_by, Template.name)
                if filters.sort_order.lower() == "desc":
                    query = query.order_by(desc(sort_column))
                else:
                    query = query.order_by(asc(sort_column))
            else:
                query = query.order_by(Template.name)

        return query.all()

    def get_by_type(self, company_id: str, template_type: str) -> List[Template]:
        """Get active templates by company and type"""
        return self.db.query(Template).filter(
            and_(
                Template.company_id == company_id,
                Template.type == template_type,
                Template.is_active == True
            )
        ).order_by(desc(Template.usage_count), Template.name).all()

    def get_most_used(self, company_id: str, template_type: str, limit: int = 3) -> List[Template]:
        """Get most used templates by type"""
        return self.db.query(Template).filter(
            and_(
                Template.company_id == company_id,
                Template.type == template_type,
                Template.is_active == True
            )
        ).order_by(desc(Template.usage_count)).limit(limit).all()

    def increment_usage_count(self, template_id: str) -> bool:
        """Increment the usage count for a template"""
        try:
            self.db.query(Template).filter(Template.id == template_id).update(
                {Template.usage_count: Template.usage_count + 1}
            )
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            return False

    def log_template_usage(
        self,
        template_id: str,
        used_by: str,
        report_id: Optional[str] = None
    ) -> TemplateUsageLog:
        """Log template usage for analytics"""
        usage_log = TemplateUsageLog(
            template_id=template_id,
            used_by=used_by,
            report_id=report_id
        )
        self.db.add(usage_log)
        self.db.commit()
        self.db.refresh(usage_log)
        return usage_log

    def get_usage_stats(self, company_id: str) -> Dict[str, Any]:
        """Get usage statistics for templates"""
        # Get total templates by type
        total_by_type = self.db.query(
            Template.type,
            func.count(Template.id).label('count')
        ).filter(
            and_(
                Template.company_id == company_id,
                Template.is_active == True
            )
        ).group_by(Template.type).all()

        # Get most used templates
        most_used = self.db.query(Template).filter(
            and_(
                Template.company_id == company_id,
                Template.is_active == True
            )
        ).order_by(desc(Template.usage_count)).limit(5).all()

        return {
            'total_by_type': {item.type: item.count for item in total_by_type},
            'most_used': [
                {
                    'id': str(template.id),
                    'name': template.name,
                    'type': template.type,
                    'usage_count': template.usage_count
                }
                for template in most_used
            ]
        }

    def duplicate_template(self, template_id: str, new_name: str) -> Optional[Template]:
        """Duplicate an existing template with a new name"""
        original = self.get(template_id)
        if not original:
            return None

        new_template = Template(
            company_id=original.company_id,
            name=new_name,
            type=original.type,
            content=original.content,
            description=f"Copy of {original.description}" if original.description else None,
            is_active=True,
            usage_count=0,
            created_by=original.created_by
        )

        self.db.add(new_template)
        self.db.commit()
        self.db.refresh(new_template)
        return new_template