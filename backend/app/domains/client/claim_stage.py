"""
Where an insurance claim is in its lifecycle, worked out from its records.

The office runs every claim through the same steps:

1. mitigation           Lead in; plumbing fixed and water mitigation done
2. wm_docs              Claim filed; WM file being put together (photos, data, documents)
3. awaiting_estimate    WM file sent to the carrier; waiting on its estimate
4. supplement_prep      Writing the supplement estimate for the PA to submit
   appraisal_prep       ...or, when the carrier won't pay, the contractor estimate for appraisal
5. supplement_followup  Submitted; following up until it is approved
   appraisal_followup   ...the same on the appraisal path
   construction         Paperwork settled; waiting on the rebuild to finish
6. depreciation         Rebuild done; depreciation file to the PA, then the carrier
7. settlement           Money in; settling up with the PA and the contractor

Construction runs alongside steps 3-5: it starts around the first carrier
estimate (which brings the first check) and ends whenever it ends, before or
after the supplement or appraisal is settled. So it is reported on its own
(construction_state). Depreciation needs both: the rebuild finished and the
paperwork settled, since the depreciation file can't go out while a
supplement is still being negotiated. A rebuild that finishes first leaves
the claim on its supplement or appraisal stage until that is settled.

The claim's status still decides the end: 'closed' and 'denied' claims are
finished whatever their records say. stage_override lets staff move a claim
ahead when its records lag behind; once the records reach a later stage the
override no longer applies.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Order matters: a stage's position is how far along the claim is.
STAGE_STEPS: Dict[str, int] = {
    'mitigation': 1,
    'wm_docs': 2,
    'awaiting_estimate': 3,
    'supplement_prep': 4,
    'appraisal_prep': 4,
    'supplement_followup': 5,
    'appraisal_followup': 5,
    'construction': 6,
    'depreciation': 7,
    'settlement': 8,
}

# What staff may set by hand. Closing or denying a claim stays on its status.
OVERRIDE_STAGES = tuple(STAGE_STEPS)

# Finished claims; every other stage is still being worked
DONE_STAGES = ('closed', 'denied')

WM_STATUS_LEVELS = {'Lead': 1, 'Doc prepping': 2}  # any other status: docs sent

# Depreciation phases reached only once construction is finished
POST_CONSTRUCTION_PHASES = (
    'construction_done', 'preparing_docs', 'docs_sent_pa',
    'docs_sent_insurance', 'following_up', 'payment_received',
)
DEPRECIATION_PHASE_ORDER = ('in_construction',) + POST_CONSTRUCTION_PHASES
# The depreciation file already went out: the claim has moved on to it
DOCS_OUT_PHASES = ('docs_sent_pa', 'docs_sent_insurance', 'following_up')
DEPRECIATION_DETAILS = {
    'construction_done': 'Prepare depreciation docs',
    'preparing_docs': 'Preparing depreciation docs',
    'docs_sent_pa': 'Docs sent to PA',
    'docs_sent_insurance': 'Docs sent to carrier',
    'following_up': 'Following up on payment',
}

CONTRACTOR_ESTIMATE_DETAILS = {
    'requested': 'We write the estimate',
    'estimate_sent': 'Our estimate awaiting approval',
    'awaiting_approval': 'Our estimate awaiting approval',
}

OPEN_TASK_STATUSES = ('pending', 'awaiting_response', 'awaiting_confirmation', 'responded', 'overdue')
WAITING_TASK_STATUSES = ('awaiting_response', 'awaiting_confirmation', 'responded')
SUPPLEMENT_PREP_STATUSES = ('identified', 'in_progress')
SUPPLEMENT_SUBMITTED_STATUSES = ('submitted', 'under_review')
SUPPLEMENT_DONE_STATUSES = ('approved', 'denied', 'withdrawn')
SUPPLEMENT_TASK_TYPES = ('supplement_estimate_prep', 'supplement_sent')

# Supplement or appraisal work that holds a finished rebuild back from depreciation
PAPERWORK_STAGES = ('supplement_prep', 'supplement_followup', 'appraisal_prep', 'appraisal_followup')
BID_PREP_STATUSES = ('draft', 'revision_needed')


@dataclass
class StageFacts:
    """The records of one claim that the stage is worked out from"""
    wm_statuses: List[str] = field(default_factory=list)
    # (task_type, status, depreciation_phase, payment_status)
    tasks: List[Tuple[str, str, Optional[str], Optional[str]]] = field(default_factory=list)
    # supplement_id -> (status, request_type)
    supplements: Dict[str, Tuple[str, Optional[str]]] = field(default_factory=dict)
    # supplement_id -> bid item statuses
    bids: Dict[str, List[str]] = field(default_factory=dict)
    revision_types: Set[str] = field(default_factory=set)
    depreciation_paid: bool = False


def _get(claim: Any, name: str) -> Any:
    """Claims come in as models or as repository dicts"""
    if isinstance(claim, dict):
        return claim.get(name)
    return getattr(claim, name, None)


def load_stage_facts(session, claim_ids: Iterable[Any]) -> Dict[str, StageFacts]:
    """{claim_id: StageFacts} for the given claims, one query per record kind"""
    from app.domains.claim_followup.models import FollowUpTask
    from app.domains.client.models import ClaimNegotiation, ClaimPayment
    from app.domains.supplement.models import BidItemEstimate, SupplementRequest
    from app.domains.water_mitigation.models import WaterMitigationJob

    ids = [str(c) for c in claim_ids if c]
    facts: Dict[str, StageFacts] = {cid: StageFacts() for cid in ids}
    if not ids:
        return facts

    for claim_id, status in session.query(
        WaterMitigationJob.claim_id, WaterMitigationJob.status
    ).filter(WaterMitigationJob.claim_id.in_(ids), WaterMitigationJob.active == True).all():  # noqa: E712
        facts[str(claim_id)].wm_statuses.append(status)

    for row in session.query(
        FollowUpTask.claim_id, FollowUpTask.task_type, FollowUpTask.status,
        FollowUpTask.depreciation_phase, FollowUpTask.payment_status,
    ).filter(FollowUpTask.claim_id.in_(ids), FollowUpTask.status != 'cancelled').all():
        facts[str(row.claim_id)].tasks.append(
            (row.task_type, row.status, row.depreciation_phase, row.payment_status)
        )

    supplement_claims: Dict[str, str] = {}
    for supp_id, claim_id, status, request_type in session.query(
        SupplementRequest.id, SupplementRequest.claim_id,
        SupplementRequest.status, SupplementRequest.request_type,
    ).filter(SupplementRequest.claim_id.in_(ids)).all():
        supplement_claims[str(supp_id)] = str(claim_id)
        facts[str(claim_id)].supplements[str(supp_id)] = (status, request_type)

    if supplement_claims:
        for supp_id, status in session.query(
            BidItemEstimate.supplement_id, BidItemEstimate.status
        ).filter(BidItemEstimate.supplement_id.in_(list(supplement_claims))).all():
            claim_facts = facts[supplement_claims[str(supp_id)]]
            claim_facts.bids.setdefault(str(supp_id), []).append(status)

    for claim_id, revision_type in session.query(
        ClaimNegotiation.claim_id, ClaimNegotiation.revision_type
    ).filter(ClaimNegotiation.claim_id.in_(ids)).distinct().all():
        facts[str(claim_id)].revision_types.add(revision_type)

    for (claim_id,) in session.query(ClaimPayment.claim_id).filter(
        ClaimPayment.claim_id.in_(ids),
        ClaimPayment.payment_type == 'depreciation_recovery',
    ).distinct().all():
        facts[str(claim_id)].depreciation_paid = True

    return facts


def _depreciation_phase(facts: StageFacts) -> Optional[str]:
    """The depreciation task phase that describes the claim: the least advanced
    open task, else the furthest any finished task got"""
    def rank(phase):
        return DEPRECIATION_PHASE_ORDER.index(phase) if phase in DEPRECIATION_PHASE_ORDER else -1

    dep = [(status, phase) for task_type, status, phase, _ in facts.tasks
           if task_type == 'depreciation_recovery' and phase]
    open_phases = [phase for status, phase in dep if status != 'resolved']
    if open_phases:
        return min(open_phases, key=rank)
    if dep:
        return max((phase for _, phase in dep), key=rank)
    return None


def _depreciation_received(facts: StageFacts) -> bool:
    if facts.depreciation_paid:
        return True
    return any(
        task_type == 'depreciation_recovery'
        and (phase == 'payment_received' or (status == 'resolved' and payment == 'received'))
        for task_type, status, phase, payment in facts.tasks
    )


def construction_state(claim: Any, facts: StageFacts) -> Optional[str]:
    """'done', 'in_progress', or None while the rebuild hasn't started"""
    phase = _depreciation_phase(facts)
    if (_get(claim, 'construction_completed_at') or phase in POST_CONSTRUCTION_PHASES
            or _depreciation_received(facts)):
        return 'done'
    if _get(claim, 'construction_started_at') or phase == 'in_construction':
        return 'in_progress'
    return None


