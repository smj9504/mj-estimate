/**
 * Claim progress model shared by the follow-up list and the claim detail page:
 * one fixed track per claim so the same stage always sits in the same place,
 * plus a single "focus" stage that answers "what is this claim on right now".
 */

import dayjs from 'dayjs';
import type { TagTone } from '../../styles/tokens';
import type { FollowUpTask, TaskType } from '../../types/claimFollowUp';
import { DEPRECIATION_PHASE_LABELS, ACTIONABLE_STATUSES } from '../../types/claimFollowUp';

/** The claim-level facts the progress model reads */
export interface ClaimProgressInput {
  tasks: FollowUpTask[];
  supplementStatuses: Record<string, number>;
  bidEstimateSummary: Record<string, number>;
  hasInsuranceEstimate: boolean;
  wmCostStatus: string;
  /** carrier_provided | contractor_prepared: who writes the rebuild estimate */
  estimateOrigin?: string;
  contractorEstimateStage?: string;
  /** The non-WM company writing it on the contractor-prepared path */
  rebuildEstimateCompanyName?: string | null;
}

/** Stage picker options for the add/edit task forms */
export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'wm_docs_sent', label: 'WM Docs (Invoice/COS/EWA/Photo)' },
  { value: 'supplement_estimate_prep', label: 'Prepare Supplement Estimate' },
  { value: 'supplement_sent', label: 'Supplement Sent' },
  { value: 'depreciation_recovery', label: 'Depreciation Recovery Docs' },
  { value: 'estimate_request', label: 'Estimate Request' },
  { value: 'payment_check', label: 'Payment Check' },
  { value: 'wm_payment_check', label: 'WM Payment Check' },
  { value: 'docs_sent', label: 'Other Documents' },
  { value: 'general', label: 'General' },
  { value: 'dispute', label: 'Dispute (Denied)' },
  { value: 'appraisal', label: 'Appraisal (Denied)' },
  { value: 'attorney_referral', label: 'Attorney Referral (Denied)' },
  { value: '__custom__', label: '+ Custom Stage...' },
];

// Stages that resolve with a payment status only (no estimate outcome).
export const PAYMENT_TASK_TYPES: TaskType[] = ['payment_check', 'wm_payment_check'];

// Stages that resolve via the insurance-estimate outcome form
// (estimate received / WM-only / requested / denied).
export const ESTIMATE_OUTCOME_TASK_TYPES: TaskType[] = ['estimate_request', 'wm_docs_sent'];

// Ordered stages for the pipeline view
export const STAGE_ORDER: TaskType[] = [
  'wm_docs_sent',
  'wm_payment_check',    // WM Payment first
  'payment_check',       // Rebuild Payment second
  'supplement_estimate_prep', // Draft supplement estimate...
  'supplement_sent',     // ...then send it, after initial payments
  'estimate_request',
  'dispute',
  'appraisal',
  'attorney_referral',
  'depreciation_recovery',
  'docs_sent',
  'general',
];

export const STAGE_LABELS: Record<string, string> = {
  wm_docs_sent: 'WM Docs',
  estimate_request: 'Est. Request',
  supplement_estimate_prep: 'Supplement Prep',
  supplement_sent: 'Supplement',
  payment_check: 'Rebuild Payment',
  wm_payment_check: 'WM Payment',
  depreciation_recovery: 'Depreciation',
  docs_sent: 'Other Docs',
  general: 'General',
  dispute: 'Dispute',
  appraisal: 'Appraisal',
  attorney_referral: 'Attorney',
};

/** Convert a custom task_type key (e.g. "check_with_pa") to a display label */
export const getStageLabel = (stage: string): string =>
  STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── Claim progress model ──

export const isTaskActive = (t: FollowUpTask) => !['resolved', 'cancelled'].includes(t.status);

export const isTaskOverdue = (task: FollowUpTask) => {
  const date = task.next_followup_date || task.due_date;
  if (!date) return false;
  // awaiting_confirmation은 다른 사람의 확인을 기다리는 상태 → overdue 아님
  return dayjs(date).isBefore(dayjs()) && ACTIONABLE_STATUSES.includes(task.status);
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  issued: 'Issued',
  homeowner_holding: 'HO Holding',
  lost: 'Lost',
  reissued: 'Reissued',
  partial: 'Partial',
  pending: 'Pending',
};

