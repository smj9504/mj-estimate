"""
Client, Claim, and ClaimNegotiation repository implementations.
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import case, func, or_

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from app.domains.client.models import Client, Claim, ClaimNegotiation

logger = logging.getLogger(__name__)


# ============================================================
# Client Repositories
# ============================================================

class ClientSQLAlchemyRepository(SQLAlchemyRepository):
    """SQLAlchemy-based client repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, Client)

    def get_by_id_with_claims(self, client_id: str) -> Optional[Dict[str, Any]]:
        """Get client with all claims and their negotiations"""
        try:
            client = self.db_session.query(Client).filter(
                Client.id == client_id
            ).first()
            if not client:
                return None

            client_dict = self._convert_to_dict(client)

            # Get claims
            claims = self.db_session.query(Claim).filter(
                Claim.client_id == client_id
            ).order_by(Claim.created_at.desc()).all()

            claim_ids = [str(claim.id) for claim in claims]

            from app.domains.invoice.models import Invoice
            from app.domains.estimate.models import Estimate
            from app.domains.water_mitigation.models import WaterMitigationJob
            from app.domains.work_order.models import WorkOrder
            from app.domains.cabinet_estimate.models import CabinetEstimate

            # Batch-fetch negotiations for all claims in one query instead
            # of one query per claim
            negotiations_by_claim: Dict[str, List[Dict[str, Any]]] = {}
            if claim_ids:
                negotiations = self.db_session.query(ClaimNegotiation).filter(
                    ClaimNegotiation.claim_id.in_(claim_ids)
                ).order_by(ClaimNegotiation.claim_id, ClaimNegotiation.revision_number).all()
                for n in negotiations:
                    negotiations_by_claim.setdefault(str(n.claim_id), []).append(
                        self._convert_to_dict(n)
                    )

            # Batch-fetch linked-document counts per claim: one grouped
            # query per model instead of one .count() query per claim
            def _counts_by_claim(model) -> Dict[str, int]:
                if not claim_ids:
                    return {}
                rows = self.db_session.query(
                    model.claim_id, func.count(model.id)
                ).filter(
                    model.claim_id.in_(claim_ids)
                ).group_by(model.claim_id).all()
                return {str(cid): cnt for cid, cnt in rows}

            invoice_counts = _counts_by_claim(Invoice)
            estimate_counts = _counts_by_claim(Estimate)
            wm_job_counts = _counts_by_claim(WaterMitigationJob)
            work_order_counts = _counts_by_claim(WorkOrder)
            cabinet_estimate_counts = _counts_by_claim(CabinetEstimate)

            claims_list = []
            for claim in claims:
                claim_dict = self._convert_to_dict(claim)
                cid = str(claim.id)

                claim_dict['negotiations'] = negotiations_by_claim.get(cid, [])
                claim_dict['invoice_count'] = invoice_counts.get(cid, 0)
                claim_dict['estimate_count'] = estimate_counts.get(cid, 0)
                claim_dict['wm_job_count'] = wm_job_counts.get(cid, 0)
                claim_dict['work_order_count'] = work_order_counts.get(cid, 0)
                claim_dict['cabinet_estimate_count'] = cabinet_estimate_counts.get(cid, 0)

                # Include plumber_report_id if linked
                claim_dict['plumber_report_id'] = str(claim.plumber_report_id) if claim.plumber_report_id else None

                claims_list.append(claim_dict)

            client_dict['claims'] = claims_list

            # Count standalone documents (linked to client but no claim)
            client_dict['standalone_invoice_count'] = self.db_session.query(Invoice).filter(
                Invoice.client_id == client_id,
                Invoice.claim_id.is_(None)
            ).count()
            client_dict['standalone_estimate_count'] = self.db_session.query(Estimate).filter(
                Estimate.client_id == client_id,
                Estimate.claim_id.is_(None)
            ).count()
            client_dict['standalone_wm_job_count'] = self.db_session.query(WaterMitigationJob).filter(
                WaterMitigationJob.client_id == client_id,
                WaterMitigationJob.claim_id.is_(None)
            ).count()
            client_dict['standalone_work_order_count'] = self.db_session.query(WorkOrder).filter(
                WorkOrder.client_id == client_id,
                WorkOrder.claim_id.is_(None)
            ).count()

            # Collect cabinet estimates: via claim OR matching property_address
            claim_ids = [c['id'] for c in claims_list]

            cab_filters = []
            if claim_ids:
                cab_filters.append(CabinetEstimate.claim_id.in_(claim_ids))
            # Also match by property_address containing client address
            client_address = client_dict.get('address')
            if client_address and client_address.strip():
                cab_filters.append(CabinetEstimate.property_address.ilike(f"%{client_address.strip()}%"))

            if cab_filters:
                cab_estimates = self.db_session.query(CabinetEstimate).filter(
                    or_(*cab_filters)
                ).order_by(CabinetEstimate.created_at.desc()).all()
            else:
                cab_estimates = []

            client_dict['cabinet_estimates'] = [
                {
                    'id': str(ce.id),
                    'claim_id': str(ce.claim_id) if ce.claim_id else None,
                    'status': ce.status,
                    'property_address': ce.property_address,
                    'tier': ce.tier,
                    'total': ce.total,
                    'created_at': ce.created_at.isoformat() if ce.created_at else None,
                }
                for ce in cab_estimates
            ]

            # Collect plumber reports: via claim OR matching client_name/client_address
            from app.domains.plumber_report.models import PlumberReport
            plumber_report_ids = [
                c['plumber_report_id'] for c in claims_list
                if c.get('plumber_report_id')
            ]

            pr_filters = []
            if plumber_report_ids:
                pr_filters.append(PlumberReport.id.in_(plumber_report_ids))
            # Match by client_name = display_name
            display_name = client_dict.get('display_name')
            if display_name and display_name.strip():
                pr_filters.append(PlumberReport.client_name == display_name.strip())
            # Also match by client_address
            if client_address and client_address.strip():
                pr_filters.append(PlumberReport.client_address.ilike(f"%{client_address.strip()}%"))

            if pr_filters:
                plumber_reports = self.db_session.query(PlumberReport).filter(
                    or_(*pr_filters)
                ).order_by(PlumberReport.created_at.desc()).all()
            else:
                plumber_reports = []

            client_dict['plumber_reports'] = [
                {
                    'id': str(pr.id),
                    'report_number': pr.report_number,
                    'status': pr.status,
                    'service_date': pr.service_date.isoformat() if pr.service_date else None,
                    'technician_name': pr.technician_name,
                    'total_amount': pr.total_amount,
                    'created_at': pr.created_at.isoformat() if pr.created_at else None,
                }
                for pr in plumber_reports
            ]

            return client_dict

        except Exception as e:
            logger.error(f"Error getting client with claims: {e}")
            raise

    def get_all_with_counts(self, filters=None, order_by=None, limit=None, offset=None) -> List[Dict[str, Any]]:
        """Get all clients with claim counts, ordered by latest claim activity"""
        try:
            # Subquery: latest claim activity per client
            latest_claim_activity = (
                self.db_session.query(
                    Claim.client_id,
                    func.max(
                        func.coalesce(Claim.updated_at, Claim.created_at)
                    ).label('latest_activity')
                )
                .group_by(Claim.client_id)
                .subquery()
            )

            query = (
                self.db_session.query(Client, func.count(Claim.id).label('claim_count'))
                .outerjoin(Claim, Client.id == Claim.client_id)
                .outerjoin(
                    latest_claim_activity,
                    Client.id == latest_claim_activity.c.client_id
                )
            )

            # Apply filters
            if filters:
                for key, value in filters.items():
                    if hasattr(Client, key):
                        query = query.filter(getattr(Client, key) == value)

            query = query.group_by(
                Client.id,
                latest_claim_activity.c.latest_activity,
            )

            # Order by most recent activity: client's own updated_at vs. its
            # claims' latest activity, whichever is more recent (desc)
            client_activity = func.coalesce(Client.updated_at, Client.created_at)
            latest_overall_activity = case(
                (latest_claim_activity.c.latest_activity > client_activity,
                 latest_claim_activity.c.latest_activity),
                else_=client_activity
            )
            query = query.order_by(latest_overall_activity.desc())

            if offset:
                query = query.offset(offset)
            if limit:
                query = query.limit(limit)

            results = query.all()

            clients = []
            for client_obj, claim_count in results:
                client_dict = self._convert_to_dict(client_obj)
                client_dict['claim_count'] = claim_count
                clients.append(client_dict)

            return clients
        except Exception as e:
            logger.error(f"Error getting clients with counts: {e}")
            raise

    def search_by_name(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search clients by display_name, address, phone, or email"""
        try:
            search_term = f"%{query}%"
            clients = self.db_session.query(Client).filter(
                or_(
                    Client.display_name.ilike(search_term),
                    Client.address.ilike(search_term),
                    Client.phone.ilike(search_term),
                    Client.email.ilike(search_term),
                    Client.city.ilike(search_term),
                )
            ).order_by(Client.display_name).limit(limit).all()
            return [self._convert_to_dict(c) for c in clients]
        except Exception as e:
            logger.error(f"Error searching clients: {e}")
            raise


# ============================================================
# Claim Repositories
# ============================================================

class ClaimSQLAlchemyRepository(SQLAlchemyRepository):
    """SQLAlchemy-based claim repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, Claim)

    def get_by_id_with_details(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Get claim with negotiations and document counts"""
        try:
            claim = self.db_session.query(Claim).filter(
                Claim.id == claim_id
            ).first()
            if not claim:
                return None

            claim_dict = self._convert_to_dict(claim)

            # Get negotiations
            negotiations = self.db_session.query(ClaimNegotiation).filter(
                ClaimNegotiation.claim_id == claim_id
            ).order_by(ClaimNegotiation.revision_number).all()
            claim_dict['negotiations'] = [self._convert_to_dict(n) for n in negotiations]

            # Count linked documents
            from app.domains.invoice.models import Invoice
            from app.domains.estimate.models import Estimate
            from app.domains.water_mitigation.models import WaterMitigationJob
            from app.domains.work_order.models import WorkOrder
            from app.domains.company.models import Company

            claim_dict['invoice_count'] = self.db_session.query(Invoice).filter(
                Invoice.claim_id == claim_id
            ).count()
            claim_dict['estimate_count'] = self.db_session.query(Estimate).filter(
                Estimate.claim_id == claim_id
            ).count()
            wm_jobs = self.db_session.query(WaterMitigationJob, Company.name).outerjoin(
                Company, WaterMitigationJob.company_id == Company.id
            ).filter(WaterMitigationJob.claim_id == claim_id).all()
            claim_dict['wm_job_count'] = len(wm_jobs)
            claim_dict['wm_jobs'] = [
                {
                    'id': str(j.id),
                    'property_address': j.property_address,
                    'status': j.status,
                    'claim_number': j.claim_number,
                    'company_id': str(j.company_id) if j.company_id else None,
                    'company_name': company_name,
                }
                for j, company_name in wm_jobs
            ]
            rebuild_jobs = self.db_session.query(WorkOrder, Company.name).outerjoin(
                Company, WorkOrder.company_id == Company.id
            ).filter(WorkOrder.claim_id == claim_id).all()
            claim_dict['work_order_count'] = len(rebuild_jobs)
            claim_dict['rebuild_jobs'] = [
                {
                    'id': str(wo.id),
                    'work_order_number': wo.work_order_number,
                    'property_address': wo.job_site_address,
                    'status': wo.status.value if wo.status else None,
                    'company_id': str(wo.company_id) if wo.company_id else None,
                    'company_name': company_name,
                }
                for wo, company_name in rebuild_jobs
            ]

            from app.domains.cabinet_estimate.models import CabinetEstimate
            claim_dict['cabinet_estimate_count'] = self.db_session.query(CabinetEstimate).filter(
                CabinetEstimate.claim_id == claim_id
            ).count()

            claim_dict['plumber_report_id'] = str(claim.plumber_report_id) if claim.plumber_report_id else None

            return claim_dict
        except Exception as e:
            logger.error(f"Error getting claim with details: {e}")
            raise

    def get_claims_by_client(self, client_id: str) -> List[Dict[str, Any]]:
        """Get all claims for a client, including assigned WM/rebuild company history"""
        claims = self.get_all(filters={'client_id': client_id}, order_by='-created_at')
        if not claims:
            return claims

        claim_ids = [c['id'] for c in claims]

        from app.domains.water_mitigation.models import WaterMitigationJob
        from app.domains.work_order.models import WorkOrder
        from app.domains.company.models import Company

        wm_jobs = self.db_session.query(WaterMitigationJob, Company.name).outerjoin(
            Company, WaterMitigationJob.company_id == Company.id
        ).filter(WaterMitigationJob.claim_id.in_(claim_ids)).all()

        wm_jobs_by_claim: Dict[str, List[Dict[str, Any]]] = {}
        for job, company_name in wm_jobs:
            wm_jobs_by_claim.setdefault(str(job.claim_id), []).append({
                'id': str(job.id),
                'property_address': job.property_address,
                'status': job.status,
                'claim_number': job.claim_number,
                'company_id': str(job.company_id) if job.company_id else None,
                'company_name': company_name,
            })

        rebuild_jobs = self.db_session.query(WorkOrder, Company.name).outerjoin(
            Company, WorkOrder.company_id == Company.id
        ).filter(WorkOrder.claim_id.in_(claim_ids)).all()

        rebuild_jobs_by_claim: Dict[str, List[Dict[str, Any]]] = {}
        for wo, company_name in rebuild_jobs:
            rebuild_jobs_by_claim.setdefault(str(wo.claim_id), []).append({
                'id': str(wo.id),
                'work_order_number': wo.work_order_number,
                'property_address': wo.job_site_address,
                'status': wo.status.value if wo.status else None,
                'company_id': str(wo.company_id) if wo.company_id else None,
                'company_name': company_name,
            })

        for claim in claims:
            claim['wm_jobs'] = wm_jobs_by_claim.get(claim['id'], [])
            claim['wm_job_count'] = len(claim['wm_jobs'])
            claim['rebuild_jobs'] = rebuild_jobs_by_claim.get(claim['id'], [])
            claim['work_order_count'] = len(claim['rebuild_jobs'])

        return claims

    def get_by_claim_number(self, claim_number: str) -> Optional[Dict[str, Any]]:
        """Get claim by claim number"""
        claims = self.get_all(filters={'claim_number': claim_number}, limit=1)
        return claims[0] if claims else None


# ============================================================
# ClaimNegotiation Repositories
# ============================================================

class ClaimNegotiationSQLAlchemyRepository(SQLAlchemyRepository):
    """SQLAlchemy-based claim negotiation repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, ClaimNegotiation)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all negotiations for a claim, ordered by revision number"""
        try:
            negotiations = self.db_session.query(ClaimNegotiation).filter(
                ClaimNegotiation.claim_id == claim_id
            ).order_by(ClaimNegotiation.revision_number).all()
            return [self._convert_to_dict(n) for n in negotiations]
        except Exception as e:
            logger.error(f"Error getting negotiations by claim: {e}")
            raise

    def get_next_revision_number(self, claim_id: str, category: str = None) -> int:
        """Get the next revision number for a claim, scoped by estimate_category."""
        try:
            from sqlalchemy import func
            q = self.db_session.query(
                func.max(ClaimNegotiation.revision_number)
            ).filter(
                ClaimNegotiation.claim_id == claim_id
            )
            if category:
                q = q.filter(ClaimNegotiation.estimate_category == category)
            max_rev = q.scalar()
            return (max_rev or 0) + 1
        except Exception as e:
            logger.error(f"Error getting next revision number: {e}")
            raise

    def create_and_update_claim(self, negotiation_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create negotiation and update parent claim's current amounts"""
        try:
            # Auto-assign revision number (per category)
            claim_id = negotiation_data['claim_id']
            category = negotiation_data.get('estimate_category')
            negotiation_data['revision_number'] = self.get_next_revision_number(claim_id, category)

            # Create negotiation
            result = self.create(negotiation_data)

            # Update claim's current amounts
            claim = self.db_session.query(Claim).filter(Claim.id == claim_id).first()
            if claim:
                claim.current_acv = negotiation_data.get('acv_amount', 0)
                claim.current_rcv = negotiation_data.get('rcv_amount', 0)
                claim.current_depreciation = negotiation_data.get('depreciation_amount', 0)
                if negotiation_data.get('deductible') is not None:
                    claim.insurance_deductible = negotiation_data['deductible']

                # Auto-update status to negotiating if still open
                if claim.status == 'open':
                    claim.status = 'negotiating'

                # If final revision, mark as settled
                if negotiation_data.get('revision_type') == 'final':
                    claim.status = 'settled'

            self.db_session.flush()
            self.db_session.commit()

            return result
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Error creating negotiation and updating claim: {e}")
            raise


# ============================================================
# Factory functions
# ============================================================

def get_client_repository(session: DatabaseSession) -> ClientSQLAlchemyRepository:
    actual_session = session
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    return ClientSQLAlchemyRepository(actual_session)


def get_claim_repository(session: DatabaseSession) -> ClaimSQLAlchemyRepository:
    actual_session = session
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    return ClaimSQLAlchemyRepository(actual_session)


def get_claim_negotiation_repository(session: DatabaseSession) -> ClaimNegotiationSQLAlchemyRepository:
    actual_session = session
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    return ClaimNegotiationSQLAlchemyRepository(actual_session)