def _has_estimate(claim: Any, facts: StageFacts) -> bool:
    """The carrier's first estimate is in (or approved ours)"""
    return bool(
        _get(claim, 'insurance_estimate_received')
        or _get(claim, 'current_acv')
        or _get(claim, 'current_rcv')
        or _get(claim, 'insurance_estimate_file_id')
        or facts.revision_types
        or _get(claim, 'contractor_estimate_stage') == 'approved_initial_received'
    )


def _tasks(facts: StageFacts, task_type: str, statuses: Iterable[str]) -> list:
    return [t for t in facts.tasks if t[0] == task_type and t[1] in statuses]


def _supplements(facts: StageFacts) -> Dict[str, Tuple[str, Optional[str]]]:
    """Supplement records, without the estimates a carrier asked us for"""
    return {sid: s for sid, s in facts.supplements.items() if (s[1] or 'supplement') == 'supplement'}


def _supplement_started(facts: StageFacts) -> bool:
    return bool(_supplements(facts)) or any(t[0] in SUPPLEMENT_TASK_TYPES for t in facts.tasks)


def _supplement_stage(facts: StageFacts) -> Tuple[str, str]:
    """After the first estimate, on the supplement path"""
    prep = bool(_tasks(facts, 'supplement_estimate_prep', OPEN_TASK_STATUSES))
    submitted = bool(_tasks(facts, 'supplement_sent', OPEN_TASK_STATUSES))
    supplements = _supplements(facts)
    for supp_id, (status, _) in supplements.items():
        bids = facts.bids.get(supp_id, [])
        if status in SUPPLEMENT_SUBMITTED_STATUSES:
            submitted = True
        elif status in SUPPLEMENT_PREP_STATUSES:
            # Every bid item already went to the PA: the supplement is out
            if bids and 'sent' in bids and not any(b in BID_PREP_STATUSES for b in bids):
                submitted = True
            else:
                prep = True

    if prep:
        return 'supplement_prep', 'Writing supplement estimate'
    if submitted:
        return 'supplement_followup', 'Submitted, awaiting approval'
    # Supplements all answered, or the carrier's final / appraisal figure is in
    if supplements or facts.revision_types & {'final', 'appraisal'}:
        return 'construction', ''
    return 'supplement_prep', 'No supplement yet'


