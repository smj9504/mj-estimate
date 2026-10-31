"""
Client, Claim, and ClaimNegotiation service layer.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.common.base_service import BaseService
from app.core.interfaces import DatabaseProvider

logger = logging.getLogger(__name__)

# Insurance details a cash job doesn't take
CASH_JOB_CLEARED_FIELDS = (
    'insurance_company', 'insurance_policy_number', 'insurance_deductible',
    'deductible_discount', 'adjuster_name', 'adjuster_phone', 'adjuster_email',
    'pa_contact_id', 'estimate_origin', 'contractor_estimate_stage',
    'rebuild_estimate_company_id', 'appraisal_date',
)


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

    def get_with_claims(self, client_id: str, staff: Any = None) -> Optional[Dict[str, Any]]:
        """Get client with its claims, negotiations, and document counts
        (with staff, only what that person may see)"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_id_with_claims(client_id, staff=staff)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting client with claims: {e}")
            raise

    def get_all_with_counts(self, filters=None, order_by=None, limit=None, offset=None,
                            source: Optional[str] = None, staff: Any = None) -> List[Dict[str, Any]]:
        """Get all clients with claim counts"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_all_with_counts(
                    filters=filters, order_by=order_by, limit=limit, offset=offset,
                    source=source, staff=staff,
                )
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting clients with counts: {e}")
            raise

    def search(self, query: str, limit: int = 20, source: Optional[str] = None,
               staff: Any = None) -> List[Dict[str, Any]]:
        """Search clients by name"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.search_by_name(query, limit, source=source, staff=staff)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error searching clients: {e}")
            raise

    def count_by_source(self, staff: Any = None) -> Dict[str, int]:
        """Client totals for the list's 'entered here' / 'AccuLynx' tabs"""
        try:
            session = self.database.get_readonly_session()
            try:
                return self._get_repository_instance(session).count_by_source(staff=staff)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error searching clients: {e}")
            raise

    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a client, keeping normalized_address in sync with address
        so email-ingestion's address-based matching can use an exact-match
        index lookup instead of always falling back to a fuzzy ILIKE scan."""
        if entity_data.get("address"):
            from app.domains.client.address_utils import normalize_address
            entity_data["normalized_address"] = normalize_address(entity_data["address"])
        return super().create(entity_data)

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Recompute normalized_address whenever address changes."""
        if "address" in update_data:
            from app.domains.client.address_utils import normalize_address
            update_data["normalized_address"] = normalize_address(update_data["address"]) if update_data["address"] else None
        return super().update(entity_id, update_data)


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

    def set_companies(self, claim_id: str, company_ids: List[str]) -> None:
        """Replace the companies working a claim"""
        from app.domains.client.claim_companies import set_claim_companies
        from app.domains.client.models import Claim

        session = self.database.get_session()
        try:
            repo = self._get_repository_instance(session)
            set_claim_companies(repo.db_session, claim_id, [str(c) for c in company_ids])
            claim = repo.db_session.query(Claim).filter(Claim.id == claim_id).first()
            if claim is not None and company_ids and str(claim.company_id or '') not in {str(c) for c in company_ids}:
                claim.company_id = str(company_ids[0])
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Stamp appraisal_date when a claim moves to appraisal without one,
        so its history always says when it left negotiation."""
        if update_data.get('claim_type') == 'cash':
            for field in CASH_JOB_CLEARED_FIELDS:
                update_data.pop(field, None)
        if update_data.get('status') == 'appraisal' and not update_data.get('appraisal_date'):
            existing = self.get_by_id(entity_id)
            if existing and not existing.get('appraisal_date'):
                update_data['appraisal_date'] = datetime.now(timezone.utc)
        if 'rebuild_estimate_company_id' in update_data:
            company_id = (str(update_data['rebuild_estimate_company_id'] or '')).strip() or None
            update_data['rebuild_estimate_company_id'] = company_id
            if company_id:
                # Raises SameCompanyAsWMError for the company that did the WM
                from app.domains.client.claim_paths import check_rebuild_estimate_company
                session = self.database.get_readonly_session()
                try:
                    check_rebuild_estimate_company(session, entity_id, company_id)
                finally:
                    session.close()
        return super().update(entity_id, update_data)

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

    def get_by_client(self, client_id: str, staff: Any = None) -> List[Dict[str, Any]]:
        """Get a client's claims (with staff, the ones that person may see)"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_claims_by_client(client_id, staff=staff)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting claims by client: {e}")
            raise

    def create_with_initial_negotiation(self, claim_data: Dict[str, Any],
                                        company_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Create a claim or cash job, put its companies on it, and optionally
        create the initial negotiation"""
        try:
            initial_acv = claim_data.pop('initial_acv', None)
            initial_rcv = claim_data.pop('initial_rcv', None)
            claim_data['claim_type'] = claim_data.get('claim_type') or 'insurance'
            if claim_data['claim_type'] == 'cash':
                # A cash job carries no insurance details
                for field in CASH_JOB_CLEARED_FIELDS:
                    claim_data.pop(field, None)
                initial_acv = initial_rcv = None
            claim_data['claim_number'] = (claim_data.get('claim_number') or '').strip()
            company_ids = [str(c) for c in company_ids or []]
            if company_ids and not claim_data.get('company_id'):
                claim_data['company_id'] = company_ids[0]

            # Create claim
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                claim = repo.create(claim_data)
                claim_id = claim['id']
                if company_ids:
                    from app.domains.client.claim_companies import set_claim_companies
                    set_claim_companies(repo.db_session, claim_id, company_ids)

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
        """Add a new negotiation revision and update claim amounts.
        If sections_data is provided, auto-compute flat amounts from sections.
        If file_id is provided, look up file record for document_url/document_name.
        """
        try:
            # Handle sections_data: auto-compute flat amounts
            sections_data = negotiation_data.get('sections_data')
            if sections_data:
                # Convert Pydantic models to dicts if needed
                if sections_data and hasattr(sections_data[0], 'dict'):
                    sections_data = [s.dict() for s in sections_data]
                    negotiation_data['sections_data'] = sections_data

                from app.domains.client.negotiation_pdf_service import compute_totals
                totals = compute_totals(sections_data)
                negotiation_data['acv_amount'] = totals['acv_amount']
                negotiation_data['rcv_amount'] = totals['rcv_amount']
                negotiation_data['depreciation_amount'] = totals['depreciation_amount']
                negotiation_data['deductible'] = totals['deductible']
                negotiation_data['extraction_status'] = 'completed'

            # Handle file_id: resolve document_url and document_name
            file_id = negotiation_data.pop('file_id', None)
            if file_id:
                session_for_file = self.database.get_readonly_session()
                try:
                    from app.domains.file.models import File
                    file_record = session_for_file.query(File).filter(
                        File.id == file_id, File.is_active == True
                    ).first()
                    if file_record:
                        negotiation_data['document_url'] = str(file_record.id)
                        negotiation_data['document_name'] = file_record.original_name
                finally:
                    session_for_file.close()

            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.create_and_update_claim(negotiation_data)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error adding negotiation: {e}")
            raise

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Save a hand edit to a revision. Edited sections re-derive the
        revision's totals the same way an upload does, and the claim's current
        amounts follow its latest revision."""
        sections_data = update_data.get('sections_data')
        if sections_data:
            from app.domains.client.negotiation_pdf_service import compute_totals
            update_data.update(compute_totals(sections_data))
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                result = repo.update(entity_id, update_data)
                if result:
                    repo.sync_claim_amounts(str(result['claim_id']), include_deductible=True)
                    from app.domains.supplement.service import sync_original_amount
                    sync_original_amount(repo.db_session, str(result['claim_id']))
                    session.commit()
                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error updating negotiation {entity_id}: {e}")
            raise

    def delete(self, entity_id: str) -> bool:
        """Delete a revision and point the claim's amounts at the one before it."""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                existing = repo.get_by_id(entity_id)
                if not existing:
                    return False
                success = repo.delete(entity_id)
                if success:
                    repo.sync_claim_amounts(str(existing['claim_id']))
                    from app.domains.supplement.service import sync_original_amount
                    sync_original_amount(repo.db_session, str(existing['claim_id']))
                    session.commit()
                return success
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error deleting negotiation {entity_id}: {e}")
            raise

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all negotiations for a claim, with resolved file_download_id"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                negotiations = repo.get_by_claim(claim_id)

                # Resolve file_download_id for each negotiation
                from app.domains.file.models import File
                for neg in negotiations:
                    neg['file_download_id'] = None
                    doc_url = neg.get('document_url')
                    if doc_url:
                        file_rec = session.query(File).filter(
                            File.id == doc_url, File.is_active == True
                        ).first()
                        if file_rec:
                            neg['file_download_id'] = str(file_rec.id)
                        else:
                            # Fallback: find by context=negotiation + context_id=claim_id
                            file_rec = (
                                session.query(File)
                                .filter(
                                    File.context == 'negotiation',
                                    File.context_id == claim_id,
                                    File.is_active == True,
                                )
                                .order_by(File.created_at.desc())
                                .first()
                            )
                            if file_rec:
                                neg['file_download_id'] = str(file_rec.id)

                return negotiations
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting negotiations by claim: {e}")
            raise


class ClaimPaymentService:
    """Service for claim payment tracking"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    def create_payment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a payment record and update claim totals"""
        session = self._get_session()
        try:
            from app.domains.client.models import ClaimPayment, Claim
            from decimal import Decimal

            payment = ClaimPayment(**data)
            session.add(payment)
            session.flush()

            # Update claim total_insurance_paid
            self._recalculate_claim_totals(session, str(data['claim_id']))

            session.commit()
            return self._to_dict(payment)
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating payment: {e}")
            raise
        finally:
            session.close()

    def update_payment(self, payment_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a payment record"""
        session = self._get_session()
        try:
            from app.domains.client.models import ClaimPayment
            payment = session.query(ClaimPayment).filter(ClaimPayment.id == payment_id).first()
            if not payment:
                return None

            for key, value in data.items():
                if hasattr(payment, key) and value is not None:
                    setattr(payment, key, value)

            session.flush()

            # Recalculate claim totals
            self._recalculate_claim_totals(session, str(payment.claim_id))

            session.commit()
            return self._to_dict(payment)
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_payment(self, payment_id: str) -> bool:
        """Delete a payment record"""
        session = self._get_session()
        try:
            from app.domains.client.models import ClaimPayment
            payment = session.query(ClaimPayment).filter(ClaimPayment.id == payment_id).first()
            if not payment:
                return False

            claim_id = str(payment.claim_id)
            session.delete(payment)
            session.flush()

            self._recalculate_claim_totals(session, claim_id)

            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_payments_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all payments for a claim"""
        session = self._get_readonly_session()
        try:
            from app.domains.client.models import ClaimPayment
            payments = session.query(ClaimPayment).filter(
                ClaimPayment.claim_id == claim_id
            ).order_by(ClaimPayment.received_date.desc()).all()
            return [self._to_dict(p) for p in payments]
        finally:
            session.close()

    def get_payment_summary(self, claim_id: str) -> Dict[str, Any]:
        """Get payment summary for a claim"""
        session = self._get_readonly_session()
        try:
            from app.domains.client.models import Claim, ClaimPayment
            from decimal import Decimal

            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                raise ValueError(f"Claim {claim_id} not found")

            payments = session.query(ClaimPayment).filter(
                ClaimPayment.claim_id == claim_id
            ).order_by(ClaimPayment.received_date.desc()).all()

            total_paid = sum(float(p.amount or 0) for p in payments)
            invoice_amount = float(claim.final_invoice_amount or claim.our_estimate_amount or 0)
            deductible = float(claim.insurance_deductible or 0)
            net_expected = invoice_amount - deductible
            difference = invoice_amount - total_paid

            return {
                "total_invoice_amount": invoice_amount,
                "total_insurance_paid": total_paid,
                "payment_difference": difference,
                "deductible": deductible,
                "net_expected": net_expected,
                "payment_status": claim.payment_status or "unpaid",
                "insurance_estimate_received": claim.insurance_estimate_received or False,
                "needs_supplement": claim.needs_supplement or False,
                "payments": [self._to_dict(p) for p in payments],
            }
        finally:
            session.close()

    def _recalculate_claim_totals(self, session, claim_id: str):
        """Recalculate and update claim payment totals"""
        from app.domains.client.models import Claim, ClaimPayment
        from sqlalchemy import func as sqlfunc
        from decimal import Decimal

        total = session.query(sqlfunc.sum(ClaimPayment.amount)).filter(
            ClaimPayment.claim_id == claim_id
        ).scalar() or Decimal(0)

        claim = session.query(Claim).filter(Claim.id == claim_id).first()
        if claim:
            claim.total_insurance_paid = total
            invoice = float(claim.final_invoice_amount or claim.our_estimate_amount or 0)
            paid = float(total)
            if paid == 0:
                claim.payment_status = "unpaid"
            elif invoice <= 0:
                # 기대 금액을 모르는 상태 — 받은 돈이 전부인지 알 수 없으므로
                # 'paid'로 단정하지 않는다 (supplement로 더 들어올 수도 있다)
                claim.payment_status = "partial"
            elif paid < invoice:
                claim.payment_status = "partial"
            else:
                claim.payment_status = "paid"

    def _to_dict(self, obj) -> Dict[str, Any]:
        """Convert SQLAlchemy model to dict"""
        result = {}
        for column in obj.__table__.columns:
            value = getattr(obj, column.name, None)
            if hasattr(value, 'isoformat'):
                value = value.isoformat()
            elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None))):
                value = str(value)
            result[column.name] = value
        return result


