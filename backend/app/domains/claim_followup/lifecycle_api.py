"""
Claims Lifecycle Dashboard API.
Aggregates data from follow-up, payment, supplement, and rebuild domains.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/lifecycle/stats")
async def get_lifecycle_stats():
    """Get unified stats across all claim lifecycle domains"""
    from app.domains.claim_followup.service import ClaimFollowUpService
    from app.domains.supplement.service import SupplementService
    from app.domains.rebuild.service import RebuildService

    followup_stats = ClaimFollowUpService().get_dashboard_stats()
    supplement_stats = SupplementService().get_dashboard_stats()
    rebuild_stats = RebuildService().get_dashboard_stats()

    return {
        "followup": followup_stats,
        "supplement": supplement_stats,
        "rebuild": rebuild_stats,
    }


@router.get("/lifecycle/overdue")
async def get_overdue_items():
    """Get all overdue follow-up tasks"""
    from app.domains.claim_followup.service import ClaimFollowUpService
    service = ClaimFollowUpService()
    tasks, _ = service.get_tasks({
        "overdue_only": True,
        "page": 1,
        "page_size": 50,
        "sort_by": "due_date",
        "sort_order": "asc",
    })
    return tasks


@router.get("/lifecycle/payment-gaps")
async def get_payment_gaps(min_difference: float = Query(500, ge=0)):
    """Get claims with significant payment differences (invoice > paid)"""
    from app.core.database_factory import get_database
    from app.domains.client.models import Claim, Client
    from sqlalchemy import and_

    database = get_database()
    session = database.get_readonly_session()
    try:
        claims = session.query(Claim).filter(
            and_(
                Claim.payment_status.in_(['unpaid', 'partial']),
                Claim.status.in_(['open', 'negotiating', 'settled']),
            )
        ).all()

        gaps = []
        for claim in claims:
            invoice = float(claim.final_invoice_amount or claim.our_estimate_amount or 0)
            paid = float(claim.total_insurance_paid or 0)
            diff = invoice - paid
            if diff >= min_difference:
                # Get client address
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                gaps.append({
                    "claim_id": str(claim.id),
                    "claim_number": claim.claim_number,
                    "insurance_company": claim.insurance_company,
                    "property_address": client.address if client else None,
                    "invoice_amount": invoice,
                    "insurance_paid": paid,
                    "difference": diff,
                    "payment_status": claim.payment_status,
                    "needs_supplement": claim.needs_supplement or False,
                })
        gaps.sort(key=lambda x: x["difference"], reverse=True)
        return gaps
    finally:
        session.close()


@router.get("/lifecycle/pending-estimates")
async def get_pending_estimates():
    """Get claims waiting for insurance rebuild estimate"""
    from app.core.database_factory import get_database
    from app.domains.client.models import Claim, Client

    database = get_database()
    session = database.get_readonly_session()
    try:
        claims = session.query(Claim).filter(
            Claim.insurance_estimate_received == False,
            Claim.status.in_(['open', 'negotiating']),
        ).all()

        results = []
        for claim in claims:
            client = session.query(Client).filter(Client.id == claim.client_id).first()
            results.append({
                "claim_id": str(claim.id),
                "claim_number": claim.claim_number,
                "insurance_company": claim.insurance_company,
                "adjuster_name": claim.adjuster_name,
                "adjuster_email": claim.adjuster_email,
                "property_address": client.address if client else None,
                "date_of_loss": claim.date_of_loss.isoformat() if claim.date_of_loss else None,
                "status": claim.status,
            })
        return results
    finally:
        session.close()


@router.get("/lifecycle/active-rebuilds")
async def get_active_rebuilds():
    """Get rebuild projects currently in progress"""
    from app.domains.rebuild.service import RebuildService
    service = RebuildService()
    items, _ = service.get_projects({
        "status": "in_progress",
        "page": 1,
        "page_size": 50,
    })
    return items
