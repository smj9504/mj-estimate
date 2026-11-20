"""
Closing or denying a claim wraps up the work linked to it; reopening the claim
puts that work back.

A claim's rebuild projects, supplements, follow-up tasks and WM jobs each keep
their own status, so a claim marked Closed or Denied would otherwise leave them
reading as still under way. When a claim's status changes to one of those, the
claim page lists every linked item with a suggested status for the claim's new
state (closeout_preview). What the person picks is saved with the claim
(apply_closeout) and recorded item by item, before and after, in a
ClaimCloseout. Opening the claim again offers to put back what that record
changed (reopen_preview / apply_reopen); an item changed by hand since is left
unticked.

Some items have no suggestion and must be picked: construction under way, a
supplement the carrier is still reviewing, and, on a closed claim, money not
yet received. "keep" leaves an item as it is.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

DONE_CLAIM_STATUSES = ('closed', 'denied')
KEEP = 'keep'

KIND_REBUILD = 'rebuild'
KIND_SUPPLEMENT = 'supplement'
KIND_TASK = 'followup'
KIND_WM = 'wm_job'
KINDS = (KIND_TASK, KIND_SUPPLEMENT, KIND_REBUILD, KIND_WM)  # the order changes are made in

REBUILD_DONE = ('closed', 'cancelled')
REBUILD_NOT_STARTED = ('pending', 'assigned')
REBUILD_FINISHED = ('completed', 'invoiced', 'docs_sent')

SUPPLEMENT_DONE = ('approved', 'denied', 'withdrawn')
SUPPLEMENT_WITH_CARRIER = ('submitted', 'under_review')

TASK_DONE = ('resolved', 'cancelled')
# Follow-ups chasing money: on a closed claim the check may still be coming
MONEY_TASK_TYPES = ('payment_check', 'wm_payment_check', 'depreciation_recovery')

WM_DONE = ('Complete',)

GROUP_LABELS = {
    KIND_REBUILD: 'Rebuild',
    KIND_SUPPLEMENT: 'Supplement',
    KIND_TASK: 'Follow-up',
    KIND_WM: 'WM job',
}

TASK_TYPE_LABELS = {
    'wm_docs_sent': 'WM docs',
    'supplement_estimate_prep': 'Supplement prep',
    'supplement_sent': 'Supplement sent',
    'depreciation_recovery': 'Depreciation',
    'estimate_request': 'Estimate request',
    'payment_check': 'Payment check',
    'wm_payment_check': 'WM payment check',
    'docs_sent': 'Docs sent',
    'general': 'General',
    'dispute': 'Dispute',
    'appraisal': 'Appraisal',
    'attorney_referral': 'Attorney referral',
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def humanize(status: Optional[str]) -> str:
    """'in_progress' -> 'In progress'; WM statuses are already words"""
    if not status:
        return 'None'
    return status.replace('_', ' ').capitalize() if status[:1].islower() else status


def item_name(item: Dict[str, Any]) -> str:
    """'Rebuild Kitchen', or just the title when it already says what it is
    ('Supplement 2')"""
    group, label = item['group'], item['label']
    return label if label.lower().startswith(group.lower()) else f'{group} {label}'


def _opt(value: str, label: str) -> Dict[str, str]:
    return {'value': value, 'label': label}


def _leave(label: str = 'Leave as is') -> Dict[str, str]:
    return _opt(KEEP, label)


# ── What each item may become, and the suggestion, by its current state ────
# Each returns None for an item already finished, else
# {'state': what it is now, in words, 'options': [...], 'default': value or
# None when the person must pick}.

def rebuild_choice(status: Optional[str], to_status: str) -> Optional[Dict[str, Any]]:
    if status in REBUILD_DONE:
        return None
    if status in REBUILD_NOT_STARTED:
        return {
            'state': 'Construction not started',
            'options': [_opt('cancelled', 'Cancelled'), _leave()],
            'default': 'cancelled',
        }
    if status == 'in_progress':
        return {
            'state': 'Construction in progress',
            'options': [
                _opt('completed', 'Completed (work finished)'),
                _opt('cancelled', 'Cancelled (work stopped)'),
                _leave('Keep going'),
            ],
            'default': None,
        }
    if status in REBUILD_FINISHED:
        return {
            'state': 'Construction finished',
            'options': [_opt('closed', 'Closed'), _leave()],
            'default': 'closed',
        }
    return {
        'state': humanize(status),
        'options': [_opt('closed', 'Closed'), _opt('cancelled', 'Cancelled'), _leave()],
        'default': None,
    }


def supplement_choice(status: Optional[str], to_status: str) -> Optional[Dict[str, Any]]:
    if status in SUPPLEMENT_DONE:
        return None
    if status in SUPPLEMENT_WITH_CARRIER:
        return {
            'state': 'Sent, waiting on the carrier',
            'options': [
                _opt('approved', 'Approved'),
                _opt('denied', 'Denied'),
                _opt('withdrawn', 'Withdrawn'),
                _leave(),
            ],
            'default': 'denied' if to_status == 'denied' else None,
        }
    return {
        'state': 'Not sent yet',
        'options': [_opt('withdrawn', 'Withdrawn'), _leave()],
        'default': 'withdrawn',
    }


def task_choice(status: Optional[str], task_type: Optional[str], payment_status: Optional[str],
                to_status: str) -> Optional[Dict[str, Any]]:
    if status in TASK_DONE:
        return None
    if task_type in MONEY_TASK_TYPES:
        if payment_status == 'received':
            return {
                'state': 'Check received',
                'options': [_opt('resolved', 'Resolved'), _opt('cancelled', 'Cancelled'), _leave()],
                'default': 'resolved',
            }
        return {
            'state': 'Money not received yet',
            'options': [
                _opt('received', 'Resolved (check received)'),
                _opt('cancelled', 'Cancelled (not coming)'),
                _leave('Keep tracking'),
            ],
            'default': 'cancelled' if to_status == 'denied' else None,
        }
    return {
        'state': humanize(status),
        'options': [_opt('cancelled', 'Cancelled'), _opt('resolved', 'Resolved (done)'), _leave()],
        'default': 'cancelled',
    }


def wm_choice(status: Optional[str], to_status: str) -> Optional[Dict[str, Any]]:
    """WM is paid on its own, so a job stays as it is unless picked"""
    if status in WM_DONE:
        return None
    return {
        'state': status or 'None',
        'options': [_leave(), _opt('Complete', 'Complete')],
        'default': KEEP,
    }


# ── The claim's linked items ──────────────────────────────────────────────

def _rows(session, claim_id: str, exclude_task_id: Optional[str] = None):
    """(kind, row) for everything linked to the claim, in display order"""
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.rebuild.models import RebuildProject
    from app.domains.supplement.models import SupplementRequest
    from app.domains.water_mitigation.models import WaterMitigationJob

    claim_id = str(claim_id)
    for p in session.query(RebuildProject).filter(
        RebuildProject.claim_id == claim_id
    ).order_by(RebuildProject.created_at).all():
        yield KIND_REBUILD, p
    for s in session.query(SupplementRequest).filter(
        SupplementRequest.claim_id == claim_id
    ).order_by(SupplementRequest.created_at).all():
        yield KIND_SUPPLEMENT, s
    tasks = session.query(FollowUpTask).filter(FollowUpTask.claim_id == claim_id)
    if exclude_task_id:
        tasks = tasks.filter(FollowUpTask.id != str(exclude_task_id))
    for t in tasks.order_by(FollowUpTask.created_at).all():
        yield KIND_TASK, t
    for j in session.query(WaterMitigationJob).filter(
        WaterMitigationJob.claim_id == claim_id,
        WaterMitigationJob.active == True,  # noqa: E712
    ).order_by(WaterMitigationJob.created_at).all():
        yield KIND_WM, j


def _group(kind: str, row: Any) -> str:
    if kind == KIND_SUPPLEMENT and getattr(row, 'request_type', None) == 'estimate_request':
        return 'Estimate request'
    return GROUP_LABELS[kind]


def _label(kind: str, row: Any) -> str:
    if kind == KIND_TASK:
        title = row.title or TASK_TYPE_LABELS.get(row.task_type, humanize(row.task_type))
        return title
    if kind == KIND_WM:
        return row.property_street or row.property_address or 'Water mitigation'
    return getattr(row, 'title', None) or GROUP_LABELS[kind]


def _choice(kind: str, row: Any, to_status: str) -> Optional[Dict[str, Any]]:
    if kind == KIND_REBUILD:
        return rebuild_choice(row.status, to_status)
    if kind == KIND_SUPPLEMENT:
        return supplement_choice(row.status, to_status)
    if kind == KIND_TASK:
        return task_choice(row.status, row.task_type, row.payment_status, to_status)
    return wm_choice(row.status, to_status)


def _item(kind: str, row: Any, to_status: str) -> Dict[str, Any]:
    choice = _choice(kind, row, to_status)
    item = {
        'kind': kind,
        'id': str(row.id),
        'group': _group(kind, row),
        'label': _label(kind, row),
        'status': row.status,
        'status_label': humanize(row.status),
        'done': choice is None,
        'state': None,
        'options': [],
        'default': None,
    }
    if kind == KIND_TASK:
        item['task_type'] = TASK_TYPE_LABELS.get(row.task_type, humanize(row.task_type))
    if choice:
        item.update(choice)
    return item


def closeout_preview(session, claim_id: str, to_status: str,
                     exclude_task_id: Optional[str] = None) -> Dict[str, Any]:
    """Everything linked to the claim, with what each may become once the
    claim is `to_status` (closed or denied). Finished items come with done."""
    if to_status not in DONE_CLAIM_STATUSES:
        raise ValueError(f"to_status must be one of {list(DONE_CLAIM_STATUSES)}")
    items = [_item(kind, row, to_status) for kind, row in _rows(session, claim_id, exclude_task_id)]
    return {'to_status': to_status, 'items': items}


# ── Changing an item, and putting it back ─────────────────────────────────

def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _parse(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _append_note(existing: Optional[str], note: str) -> str:
    return f'{existing}\n{note}' if existing else note


def _mirror_supplement_status(session, claim_id: Any, status: str) -> None:
    """The claim carries its supplement's status, as the supplement page keeps it"""
    from app.domains.client.models import Claim
    claim = session.query(Claim).filter(Claim.id == str(claim_id)).first()
    if claim is not None:
        claim.supplement_status = status


