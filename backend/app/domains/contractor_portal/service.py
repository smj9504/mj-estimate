"""Contractor Portal service layer."""

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from app.core.database_factory import get_database

logger = logging.getLogger(__name__)


class ContractorPortalService:
    def __init__(self):
        self.database = get_database()

    def validate_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Validate a portal token and return contact info."""
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            portal_token = (
                session.query(ContractorPortalToken)
                .filter(
                    ContractorPortalToken.token == token,
                    ContractorPortalToken.is_active == True,
                )
                .first()
            )
            if not portal_token:
                return None

            # Update last accessed
            portal_token.last_accessed_at = datetime.now(timezone.utc)
            session.commit()

            contact = portal_token.contact
            if not contact:
                return None

            return {
                "contact_id": str(contact.id),
                "contact_name": contact.name,
                "contact_email": contact.email,
                "company_id": str(contact.company_id) if contact.company_id else None,
            }

    def get_all_claims_for_contact(self, token: str) -> List[Dict[str, Any]]:
        """Get all claims across all companies this contact works for."""
        from app.domains.client.models import Claim, ClaimPayment, Client
        from app.domains.company.models import Company, CompanyContact
        from app.domains.contract.models import ClaimCompany
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            portal_token = (
                session.query(ContractorPortalToken)
                .filter(
                    ContractorPortalToken.token == token,
                    ContractorPortalToken.is_active == True,
                )
                .first()
            )
            if not portal_token or not portal_token.contact:
                return []

            contact = portal_token.contact

            # Find all companies this contact is associated with
            # (same person might be contact at multiple companies)
            company_ids = set()
            if contact.company_id:
                company_ids.add(str(contact.company_id))

            # Also find by matching name+email across companies
            if contact.email:
                other_contacts = (
                    session.query(CompanyContact)
                    .filter(
                        CompanyContact.email == contact.email,
                        CompanyContact.is_active == True,
                    )
                    .all()
                )
                for c in other_contacts:
                    if c.company_id:
                        company_ids.add(str(c.company_id))

            if not company_ids:
                return []

            # Find all claims assigned to any of these companies
            claim_companies = (
                session.query(ClaimCompany, Claim, Client, Company)
                .join(Claim, ClaimCompany.claim_id == Claim.id)
                .join(Client, Claim.client_id == Client.id)
                .join(Company, ClaimCompany.company_id == Company.id)
                .filter(ClaimCompany.company_id.in_(company_ids))
                .order_by(Claim.created_at.desc())
                .all()
            )

            # Calculate received totals per claim
            claim_ids = [str(cc.id) for cc, _, _, _ in claim_companies]
            payment_totals = {}
            if claim_ids:
                totals = (
                    session.query(
                        ClaimPayment.claim_id,
                        func.sum(ClaimPayment.amount),
                    )
                    .filter(ClaimPayment.claim_id.in_(
                        [cc.claim_id for cc, _, _, _ in claim_companies]
                    ))
                    .group_by(ClaimPayment.claim_id)
                    .all()
                )
                payment_totals = {str(t[0]): float(t[1] or 0) for t in totals}

            results = []
            for cc, claim, client, company in claim_companies:
                # Expected = RCV - Deductible (deductible is homeowner's responsibility)
                rcv = float(claim.current_rcv or 0)
                deductible = float(claim.insurance_deductible or 0) if hasattr(claim, 'insurance_deductible') else 0
                expected = rcv - deductible
                received = payment_totals.get(str(claim.id), 0)
                address_parts = []
                if client.address:
                    address_parts.append(client.address)
                if client.city:
                    address_parts.append(client.city)
                if client.state:
                    address_parts.append(client.state)

                results.append({
                    "claim_id": str(claim.id),
                    "claim_number": claim.claim_number,
                    "insurance_company": claim.insurance_company,
                    "client_name": client.display_name,
                    "address": ", ".join(address_parts) if address_parts else None,
                    "city": client.city,
                    "company_name": company.name,
                    "role": cc.role,
                    "date_of_loss": claim.date_of_loss.isoformat() if claim.date_of_loss else None,
                    "expected_amount": expected,
                    "received_total": received,
                    "remaining": max(0, expected - received),
                })

            return results

    def get_payments(self, token: str, claim_id: str) -> Dict[str, Any]:
        """Get payments for a claim with summary."""
        from app.domains.client.models import Claim, ClaimPayment
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            # Validate token
            portal_token = (
                session.query(ContractorPortalToken)
                .filter(
                    ContractorPortalToken.token == token,
                    ContractorPortalToken.is_active == True,
                )
                .first()
            )
            if not portal_token:
                return {"payments": [], "total_by_category": {}, "grand_total": 0, "expected": {}}

            # Get claim for expected amounts
            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                return {"payments": [], "total_by_category": {}, "grand_total": 0, "expected": {}}

            # Get all payments for this claim
            payments = (
                session.query(ClaimPayment)
                .filter(ClaimPayment.claim_id == claim_id)
                .order_by(ClaimPayment.created_at.desc())
                .all()
            )

            total_by_category = defaultdict(float)
            grand_total = 0.0
            payment_list = []

            for p in payments:
                amt = float(p.amount or 0)
                grand_total += amt
                cat = p.payment_category or "other"
                total_by_category[cat] += amt

                payment_list.append({
                    "id": str(p.id),
                    "payment_type": p.payment_type,
                    "payment_category": p.payment_category,
                    "amount": amt,
                    "check_number": p.check_number,
                    "check_date": p.check_date.isoformat() if p.check_date else None,
                    "received_date": p.received_date.isoformat() if p.received_date else None,
                    "pa_fee_deducted": p.pa_fee_deducted,
                    "pa_fee_amount": float(p.pa_fee_amount) if p.pa_fee_amount else None,
                    "gross_amount": float(p.gross_amount) if p.gross_amount else None,
                    "check_photo_file_id": p.check_photo_file_id,
                    "source": p.source,
                    "notes": p.notes,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                })

            return {
                "payments": payment_list,
                "total_by_category": dict(total_by_category),
                "grand_total": grand_total,
                "expected": {
                    "rcv": float(claim.current_rcv or 0),
                    "acv": float(claim.current_acv or 0),
                    "depreciation": float(claim.current_depreciation or 0),
                    "deductible": float(claim.insurance_deductible or 0) if hasattr(claim, 'insurance_deductible') else 0,
                    "pa_fee_percentage": float(claim.pa_fee_percentage or 20) if claim.has_public_adjuster else 0,
                },
            }

    def create_payment(self, token: str, claim_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create a payment from the contractor portal."""
        from app.domains.client.models import ClaimPayment
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            portal_token = (
                session.query(ContractorPortalToken)
                .filter(
                    ContractorPortalToken.token == token,
                    ContractorPortalToken.is_active == True,
                )
                .first()
            )
            if not portal_token:
                return None

            payment = ClaimPayment(
                claim_id=claim_id,
                payment_type=data.get("payment_type", "insurance"),
                payment_category=data.get("payment_category"),
                amount=data.get("amount", 0),
                check_number=data.get("check_number"),
                check_date=data.get("check_date"),
                received_date=data.get("received_date"),
                pa_fee_deducted=data.get("pa_fee_deducted", True),
                pa_fee_amount=data.get("pa_fee_amount"),
                gross_amount=data.get("gross_amount"),
                check_photo_file_id=data.get("check_photo_file_id"),
                notes=data.get("memo"),
                source="contractor_portal",
                contractor_company_id=data.get("company_id"),
            )
            session.add(payment)
            session.commit()
            session.refresh(payment)

            return {
                "id": str(payment.id),
                "payment_type": payment.payment_type,
                "payment_category": payment.payment_category,
                "amount": float(payment.amount or 0),
                "check_number": payment.check_number,
                "check_date": payment.check_date.isoformat() if payment.check_date else None,
                "received_date": payment.received_date.isoformat() if payment.received_date else None,
                "pa_fee_deducted": payment.pa_fee_deducted,
                "pa_fee_amount": float(payment.pa_fee_amount) if payment.pa_fee_amount else None,
                "gross_amount": float(payment.gross_amount) if payment.gross_amount else None,
                "check_photo_file_id": payment.check_photo_file_id,
                "source": payment.source,
                "notes": payment.notes,
                "created_at": payment.created_at.isoformat() if payment.created_at else None,
            }

    # ── Auth-based methods (for logged-in contractors) ──

    def get_claims_for_company(self, company_id: str = None) -> List[Dict[str, Any]]:
        """Get claims assigned to a company, or all claims if no company_id."""
        from app.domains.client.models import Claim, ClaimPayment, Client
        from app.domains.company.models import Company
        from app.domains.contract.models import ClaimCompany

        with self.database.get_session() as session:
            query = (
                session.query(ClaimCompany, Claim, Client, Company)
                .join(Claim, ClaimCompany.claim_id == Claim.id)
                .join(Client, Claim.client_id == Client.id)
                .join(Company, ClaimCompany.company_id == Company.id)
            )
            if company_id:
                query = query.filter(ClaimCompany.company_id == company_id)
            claim_companies = query.order_by(Claim.created_at.desc()).all()

            payment_totals = {}
            if claim_companies:
                totals = (
                    session.query(
                        ClaimPayment.claim_id,
                        func.sum(ClaimPayment.amount),
                    )
                    .filter(ClaimPayment.claim_id.in_(
                        [cc.claim_id for cc, _, _, _ in claim_companies]
                    ))
                    .group_by(ClaimPayment.claim_id)
                    .all()
                )
                payment_totals = {
                    str(t[0]): float(t[1] or 0) for t in totals
                }

            results = []
            for cc, claim, client, company in claim_companies:
                expected = float(claim.current_rcv or 0)
                received = payment_totals.get(str(claim.id), 0)
                address_parts = []
                if client.address:
                    address_parts.append(client.address)
                if client.city:
                    address_parts.append(client.city)
                if client.state:
                    address_parts.append(client.state)

                results.append({
                    "claim_id": str(claim.id),
                    "claim_number": claim.claim_number,
                    "insurance_company": claim.insurance_company,
                    "client_name": client.display_name,
                    "address": ", ".join(address_parts) if address_parts else None,
                    "city": client.city,
                    "company_name": company.name,
                    "role": cc.role,
                    "date_of_loss": (
                        claim.date_of_loss.isoformat()
                        if claim.date_of_loss else None
                    ),
                    "expected_amount": expected,
                    "received_total": received,
                    "remaining": max(0, expected - received),
                })
            return results

    def get_payments_by_claim(self, claim_id: str) -> Dict[str, Any]:
        """Get payments for a claim (no token needed)."""
        from app.domains.client.models import Claim, ClaimPayment

        with self.database.get_session() as session:
            claim = session.query(Claim).filter(
                Claim.id == claim_id
            ).first()
            if not claim:
                return {
                    "payments": [],
                    "total_by_category": {},
                    "grand_total": 0,
                    "expected": {},
                }

            payments = (
                session.query(ClaimPayment)
                .filter(ClaimPayment.claim_id == claim_id)
                .order_by(ClaimPayment.created_at.desc())
                .all()
            )

            total_by_category = defaultdict(float)
            grand_total = 0.0
            payment_list = []

            for p in payments:
                amt = float(p.amount or 0)
                grand_total += amt
                cat = p.payment_category or "other"
                total_by_category[cat] += amt

                payment_list.append({
                    "id": str(p.id),
                    "payment_type": p.payment_type,
                    "payment_category": p.payment_category,
                    "amount": amt,
                    "check_number": p.check_number,
                    "check_date": (
                        p.check_date.isoformat()
                        if p.check_date else None
                    ),
                    "received_date": (
                        p.received_date.isoformat()
                        if p.received_date else None
                    ),
                    "pa_fee_deducted": p.pa_fee_deducted,
                    "pa_fee_amount": (
                        float(p.pa_fee_amount)
                        if p.pa_fee_amount else None
                    ),
                    "gross_amount": (
                        float(p.gross_amount)
                        if p.gross_amount else None
                    ),
                    "check_photo_file_id": p.check_photo_file_id,
                    "source": p.source,
                    "notes": p.notes,
                    "created_at": (
                        p.created_at.isoformat()
                        if p.created_at else None
                    ),
                })

            return {
                "payments": payment_list,
                "total_by_category": dict(total_by_category),
                "grand_total": grand_total,
                "expected": {
                    "rcv": float(claim.current_rcv or 0),
                    "acv": float(claim.current_acv or 0),
                    "depreciation": float(
                        claim.current_depreciation or 0
                    ),
                    "deductible": (
                        float(claim.insurance_deductible or 0)
                        if hasattr(claim, 'insurance_deductible')
                        else 0
                    ),
                    "pa_fee_percentage": float(claim.pa_fee_percentage or 20) if claim.has_public_adjuster else 0,
                },
            }

    def create_payment_direct(
        self, claim_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Create payment without token validation."""
        from app.domains.client.models import ClaimPayment

        with self.database.get_session() as session:
            payment = ClaimPayment(
                claim_id=claim_id,
                payment_type=data.get("payment_type", "insurance"),
                payment_category=data.get("payment_category"),
                amount=data.get("amount", 0),
                check_number=data.get("check_number"),
                check_date=data.get("check_date"),
                received_date=data.get("received_date"),
                pa_fee_deducted=data.get("pa_fee_deducted", True),
                pa_fee_amount=data.get("pa_fee_amount"),
                gross_amount=data.get("gross_amount"),
                check_photo_file_id=data.get("check_photo_file_id"),
                notes=data.get("memo"),
                source="contractor_portal",
                contractor_company_id=data.get("company_id"),
            )
            session.add(payment)
            session.commit()
            session.refresh(payment)

            return {
                "id": str(payment.id),
                "payment_type": payment.payment_type,
                "payment_category": payment.payment_category,
                "amount": float(payment.amount or 0),
                "check_number": payment.check_number,
                "check_date": (
                    payment.check_date.isoformat()
                    if payment.check_date else None
                ),
                "pa_fee_deducted": payment.pa_fee_deducted,
                "pa_fee_amount": (
                    float(payment.pa_fee_amount)
                    if payment.pa_fee_amount else None
                ),
                "gross_amount": (
                    float(payment.gross_amount)
                    if payment.gross_amount else None
                ),
                "check_photo_file_id": payment.check_photo_file_id,
                "source": payment.source,
                "notes": payment.notes,
                "created_at": (
                    payment.created_at.isoformat()
                    if payment.created_at else None
                ),
            }

    # ── Admin methods ──

    def create_token(self, company_contact_id: str) -> Optional[Dict[str, Any]]:
        """Create a portal token for a company contact."""
        from app.domains.company.models import Company, CompanyContact
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            contact = session.query(CompanyContact).filter(
                CompanyContact.id == company_contact_id
            ).first()
            if not contact:
                return None

            # Check for existing active token
            existing = (
                session.query(ContractorPortalToken)
                .filter(
                    ContractorPortalToken.company_contact_id == company_contact_id,
                    ContractorPortalToken.is_active == True,
                )
                .first()
            )
            if existing:
                company = session.query(Company).filter(Company.id == contact.company_id).first()
                return {
                    "id": str(existing.id),
                    "token": existing.token,
                    "contact_name": contact.name,
                    "contact_email": contact.email,
                    "company_name": company.name if company else None,
                    "is_active": existing.is_active,
                    "last_accessed_at": existing.last_accessed_at.isoformat() if existing.last_accessed_at else None,
                    "created_at": existing.created_at.isoformat() if existing.created_at else None,
                }

            token_obj = ContractorPortalToken(
                company_contact_id=company_contact_id,
            )
            session.add(token_obj)
            session.commit()
            session.refresh(token_obj)

            company = session.query(Company).filter(Company.id == contact.company_id).first()
            return {
                "id": str(token_obj.id),
                "token": token_obj.token,
                "contact_name": contact.name,
                "contact_email": contact.email,
                "company_name": company.name if company else None,
                "is_active": token_obj.is_active,
                "last_accessed_at": None,
                "created_at": token_obj.created_at.isoformat() if token_obj.created_at else None,
            }

    def list_tokens(self, company_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List portal tokens, optionally filtered by company."""
        from app.domains.company.models import Company, CompanyContact
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            query = (
                session.query(ContractorPortalToken, CompanyContact, Company)
                .join(CompanyContact, ContractorPortalToken.company_contact_id == CompanyContact.id)
                .join(Company, CompanyContact.company_id == Company.id)
                .filter(ContractorPortalToken.is_active == True)
            )
            if company_id:
                query = query.filter(CompanyContact.company_id == company_id)

            query = query.order_by(ContractorPortalToken.created_at.desc())
            results = []
            for token_obj, contact, company in query.all():
                results.append({
                    "id": str(token_obj.id),
                    "token": token_obj.token,
                    "contact_name": contact.name,
                    "contact_email": contact.email,
                    "company_name": company.name,
                    "is_active": token_obj.is_active,
                    "last_accessed_at": token_obj.last_accessed_at.isoformat() if token_obj.last_accessed_at else None,
                    "created_at": token_obj.created_at.isoformat() if token_obj.created_at else None,
                })
            return results

    def deactivate_token(self, token_id: str) -> bool:
        """Deactivate a portal token."""
        from app.domains.contractor_portal.models import ContractorPortalToken

        with self.database.get_session() as session:
            token_obj = session.query(ContractorPortalToken).filter(
                ContractorPortalToken.id == token_id
            ).first()
            if not token_obj:
                return False
            token_obj.is_active = False
            session.commit()
            return True