// Payment states that need someone to chase the money.
export const PAYMENT_ISSUE_STATUSES = ['homeowner_holding', 'lost', 'partial'];

export const TASK_STATUS_PHRASES: Record<string, string> = {
  pending: 'To do',
  awaiting_response: 'Awaiting response',
  awaiting_confirmation: 'Awaiting confirmation',
  responded: 'Responded',
  resolved: 'Done',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_response: 'Awaiting response',
  awaiting_confirmation: 'Awaiting confirmation',
  responded: 'Responded',
  resolved: 'Resolved',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

/** One tone per task status, so a status reads the same wherever it shows */
export const TASK_STATUS_TONES: Record<string, TagTone> = {
  pending: 'blue',
  awaiting_response: 'orange',
  awaiting_confirmation: 'purple',
  responded: 'yellow',
  resolved: 'green',
  cancelled: 'gray',
};

export const ROLE_SHORT_LABELS: Record<string, string> = {
  public_adjuster: 'PA',
  adjuster: 'Adjuster',
  contractor: 'Contractor',
};

/** Where the contractor-prepared rebuild estimate stands */
export const CONTRACTOR_STAGE_PHRASES: Record<string, string> = {
  requested: 'We write it',
  estimate_sent: 'Sent for approval',
  awaiting_approval: 'Awaiting approval',
  approved_initial_received: 'Approved',
};

// overdue/issue: needs attention · active: ours to move · waiting: on someone
// else · todo: expected next but not started · done · none: not reached / n/a
export type StepState = 'overdue' | 'issue' | 'active' | 'waiting' | 'todo' | 'done' | 'none';

export interface ProgressStep {
  key: string;
  label: string;
  shortLabel: string;
  title: string;
  state: StepState;
  detail: string;
  note?: string;
  activeTask?: FollowUpTask;
  resolvedTask?: FollowUpTask;
}

export interface ClaimProgress {
  track: ProgressStep[];
  /** Off-track stages (dispute, other docs, custom…) with open work */
  extras: ProgressStep[];
  focus: ProgressStep | null;
}

export const TRACK_SLOTS: { key: string; label: string; shortLabel: string; title: string; types: TaskType[] }[] = [
  { key: 'wm_docs', label: 'WM Docs', shortLabel: 'Docs', title: 'WM docs', types: ['wm_docs_sent'] },
  { key: 'estimate', label: 'Estimate', shortLabel: 'Est.', title: 'Insurance estimate', types: ['estimate_request'] },
  { key: 'wm_payment', label: 'WM $', shortLabel: 'WM $', title: 'WM payment', types: ['wm_payment_check'] },
  { key: 'rebuild_payment', label: 'Rebuild $', shortLabel: 'Rebuild', title: 'Rebuild payment', types: ['payment_check'] },
  { key: 'supplement', label: 'Supplement', shortLabel: 'Supp.', title: 'Supplement', types: ['supplement_estimate_prep', 'supplement_sent'] },
  { key: 'depreciation', label: 'Depreciation', shortLabel: 'Dep.', title: 'Depreciation', types: ['depreciation_recovery'] },
];

export const TRACK_TYPES = new Set<string>(TRACK_SLOTS.flatMap(s => s.types));

// Legend order: attention first, then ours, then everyone else.
export const STAGE_LEGEND: { state: StepState; label: string }[] = [
  { state: 'overdue', label: 'Overdue' },
  { state: 'issue', label: 'Payment / denial issue' },
  { state: 'active', label: 'In progress (ours)' },
  { state: 'waiting', label: 'Waiting on others' },
  { state: 'todo', label: 'Next, not started' },
  { state: 'done', label: 'Done' },
  { state: 'none', label: 'Not reached' },
];

// A denied claim's dispute path outranks routine stages as the focus.
export const DENIAL_TYPES = ['dispute', 'appraisal', 'attorney_referral'];

export const stateFromTasks = (active: FollowUpTask[], resolved: FollowUpTask[]): StepState => {
  if (active.some(isTaskOverdue)) return 'overdue';
  if (active.length > 0) {
    return active.every(t => t.status === 'awaiting_confirmation') ? 'waiting' : 'active';
  }
  return resolved.length > 0 ? 'done' : 'none';
};

export const buildClaimProgress = (group: ClaimProgressInput): ClaimProgress => {
  const byTypes = (types: string[]) => {
    const tasks = group.tasks.filter(t => types.includes(t.task_type));
    return {
      active: tasks.filter(isTaskActive),
      resolved: tasks.filter(t => t.status === 'resolved'),
    };
  };

  const makeStep = (
    key: string, label: string, shortLabel: string, title: string, types: string[],
  ): ProgressStep => {
    const { active, resolved } = byTypes(types);
    const primary = active.find(isTaskOverdue) || active[0];
    return {
      key, label, shortLabel, title,
      state: stateFromTasks(active, resolved),
      detail: primary
        ? (TASK_STATUS_PHRASES[primary.status] || primary.status)
        : resolved.length > 0 ? 'Done' : '',
      activeTask: primary,
      resolvedTask: resolved[0],
    };
  };

  const applyPaymentStatus = (step: ProgressStep) => {
    const task = step.activeTask || step.resolvedTask;
    const status = task?.payment_status;
    step.note = task?.payment_note || undefined;
    if (!status || status === 'pending') return;
    step.detail = PAYMENT_STATUS_LABELS[status] || status;
    if (PAYMENT_ISSUE_STATUSES.includes(status) && step.state !== 'overdue') {
      step.state = 'issue';
    }
  };

  // Supplement summary from supplement records + bid items
  const ss = group.supplementStatuses;
  const suppTotal = Object.values(ss).reduce((a, b) => a + b, 0);
  const suppApproved = ss['approved'] || 0;
  const suppDenied = ss['denied'] || 0;
  const suppSubmitted = ss['submitted'] || ss['under_review'] || 0;
  const suppInProgress = ss['in_progress'] || ss['identified'] || 0;
  const bid = group.bidEstimateSummary;
  const bidTotal = Object.values(bid).reduce((a, b) => a + b, 0);
  const bidDraft = bid['draft'] || 0;
  const bidSent = bid['sent'] || 0;
  const allSuppApproved = suppApproved > 0 && suppApproved === suppTotal;
  const allSuppDenied = suppDenied > 0 && suppDenied === suppTotal;
  let suppDetail = '';
  if (allSuppApproved) suppDetail = `Approved (${suppApproved})`;
  else if (allSuppDenied) suppDetail = 'Denied';
  else if (suppSubmitted > 0) suppDetail = 'Submitted';
  else if (bidSent > 0) suppDetail = `Sent to PA${bidDraft > 0 ? ` (${bidSent}/${bidTotal})` : ''}`;
  else if (suppInProgress > 0 || bidDraft > 0) suppDetail = `Estimating${bidTotal > 0 ? ` (${bidTotal})` : ''}`;
  else if (suppTotal > 0) suppDetail = `${suppTotal} open`;

  const track = TRACK_SLOTS.map(slot => {
    const step = makeStep(slot.key, slot.label, slot.shortLabel, slot.title, slot.types);

    switch (slot.key) {
      case 'wm_docs':
        if (step.activeTask?.status === 'awaiting_response') step.detail = 'Sent, awaiting response';
        else if (step.state === 'done') step.detail = 'Sent';
        break;

      case 'estimate':
        if (group.hasInsuranceEstimate && (step.state === 'none' || step.state === 'done')) {
          step.state = 'done';
          step.detail = 'Received';
        } else if (step.state === 'none' && group.estimateOrigin === 'contractor_prepared') {
          // The carrier asked us for it: a non-WM company writes it, then
          // the carrier approves it.
          const stage = group.contractorEstimateStage || 'requested';
          step.state = stage === 'requested' ? 'active' : 'waiting';
          step.detail = CONTRACTOR_STAGE_PHRASES[stage] || stage;
          step.note = group.rebuildEstimateCompanyName
            ? `Rebuild estimate by ${group.rebuildEstimateCompanyName}`
            : 'Pick the company that writes it (not the WM company)';
        } else if (step.state === 'none') {
          const docs = byTypes(['wm_docs_sent']);
          if (docs.resolved.length > 0 && docs.active.length === 0) {
            step.state = 'waiting';
            // WM paid per our invoice: only the rebuild estimate is still to come
            step.detail = group.wmCostStatus === 'paid_per_invoice'
              ? 'Awaiting rebuild estimate'
              : 'Awaiting initial estimate';
          }
        }
        break;

      case 'wm_payment':
        if (step.state === 'none') {
          if (group.wmCostStatus === 'paid_per_invoice') {
            step.state = 'todo';
            step.detail = 'Invoice approved';
          } else if (group.wmCostStatus === 'included_in_rebuild') {
            step.state = 'done';
            step.detail = 'In rebuild payment';
          } else if (group.wmCostStatus === 'separate_estimate') {
            step.state = 'todo';
            step.detail = 'Not started';
          }
        }
        applyPaymentStatus(step);
        if (group.wmCostStatus === 'paid_per_invoice' && !step.note) {
          step.note = 'Paid per our invoice, no WM estimate';
        }
        break;

      case 'rebuild_payment':
        if (step.state === 'none' && group.hasInsuranceEstimate) {
          step.state = 'todo';
          step.detail = 'Not started';
        }
        applyPaymentStatus(step);
        break;

      case 'supplement': {
        const prep = byTypes(['supplement_estimate_prep']);
        const sent = byTypes(['supplement_sent']);
        const sentHasTasks = sent.active.length + sent.resolved.length > 0;
        if (!sentHasTasks && prep.active.length === 0 && group.hasInsuranceEstimate) {
          // No follow-up task for sending — derive from the supplement records
          if (allSuppApproved) step.state = 'done';
          else if (suppSubmitted > 0 || bidSent > 0) step.state = 'waiting';
          else step.state = 'todo';
          step.detail = suppDetail || 'Needs supplement';
        } else if (step.state !== 'none') {
          if (suppDetail) step.detail = suppDetail;
          else if (prep.active.length > 0 && sent.active.length === 0) step.detail = 'Preparing estimate';
        }
        if (allSuppDenied && step.state !== 'overdue') step.state = 'issue';
        if (!step.note) {
          if (bidSent > 0) step.note = `${bidSent} bid item(s) sent to PA`;
          else if (bidDraft > 0) step.note = `${bidDraft} bid item(s) in draft`;
        }
        break;
      }

      case 'depreciation': {
        const phase = (step.activeTask || step.resolvedTask)?.depreciation_phase;
        if (phase) {
          step.detail = DEPRECIATION_PHASE_LABELS[phase as keyof typeof DEPRECIATION_PHASE_LABELS] || phase;
        }
        break;
      }
    }
    return step;
  });

  // Off-track stages only appear while they have open work; their full
  // history stays in the expanded stage table.
  const extraTypes = Array.from(new Set(
    group.tasks
      .filter(t => !TRACK_TYPES.has(t.task_type) && isTaskActive(t))
      .map(t => t.task_type as string),
  )).sort((a, b) => {
    const rank = (t: string) => {
      const d = DENIAL_TYPES.indexOf(t);
      if (d >= 0) return d;
      const s = STAGE_ORDER.indexOf(t as TaskType);
      return s >= 0 ? 10 + s : 100;
    };
    return rank(a) - rank(b);
  });
  const extras = extraTypes.map(type => {
    const label = getStageLabel(type);
    return makeStep(type, label, label, label, [type]);
  });

  const dueOf = (s: ProgressStep) =>
    s.activeTask?.next_followup_date || s.activeTask?.due_date || '';
  const all = [...track, ...extras];
  const focus =
    all.filter(s => s.state === 'overdue').sort((a, b) => dueOf(a).localeCompare(dueOf(b)))[0]
    || extras.find(s => DENIAL_TYPES.includes(s.key) && s.state === 'active')
    || [...track].reverse().find(s => s.state === 'active')
    || extras.find(s => s.state === 'active')
    || all.find(s => s.state === 'issue')
    || track.find(s => s.state === 'todo')
    || all.find(s => s.state === 'waiting')
    || null;

  return { track, extras, focus };
};
