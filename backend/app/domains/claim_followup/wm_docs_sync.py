"""
Keep a water mitigation job's status and its WM docs follow-up in step.

Once the carrier is paying (Payment on the way, Check received) or the job is
Complete, there is nothing left to chase on the documents we sent, so the WM
docs follow-up resolves itself. The other way round, resolving that follow-up
moves the job to the status picked in the Resolve form.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

WM_DOCS_TASK_TYPE = 'wm_docs_sent'

# Job statuses that leave nothing to follow up on the documents
WM_DOCS_DONE_STATUSES = ('Payment on the way', 'Check received', 'Complete')

# What the Resolve form may move the job to: the statuses that come after the
# carrier has answered the documents. Earlier ones (Sent to adjuster,
# Insurance reviewing, Follow up) would mean the documents are still being
# chased, which is what resolving says they are not.
WM_STATUSES_ON_RESOLVE = (
    'Paperwork received',
    'Estimate requested',
    'Payment on the way',
    'Check received',
    'Complete',
)

# Sent instead of a status when the job should stay as it is
KEEP_WM_STATUS = 'keep'

_CLOSED_TASK_STATUSES = ('resolved', 'cancelled')


def _now() -> datetime:
    return datetime.now(timezone.utc)


def resolve_wm_docs_followups(session, job_id: str, claim_id: Optional[str], new_status: str) -> int:
    """
    Resolve the open WM docs follow-ups a job no longer needs, now that it has
    moved to `new_status`. Returns how many were resolved.

    A follow-up linked to the job resolves with it. One added by hand on the
    follow-up screen carries no job, so it resolves only once every active WM
    job on the claim is past the documents.
    """
    if new_status not in WM_DOCS_DONE_STATUSES or not claim_id:
        return 0

    from sqlalchemy import or_
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.water_mitigation.models import WaterMitigationJob

    tasks = session.query(FollowUpTask).filter(
        FollowUpTask.claim_id == str(claim_id),
        FollowUpTask.task_type == WM_DOCS_TASK_TYPE,
        FollowUpTask.status.notin_(_CLOSED_TASK_STATUSES),
        or_(
            FollowUpTask.wm_job_id == str(job_id),
            FollowUpTask.wm_job_id.is_(None),
        ),
    ).all()
    if not tasks:
        return 0

    others_still_on_docs = None
    note = f'Resolved: the WM job moved to {new_status}.'
    resolved = 0
    for task in tasks:
        if task.wm_job_id is None:
            if others_still_on_docs is None:
                others_still_on_docs = session.query(WaterMitigationJob.id).filter(
                    WaterMitigationJob.claim_id == str(claim_id),
                    WaterMitigationJob.active == True,  # noqa: E712
                    WaterMitigationJob.id != str(job_id),
                    WaterMitigationJob.status.notin_(WM_DOCS_DONE_STATUSES),
                ).first() is not None
            if others_still_on_docs:
                continue
        task.status = 'resolved'
        task.resolved_at = _now()
        task.resolution_notes = f'{task.resolution_notes}\n{note}' if task.resolution_notes else note
        resolved += 1

    if resolved:
        session.flush()
        logger.info(f"Resolved {resolved} WM docs follow-up(s): WM job {job_id} moved to {new_status}")
    return resolved


def jobs_for_task(session, task: Dict[str, Any]) -> List[Any]:
    """The WM job(s) a WM docs follow-up is about: its linked job, or, for one
    added by hand, the claim's active jobs."""
    from app.domains.water_mitigation.models import WaterMitigationJob

    if task.get('wm_job_id'):
        job = session.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == str(task['wm_job_id'])
        ).first()
        return [job] if job else []
    if not task.get('claim_id'):
        return []
    return session.query(WaterMitigationJob).filter(
        WaterMitigationJob.claim_id == str(task['claim_id']),
        WaterMitigationJob.active == True,  # noqa: E712
    ).order_by(WaterMitigationJob.created_at).all()


def set_wm_status_on_resolve(session, task: Dict[str, Any], wm_status: str) -> int:
    """
    Move the WM job(s) of a just-resolved WM docs follow-up to `wm_status`,
    through the same path as the WM page, so its history and claim activity
    are written as usual. Returns how many jobs changed.
    """
    if wm_status == KEEP_WM_STATUS:
        return 0
    if wm_status not in WM_STATUSES_ON_RESOLVE:
        raise ValueError(f"A WM job can't be set to '{wm_status}' when its docs follow-up is resolved")

    from app.domains.water_mitigation.schemas import JobStatusUpdate
    from app.domains.water_mitigation.service import WaterMitigationService

    wm_service = WaterMitigationService(session)
    changed = 0
    for job in jobs_for_task(session, task):
        if job.status == wm_status:
            continue
        wm_service.update_job_status(
            job.id,
            JobStatusUpdate(status=wm_status, notes='Set when the WM docs follow-up was resolved.'),
        )
        changed += 1
    return changed


def wm_job_status_for_tasks(session, tasks: List[Any]) -> Dict[str, Optional[str]]:
    """
    For each WM docs follow-up in `tasks` (rows), the status of the WM job it
    is about: its linked job's, or for one added by hand, the claim's active
    job furthest behind. Keyed by task id.
    """
    from app.domains.water_mitigation.models import WaterMitigationJob
    from app.domains.water_mitigation.schemas import JobStatus

    wm_tasks = [t for t in tasks if t.task_type == WM_DOCS_TASK_TYPE]
    if not wm_tasks:
        return {}

    linked_ids = {str(t.wm_job_id) for t in wm_tasks if t.wm_job_id}
    claim_ids = {str(t.claim_id) for t in wm_tasks if not t.wm_job_id and t.claim_id}
    jobs = []
    if linked_ids:
        jobs += session.query(WaterMitigationJob).filter(WaterMitigationJob.id.in_(linked_ids)).all()
    if claim_ids:
        jobs += session.query(WaterMitigationJob).filter(
            WaterMitigationJob.claim_id.in_(claim_ids),
            WaterMitigationJob.active == True,  # noqa: E712
        ).all()

    order = {status: i for i, status in enumerate(JobStatus.all_statuses())}
    by_id = {str(j.id): j.status for j in jobs}
    behind_by_claim: Dict[str, str] = {}
    for j in jobs:
        if not j.active or not j.claim_id:
            continue
        cid = str(j.claim_id)
        current = behind_by_claim.get(cid)
        if current is None or order.get(j.status, 99) < order.get(current, 99):
            behind_by_claim[cid] = j.status

    return {
        str(t.id): by_id.get(str(t.wm_job_id)) if t.wm_job_id else behind_by_claim.get(str(t.claim_id))
        for t in wm_tasks
    }
