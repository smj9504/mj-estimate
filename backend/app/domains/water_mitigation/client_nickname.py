"""
The client nickname a WM job shows on the list.

A WM job reaches its client through its claim (its own client_id is a legacy
company link), so the list reads the nickname through claim_id at request
time. Nothing is copied onto the job: a nickname changed on the client page
shows on the next list load.
"""

from typing import Dict, Iterable

from .models import WaterMitigationJob


def client_nicknames_for_jobs(db, jobs: Iterable[WaterMitigationJob]) -> Dict[str, str]:
    """Map job_id (str) -> its claim's client's nickname, for the jobs that have one"""
    from app.domains.client.models import Claim, Client

    jobs = [j for j in jobs if j.claim_id]
    if not jobs:
        return {}

    rows = (
        db.query(Claim.id, Client.nickname)
        .join(Client, Client.id == Claim.client_id)
        .filter(Claim.id.in_({j.claim_id for j in jobs}))
        .filter(Client.nickname.isnot(None))
        .all()
    )
    by_claim = {str(claim_id): nickname for claim_id, nickname in rows if nickname}
    return {
        str(j.id): by_claim[str(j.claim_id)]
        for j in jobs
        if str(j.claim_id) in by_claim
    }
