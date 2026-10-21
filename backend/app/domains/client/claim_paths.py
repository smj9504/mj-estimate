"""
How a claim's two estimates come to be.

Water mitigation: we send our WM invoice first. The carrier either pays it as
billed, with no WM estimate of its own (wm_cost_status 'paid_per_invoice'), or
answers with a WM estimate, separate or inside the rebuild estimate.

Rebuild: the carrier usually writes it (estimate_origin 'carrier_provided').
Some carriers ask the contractor for it instead ('contractor_prepared'); then a
company other than the one that did the water mitigation writes and sends it
(claims.rebuild_estimate_company_id).
"""

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional, Set

logger = logging.getLogger(__name__)

WM_COST_STATUSES = (
    'paid_per_invoice',
    'included_in_rebuild',
    'separate_estimate',
    'not_received',
    'not_applicable',
)

# WM statuses whose money still has to be chased on its own WM payment stage,
# apart from the rebuild payment.
WM_SEPARATE_PAYMENT_STATUSES = ('paid_per_invoice', 'separate_estimate', 'not_received')


class SameCompanyAsWMError(ValueError):
    """The company picked to write the rebuild estimate did the water mitigation."""


def wm_company_ids_by_claim(session, claim_ids: Iterable[str]) -> dict:
    """{claim_id: {company_id, ...}} of the companies that did each claim's
    water mitigation: the WM jobs' companies plus any company assigned to the
    claim in the water_mitigation role."""
    from app.domains.contract.models import ClaimCompany
    from app.domains.water_mitigation.models import WaterMitigationJob

    ids = [str(c) for c in claim_ids if c]
    result: dict = {cid: set() for cid in ids}
    if not ids:
        return result

    job_rows = session.query(
        WaterMitigationJob.claim_id, WaterMitigationJob.company_id
    ).filter(
        WaterMitigationJob.claim_id.in_(ids),
        WaterMitigationJob.company_id.isnot(None),
    ).all()
    role_rows = session.query(
        ClaimCompany.claim_id, ClaimCompany.company_id
    ).filter(
        ClaimCompany.claim_id.in_(ids),
        ClaimCompany.role == 'water_mitigation',
    ).all()
    for claim_id, company_id in list(job_rows) + list(role_rows):
        result.setdefault(str(claim_id), set()).add(str(company_id))
    return result


def wm_company_ids(session, claim_id: str) -> Set[str]:
    return wm_company_ids_by_claim(session, [claim_id]).get(str(claim_id), set())


def check_rebuild_estimate_company(session, claim_id: str, company_id) -> None:
    """Raise SameCompanyAsWMError when company_id did this claim's water
    mitigation. An empty company_id (not chosen yet) passes."""
    if not company_id or not claim_id:
        return
    if str(company_id) in wm_company_ids(session, claim_id):
        raise SameCompanyAsWMError(
            "The rebuild estimate has to come from a company other than the one "
            "that did the water mitigation. Pick a different company."
        )


def company_names(session, company_ids: Iterable[str]) -> dict:
    """{company_id: name} for the given ids."""
    from app.domains.company.models import Company

    ids = list({str(c) for c in company_ids if c})
    if not ids:
        return {}
    rows = session.query(Company.id, Company.name).filter(Company.id.in_(ids)).all()
    return {str(cid): name for cid, name in rows}


