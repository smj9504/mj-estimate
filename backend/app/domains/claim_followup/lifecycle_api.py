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
async def get_payment_gaps(min_difference: float = Query(0, ge=0)):
    """Get claims where insurance estimate was received but payment not fully collected"""
    from app.core.database_factory import get_database
    from app.domains.client.models import Claim, Client
    from sqlalchemy import and_, or_

    database = get_database()
    session = database.get_readonly_session()
    try:
        # Find claims that have received insurance estimate but payment is not complete
        claims = session.query(Claim).filter(
            Claim.status.in_(['open', 'negotiating', 'settled']),
            Claim.payment_status.in_(['unpaid', 'partial']),
            # Must have some estimated amount (insurance gave us numbers)
            or_(
                Claim.current_acv > 0,
                Claim.current_rcv > 0,
                Claim.final_invoice_amount > 0,
                Claim.our_estimate_amount > 0,
            ),
        ).all()

        gaps = []
        for claim in claims:
            # Use best available amount: final invoice > our estimate > insurance ACV
            expected = float(
                claim.final_invoice_amount
                or claim.our_estimate_amount
                or claim.current_acv
                or 0
            )
            paid = float(claim.total_insurance_paid or 0)
            deductible = float(claim.insurance_deductible or 0)
            # Actual owed = expected - deductible - paid
            diff = expected - deductible - paid
            if diff < min_difference:
                continue

            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first()
            gaps.append({
                "claim_id": str(claim.id),
                "claim_number": claim.claim_number,
                "insurance_company": claim.insurance_company,
                "property_address": client.address if client else None,
                "expected_amount": expected,
                "deductible": deductible,
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
    """Get WM jobs with 'Sent to adjuster' status - awaiting insurance estimate"""
    from app.core.database_factory import get_database
    from app.domains.water_mitigation.models import WaterMitigationJob

    database = get_database()
    session = database.get_readonly_session()
    try:
        jobs = session.query(WaterMitigationJob).filter(
            WaterMitigationJob.active == True,
            WaterMitigationJob.status == 'Sent to adjuster',
        ).order_by(WaterMitigationJob.documents_sent_date.asc().nullsfirst()).all()

        results = []
        for job in jobs:
            results.append({
                "job_id": str(job.id),
                "claim_number": job.claim_number,
                "insurance_company": job.insurance_company,
                "adjuster_name": job.adjuster_name,
                "adjuster_email": job.adjuster_email,
                "property_address": job.property_address,
                "homeowner_name": job.homeowner_name,
                "date_of_loss": job.date_of_loss.isoformat() if job.date_of_loss else None,
                "documents_sent_date": job.documents_sent_date.isoformat() if job.documents_sent_date else None,
                "status": job.status,
            })
        return results
    finally:
        session.close()


@router.get("/lifecycle/wm-doc-prep")
async def get_wm_doc_prep():
    """Get WM jobs with 'Lead' or 'Doc prepping' status - need documents prepared"""
    from app.core.database_factory import get_database
    from app.domains.water_mitigation.models import WaterMitigationJob

    database = get_database()
    session = database.get_readonly_session()
    try:
        jobs = session.query(WaterMitigationJob).filter(
            WaterMitigationJob.active == True,
            WaterMitigationJob.status.in_(['Lead', 'Doc prepping']),
        ).order_by(WaterMitigationJob.created_at.asc()).all()

        results = []
        for job in jobs:
            results.append({
                "job_id": str(job.id),
                "claim_number": job.claim_number,
                "insurance_company": job.insurance_company,
                "property_address": job.property_address,
                "homeowner_name": job.homeowner_name,
                "date_of_loss": job.date_of_loss.isoformat() if job.date_of_loss else None,
                "status": job.status,
                "created_at": job.created_at.isoformat() if job.created_at else None,
            })
        return results
    finally:
        session.close()


@router.get("/lifecycle/supplement-work")
async def get_supplement_work():
    """Get supplements with 'identified' or 'in_progress' status - need estimate work"""
    from app.core.database_factory import get_database
    from app.domains.supplement.models import SupplementRequest
    from app.domains.client.models import Claim, Client

    database = get_database()
    session = database.get_readonly_session()
    try:
        supplements = session.query(SupplementRequest).filter(
            SupplementRequest.status.in_(['identified', 'in_progress']),
        ).order_by(SupplementRequest.created_at.asc()).all()

        results = []
        for sup in supplements:
            claim = session.query(Claim).filter(Claim.id == sup.claim_id).first()
            client = session.query(Client).filter(Client.id == claim.client_id).first() if claim else None
            results.append({
                "supplement_id": str(sup.id),
                "claim_id": str(sup.claim_id),
                "claim_number": claim.claim_number if claim else None,
                "title": sup.title,
                "status": sup.status,
                "priority": sup.priority,
                "original_amount": float(sup.original_amount or 0),
                "supplement_amount": float(sup.supplement_amount or 0),
                "difference": float(sup.difference or 0),
                "insurance_company": claim.insurance_company if claim else None,
                "property_address": client.address if client else None,
                "required_estimates": sup.required_estimates or {},
                "created_at": sup.created_at.isoformat() if sup.created_at else None,
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
