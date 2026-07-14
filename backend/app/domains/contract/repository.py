"""
Contract domain repository implementations.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.contract.models import (
    ClaimCompany,
    ContractInstance,
    ContractSignature,
    ContractTemplate,
)

logger = logging.getLogger(__name__)


class ContractTemplateRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, ContractTemplate)

    def get_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        try:
            templates = self.db_session.query(ContractTemplate).filter(
                ContractTemplate.company_id == company_id,
                ContractTemplate.is_active == True,
            ).order_by(ContractTemplate.name).all()
            result = []
            for t in templates:
                d = self._convert_to_dict(t)
                if t.company:
                    d['company_name'] = t.company.name
                result.append(d)
            return result
        except Exception as e:
            logger.error(f"Error getting templates by company: {e}")
            raise

    def get_all_with_company(self, filters=None, order_by=None, limit=None, offset=None):
        try:
            templates = self.get_all(filters=filters, order_by=order_by or '-created_at', limit=limit, offset=offset)
            for t in templates:
                company_id = t.get('company_id')
                if company_id:
                    from app.domains.company.models import Company
                    company = self.db_session.query(Company).filter(Company.id == company_id).first()
                    t['company_name'] = company.name if company else ''
            return templates
        except Exception as e:
            logger.error(f"Error getting templates with company: {e}")
            raise


class ContractInstanceRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, ContractInstance)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            instances = self.db_session.query(ContractInstance).filter(
                ContractInstance.claim_id == claim_id
            ).order_by(ContractInstance.created_at.desc()).all()
            return [self._enrich(i) for i in instances]
        except Exception as e:
            logger.error(f"Error getting contracts by claim: {e}")
            raise

    def get_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        try:
            instance = self.db_session.query(ContractInstance).filter(
                ContractInstance.signing_token == token
            ).first()
            if not instance:
                return None
            return self._enrich(instance)
        except Exception as e:
            logger.error(f"Error getting contract by token: {e}")
            raise

    def get_by_id_enriched(self, instance_id: str) -> Optional[Dict[str, Any]]:
        try:
            instance = self.db_session.query(ContractInstance).filter(
                ContractInstance.id == instance_id
            ).first()
            if not instance:
                return None
            return self._enrich(instance)
        except Exception as e:
            logger.error(f"Error getting contract by id: {e}")
            raise

    def _enrich(self, instance: ContractInstance) -> Dict[str, Any]:
        d = self._convert_to_dict(instance)
        if instance.template:
            d['template_name'] = instance.template.name
            d['file_url'] = instance.template.file_url
            d['file_name'] = instance.template.file_name
            d['document_type'] = instance.template.document_type
            d['requires_signature'] = (
                instance.template.requires_signature
            )
            d['signature_roles'] = (
                instance.template.signature_roles
            )
            d['storage_provider'] = instance.template.storage_provider
            d['field_mappings'] = instance.template.field_mappings
        # Prefer filled PDF over template PDF
        if instance.filled_pdf_url:
            d['filled_pdf_url'] = instance.filled_pdf_url
        if instance.company:
            d['company_name'] = instance.company.name
            d['company_email'] = instance.company.email
            d['company_phone'] = instance.company.phone
        if instance.client:
            d['client_name'] = instance.client.display_name
            d['client_email'] = instance.client.email
        # Signatures
        sigs = self.db_session.query(ContractSignature).filter(
            ContractSignature.contract_instance_id == instance.id
        ).order_by(ContractSignature.signed_at).all()
        d['signatures'] = [self._convert_to_dict(s) for s in sigs]
        d['signature_count'] = len(sigs)
        return d

    def create_with_token(self, data: Dict[str, Any], expires_days: int = 30) -> Dict[str, Any]:
        try:
            data['signing_token'] = str(uuid.uuid4())
            data['token_expires_at'] = datetime.utcnow() + timedelta(days=expires_days)
            # Generate contract number
            from sqlalchemy import func
            count = self.db_session.query(func.count(ContractInstance.id)).scalar() or 0
            data['contract_number'] = f"CTR-{datetime.utcnow().strftime('%Y%m')}-{count + 1:04d}"
            result = self.create(data)
            self.db_session.commit()
            return self.get_by_id_enriched(str(result['id']))
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Error creating contract with token: {e}")
            raise

    def add_signature(self, instance_id: str, sig_data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            sig_data['contract_instance_id'] = instance_id
            sig = ContractSignature(**{k: v for k, v in sig_data.items() if v is not None})
            self.db_session.add(sig)

            # Update instance status
            instance = self.db_session.query(ContractInstance).filter(
                ContractInstance.id == instance_id
            ).first()
            if instance:
                instance.status = 'signed'
                instance.signed_at = datetime.utcnow()

            self.db_session.flush()
            self.db_session.commit()
            return self._convert_to_dict(sig)
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Error adding signature: {e}")
            raise


    def get_contracts_by_company_for_field(
        self, company_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get contract instances for field signing: not voided, token not expired."""
        try:
            instances = (
                self.db_session.query(ContractInstance)
                .filter(
                    ContractInstance.company_id == company_id,
                    ContractInstance.status != 'voided',
                    ContractInstance.signing_token.isnot(None),
                    (
                        (ContractInstance.token_expires_at.is_(None))
                        | (ContractInstance.token_expires_at > datetime.utcnow())
                    ),
                )
                .order_by(ContractInstance.created_at.desc())
                .limit(limit)
                .all()
            )
            return [self._enrich(i) for i in instances]
        except Exception as e:
            logger.error(f"Error getting contracts by company for field: {e}")
            raise


class ContractSignatureRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, ContractSignature)


class ClaimCompanyRepository(SQLAlchemyRepository):
    def __init__(self, session: DatabaseSession):
        super().__init__(session, ClaimCompany)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            entries = self.db_session.query(ClaimCompany).filter(
                ClaimCompany.claim_id == claim_id
            ).order_by(ClaimCompany.assigned_at).all()
            result = []
            for e in entries:
                d = self._convert_to_dict(e)
                if e.company:
                    d['company_name'] = e.company.name
                result.append(d)
            return result
        except Exception as e:
            logger.error(f"Error getting claim companies: {e}")
            raise


# ============================================================
# Factory functions
# ============================================================

def _unwrap_session(session):
    actual = session
    if hasattr(session, 'session') and session.session is not None:
        actual = session.session
    if hasattr(actual, '_session') and actual._session is not None:
        actual = actual._session
    return actual


def get_template_repository(session) -> ContractTemplateRepository:
    return ContractTemplateRepository(_unwrap_session(session))


def get_instance_repository(session) -> ContractInstanceRepository:
    return ContractInstanceRepository(_unwrap_session(session))


def get_signature_repository(session) -> ContractSignatureRepository:
    return ContractSignatureRepository(_unwrap_session(session))


def get_claim_company_repository(session) -> ClaimCompanyRepository:
    return ClaimCompanyRepository(_unwrap_session(session))