def record_wm_paid_per_invoice(
    session,
    claim,
    approved_amount: Optional[float] = None,
    notes: Optional[str] = None,
    source_task: Optional[dict] = None,
    job_id: Optional[str] = None,
) -> None:
    """The carrier pays our WM invoice as billed, so no WM estimate is coming.

    Marks the claim, records the approved amount on its WM jobs (the invoice
    amount unless one is given), closes the open "WM docs sent" follow-up, and
    opens the WM payment stage. The rebuild estimate is unaffected: it still
    comes from the carrier or, when asked, from a non-WM company.
    Does not commit.
    """
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.client.models import ClaimActivity
    from app.domains.water_mitigation.models import WaterMitigationJob

    claim_id = str(claim.id)
    claim.wm_cost_status = 'paid_per_invoice'

    jobs_q = session.query(WaterMitigationJob).filter(
        WaterMitigationJob.claim_id == claim_id
    )
    if job_id:
        jobs_q = jobs_q.filter(WaterMitigationJob.id == str(job_id))
    jobs = jobs_q.all()
    # A typed amount belongs to one job; with several, each keeps its invoice.
    explicit = approved_amount if approved_amount is not None and len(jobs) == 1 else None
    for job in jobs:
        if explicit is not None:
            job.approved_amount = explicit
        elif job.approved_amount is None and job.invoice_amount is not None:
            job.approved_amount = job.invoice_amount

    # The adjuster has answered the docs we sent, so that follow-up is done.
    now = datetime.now(timezone.utc)
    open_docs = session.query(FollowUpTask).filter(
        FollowUpTask.claim_id == claim_id,
        FollowUpTask.task_type == 'wm_docs_sent',
        FollowUpTask.status.notin_(['resolved', 'cancelled']),
    ).all()
    for task in open_docs:
        task.status = 'resolved'
        task.resolved_at = now
        task.resolution_notes = task.resolution_notes or (
            'Insurance is paying our WM invoice as billed. No WM estimate needed.'
        )
    if source_task is None and open_docs:
        t = open_docs[0]
        source_task = {
            'assigned_to_name': t.assigned_to_name,
            'assigned_to_email': t.assigned_to_email,
            'assigned_to_phone': t.assigned_to_phone,
            'assigned_to_role': t.assigned_to_role,
        }

    from app.domains.claim_followup.service import ClaimFollowUpService
    ClaimFollowUpService()._auto_create_payment_task(
        session, claim_id, source_task or {}, 'wm_payment_check',
        title='WM Payment',
        description='Insurance is paying our WM invoice as billed. Follow up for the WM check.',
    )

    shown = sum(float(j.approved_amount or j.invoice_amount or 0) for j in jobs)
    amount_info = f" Approved: ${shown:,.2f}." if shown else ''
    session.add(ClaimActivity(
        claim_id=claim_id,
        activity_type='wm_invoice_accepted',
        title='Insurance paying our WM invoice',
        description=(
            (notes or 'Insurance will pay our water mitigation invoice as billed. '
             'No insurance WM estimate needed.') + amount_info
        ),
        related_entity_type='wm_job' if job_id else 'claim',
        related_entity_id=str(job_id) if job_id else claim_id,
    ))
    session.flush()


def undo_wm_paid_per_invoice(session, claim) -> None:
    """Take back a 'paid per invoice' marking made by mistake. The WM payment
    stage and approved amounts stay, since a check may already be tracked on
    them. Does not commit."""
    from app.domains.client.models import ClaimActivity

    if claim.wm_cost_status != 'paid_per_invoice':
        return
    claim.wm_cost_status = None
    session.add(ClaimActivity(
        claim_id=str(claim.id),
        activity_type='status_changed',
        title='WM no longer marked as paid per invoice',
        description='Water mitigation is back to waiting on the insurance answer.',
        related_entity_type='claim',
        related_entity_id=str(claim.id),
    ))
    session.flush()


def mark_rebuild_estimate_requested(
    session, claim, company_id=None, stage: str = 'requested',
) -> None:
    """The carrier asked the contractor to write the rebuild estimate.

    Puts the claim on the contractor-prepared path and records which company
    writes it. Raises SameCompanyAsWMError when that company did the water
    mitigation. Does not commit.
    """
    if company_id:
        check_rebuild_estimate_company(session, str(claim.id), company_id)
        claim.rebuild_estimate_company_id = str(company_id)
    claim.estimate_origin = 'contractor_prepared'
    if not claim.contractor_estimate_stage:
        claim.contractor_estimate_stage = stage
