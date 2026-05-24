"""
Rebuild domain service.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class RebuildService:
    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _s(self):
        return self.database.get_session()

    def _rs(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Contractors
    # ============================================================

    def create_contractor(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_contractor(self, cid: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).update(cid, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_contractor(self, cid: str) -> Optional[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            return get_contractor_repository(session).get_by_id(cid)
        finally:
            session.close()

    def get_contractors(self) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            return get_contractor_repository(session).get_active()
        finally:
            session.close()

    def delete_contractor(self, cid: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).update(cid, {"is_active": False})
            session.commit()
            return result is not None
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    # ============================================================
    # Projects
    # ============================================================

    def create_project(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            # Auto-fill property_address from claim if not provided
            if not data.get('property_address') and data.get('claim_id'):
                data['property_address'] = self._get_claim_address(session, str(data['claim_id']))

            # Set status to assigned if contractor is provided
            if data.get('contractor_id') and data.get('status', 'pending') == 'pending':
                data['status'] = 'assigned'

            result = get_project_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_project(self, pid: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            result = get_project_repository(session).update(pid, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_project(self, pid: str) -> Optional[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository, get_completion_doc_repository
            repo = get_project_repository(session)
            result = repo.get_by_id(pid)
            if result:
                self._enrich_project(session, result)
                doc_repo = get_completion_doc_repository(session)
                result['completion_docs'] = doc_repo.get_by_project(pid)
                result['completion_doc_count'] = len(result['completion_docs'])
            return result
        finally:
            session.close()

    def get_projects(self, params: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            items, total = get_project_repository(session).get_with_filters(**params)
            for item in items:
                self._enrich_project(session, item)
            return items, total
        finally:
            session.close()

    def get_projects_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            items = get_project_repository(session).get_by_claim(claim_id)
            for item in items:
                self._enrich_project(session, item)
            return items
        finally:
            session.close()

    def delete_project(self, pid: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            result = get_project_repository(session).delete(pid)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_dashboard_stats(self) -> Dict[str, Any]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            return get_project_repository(session).get_dashboard_stats()
        finally:
            session.close()

    # ============================================================
    # Completion Docs
    # ============================================================

    def create_completion_doc(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_completion_doc(self, doc_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).update(doc_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_completion_doc(self, doc_id: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).delete(doc_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_completion_docs(self, project_id: str) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            return get_completion_doc_repository(session).get_by_project(project_id)
        finally:
            session.close()

    # ============================================================
    # Helpers
    # ============================================================

    def _enrich_project(self, session, item: Dict[str, Any]):
        try:
            from app.domains.client.models import Claim, Client
            from app.domains.rebuild.models import RebuildContractor
            claim = session.query(Claim).filter(Claim.id == item.get('claim_id')).first()
            if claim:
                item['claim_number'] = claim.claim_number
                item['insurance_company'] = claim.insurance_company
            if item.get('contractor_id'):
                contractor = session.query(RebuildContractor).filter(
                    RebuildContractor.id == item['contractor_id']
                ).first()
                if contractor:
                    item['contractor_name'] = contractor.company_name

            # Enrich with assigned reconstruction company from ClaimCompany
            try:
                from app.domains.contract.models import ClaimCompany
                from app.domains.company.models import Company
                cc = (
                    session.query(ClaimCompany, Company)
                    .join(Company, ClaimCompany.company_id == Company.id)
                    .filter(
                        ClaimCompany.claim_id == item.get('claim_id'),
                        ClaimCompany.role == 'reconstruction',
                    )
                    .first()
                )
                if cc:
                    item['rebuild_company_id'] = str(cc[1].id)
                    item['rebuild_company_name'] = cc[1].name
            except Exception:
                pass
        except Exception:
            pass

    def _get_claim_address(self, session, claim_id: str) -> Optional[str]:
        try:
            from app.domains.client.models import Claim, Client
            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if claim:
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    return client.address
        except Exception:
            pass
        return None