class ClaimNoteService:
    """Service for claim notes"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _to_dict(self, obj) -> Dict[str, Any]:
        result = {}
        for column in obj.__table__.columns:
            value = getattr(obj, column.name, None)
            if hasattr(value, 'isoformat'):
                value = value.isoformat()
            elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None))):
                value = str(value)
            result[column.name] = value
        return result

    def get_notes_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self.database.get_readonly_session()
        try:
            from app.domains.client.models import ClaimNote
            notes = session.query(ClaimNote).filter(
                ClaimNote.claim_id == claim_id
            ).order_by(ClaimNote.pinned.desc(), ClaimNote.created_at.desc()).all()
            return [self._to_dict(n) for n in notes]
        finally:
            session.close()

    def create_note(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimNote
            note = ClaimNote(**data)
            session.add(note)
            session.flush()
            result = self._to_dict(note)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_note(self, note_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimNote
            note = session.query(ClaimNote).filter(ClaimNote.id == note_id).first()
            if not note:
                return None
            for key, value in data.items():
                if hasattr(note, key) and value is not None:
                    setattr(note, key, value)
            session.flush()
            result = self._to_dict(note)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_note(self, note_id: str) -> bool:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimNote
            note = session.query(ClaimNote).filter(ClaimNote.id == note_id).first()
            if not note:
                return False
            session.delete(note)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()


class ClaimTodoService:
    """Service for claim todos. A todo may be assigned to several people: it is
    one todo, with one status, on each of their boards at their own place."""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _to_dict(self, obj) -> Dict[str, Any]:
        result = {}
        for column in obj.__table__.columns:
            value = getattr(obj, column.name, None)
            if hasattr(value, 'isoformat'):
                value = value.isoformat()
            elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None))):
                value = str(value)
            result[column.name] = value
        return result

    def get_todos_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self.database.get_readonly_session()
        try:
            from app.domains.client.models import ClaimTodo
            todos = session.query(ClaimTodo).filter(
                ClaimTodo.claim_id == claim_id
            ).order_by(ClaimTodo.is_completed, ClaimTodo.created_at.desc()).all()
            return [self._to_dict(t) for t in todos]
        finally:
            session.close()

    @staticmethod
    def _apply_status(todo, status: str) -> None:
        """Move a todo to a board column, keeping is_completed / completed_at in step with Done"""
        from datetime import datetime, timezone
        if status == 'done':
            if not todo.is_completed or not todo.completed_at:
                todo.completed_at = datetime.now(timezone.utc)
            todo.is_completed = True
        else:
            todo.is_completed = False
            todo.completed_at = None
        todo.status = status

    @classmethod
    def _top_sort_order(cls, session, status: str, owner_id, exclude_id=None) -> int:
        """A sort_order that puts a todo above everything already in the column on
        this person's board (or among the todos on nobody's, for none)"""
        from sqlalchemy import func as sa_func
        from app.domains.client.models import ClaimTodo, ClaimTodoAssignee
        if owner_id is None:
            query = session.query(sa_func.min(ClaimTodo.sort_order)).filter(
                ClaimTodo.status == status, ClaimTodo.owner_id.is_(None)
            )
        else:
            query = session.query(sa_func.min(ClaimTodoAssignee.sort_order)).join(
                ClaimTodo, ClaimTodo.id == ClaimTodoAssignee.todo_id
            ).filter(ClaimTodo.status == status, ClaimTodoAssignee.staff_id == str(owner_id))
        if exclude_id is not None:
            query = query.filter(ClaimTodo.id != exclude_id)
        lowest = query.scalar()
        return 0 if lowest is None else lowest - 1

    @classmethod
    def _to_top_everywhere(cls, session, todo) -> None:
        """A todo that changed column goes to the top of it on every board it's on"""
        from app.domains.client.models import ClaimTodoAssignee
        todo.sort_order = cls._top_sort_order(session, todo.status, todo.owner_id, exclude_id=todo.id)
        for row in session.query(ClaimTodoAssignee).filter(ClaimTodoAssignee.todo_id == todo.id).all():
            row.sort_order = cls._top_sort_order(session, todo.status, row.staff_id, exclude_id=todo.id)

    @classmethod
    def _assignees_of(cls, session, todo_ids) -> Dict[str, List[Dict[str, Any]]]:
        """Each todo's assignees, the one it was made for first, then by name"""
        from app.domains.client.models import ClaimTodo, ClaimTodoAssignee
        from app.domains.staff.models import Staff
        ids = [str(i) for i in todo_ids]
        if not ids:
            return {}
        rows = session.query(
            ClaimTodoAssignee.todo_id, Staff.id, Staff.first_name, Staff.last_name, ClaimTodo.owner_id,
        ).join(Staff, Staff.id == ClaimTodoAssignee.staff_id).join(
            ClaimTodo, ClaimTodo.id == ClaimTodoAssignee.todo_id
        ).filter(ClaimTodoAssignee.todo_id.in_(ids)).all()
        found: Dict[str, List[Dict[str, Any]]] = {}
        for todo_id, staff_id, first_name, last_name, owner_id in rows:
            found.setdefault(str(todo_id), []).append({
                'id': str(staff_id),
                'name': cls._staff_name(first_name, last_name),
                'first': str(staff_id) == str(owner_id),
            })
        for people in found.values():
            people.sort(key=lambda a: (not a.pop('first'), (a['name'] or '').lower()))
        return found

    @staticmethod
    def _staff_name(first_name, last_name) -> Optional[str]:
        return ' '.join(n for n in (first_name, last_name) if n) or None

    def _with_context(self, session, todo) -> Dict[str, Any]:
        """The todo plus its client name, claim number, owner name and assignees"""
        from app.domains.client.models import Claim, Client
        from app.domains.staff.models import Staff
        result = self._to_dict(todo)
        client = session.query(Client).filter(Client.id == todo.client_id).first() if todo.client_id else None
        claim = session.query(Claim).filter(Claim.id == todo.claim_id).first() if todo.claim_id else None
        owner = session.query(Staff).filter(Staff.id == todo.owner_id).first() if todo.owner_id else None
        result['client_name'] = client.display_name if client else None
        result['claim_number'] = claim.claim_number if claim else None
        result['owner_name'] = self._staff_name(owner.first_name, owner.last_name) if owner else None
        result['assignees'] = self._assignees_of(session, [todo.id]).get(str(todo.id), [])
        return result

    def create_todo(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """New todos go to the top of their column on each assignee's board. The
        owner is assigned, and so is everyone in assignee_ids; without an owner,
        the first of them is it."""
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimTodo, ClaimTodoAssignee, Claim
            status = data.pop('status', None) or 'todo'
            people = [str(data['owner_id'])] if data.get('owner_id') else []
            people += [str(i) for i in data.pop('assignee_ids', None) or [] if i]
            people = list(dict.fromkeys(people))
            if people and not data.get('owner_id'):
                data['owner_id'] = people[0]
            if data.get('claim_id') and not data.get('client_id'):
                claim = session.query(Claim).filter(Claim.id == data['claim_id']).first()
                if claim:
                    data['client_id'] = claim.client_id
            todo = ClaimTodo(**data)
            self._apply_status(todo, status)
            todo.sort_order = self._top_sort_order(session, status, todo.owner_id)
            places = {person: self._top_sort_order(session, status, person) for person in people}
            session.add(todo)
            session.flush()
            for person, place in places.items():
                session.add(ClaimTodoAssignee(todo_id=todo.id, staff_id=person, sort_order=place))
            session.flush()
            result = self._with_context(session, todo)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_todo(self, todo_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimTodo
            todo = session.query(ClaimTodo).filter(ClaimTodo.id == todo_id).first()
            if not todo:
                return None

            # The board sends a status; the older claim checkbox sends is_completed
            completed = data.pop('is_completed', None)
            status = data.pop('status', None)
            if status is None and completed is not None:
                status = 'done' if completed else 'todo'
            if status and status != todo.status:
                self._apply_status(todo, status)
                self._to_top_everywhere(session, todo)

            # Another client (or none) takes the todo off the old client's claim
            if 'client_id' in data and 'claim_id' not in data:
                if str(data['client_id'] or '') != str(todo.client_id or ''):
                    todo.claim_id = None

            for key, value in data.items():
                if key == 'title' and not value:
                    continue
                if hasattr(todo, key):
                    setattr(todo, key, value)

            session.flush()
            result = self._with_context(session, todo)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_todo(self, todo_id: str) -> bool:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimTodo
            todo = session.query(ClaimTodo).filter(ClaimTodo.id == todo_id).first()
            if not todo:
                return False
            session.delete(todo)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def list_todos(
        self,
        owner_id: Optional[str] = None,
        client_id: Optional[str] = None,
        claim_id: Optional[str] = None,
        staff: Any = None,
    ) -> List[Dict[str, Any]]:
        """Todos in board order: To do, In progress, Done, each in its drag order.

        With an owner: the todos assigned to that person, at their places on
        their board. With a claim: that claim's todos and the client's todos
        that are not tied to a claim, whoever they're assigned to, each once.
        With only a client: all of the client's todos. With staff, todos on
        claims that person may not see are left out. Each comes with its
        assignees.
        """
        session = self.database.get_readonly_session()
        try:
            from sqlalchemy import and_, case, or_
            from app.domains.client.models import ClaimTodo, ClaimTodoAssignee, Claim, Client
            from app.domains.staff.models import Staff

            query = session.query(
                ClaimTodo, Client.display_name, Claim.claim_number, Staff.first_name, Staff.last_name,
            ).outerjoin(
                Client, ClaimTodo.client_id == Client.id
            ).outerjoin(
                Claim, ClaimTodo.claim_id == Claim.id
            ).outerjoin(
                Staff, ClaimTodo.owner_id == Staff.id
            )
            place = ClaimTodo.sort_order
            if owner_id:
                query = query.join(ClaimTodoAssignee, and_(
                    ClaimTodoAssignee.todo_id == ClaimTodo.id,
                    ClaimTodoAssignee.staff_id == str(owner_id),
                )).add_columns(ClaimTodoAssignee.sort_order)
                place = ClaimTodoAssignee.sort_order
            if claim_id:
                condition = ClaimTodo.claim_id == claim_id
                if client_id:
                    condition = or_(
                        condition,
                        and_(ClaimTodo.client_id == client_id, ClaimTodo.claim_id.is_(None)),
                    )
                query = query.filter(condition)
            elif client_id:
                query = query.filter(ClaimTodo.client_id == client_id)
            if staff is not None:
                from app.domains.auth.company_scope import claim_condition
                scope = claim_condition(session, staff, ClaimTodo.claim_id)
                if scope is not None:
                    query = query.filter(or_(ClaimTodo.claim_id.is_(None), scope))

            column_rank = case(
                (ClaimTodo.status == 'in_progress', 1),
                (ClaimTodo.status == 'done', 2),
                else_=0,
            )
            query = query.order_by(column_rank, place, ClaimTodo.created_at.desc())

            rows = query.all()
            assignees = self._assignees_of(session, [row[0].id for row in rows])
            todos = []
            for todo, client_name, claim_number, first_name, last_name, *own_place in rows:
                todo_dict = self._to_dict(todo)
                if own_place:
                    todo_dict['sort_order'] = own_place[0]
                todo_dict['client_name'] = client_name
                todo_dict['claim_number'] = claim_number
                todo_dict['owner_name'] = self._staff_name(first_name, last_name)
                todo_dict['assignees'] = assignees.get(str(todo.id), [])
                todos.append(todo_dict)
            return todos
        finally:
            session.close()

    def reorder_todos(self, owner_id: str, status: str, ids: List[str]) -> int:
        """Set one column of a person's board after a drop; a todo dragged in from
        another column changes status, and goes to the top of it on the other
        boards it's on"""
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimTodo, ClaimTodoAssignee
            pairs = session.query(ClaimTodoAssignee, ClaimTodo).join(
                ClaimTodo, ClaimTodo.id == ClaimTodoAssignee.todo_id
            ).filter(
                ClaimTodo.id.in_([str(i) for i in ids]), ClaimTodoAssignee.staff_id == str(owner_id)
            ).all()
            by_id = {str(todo.id): (row, todo) for row, todo in pairs}
            for index, todo_id in enumerate(ids):
                pair = by_id.get(str(todo_id))
                if not pair:
                    continue
                row, todo = pair
                if todo.status != status:
                    self._apply_status(todo, status)
                    self._to_top_everywhere(session, todo)
                row.sort_order = index
                if str(todo.owner_id) == str(owner_id):
                    todo.sort_order = index
            session.commit()
            return len(by_id)
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_active_todos(self, include_completed: bool = False, staff: Any = None) -> List[Dict[str, Any]]:
        """Get all todos across all claims (with staff, the claims that person
        may see), with client/claim context for dashboard"""
        session = self.database.get_readonly_session()
        try:
            from app.domains.auth.company_scope import claim_condition, scoped
            from app.domains.client.models import ClaimTodo, Claim, Client

            query = session.query(ClaimTodo, Claim, Client).join(
                Claim, ClaimTodo.claim_id == Claim.id
            ).join(
                Client, Claim.client_id == Client.id
            )
            if staff is not None:
                query = scoped(query, claim_condition(session, staff, ClaimTodo.claim_id))

            if not include_completed:
                query = query.filter(ClaimTodo.is_completed == False)

            query = query.order_by(
                ClaimTodo.is_completed,
                ClaimTodo.due_date.asc().nulls_last(),
                ClaimTodo.created_at.desc(),
            )

            results = query.all()
            todos = []
            for todo, claim, client in results:
                todo_dict = self._to_dict(todo)
                todo_dict['client_id'] = str(client.id)
                todo_dict['client_name'] = client.display_name
                todo_dict['claim_number'] = claim.claim_number
                todos.append(todo_dict)
            return todos
        finally:
            session.close()


class ClaimExpenseService:
    """Service for claim expense tracking and profitability analysis"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _to_dict(self, obj) -> Dict[str, Any]:
        result = {}
        for column in obj.__table__.columns:
            value = getattr(obj, column.name, None)
            if hasattr(value, 'isoformat'):
                value = value.isoformat()
            elif hasattr(value, '__str__') and not isinstance(value, (str, int, float, bool, type(None))):
                value = str(value)
            result[column.name] = value
        return result

    def create_expense(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimExpense
            expense = ClaimExpense(**data)
            session.add(expense)
            session.flush()
            result = self._to_dict(expense)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_expense(self, expense_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimExpense
            expense = session.query(ClaimExpense).filter(ClaimExpense.id == expense_id).first()
            if not expense:
                return None
            for key, value in data.items():
                if hasattr(expense, key) and value is not None:
                    setattr(expense, key, value)
            session.flush()
            result = self._to_dict(expense)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_expense(self, expense_id: str) -> bool:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimExpense
            expense = session.query(ClaimExpense).filter(ClaimExpense.id == expense_id).first()
            if not expense:
                return False
            session.delete(expense)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_expenses_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self.database.get_readonly_session()
        try:
            from app.domains.client.models import ClaimExpense
            expenses = session.query(ClaimExpense).filter(
                ClaimExpense.claim_id == claim_id
            ).order_by(ClaimExpense.created_at).all()
            return [self._to_dict(e) for e in expenses]
        finally:
            session.close()

    def get_profitability_summary(self, claim_id: str) -> Dict[str, Any]:
        session = self.database.get_readonly_session()
        try:
            from app.domains.client.models import Claim, ClaimExpense, ClaimPayment
            from decimal import Decimal

            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                raise ValueError(f"Claim {claim_id} not found")

            expenses = session.query(ClaimExpense).filter(
                ClaimExpense.claim_id == claim_id
            ).all()

            # Revenue = total insurance paid
            total_paid = float(claim.total_insurance_paid or 0)

            # PA fee calculation: (RCV - deductible) * pa_pct%
            pa_pct = float(claim.pa_fee_percentage or 0)
            deductible = float(claim.insurance_deductible or 0)
            # Revenue above is insurance money only, so the waived deductible is
            # reported beside it rather than subtracted from profit
            deductible_discount = min(float(claim.deductible_discount or 0), deductible)
            current_rcv = float(claim.current_rcv or 0)
            pa_fee_base = max(0, current_rcv - deductible)
            pa_fee = pa_fee_base * (pa_pct / 100) if claim.has_public_adjuster and pa_pct > 0 else 0

            # Expense breakdown by category
            cat_totals = {}
            for exp in expenses:
                cat = exp.category or 'other'
                cat_totals[cat] = cat_totals.get(cat, 0) + float(exp.amount or 0)

            total_material = cat_totals.get('material', 0)
            total_labor = cat_totals.get('labor', 0)
            total_subcontractor = cat_totals.get('subcontractor', 0)
            total_equipment = cat_totals.get('equipment', 0)
            total_other = sum(v for k, v in cat_totals.items()
                             if k not in ('material', 'labor', 'subcontractor', 'equipment'))
            total_expenses = sum(cat_totals.values())

            # Profit calculations
            gross_profit = total_paid - pa_fee  # Revenue after PA fee
            net_profit = gross_profit - total_expenses
            gross_margin_pct = (gross_profit / total_paid * 100) if total_paid > 0 else 0
            net_margin_pct = (net_profit / total_paid * 100) if total_paid > 0 else 0

            return {
                "total_insurance_paid": total_paid,
                "current_rcv": current_rcv,
                "deductible": deductible,
                "deductible_discount": round(deductible_discount, 2),
                "homeowner_deductible_due": round(deductible - deductible_discount, 2),
                "pa_fee_percentage": pa_pct,
                "pa_fee_base": round(pa_fee_base, 2),
                "pa_fee_amount": round(pa_fee, 2),
                "total_material": round(total_material, 2),
                "total_labor": round(total_labor, 2),
                "total_subcontractor": round(total_subcontractor, 2),
                "total_equipment": round(total_equipment, 2),
                "total_other_expenses": round(total_other, 2),
                "total_expenses": round(total_expenses, 2),
                "gross_profit": round(gross_profit, 2),
                "gross_margin_pct": round(gross_margin_pct, 1),
                "net_profit": round(net_profit, 2),
                "net_margin_pct": round(net_margin_pct, 1),
                "expenses": [self._to_dict(e) for e in expenses],
            }
        finally:
            session.close()