def _set_wm_status(session, job: Any, status: str, notes: str, staff_id: Optional[str]) -> None:
    """Move a WM job without the WM page's own side effects (a new docs
    follow-up on Sent to adjuster, a supplement on Estimate requested): its
    history and the claim's activity are still written."""
    from app.domains.client.models import ClaimActivity
    from app.domains.water_mitigation.models import WMJobStatusHistory

    previous = job.status
    job.status = status
    if staff_id:
        job.updated_by_id = staff_id
    session.add(WMJobStatusHistory(
        job_id=job.id, previous_status=previous, new_status=status,
        changed_by_id=staff_id, notes=notes,
    ))
    if job.claim_id:
        session.add(ClaimActivity(
            claim_id=job.claim_id,
            activity_type='status_changed',
            title=f"WM Job: {previous} → {status}",
            description=notes,
            related_entity_type='wm_job',
            related_entity_id=str(job.id),
            created_by_id=staff_id,
        ))


def _change(session, kind: str, row: Any, to: str, to_status: str,
            staff_id: Optional[str]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Set one item to `to`; returns what it was and what it is now"""
    if kind == KIND_REBUILD:
        before = {'status': row.status, 'actual_completion': _iso(row.actual_completion)}
        row.status = to
        if to == 'completed' and not row.actual_completion:
            row.actual_completion = _now()
        return before, {'status': row.status, 'actual_completion': _iso(row.actual_completion)}

    if kind == KIND_SUPPLEMENT:
        before = {'status': row.status}
        row.status = to
        _mirror_supplement_status(session, row.claim_id, to)
        return before, {'status': to}

    if kind == KIND_TASK:
        from app.domains.claim_followup.service import sync_payment_to_wm
        before = {
            'status': row.status,
            'payment_status': row.payment_status,
            'resolved_at': _iso(row.resolved_at),
        }
        if to == 'cancelled':
            row.status = 'cancelled'
            note = f'Cancelled when the claim was {to_status}.'
        else:
            row.status = 'resolved'
            row.resolved_at = _now()
            note = f'Resolved when the claim was {to_status}.'
            if to == 'received':
                row.payment_status = 'received'
                sync_payment_to_wm(session, {
                    'task_type': row.task_type, 'title': row.title,
                    'claim_id': str(row.claim_id),
                    'wm_job_id': str(row.wm_job_id) if row.wm_job_id else None,
                }, {'payment_status': 'received'})
        row.resolution_notes = _append_note(row.resolution_notes, note)
        return before, {
            'status': row.status,
            'payment_status': row.payment_status,
            'resolved_at': _iso(row.resolved_at),
        }

    # WM job: through the WM page's own path, so a docs follow-up it no longer
    # needs is resolved as usual
    from app.domains.water_mitigation.schemas import JobStatusUpdate
    from app.domains.water_mitigation.service import WaterMitigationService
    before = {'status': row.status}
    WaterMitigationService(session).update_job_status(
        row.id,
        JobStatusUpdate(status=to, notes=f'Set when the claim was {to_status}.'),
        changed_by_id=staff_id,
    )
    session.refresh(row)
    return before, {'status': row.status}


def _restore(session, kind: str, row: Any, before: Dict[str, Any], staff_id: Optional[str]) -> None:
    """Put one item back the way the closeout found it"""
    if kind == KIND_REBUILD:
        row.status = before.get('status')
        row.actual_completion = _parse(before.get('actual_completion'))
    elif kind == KIND_SUPPLEMENT:
        row.status = before.get('status')
        _mirror_supplement_status(session, row.claim_id, row.status)
    elif kind == KIND_TASK:
        row.status = before.get('status')
        row.payment_status = before.get('payment_status')
        row.resolved_at = _parse(before.get('resolved_at'))
        row.resolution_notes = _append_note(row.resolution_notes, 'Reopened with the claim.')
    else:
        _set_wm_status(session, row, before.get('status'), 'Set back when the claim was reopened.', staff_id)


def _load(session, kind: str, item_id: str) -> Any:
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.rebuild.models import RebuildProject
    from app.domains.supplement.models import SupplementRequest
    from app.domains.water_mitigation.models import WaterMitigationJob
    model = {
        KIND_REBUILD: RebuildProject,
        KIND_SUPPLEMENT: SupplementRequest,
        KIND_TASK: FollowUpTask,
        KIND_WM: WaterMitigationJob,
    }.get(kind)
    if model is None:
        return None
    return session.query(model).filter(model.id == str(item_id)).first()


def _open_records(session, claim_id: str):
    from app.domains.client.models import ClaimCloseout
    return session.query(ClaimCloseout).filter(
        ClaimCloseout.claim_id == str(claim_id),
        ClaimCloseout.reopened_at.is_(None),
    )


def _summary(changes: List[Dict[str, Any]], key: str) -> str:
    return '\n'.join(
        f"{item_name(c)}: {humanize(c['before']['status'])} → {humanize(c['after']['status'])}"
        if key == 'forward' else
        f"{item_name(c)}: back to {humanize(c['before']['status'])}"
        for c in changes
    )


def check_closeout(session, claim_id: str, to_status: str, choices: Iterable[Dict[str, Any]],
                   exclude_task_id: Optional[str] = None
                   ) -> Tuple[Dict[Tuple[str, str], Dict[str, Any]], Dict[Tuple[str, str], str]]:
    """
    The claim's open items and what was picked for each ({kind, id, to}).
    Raises ValueError for a value an item doesn't offer, or an item with no
    suggestion left unpicked. Picks for items not on the claim, or finished in
    the meantime, are dropped. Callers check before saving anything.
    """
    preview = closeout_preview(session, claim_id, to_status, exclude_task_id)
    open_items = {(i['kind'], i['id']): i for i in preview['items'] if not i['done']}

    picked: Dict[Tuple[str, str], str] = {}
    for choice in choices or []:
        key = (choice.get('kind'), str(choice.get('id')))
        item = open_items.get(key)
        if item is None:
            continue
        to = choice.get('to')
        if to not in {o['value'] for o in item['options']}:
            raise ValueError(f"{item_name(item)} can't be set to '{to}'")
        picked[key] = to
    missing = [item_name(i) for k, i in open_items.items()
               if k not in picked and i['default'] is None]
    if missing:
        raise ValueError('Pick what happens to: ' + '; '.join(missing))
    return open_items, picked


def apply_closeout(session, claim_id: str, from_status: Optional[str], to_status: str,
                   choices: Iterable[Dict[str, Any]], staff_id: Optional[str] = None,
                   exclude_task_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Set the claim's linked items to what was picked for each ({kind, id, to}),
    in the caller's transaction, and record what changed. Only picked items
    change; check_closeout's ValueErrors apply. Returns the changes.
    """
    from app.domains.client.models import ClaimActivity, ClaimCloseout

    open_items, picked = check_closeout(session, claim_id, to_status, choices, exclude_task_id)

    # A newer closeout replaces any older one a reopen hadn't used
    for old in _open_records(session, claim_id).all():
        old.reopened_at = _now()

    changes: List[Dict[str, Any]] = []
    for kind in KINDS:
        for (k, item_id), to in picked.items():
            if k != kind or to == KEEP:
                continue
            row = _load(session, kind, item_id)
            if row is None:
                continue
            before, after = _change(session, kind, row, to, to_status, staff_id)
            if before.get('status') == after.get('status'):
                continue
            item = open_items[(k, item_id)]
            changes.append({
                'kind': kind, 'id': item_id, 'group': item['group'], 'label': item['label'],
                'before': before, 'after': after,
            })

    if changes:
        session.add(ClaimCloseout(
            claim_id=str(claim_id), from_status=from_status, to_status=to_status,
            items=changes, created_by_id=staff_id,
        ))
        session.add(ClaimActivity(
            claim_id=str(claim_id),
            activity_type='status_changed',
            title=f'Claim {to_status}: linked work wrapped up',
            description=_summary(changes, 'forward'),
            created_by_id=staff_id,
        ))
    session.flush()
    return changes


def reopen_preview(session, claim_id: str) -> Dict[str, Any]:
    """What the claim's last closeout changed, with what each item is now. An
    item changed since (by hand, or by other work) comes unticked."""
    from app.domains.client.models import ClaimCloseout

    record = _open_records(session, claim_id).order_by(ClaimCloseout.created_at.desc()).first()
    if record is None:
        return {'closeout_id': None, 'to_status': None, 'closed_at': None, 'items': []}
    items = []
    for change in record.items or []:
        row = _load(session, change['kind'], change['id'])
        if row is None:
            continue
        changed_since = row.status != change['after'].get('status')
        items.append({
            'kind': change['kind'],
            'id': change['id'],
            'group': change['group'],
            'label': change['label'],
            'before_status': change['before'].get('status'),
            'before_label': humanize(change['before'].get('status')),
            'status': row.status,
            'status_label': humanize(row.status),
            'changed_since': changed_since,
            'default': not changed_since,
        })
    return {
        'closeout_id': str(record.id),
        'to_status': record.to_status,
        'closed_at': _iso(record.created_at),
        'items': items,
    }


def apply_reopen(session, claim_id: str, keys: Optional[Iterable[Dict[str, Any]]],
                 staff_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Put back the picked items ({kind, id}) of the claim's last closeout, in
    the caller's transaction. Called whenever a claim leaves Closed/Denied, so
    the record is used up even when nothing is picked. Returns what was put
    back."""
    from app.domains.client.models import ClaimActivity, ClaimCloseout

    records = _open_records(session, claim_id).order_by(ClaimCloseout.created_at.desc()).all()
    if not records:
        return []
    record = records[0]
    wanted = {(k.get('kind'), str(k.get('id'))) for k in (keys or [])}
    restored: List[Dict[str, Any]] = []
    for change in record.items or []:
        if (change['kind'], change['id']) not in wanted:
            continue
        row = _load(session, change['kind'], change['id'])
        if row is None:
            continue
        _restore(session, change['kind'], row, change['before'], staff_id)
        restored.append(change)
    now = _now()
    for r in records:
        r.reopened_at = now
    if restored:
        session.add(ClaimActivity(
            claim_id=str(claim_id),
            activity_type='status_changed',
            title='Claim reopened: linked work put back',
            description=_summary(restored, 'back'),
            created_by_id=staff_id,
        ))
    session.flush()
    return restored
