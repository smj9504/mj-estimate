"""
Client, Claim, and ClaimNegotiation service layer.
"""

import logging
from typing import Any, Dict, List, Optional

from app.common.base_service import BaseService
from app.core.interfaces import DatabaseProvider

logger = logging.getLogger(__name__)


class ClientService(BaseService[Dict[str, Any], str]):
    """Service for client operations"""

    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.client.repository import get_client_repository
        session = self.database.get_session()
        return get_client_repository(session)

    def _get_repository_instance(self, session):
        from app.domains.client.repository import get_client_repository
        return get_client_repository(session)

    def get_with_claims(self, client_id: str) -> Optional[Dict[str, Any]]:
        """Get client with all claims, negotiations, and document counts"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_id_with_claims(client_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting client with claims: {e}")
            raise

    def get_all_with_counts(self, filters=None, order_by=None, limit=None, offset=None) -> List[Dict[str, Any]]:
        """Get all clients with claim counts"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_all_with_counts(
                    filters=filters, order_by=order_by, limit=limit, offset=offset
                )
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting clients with counts: {e}")
            raise

    def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search clients by name"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.search_by_name(query, limit)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error searching clients: {e}")
            raise


class ClaimService(BaseService[Dict[str, Any], str]):
    """Service for claim operations"""

    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.client.repository import get_claim_repository
        session = self.database.get_session()
        return get_claim_repository(session)

    def _get_repository_instance(self, session):
        from app.domains.client.repository import get_claim_repository
        return get_claim_repository(session)

    def get_with_details(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Get claim with negotiations and document counts"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_id_with_details(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting claim with details: {e}")
            raise

    def get_by_client(self, client_id: str) -> List[Dict[str, Any]]:
        """Get all claims for a client"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_claims_by_client(client_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting claims by client: {e}")
            raise

    def create_with_initial_negotiation(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create claim and optionally create initial negotiation"""
        try:
            initial_acv = claim_data.pop('initial_acv', None)
            initial_rcv = claim_data.pop('initial_rcv', None)

            # Create claim
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                claim = repo.create(claim_data)
                claim_id = claim['id']

                # Create initial negotiation if amounts provided
                if initial_acv is not None or initial_rcv is not None:
                    from app.domains.client.repository import get_claim_negotiation_repository
                    neg_repo = get_claim_negotiation_repository(session)
                    neg_data = {
                        'claim_id': claim_id,
                        'revision_type': 'initial',
                        'acv_amount': initial_acv or 0,
                        'rcv_amount': initial_rcv or 0,
                        'deductible': claim_data.get('insurance_deductible', 0),
                    }
                    neg_repo.create_and_update_claim(neg_data)
                else:
                    session.commit()

                # Return full claim
                return repo.get_by_id_with_details(str(claim_id))
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating claim with initial negotiation: {e}")
            raise

    def get_linked_documents(self, claim_id: str) -> Dict[str, Any]:
        """Get all documents linked to a claim"""
        try:
            session = self.database.get_readonly_session()
            try:
                from app.domains.invoice.models import Invoice
                from app.domains.estimate.models import Estimate
                from app.domains.water_mitigation.models import WaterMitigationJob
                from app.domains.work_order.models import WorkOrder

                invoices = session.query(Invoice).filter(Invoice.claim_id == claim_id).all()
                estimates = session.query(Estimate).filter(Estimate.claim_id == claim_id).all()
                wm_jobs = session.query(WaterMitigationJob).filter(WaterMitigationJob.claim_id == claim_id).all()
                work_orders = session.query(WorkOrder).filter(WorkOrder.claim_id == claim_id).all()

                from app.common.base_repository import SQLAlchemyRepository
                repo = SQLAlchemyRepository(session, Invoice)

                return {
                    'invoices': [repo._convert_to_dict(i) for i in invoices],
                    'estimates': [repo._convert_to_dict(e) for e in estimates],
                    'water_mitigation_jobs': [repo._convert_to_dict(w) for w in wm_jobs],
                    'work_orders': [repo._convert_to_dict(w) for w in work_orders],
                }
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting linked documents: {e}")
            raise


class ClaimNegotiationService(BaseService[Dict[str, Any], str]):
    """Service for claim negotiation operations"""

    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.client.repository import get_claim_negotiation_repository
        session = self.database.get_session()
        return get_claim_negotiation_repository(session)

    def _get_repository_instance(self, session):
        from app.domains.client.repository import get_claim_negotiation_repository
        return get_claim_negotiation_repository(session)

    def add_negotiation(self, negotiation_data: Dict[str, Any]) -> Dict[str, Any]:
        """Add a new negotiation revision and update claim amounts"""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.create_and_update_claim(negotiation_data)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error adding negotiation: {e}")
            raise

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all negotiations for a claim"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_claim(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting negotiations by claim: {e}")
            raise
