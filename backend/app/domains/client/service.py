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
            elif paid < invoice:
                claim.payment_status = "partial"
            elif paid >= invoice:
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
    """Service for claim todos"""

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

    def create_todo(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self.database.get_session()
        try:
            from app.domains.client.models import ClaimTodo
            todo = ClaimTodo(**data)
            session.add(todo)
            session.flush()
            result = self._to_dict(todo)
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
            from datetime import datetime, timezone
            todo = session.query(ClaimTodo).filter(ClaimTodo.id == todo_id).first()
            if not todo:
                return None

            # Handle completion toggle
            if 'is_completed' in data:
                if data['is_completed'] and not todo.is_completed:
                    data['completed_at'] = datetime.now(timezone.utc)
                elif not data['is_completed']:
                    data['completed_at'] = None

            for key, value in data.items():
                if hasattr(todo, key):
                    setattr(todo, key, value)

            session.flush()
            result = self._to_dict(todo)
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

    def get_active_todos(self, include_completed: bool = False) -> List[Dict[str, Any]]:
        """Get all todos across all claims, with client/claim context for dashboard"""
        session = self.database.get_readonly_session()
        try:
            from app.domains.client.models import ClaimTodo, Claim, Client

            query = session.query(ClaimTodo, Claim, Client).join(
                Claim, ClaimTodo.claim_id == Claim.id
            ).join(
                Client, Claim.client_id == Client.id
            )

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
