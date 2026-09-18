"""
Insurance-approved WM amount, resolved the same way the job detail page does.

The detail page's financial comparison (api.py get_financial_comparison)
takes the latest water_mitigation ClaimNegotiation's WM section RCV and
falls back to Claim.wm_estimate_amount. The payment board shows that same
number as the default "Approved" amount, so the two screens never disagree.
This version resolves it for many jobs in two queries instead of per job.
"""

from collections import defaultdict
from typing import Dict, Iterable, List, Optional
from uuid import UUID

from .models import WaterMitigationJob


def _wm_section_rcv(negotiation) -> Optional[float]:
    sections = negotiation.sections_data
    if not isinstance(sections, list) or not sections:
        return None
    for sec in sections:
        name = (sec.get('section_name') or '').lower()
        if 'water' in name and 'mitig' in name:
            return float(sec.get('rcv') or 0)
    # A WM-category estimate holds only WM sections, so a single section is
    # the WM amount even when the carrier titled it something else.
    if negotiation.estimate_category == 'water_mitigation' and len(sections) == 1:
        return float(sections[0].get('rcv') or 0)
    return None


def resolve_insurance_wm_amounts(db, claim_ids: Iterable[UUID]) -> Dict[str, float]:
    """Map claim_id (str) -> insurance WM amount, for claims where one exists."""
    from app.domains.client.models import Claim, ClaimNegotiation

    ids = list({c for c in claim_ids if c})
    if not ids:
        return {}

    negotiations = (
        db.query(ClaimNegotiation)
        .filter(ClaimNegotiation.claim_id.in_(ids))
        .order_by(ClaimNegotiation.revision_number.desc())
        .all()
    )
    by_claim: Dict[str, List] = defaultdict(list)
    for neg in negotiations:
        by_claim[str(neg.claim_id)].append(neg)

    claims = db.query(Claim.id, Claim.wm_estimate_amount).filter(Claim.id.in_(ids)).all()
    wm_estimate = {str(cid): amt for cid, amt in claims}

    result: Dict[str, float] = {}
    for claim_id in (str(c) for c in ids):
        negs = by_claim.get(claim_id, [])
        # Prefer the latest WM-category negotiation; fall back to the latest of any
        latest = next((n for n in negs if n.estimate_category == 'water_mitigation'), None)
        if latest is None and negs:
            latest = negs[0]
        rcv = _wm_section_rcv(latest) if latest is not None else None
        if rcv:
            result[claim_id] = rcv
        elif wm_estimate.get(claim_id):
            result[claim_id] = float(wm_estimate[claim_id])
    return result


def insurance_amounts_for_jobs(db, jobs: Iterable[WaterMitigationJob]) -> Dict[str, float]:
    """Map job_id (str) -> insurance WM amount for jobs that have a linked claim."""
    jobs = list(jobs)
    by_claim = resolve_insurance_wm_amounts(db, (j.claim_id for j in jobs))
    return {
        str(j.id): by_claim[str(j.claim_id)]
        for j in jobs
        if j.claim_id and str(j.claim_id) in by_claim
    }