def _in_appraisal(claim: Any, facts: StageFacts) -> bool:
    # A denied claim taken to appraisal stays 'open' with an open appraisal task
    return _get(claim, 'status') == 'appraisal' or bool(_tasks(facts, 'appraisal', OPEN_TASK_STATUSES))


def _appraisal_stage(facts: StageFacts) -> Tuple[str, str]:
    """After the claim moved to appraisal: our estimate goes in through the PA"""
    tasks = [t for t in facts.tasks if t[0] == 'appraisal']
    if 'appraisal' in facts.revision_types or (tasks and all(t[1] == 'resolved' for t in tasks)):
        return 'construction', ''
    if any(t[1] in WAITING_TASK_STATUSES for t in tasks):
        return 'appraisal_followup', 'Submitted, awaiting decision'
    return 'appraisal_prep', 'Writing contractor estimate'


def _before_estimate(claim: Any, facts: StageFacts) -> Tuple[str, str]:
    """Before the carrier's first estimate"""
    contractor_stage = _get(claim, 'contractor_estimate_stage')
    if _get(claim, 'estimate_origin') == 'contractor_prepared' and contractor_stage in CONTRACTOR_ESTIMATE_DETAILS:
        return 'awaiting_estimate', CONTRACTOR_ESTIMATE_DETAILS[contractor_stage]

    docs_sent = bool(
        _tasks(facts, 'wm_docs_sent', WAITING_TASK_STATUSES + ('resolved',))
        or _tasks(facts, 'estimate_request', OPEN_TASK_STATUSES)
    )
    levels = [WM_STATUS_LEVELS.get(s, 3) for s in facts.wm_statuses]
    # The job furthest behind holds the claim back
    level = min(levels) if levels else None
    if not docs_sent and level == 1:
        return 'mitigation', 'Lead'
    if not docs_sent and level == 2:
        return 'wm_docs', 'Preparing WM docs'
    if _get(claim, 'wm_cost_status') == 'paid_per_invoice':
        return 'awaiting_estimate', 'Awaiting rebuild estimate'
    return 'awaiting_estimate', ('WM docs sent' if (docs_sent or levels) else '')


