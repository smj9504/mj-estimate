"""
Contract domain service layer.
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.common.base_service import BaseService
from app.core.interfaces import DatabaseProvider

logger = logging.getLogger(__name__)


class ContractTemplateService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_template_repository
        return get_template_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_template_repository
        return get_template_repository(session)

    def get_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_company(company_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting templates by company: {e}")
            raise

    def get_all_with_company(self, **kwargs) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_all_with_company(**kwargs)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting templates: {e}")
            raise


class ContractInstanceService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_instance_repository
        return get_instance_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_instance_repository
        return get_instance_repository(session)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_claim(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting contracts by claim: {e}")
            raise

    def create_contract(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a contract instance with signing token"""
        try:
            expires_days = data.pop('token_expires_days', 30)

            # Build prefill snapshot
            session = self.database.get_session()
            try:
                prefill = self._build_prefill(session, data)
                data['prefill_data'] = json.dumps(prefill)
                # Set title from template if not provided
                if not data.get('title'):
                    from app.domains.contract.models import ContractTemplate
                    tmpl = session.query(ContractTemplate).filter(
                        ContractTemplate.id == data['template_id']
                    ).first()
                    if tmpl:
                        data['title'] = tmpl.name

                repo = self._get_repository_instance(session)
                return repo.create_with_token(data, expires_days)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating contract: {e}")
            raise

    def _build_prefill(self, session, data: Dict[str, Any]) -> Dict[str, Any]:
        """Capture client/claim/company info at time of contract generation"""
        prefill = {}
        try:
            from app.domains.client.models import Client, Claim
            from app.domains.company.models import Company

            client = session.query(Client).filter(Client.id == data.get('client_id')).first()
            if client:
                prefill['client'] = {
                    'display_name': client.display_name,
                    'address': client.address,
                    'city': client.city,
                    'state': client.state,
                    'zipcode': client.zipcode,
                    'phone': client.phone,
                    'email': client.email,
                }

            claim = session.query(Claim).filter(Claim.id == data.get('claim_id')).first()
            if claim:
                prefill['claim'] = {
                    'claim_number': claim.claim_number,
                    'insurance_company': claim.insurance_company,
                    'insurance_policy_number': claim.insurance_policy_number,
                    'date_of_loss': str(claim.date_of_loss) if claim.date_of_loss else None,
                    'adjuster_name': claim.adjuster_name,
                }

            company = session.query(Company).filter(Company.id == data.get('company_id')).first()
            if company:
                prefill['company'] = {
                    'name': company.name,
                    'address': company.address,
                    'phone': company.phone,
                    'email': company.email,
                    'license_number': company.license_number,
                }
        except Exception as e:
            logger.warning(f"Error building prefill: {e}")
        return prefill

    def get_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Get contract by signing token (public, no auth)"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_token(token)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting contract by token: {e}")
            raise

    def send_for_signing(self, instance_id: str) -> Optional[Dict[str, Any]]:
        """Mark contract as sent and return signing URL info"""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                result = repo.update(instance_id, {
                    'status': 'sent',
                    'sent_at': datetime.utcnow(),
                })
                session.commit()
                return repo.get_by_id_enriched(instance_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error sending contract: {e}")
            raise

    def sign_contract(self, token: str, sig_data: Dict[str, Any]) -> Dict[str, Any]:
        """Add signature to contract via public token"""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                contract = repo.get_by_token(token)
                if not contract:
                    raise ValueError("Contract not found")
                if contract['status'] == 'voided':
                    raise ValueError("Contract has been voided")

                # Check token expiry
                expires = contract.get('token_expires_at')
                if expires:
                    if isinstance(expires, str):
                        expires = datetime.fromisoformat(expires)
                    if datetime.utcnow() > expires:
                        raise ValueError("Signing link has expired")

                instance_id = str(contract['id'])
                return repo.add_signature(instance_id, sig_data)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error signing contract: {e}")
            raise

    def void_contract(self, instance_id: str) -> Optional[Dict[str, Any]]:
        try:
            return self.update(instance_id, {
                'status': 'voided',
                'voided_at': datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"Error voiding contract: {e}")
            raise


class ClaimCompanyService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_claim_company_repository
        return get_claim_company_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_claim_company_repository
        return get_claim_company_repository(session)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_claim(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting claim companies: {e}")
            raise
