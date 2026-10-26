"""
Supplement requests filed on a WM job's claim.

A supplement (or estimate request) belongs to a claim, and a WM job links to
that same claim, so the job list reads them through claim_id at request time.
Nothing is copied onto the job: a status changed on the supplement screen
shows on the next list load.
"""

from collections import defaultdict
from typing import Any, Dict, Iterable, List

from .models import WaterMitigationJob

# Settled states sort after the ones still being worked
_CLOSED_STATUSES = {'approved', 'denied', 'withdrawn'}


def supplements_for_jobs(db, jobs: Iterable[WaterMitigationJob]) -> Dict[str, List[Dict[str, Any]]]:
    """Map job_id (str) -> the claim's supplement requests, the one to show first.

    Open requests come before settled ones, newest first within each, so the
    first entry is the request someone is still working when there is one.
    """
    from app.domains.supplement.models import SupplementRequest

    jobs = [j for j in jobs if j.claim_id]
    if not jobs:
        return {}

    rows = (
        db.query(
            SupplementRequest.id,
            SupplementRequest.claim_id,
            SupplementRequest.request_type,
            SupplementRequest.status,
            SupplementRequest.title,
            SupplementRequest.updated_at,
        )
        .filter(SupplementRequest.claim_id.in_({j.claim_id for j in jobs}))
        .order_by(SupplementRequest.created_at.desc())
        .all()
    )
    by_claim: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_claim[str(row.claim_id)].append({
            'id': row.id,
            'request_type': row.request_type,
            'status': row.status,
            'title': row.title,
            'updated_at': row.updated_at,
        })
    for items in by_claim.values():
        items.sort(key=lambda s: s['status'] in _CLOSED_STATUSES)

    return {
        str(j.id): by_claim[str(j.claim_id)]
        for j in jobs
        if str(j.claim_id) in by_claim
    }
