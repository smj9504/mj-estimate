"""
Client, Claim, and ClaimNegotiation repository implementations.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, case, func, or_

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

    def get_by_id_with_claims(self, client_id: str, staff: Any = None) -> Optional[Dict[str, Any]]:
        """Get client with its claims and their negotiations. With staff, only
        the claims and documents that person may see."""
        from app.domains.auth.company_scope import claim_condition, company_ids, document_condition, scoped

        try:
            client = self.db_session.query(Client).filter(
                Client.id == client_id
            ).first()
            if not client:
                return None

            client_dict = self._convert_to_dict(client)

            def doc_scope(model):
                if staff is None:
                    return None
                return document_condition(self.db_session, staff, model.claim_id, model.company_id)

            # Get claims
            claims_query = self.db_session.query(Claim).filter(Claim.client_id == client_id)
            if staff is not None:
                claims_query = scoped(claims_query, claim_condition(self.db_session, staff, Claim.id))
            claims = claims_query.order_by(Claim.created_at.desc()).all()

            claim_ids = [str(claim.id) for claim in claims]

            from app.domains.invoice.models import Invoice
            from app.domains.estimate.models import Estimate
            from app.domains.water_mitigation.models import WaterMitigationJob
            from app.domains.work_order.models import WorkOrder
            from app.domains.cabinet_estimate.models import CabinetEstimate
            from app.domains.client.claim_companies import companies_by_claim

            companies = companies_by_claim(self.db_session, claim_ids)

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

            from app.domains.client.claim_stage import claim_stages
            stages = claim_stages(self.db_session, claims)

            claims_list = []
            for claim in claims:
                claim_dict = self._convert_to_dict(claim)
                cid = str(claim.id)

                claim_dict.update(stages[cid])
                claim_dict['negotiations'] = negotiations_by_claim.get(cid, [])
                claim_dict['companies'] = companies.get(cid, [])
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
            client_dict['standalone_invoice_count'] = scoped(self.db_session.query(Invoice).filter(
                Invoice.client_id == client_id,
                Invoice.claim_id.is_(None)
            ), doc_scope(Invoice)).count()
            client_dict['standalone_estimate_count'] = scoped(self.db_session.query(Estimate).filter(
                Estimate.client_id == client_id,
                Estimate.claim_id.is_(None)
            ), doc_scope(Estimate)).count()
            client_dict['standalone_wm_job_count'] = scoped(self.db_session.query(WaterMitigationJob).filter(
                WaterMitigationJob.client_id == client_id,
                WaterMitigationJob.claim_id.is_(None)
            ), doc_scope(WaterMitigationJob)).count()
            client_dict['standalone_work_order_count'] = scoped(self.db_session.query(WorkOrder).filter(
                WorkOrder.client_id == client_id,
                WorkOrder.claim_id.is_(None)
            ), doc_scope(WorkOrder)).count()

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
                cab_estimates = scoped(self.db_session.query(CabinetEstimate).filter(
                    or_(*cab_filters)
                ), doc_scope(CabinetEstimate)).order_by(CabinetEstimate.created_at.desc()).all()
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

            match_filters = []
            # Match by client_name = display_name
            display_name = client_dict.get('display_name')
            if display_name and display_name.strip():
                match_filters.append(PlumberReport.client_name == display_name.strip())
            # Also match by client_address
            if client_address and client_address.strip():
                match_filters.append(PlumberReport.client_address.ilike(f"%{client_address.strip()}%"))

            # A report matched by name or address only shows to its own
            # company's people; one linked to a visible claim always does
            own_companies = company_ids(self.db_session, staff) if staff is not None else None
            if match_filters and own_companies is not None:
                import uuid
                match_filters = (
                    [and_(or_(*match_filters),
                          PlumberReport.company_id.in_([uuid.UUID(c) for c in own_companies]))]
                    if own_companies else []
                )

            pr_filters = match_filters
            if plumber_report_ids:
                pr_filters = [PlumberReport.id.in_(plumber_report_ids)] + match_filters

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

    @staticmethod
    def _filter_source(query, source: Optional[str]):
        """source: 'acculynx' = AccuLynx archive import, 'manual' = entered here"""
        if source == 'acculynx':
            return query.filter(Client.source == 'acculynx')
        if source == 'manual':
            return query.filter(or_(Client.source.is_(None), Client.source != 'acculynx'))
        return query

    def _client_scope(self, staff: Any):
        from app.domains.auth.company_scope import client_condition
        return None if staff is None else client_condition(self.db_session, staff)

    def _claim_scope(self, staff: Any):
        from app.domains.auth.company_scope import claim_condition
        return None if staff is None else claim_condition(self.db_session, staff, Claim.id)

    def count_by_source(self, staff: Any = None) -> Dict[str, int]:
        from app.domains.auth.company_scope import scoped

        scope = self._client_scope(staff)
        imported = scoped(self.db_session.query(func.count(Client.id)).filter(
            Client.source == 'acculynx'
        ), scope).scalar() or 0
        total = scoped(self.db_session.query(func.count(Client.id)), scope).scalar() or 0
        return {'manual': total - imported, 'acculynx': imported}

    def _list_items(self, client_objs: List[Client], staff: Any = None) -> List[Dict[str, Any]]:
        """Client list rows: each client with its claim count, the stage of the
        claim that describes it, and when the client or any of its claims last
        changed. The claim shown is the newest one still being worked, else the
        newest one. With staff, only the claims that person may see count."""
        from app.domains.auth.company_scope import scoped
        from app.domains.client.claim_stage import claim_stages, is_active_stage

        claims_by_client: Dict[Any, List[Any]] = {}
        stages: Dict[str, Dict[str, Any]] = {}
        client_ids = [c.id for c in client_objs]
        if client_ids:
            claims = scoped(
                self.db_session.query(Claim).filter(Claim.client_id.in_(client_ids)),
                self._claim_scope(staff),
            ).all()
            for claim in claims:
                claims_by_client.setdefault(claim.client_id, []).append(claim)
            stages = claim_stages(self.db_session, claims)

        items = []
        for client_obj in client_objs:
            claims = claims_by_client.get(client_obj.id, [])
            active = [c for c in claims if is_active_stage(stages[str(c.id)]['stage'])]
            shown = max(active or claims, key=lambda c: c.created_at, default=None)
            shown_stage = stages[str(shown.id)] if shown else {}
            changed = [client_obj.updated_at or client_obj.created_at] + [
                c.updated_at or c.created_at for c in claims
            ]
            last_activity = max((d for d in changed if d), default=None)

            item = self._convert_to_dict(client_obj)
            item['claim_count'] = len(claims)
            item['active_claim_count'] = len(active)
            item['latest_claim_status'] = shown.status if shown else None
            item['claim_stage'] = shown_stage.get('stage')
            item['claim_stage_detail'] = shown_stage.get('stage_detail')
            item['claim_stage_source'] = shown_stage.get('stage_source')
            item['claim_construction'] = shown_stage.get('construction')
            item['last_activity_at'] = last_activity.isoformat() if last_activity else None
            items.append(item)
        return items

    def get_all_with_counts(self, filters=None, order_by=None, limit=None, offset=None,
                            source: Optional[str] = None, staff: Any = None) -> List[Dict[str, Any]]:
        """Get all clients with claim counts, ordered by latest claim activity.
        With staff, only the clients and claims that person may see."""
        from app.domains.auth.company_scope import scoped

        try:
            # Subquery: latest claim activity per client
            latest_claim_activity = scoped(
                self.db_session.query(
                    Claim.client_id,
                    func.max(
                        func.coalesce(Claim.updated_at, Claim.created_at)
                    ).label('latest_activity')
                ),
                self._claim_scope(staff),
            ).group_by(Claim.client_id).subquery()

            query = (
                self.db_session.query(Client)
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
            query = self._filter_source(query, source)
            query = scoped(query, self._client_scope(staff))

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

            return self._list_items(query.all(), staff)
        except Exception as e:
            logger.error(f"Error getting clients with counts: {e}")
            raise

    def search_by_name(self, query: str, limit: int = 20,
                       source: Optional[str] = None, staff: Any = None) -> List[Dict[str, Any]]:
        """Search clients by display_name, address, phone, or email"""
        from app.domains.auth.company_scope import scoped

        try:
            search_term = f"%{query}%"
            base = scoped(self.db_session.query(Client), self._client_scope(staff))
            clients = self._filter_source(base, source).filter(
                or_(
                    Client.display_name.ilike(search_term),
                    Client.address.ilike(search_term),
                    Client.phone.ilike(search_term),
                    Client.email.ilike(search_term),
                    Client.city.ilike(search_term),
                )
            ).order_by(Client.display_name).limit(limit).all()
            return self._list_items(clients, staff)
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

            from app.domains.client.claim_companies import companies_by_claim
            claim_dict['companies'] = companies_by_claim(self.db_session, [claim_id]).get(str(claim_id), [])

            from app.domains.client.claim_paths import company_names, wm_company_ids
            claim_dict['wm_company_ids'] = sorted(wm_company_ids(self.db_session, claim_id))
            claim_dict['rebuild_estimate_company_name'] = company_names(
                self.db_session, [claim.rebuild_estimate_company_id]
            ).get(str(claim.rebuild_estimate_company_id or ''))

            from app.domains.client.claim_stage import claim_stages
            claim_dict.update(claim_stages(self.db_session, [claim])[str(claim.id)])

            return claim_dict
        except Exception as e:
            logger.error(f"Error getting claim with details: {e}")
            raise

    def get_claims_by_client(self, client_id: str, staff: Any = None) -> List[Dict[str, Any]]:
        """Get a client's claims, including assigned WM/rebuild company history.
        With staff, only the claims that person may see."""
        claims = self.get_all(filters={'client_id': client_id}, order_by='-created_at')
        if staff is not None:
            from app.domains.auth.company_scope import visible_claim_id_set
            visible = visible_claim_id_set(self.db_session, staff, [c['id'] for c in claims])
            if visible is not None:
                claims = [c for c in claims if str(c['id']) in visible]
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

        from app.domains.client.claim_paths import company_names, wm_company_ids_by_claim
        from app.domains.client.claim_companies import companies_by_claim
        wm_companies = wm_company_ids_by_claim(self.db_session, claim_ids)
        names = company_names(
            self.db_session, [c.get('rebuild_estimate_company_id') for c in claims]
        )
        companies = companies_by_claim(self.db_session, claim_ids)

        from app.domains.client.claim_stage import claim_stages
        stages = claim_stages(self.db_session, claims)

        for claim in claims:
            claim.update(stages[str(claim['id'])])
            claim['companies'] = companies.get(str(claim['id']), [])
            claim['wm_jobs'] = wm_jobs_by_claim.get(claim['id'], [])
            claim['wm_job_count'] = len(claim['wm_jobs'])
            claim['rebuild_jobs'] = rebuild_jobs_by_claim.get(claim['id'], [])
            claim['work_order_count'] = len(claim['rebuild_jobs'])
            claim['wm_company_ids'] = sorted(wm_companies.get(str(claim['id']), set()))
            claim['rebuild_estimate_company_name'] = names.get(
                str(claim.get('rebuild_estimate_company_id') or '')
            )

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
                # Estimates uploaded without a deductible send 0 — don't wipe one entered by hand
                if negotiation_data.get('deductible'):
                    claim.insurance_deductible = negotiation_data['deductible']

                # A revision is a carrier estimate, so the claim has one now
                if not claim.insurance_estimate_received:
                    claim.insurance_estimate_received = True
                    claim.insurance_estimate_received_date = datetime.now(timezone.utc)

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

    def sync_claim_amounts(self, claim_id: str, include_deductible: bool = False) -> None:
        """Point the claim's current amounts at its most recently added
        revision, the one create_and_update_claim set them from. Called after
        a revision is edited or deleted so the claim doesn't keep stale
        figures. Leaves the claim alone when no revision is left."""
        latest = self.db_session.query(ClaimNegotiation).filter(
            ClaimNegotiation.claim_id == claim_id
        ).order_by(ClaimNegotiation.created_at.desc()).first()
        claim = self.db_session.query(Claim).filter(Claim.id == claim_id).first()
        if not latest or not claim:
            return
        claim.current_acv = latest.acv_amount or 0
        claim.current_rcv = latest.rcv_amount or 0
        claim.current_depreciation = latest.depreciation_amount or 0
        # Same rule as on upload: a 0 deductible doesn't wipe one entered by hand
        if include_deductible and latest.deductible:
            claim.insurance_deductible = latest.deductible
        self.db_session.flush()


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
