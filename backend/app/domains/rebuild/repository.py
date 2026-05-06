"""
Rebuild domain repository implementations.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.rebuild.models import (
    RebuildCompletionDoc,
    RebuildContractor,
    RebuildProject,
)

logger = logging.getLogger(__name__)


class RebuildContractorRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RebuildContractor)

    def get_active(self) -> List[Dict[str, Any]]:
        items = self.db_session.query(RebuildContractor).filter(
            RebuildContractor.is_active == True
        ).order_by(RebuildContractor.company_name).all()
        result = []
        for c in items:
            d = self._convert_to_dict(c)
            d['project_count'] = self.db_session.query(func.count(RebuildProject.id)).filter(
                RebuildProject.contractor_id == c.id
            ).scalar() or 0
            result.append(d)
        return result


class RebuildProjectRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RebuildProject)

    def get_with_filters(
        self,
        status: Optional[str] = None,
        contractor_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Dict[str, Any]], int]:
        query = self.db_session.query(RebuildProject)

        if status:
            query = query.filter(RebuildProject.status == status)
        if contractor_id:
            query = query.filter(RebuildProject.contractor_id == contractor_id)
        if claim_id:
            query = query.filter(RebuildProject.claim_id == claim_id)

        total = query.count()
        query = query.order_by(RebuildProject.created_at.desc())

        offset = (page - 1) * page_size
        items = query.offset(offset).limit(page_size).all()
        return [self._convert_to_dict(p) for p in items], total

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        items = self.db_session.query(RebuildProject).filter(
            RebuildProject.claim_id == claim_id
        ).order_by(RebuildProject.created_at.desc()).all()
        return [self._convert_to_dict(p) for p in items]

    def get_dashboard_stats(self) -> Dict[str, Any]:
        total = self.db_session.query(func.count(RebuildProject.id)).scalar() or 0

        status_counts = self.db_session.query(
            RebuildProject.status, func.count(RebuildProject.id)
        ).group_by(RebuildProject.status).all()
        counts = {s: c for s, c in status_counts}

        total_contract = self.db_session.query(
            func.sum(RebuildProject.contract_amount)
        ).filter(RebuildProject.status.in_(['in_progress', 'completed', 'invoiced'])).scalar() or 0

        total_contractors = self.db_session.query(func.count(RebuildContractor.id)).filter(
            RebuildContractor.is_active == True
        ).scalar() or 0

        return {
            "total_projects": total,
            "pending": counts.get('pending', 0),
            "assigned": counts.get('assigned', 0),
            "in_progress": counts.get('in_progress', 0),
            "completed": counts.get('completed', 0),
            "docs_sent": counts.get('docs_sent', 0),
            "total_contract_amount": float(total_contract),
            "total_contractors": total_contractors,
        }


class RebuildCompletionDocRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, RebuildCompletionDoc)

    def get_by_project(self, project_id: str) -> List[Dict[str, Any]]:
        items = self.db_session.query(RebuildCompletionDoc).filter(
            RebuildCompletionDoc.project_id == project_id
        ).order_by(RebuildCompletionDoc.created_at).all()
        return [self._convert_to_dict(d) for d in items]


def get_contractor_repository(session):
    return RebuildContractorRepository(session)

def get_project_repository(session):
    return RebuildProjectRepository(session)

def get_completion_doc_repository(session):
    return RebuildCompletionDocRepository(session)