def derive_stage(claim: Any, facts: StageFacts) -> Tuple[str, str]:
    """(stage, detail) from the claim's records alone, ignoring any override"""
    status = _get(claim, 'status')
    if status in DONE_STAGES:
        return status, ''
    if _get(claim, 'claim_type') == 'cash':
        # A cash job has no carrier paperwork: it is open until it is closed
        return 'open', ''

    construction = construction_state(claim, facts)
    if _depreciation_received(facts):
        return 'settlement', 'Depreciation paid'
    if construction == 'done' and _get(claim, 'payment_status') in ('paid', 'overpaid'):
        return 'settlement', 'Paid in full'

    if _in_appraisal(claim, facts):
        stage, detail = _appraisal_stage(facts)
    elif _has_estimate(claim, facts):
        stage, detail = _supplement_stage(facts)
    else:
        stage, detail = _before_estimate(claim, facts)

    if construction == 'done':
        phase = _depreciation_phase(facts)
        # A rebuild that finished before the supplement or appraisal was
        # settled waits on it, unless the depreciation file already went out
        # (allowed during appraisal). A supplement never started holds nothing.
        held = (
            stage in PAPERWORK_STAGES
            and phase not in DOCS_OUT_PHASES
            and not (stage == 'supplement_prep' and not _supplement_started(facts))
        )
        if held:
            return stage, detail
        detail = DEPRECIATION_DETAILS.get(phase, 'Prepare depreciation docs')
        # Requested-estimate records block the file too
        pending = any(s[0] not in SUPPLEMENT_DONE_STATUSES for s in facts.supplements.values())
        if pending and phase not in DOCS_OUT_PHASES:
            detail = 'Supplement still open'
        return 'depreciation', detail

    if stage == 'construction':
        detail = 'In progress' if construction == 'in_progress' else 'Not started'
    return stage, detail


def claim_stage(claim: Any, facts: StageFacts) -> Dict[str, Any]:
    """The claim's stage for the screens: the derived one, or the override while
    the records haven't caught up with it"""
    auto_stage, auto_detail = derive_stage(claim, facts)
    stage, detail, source = auto_stage, auto_detail, 'auto'

    override = _get(claim, 'stage_override')
    if (override in STAGE_STEPS and auto_stage in STAGE_STEPS
            and override != auto_stage
            and STAGE_STEPS[override] >= STAGE_STEPS[auto_stage]):
        stage, detail, source = override, '', 'manual'

    return {
        'stage': stage,
        'stage_detail': detail,
        'stage_source': source,
        'auto_stage': auto_stage,
        'auto_stage_detail': auto_detail,
        'construction': construction_state(claim, facts),
    }


def claim_stages(session, claims: List[Any]) -> Dict[str, Dict[str, Any]]:
    """{claim_id: claim_stage(...)} for a batch of claims"""
    facts = load_stage_facts(session, [_get(c, 'id') for c in claims])
    return {
        str(_get(c, 'id')): claim_stage(c, facts.get(str(_get(c, 'id')), StageFacts()))
        for c in claims
    }


def is_active_stage(stage: Optional[str]) -> bool:
    return bool(stage) and stage not in DONE_STAGES
