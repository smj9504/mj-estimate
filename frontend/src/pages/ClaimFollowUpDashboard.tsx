import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Switch,
  InputNumber,
  message,
  Typography,
  Row,
  Col,
  Statistic,
  Tooltip,
  Dropdown,
  Collapse,
  Upload,
  Drawer,
  Descriptions,
  Divider,
  Tabs,
  Popconfirm,
  Alert,
  Skeleton,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MailOutlined,
  SendOutlined,
  EllipsisOutlined,
  AlertOutlined,
  FileTextOutlined,
  DollarOutlined,
  AuditOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  RightOutlined,
  FilePdfOutlined,
  HistoryOutlined,
  UserOutlined,
  PhoneOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { supplementService } from '../services/supplementService';
import { companyService } from '../services/companyService';
import { SUPPLEMENT_STATUS_COLORS } from '../types/supplement';
import { fileService } from '../services/fileService';
import ClaimSearchSelect from '../components/common/ClaimSearchSelect';
import { EmailComposer, CommunicationTimeline, DepreciationPhaseTracker } from '../components/claim-followup';
import type {
  FollowUpTask,
  FollowUpTaskCreate,
  FollowUpTaskUpdate,
  TaskType,
  TaskStatus,
  TaskPriority,
  PaymentReceiptCreate,
  PaymentReceipt,
} from '../types/claimFollowUp';
import {
  KNOWN_TASK_TYPES, DEPRECIATION_PHASE_LABELS, ACTIONABLE_STATUSES,
  PAYMENT_RECEIPT_TYPE_LABELS,
} from '../types/claimFollowUp';
import {
  ASSIGNED_ROLE_OPTIONS,
  ASSIGNED_ROLE_LABELS,
  contactForRole,
  isSupplementTaskType,
} from '../types/claimFollowUp';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { TextArea } = Input;

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 576);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 575px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
};

const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
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

const TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  wm_docs_sent: <SendOutlined />,
  supplement_estimate_prep: <FileTextOutlined />,
  supplement_sent: <FileTextOutlined />,
  depreciation_recovery: <DollarOutlined />,
  estimate_request: <AuditOutlined />,
  payment_check: <DollarOutlined />,
  wm_payment_check: <DollarOutlined />,
  docs_sent: <FileTextOutlined />,
  general: <ClockCircleOutlined />,
  dispute: <AuditOutlined />,
  appraisal: <FileTextOutlined />,
  attorney_referral: <AlertOutlined />,
};

// Stages that resolve with a payment status only (no estimate outcome).
const PAYMENT_TASK_TYPES: TaskType[] = ['payment_check', 'wm_payment_check'];

// Stages that resolve via the insurance-estimate outcome form
// (estimate received / WM-only / requested / denied).
const ESTIMATE_OUTCOME_TASK_TYPES: TaskType[] = ['estimate_request', 'wm_docs_sent'];

// Ordered stages for the pipeline view
const STAGE_ORDER: TaskType[] = [
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

const STAGE_LABELS: Record<string, string> = {
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
const getStageLabel = (stage: string): string =>
  STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── Estimate Category Configuration ──
// Add new estimate types here. Everything else adapts automatically.
const ESTIMATE_CATEGORIES: Record<string, {
  label: string;
  tagColor: string;
  fileLabel: string;       // Used in PDF filenames: {address}-{fileLabel}-v1.pdf
  sectionKeywords: string[]; // Keywords to auto-detect sections in this category
}> = {
  combined:          { label: 'Combined',          tagColor: 'blue',   fileLabel: 'Insurance-Estimate',        sectionKeywords: [] },
  reconstruction:    { label: 'Reconstruction',    tagColor: 'purple', fileLabel: 'Reconstruction-Estimate',   sectionKeywords: ['dwelling', 'water damage', 'rebuild', 'reconstruction', 'drywall', 'flooring', 'paint', 'cabinet', 'plumb', 'electrical', 'code', 'upgrade', 'coverage a'] },
  water_mitigation:  { label: 'Water Mitigation',  tagColor: 'cyan',   fileLabel: 'WM-Estimate',              sectionKeywords: ['water mitigation', 'emergency service', 'dry out', 'drying', 'dehumidifier', 'extraction'] },
  mold_remediation:  { label: 'Mold Remediation',  tagColor: 'volcano', fileLabel: 'Mold-Estimate',           sectionKeywords: ['mold', 'remediation', 'fungi', 'microbial'] },
};

const ESTIMATE_CATEGORY_OPTIONS = Object.entries(ESTIMATE_CATEGORIES).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));

const getEstimateCategoryConfig = (category: string | null | undefined) =>
  (category && ESTIMATE_CATEGORIES[category]) || null;

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue',
  awaiting_response: 'orange',
  awaiting_confirmation: 'purple',
  responded: 'cyan',
  resolved: 'green',
  overdue: 'red',
  cancelled: 'default',
};

const PRIORITY_TAG_COLORS: Record<string, string> = {
  low: 'default',
  normal: 'blue',
  high: 'orange',
  urgent: 'red',
};

// ── Stage Aggregation ──
// Groups multiple tasks of the same stage into one row with the worst status
interface StageAggregated {
  task_type: TaskType;
  status: string;
  assigned_to_name?: string;
  assigned_to_role?: string;
  primaryTask: FollowUpTask;
  taskCount: number;
  contact_count: number;
  priority: string;
  next_followup_date?: string;
  title: string;
}

const STAGE_STATUS_PRIORITY: Record<string, number> = {
  overdue: 0,
  awaiting_response: 1,
  pending: 2,
  responded: 3,
  // 타인 확인 대기: 우리 액션이 아니므로 resolved 직전 순위
  awaiting_confirmation: 4,
  resolved: 5,
  cancelled: 6,
};

const aggregateByStage = (
  tasks: FollowUpTask[],
  isOverdueFn: (t: FollowUpTask) => boolean,
): StageAggregated[] => {
  const stageMap = new Map<TaskType, FollowUpTask[]>();
  tasks.forEach(task => {
    if (!stageMap.has(task.task_type)) stageMap.set(task.task_type, []);
    stageMap.get(task.task_type)!.push(task);
  });

  // Include known stages in order, then append any custom stages
  const knownSet = new Set<string>(STAGE_ORDER);
  const orderedStages: TaskType[] = [
    ...STAGE_ORDER.filter(stage => stageMap.has(stage)),
    ...Array.from(stageMap.keys()).filter(k => !knownSet.has(k)),
  ];

  return orderedStages.map(stage => {
      const stageTasks = stageMap.get(stage)!;

      // Worst (most urgent) status across all tasks in this stage
      // Start above every rank so a lone resolved task reads "resolved",
      // not the 'cancelled' placeholder.
      let worstStatus = 'cancelled';
      let worstPri = Number.POSITIVE_INFINITY;
      stageTasks.forEach(t => {
        const effective = isOverdueFn(t) ? 'overdue' : t.status;
        const pri = STAGE_STATUS_PRIORITY[effective] ?? 5;
        if (pri < worstPri) { worstPri = pri; worstStatus = effective; }
      });

      // Primary task: prefer active (non-resolved/cancelled) task
      const activeTask = stageTasks.find(t => !['resolved', 'cancelled'].includes(t.status));
      const primary = activeTask || stageTasks[0];

      // Earliest upcoming follow-up date among active tasks
      const dates = stageTasks
        .filter(t => !['resolved', 'cancelled'].includes(t.status))
        .map(t => t.next_followup_date || t.due_date)
        .filter(Boolean) as string[];

      return {
        task_type: stage,
        status: worstStatus,
        assigned_to_name: primary.assigned_to_name,
        assigned_to_role: primary.assigned_to_role,
        primaryTask: primary,
        taskCount: stageTasks.length,
        contact_count: stageTasks.reduce((sum, t) => sum + t.contact_count, 0),
        priority: primary.priority,
        next_followup_date: dates.sort()[0],
        title: primary.title,
      };
    });
};

interface ClaimGroup {
  claim_id: string;
  property_address: string;
  claim_number: string;
  insurance_company: string;
  tasks: FollowUpTask[];
  activeStages: Set<TaskType>;
  hasOverdue: boolean;
  hasUrgent: boolean;
  wmCostStatus: string;
  hasInsuranceEstimate: boolean;
  nextFollowupDate: string | null;
  supplementStatuses: Record<string, number>;
  bidEstimateSummary: Record<string, number>;
  pendingInfoRequests: number;
  pa_name: string;
  pa_company: string;
  pa_email: string;
  pa_phone: string;
  expectedAmount: number;
  receivedAmount: number;
  deductible: number;
  hasPaymentIssue: boolean;
  progress: ClaimProgress | null;
}

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatWholeDollars = (val: number) =>
  `$${Math.round(val).toLocaleString('en-US')}`;

// ── Claim progress model ──
// One fixed track per claim so the same stage always sits in the same place,
// plus a single "focus" stage that answers "what is this claim on right now".

const isTaskActive = (t: FollowUpTask) => !['resolved', 'cancelled'].includes(t.status);

const isTaskOverdue = (task: FollowUpTask) => {
  const date = task.next_followup_date || task.due_date;
  if (!date) return false;
  // awaiting_confirmation은 다른 사람의 확인을 기다리는 상태 → overdue 아님
  return dayjs(date).isBefore(dayjs()) && ACTIONABLE_STATUSES.includes(task.status);
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  issued: 'Issued',
  homeowner_holding: 'HO Holding',
  lost: 'Lost',
  reissued: 'Reissued',
  partial: 'Partial',
  pending: 'Pending',
};

// Payment states that need someone to chase the money.
const PAYMENT_ISSUE_STATUSES = ['homeowner_holding', 'lost', 'partial'];

const TASK_STATUS_PHRASES: Record<string, string> = {
  pending: 'To do',
  awaiting_response: 'Awaiting response',
  awaiting_confirmation: 'Awaiting confirmation',
  responded: 'Responded',
  resolved: 'Done',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_response: 'Awaiting response',
  awaiting_confirmation: 'Awaiting confirmation',
  responded: 'Responded',
  resolved: 'Resolved',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

const ROLE_SHORT_LABELS: Record<string, string> = {
  public_adjuster: 'PA',
  adjuster: 'Adjuster',
  contractor: 'Contractor',
};

// overdue/issue: needs attention · active: ours to move · waiting: on someone
// else · todo: expected next but not started · done · none: not reached / n/a
type StepState = 'overdue' | 'issue' | 'active' | 'waiting' | 'todo' | 'done' | 'none';

interface ProgressStep {
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

interface ClaimProgress {
  track: ProgressStep[];
  /** Off-track stages (dispute, other docs, custom…) with open work */
  extras: ProgressStep[];
  focus: ProgressStep | null;
}

const TRACK_SLOTS: { key: string; label: string; shortLabel: string; title: string; types: TaskType[] }[] = [
  { key: 'wm_docs', label: 'WM Docs', shortLabel: 'Docs', title: 'WM docs', types: ['wm_docs_sent'] },
  { key: 'estimate', label: 'Estimate', shortLabel: 'Est.', title: 'Insurance estimate', types: ['estimate_request'] },
  { key: 'wm_payment', label: 'WM $', shortLabel: 'WM $', title: 'WM payment', types: ['wm_payment_check'] },
  { key: 'rebuild_payment', label: 'Rebuild $', shortLabel: 'Rebuild', title: 'Rebuild payment', types: ['payment_check'] },
  { key: 'supplement', label: 'Supplement', shortLabel: 'Supp.', title: 'Supplement', types: ['supplement_estimate_prep', 'supplement_sent'] },
  { key: 'depreciation', label: 'Depreciation', shortLabel: 'Dep.', title: 'Depreciation', types: ['depreciation_recovery'] },
];

const TRACK_TYPES = new Set<string>(TRACK_SLOTS.flatMap(s => s.types));

// Legend order: attention first, then ours, then everyone else.
const STAGE_LEGEND: { state: StepState; label: string }[] = [
  { state: 'overdue', label: 'Overdue' },
  { state: 'issue', label: 'Payment / denial issue' },
  { state: 'active', label: 'In progress (ours)' },
  { state: 'waiting', label: 'Waiting on others' },
  { state: 'todo', label: 'Next, not started' },
  { state: 'done', label: 'Done' },
  { state: 'none', label: 'Not reached' },
];

// A denied claim's dispute path outranks routine stages as the focus.
const DENIAL_TYPES = ['dispute', 'appraisal', 'attorney_referral'];

const stateFromTasks = (active: FollowUpTask[], resolved: FollowUpTask[]): StepState => {
  if (active.some(isTaskOverdue)) return 'overdue';
  if (active.length > 0) {
    return active.every(t => t.status === 'awaiting_confirmation') ? 'waiting' : 'active';
  }
  return resolved.length > 0 ? 'done' : 'none';
};

const buildClaimProgress = (group: ClaimGroup): ClaimProgress => {
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
        } else if (step.state === 'none') {
          const docs = byTypes(['wm_docs_sent']);
          if (docs.resolved.length > 0 && docs.active.length === 0) {
            step.state = 'waiting';
            step.detail = 'Awaiting initial estimate';
          }
        }
        break;

      case 'wm_payment':
        if (step.state === 'none') {
          if (group.wmCostStatus === 'included_in_rebuild') {
            step.state = 'done';
            step.detail = 'In rebuild payment';
          } else if (group.wmCostStatus === 'separate_estimate') {
            step.state = 'todo';
            step.detail = 'Not started';
          }
        }
        applyPaymentStatus(step);
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

const needsSupplementWriting = (group: ClaimGroup) =>
  (group.supplementStatuses['identified'] || 0) > 0
  || (group.supplementStatuses['in_progress'] || 0) > 0;

type QuickFilter = 'overdue' | 'due_week' | 'supp_writing' | 'payment_issue';

const QUICK_FILTERS: { key: QuickFilter; label: string; hint: string; match: (g: ClaimGroup) => boolean }[] = [
  {
    key: 'overdue', label: 'Overdue',
    hint: 'A follow-up date has passed on a stage that is ours to move',
    match: g => g.hasOverdue,
  },
  {
    key: 'due_week', label: 'Due in 7 days',
    hint: 'Next follow-up falls within the coming week',
    match: g => !g.hasOverdue && !!g.nextFollowupDate
      && dayjs(g.nextFollowupDate).isBefore(dayjs().add(7, 'day')),
  },
  {
    key: 'supp_writing', label: 'Supplement to write',
    hint: 'Supplement identified or in progress, not yet submitted',
    match: needsSupplementWriting,
  },
  {
    key: 'payment_issue', label: 'Payment issues',
    hint: 'A payment is held by the homeowner, lost, or only partly in',
    match: g => g.hasPaymentIssue,
  },
];

export const ClaimEstimatesPanel: React.FC<{ claimId: string }> = ({ claimId }) => {
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<any[]>([]);
  const [bidItems, setBidItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      const [estData, supData] = await Promise.all([
        supplementService.listInsuranceEstimates(claimId).catch(() => []),
        supplementService.getByClaim(claimId).catch(() => []),
      ]);
      setEstimates(estData);
      setSupplements(supData);
      const allBidItems = supData.flatMap((s: any) => (s.bid_items || []).map((b: any) => ({
        ...b, supplement_title: s.title,
      })));
      setBidItems(allBidItems);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      await loadData();
      if (cancelled) return;
    };
    run();
    return () => { cancelled = true; };
  }, [claimId]);

  const [editReplacePdf, setEditReplacePdf] = useState<File | undefined>();
  const [editParsing, setEditParsing] = useState(false);

  const startEdit = (ver: any) => {
    setEditingId(ver.id);
    setEditReplacePdf(undefined);
    setEditValues({
      rcv_amount: ver.rcv_amount || 0,
      acv_amount: ver.acv_amount || 0,
      depreciation_amount: ver.depreciation_amount || 0,
      deductible: ver.deductible || 0,
      estimate_category: ver.estimate_category || null,
      sections_data: ver.sections_data ? JSON.parse(JSON.stringify(ver.sections_data)) : [],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
    setEditReplacePdf(undefined);
  };

  const saveEdit = async (ver: any) => {
    setSaving(true);
    try {
      // If PDF replaced, upload file first then replace on negotiation
      if (editReplacePdf) {
        const uploaded = await fileService.uploadFiles(
          [editReplacePdf], 'negotiation', ver.id, 'estimate', 'Insurance estimate PDF'
        );
        if (uploaded?.[0]?.id) {
          await supplementService.replaceInsuranceEstimatePdf(claimId, ver.id, uploaded[0].id);
        }
      }
      await supplementService.updateInsuranceEstimate(claimId, ver.id, editValues);
      message.success('Estimate updated');
      setEditingId(null);
      setEditValues({});
      setEditReplacePdf(undefined);
      setLoading(true);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const addEditSection = () => {
    const sections = [...(editValues.sections_data || []), { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }];
    setEditValues({ ...editValues, sections_data: sections });
  };

  const removeEditSection = (idx: number) => {
    const sections = (editValues.sections_data || []).filter((_: any, i: number) => i !== idx);
    const totalRcv = sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
    const totalDep = sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
    const ded = editValues.deductible || 0;
    setEditValues({
      ...editValues,
      sections_data: sections,
      rcv_amount: Math.round(totalRcv * 100) / 100,
      acv_amount: Math.round((totalRcv - totalDep) * 100) / 100,
      depreciation_amount: Math.round(totalDep * 100) / 100,
    });
  };

  const updateEditSection = (idx: number, field: string, value: any) => {
    const sections = [...(editValues.sections_data || [])];
    sections[idx] = { ...sections[idx], [field]: value };
    if (field === 'rcv' || field === 'depreciation') {
      const rcv = field === 'rcv' ? (value || 0) : (sections[idx].rcv || 0);
      const dep = field === 'depreciation' ? (value || 0) : (sections[idx].depreciation || 0);
      sections[idx].net_acv = Math.round((rcv - dep) * 100) / 100;
    }
    // Recalc totals: ACV = RCV - DEP (deductible is separate, not subtracted from ACV)
    const totalRcv = sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
    const totalDep = sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
    const ded = editValues.deductible || 0;
    setEditValues({
      ...editValues,
      sections_data: sections,
      rcv_amount: Math.round(totalRcv * 100) / 100,
      acv_amount: Math.round((totalRcv - totalDep) * 100) / 100,
      depreciation_amount: Math.round(totalDep * 100) / 100,
    });
  };

  const handleDelete = async (ver: any) => {
    try {
      await supplementService.deleteInsuranceEstimate(claimId, ver.id);
      message.success('Estimate deleted');
      setLoading(true);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to delete');
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 16 }}><Text type="secondary">Loading...</Text></div>;

  const hasEstimates = estimates.length > 0;
  const hasSupplements = supplements.length > 0;
  const hasBidItems = bidItems.filter((b: any) => b.custom_document_file_id).length > 0;

  // Check for WM data on claim but no WM negotiation record
  const hasWmNegotiation = estimates.some((e: any) => e.estimate_category === 'water_mitigation');
  const claimWmStatus = hasEstimates ? (estimates[0] as any).claim_wm_cost_status : null;
  const claimWmAmount = hasEstimates ? (estimates[0] as any).claim_wm_estimate_amount : 0;
  const showWmFallback = !hasWmNegotiation && claimWmStatus === 'separate_estimate' && claimWmAmount > 0;

  if (!hasEstimates && !hasSupplements && !hasBidItems && !showWmFallback) {
    return <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: 16 }}>No estimate documents uploaded yet.</Text>;
  }

  // Auto-categorize sections by matching keywords from ESTIMATE_CATEGORIES config
  const categorizeSection = (name: string): string => {
    const lower = name.toLowerCase();
    for (const [key, cfg] of Object.entries(ESTIMATE_CATEGORIES)) {
      if (key === 'combined') continue; // skip combined — it's not a section type
      if (cfg.sectionKeywords.some(kw => lower.includes(kw))) return key;
    }
    return 'other';
  };

  // Section display config — derived from ESTIMATE_CATEGORIES + fallback for 'other'
  const SECTION_COLORS: Record<string, { label: string; color: string; bg: string; border: string }> = {
    ...Object.fromEntries(Object.entries(ESTIMATE_CATEGORIES)
      .filter(([k]) => k !== 'combined')
      .map(([key, cfg]) => [key, {
        label: cfg.label,
        color: cfg.tagColor === 'cyan' ? '#0958d9' : cfg.tagColor === 'purple' ? '#531dab' : cfg.tagColor === 'volcano' ? '#d4380d' : '#5f5e5b',
        bg: cfg.tagColor === 'cyan' ? '#e7f3f8' : cfg.tagColor === 'purple' ? '#f6f3f9' : cfg.tagColor === 'volcano' ? '#fff2e8' : '#f7f7f5',
        border: cfg.tagColor === 'cyan' ? '#c6e0ee' : cfg.tagColor === 'purple' ? '#e3d8ee' : cfg.tagColor === 'volcano' ? '#ffbb96' : '#dfdfdc',
      }])
    ),
    other: { label: 'Other', color: '#5f5e5b', bg: '#f7f7f5', border: '#dfdfdc' },
  };

  // Track latest per category for "LATEST" badge
  const latestPerCategory = new Set<string>();
  estimates.forEach((ver: any) => {
    const cat = ver.estimate_category || '_none';
    if (!latestPerCategory.has(cat)) latestPerCategory.add(cat);
  });
  const seenCategories = new Set<string>();

  return (
    <div>
      {/* Insurance Company Estimates */}
      {hasEstimates && (
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Insurance Company Estimates</Text>
          {estimates.map((ver: any, idx: number) => {
            const verCat = ver.estimate_category || '_none';
            const isLatestInCategory = !seenCategories.has(verCat);
            seenCategories.add(verCat);
            const isEditing = editingId === ver.id;
            const displaySections: any[] = isEditing ? (editValues.sections_data || []) : (ver.sections_data || []);
            const hasSections = displaySections.length > 0;

            // Group sections by category
            const grouped: Record<string, { items: any[]; indices: number[] }> = {};
            if (hasSections) {
              displaySections.forEach((s: any, sIdx: number) => {
                const cat = categorizeSection(s.section_name || '');
                if (!grouped[cat]) grouped[cat] = { items: [], indices: [] };
                grouped[cat].items.push(s);
                grouped[cat].indices.push(sIdx);
              });
            }

            const hasWm = !!grouped['water_mitigation'];
            const hasReconstruction = !!grouped['reconstruction'];

            // Category tag: use estimate_category if set, otherwise leave empty
            const categoryCfg = getEstimateCategoryConfig(ver.estimate_category);

            const dispRcv = isEditing ? editValues.rcv_amount : ver.rcv_amount;
            const dispAcv = isEditing ? editValues.acv_amount : ver.acv_amount;
            const dispDep = isEditing ? editValues.depreciation_amount : ver.depreciation_amount;
            const dispDed = isEditing ? editValues.deductible : ver.deductible;

            return (
              <div
                key={ver.id}
                style={{
                  marginBottom: 6, padding: '8px 10px', borderRadius: 6,
                  border: isEditing ? '1px solid #cb912f' : isLatestInCategory ? '1px solid #1f74c9' : '1px solid #e9e9e7',
                  background: isEditing ? '#fbf3db' : isLatestInCategory ? '#f6fbff' : '#fff',
                }}
              >
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
                      <Tag color={isLatestInCategory ? 'blue' : 'default'} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                        Rev #{ver.revision_number}
                      </Tag>
                      <Tag color={
                        ver.revision_type === 'initial' ? 'green' :
                        ver.revision_type === 'supplement' ? 'orange' :
                        ver.revision_type === 're_inspection' ? 'purple' : 'default'
                      } style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                        {ver.revision_type?.replace('_', ' ').toUpperCase()}
                      </Tag>
                      {isLatestInCategory && <Tag color="processing" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>LATEST</Tag>}
                      {categoryCfg && (
                        <Tag color={categoryCfg.tagColor} style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>{categoryCfg.label}</Tag>
                      )}
                      {ver.file_download_id && (
                        <a
                          href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11 }}
                        >
                          <FilePdfOutlined style={{ color: '#d44c47' }} />
                          PDF
                        </a>
                      )}
                    </div>

                    {/* Amounts: display or edit */}
                    {isEditing ? (
                      <>
                      <Row gutter={[6, 4]} style={{ marginTop: 4 }}>
                        <Col span={6}>
                          <Text type="secondary" style={{ fontSize: 10 }}>RCV</Text>
                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={editValues.rcv_amount} onChange={v => setEditValues({ ...editValues, rcv_amount: v || 0 })} />
                        </Col>
                        <Col span={6}>
                          <Text type="secondary" style={{ fontSize: 10 }}>ACV</Text>
                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={editValues.acv_amount} onChange={v => setEditValues({ ...editValues, acv_amount: v || 0 })} />
                        </Col>
                        <Col span={6}>
                          <Text type="secondary" style={{ fontSize: 10 }}>Dep</Text>
                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={editValues.depreciation_amount} onChange={v => setEditValues({ ...editValues, depreciation_amount: v || 0 })} />
                        </Col>
                        <Col span={6}>
                          <Text type="secondary" style={{ fontSize: 10 }}>Ded</Text>
                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                            value={editValues.deductible} onChange={v => {
                              const ded = v || 0;
                              const rcv = editValues.rcv_amount || 0;
                              const dep = editValues.depreciation_amount || 0;
                              setEditValues({ ...editValues, deductible: ded, acv_amount: Math.round((rcv - dep) * 100) / 100 });
                            }} />
                        </Col>
                      </Row>
                      {/* PDF replace + Category selector in edit mode */}
                      <Row gutter={[6, 4]} style={{ marginTop: 6 }}>
                        <Col span={14}>
                          <Text type="secondary" style={{ fontSize: 10 }}>Replace PDF</Text>
                          <Upload
                            maxCount={1}
                            accept=".pdf"
                            beforeUpload={async (file) => {
                              setEditReplacePdf(file);
                              if (file.name.toLowerCase().endsWith('.pdf')) {
                                setEditParsing(true);
                                try {
                                  const result = await claimFollowUpService.parseEstimatePdf(file);
                                  if (result.sections?.length) {
                                    const sections = result.sections;
                                    const totalRcv = sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
                                    const totalDep = sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
                                    setEditValues((prev: any) => {
                                      const ded = result.totals?.deductible || prev.deductible || 0;
                                      return {
                                        ...prev,
                                        sections_data: sections,
                                        rcv_amount: Math.round(totalRcv * 100) / 100,
                                        acv_amount: Math.round((totalRcv - totalDep) * 100) / 100,
                                        depreciation_amount: Math.round(totalDep * 100) / 100,
                                        deductible: ded,
                                      };
                                    });
                                    message.success(`Parsed ${sections.length} sections`);
                                  }
                                } catch {
                                  message.warning('PDF parsing failed. Edit amounts manually.');
                                } finally {
                                  setEditParsing(false);
                                }
                              }
                              return false;
                            }}
                            onRemove={() => setEditReplacePdf(undefined)}
                            fileList={editReplacePdf ? [{ uid: '-1', name: editReplacePdf.name, status: 'done' as const }] : []}
                          >
                            <Button size="small" icon={<UploadOutlined />} loading={editParsing} style={{ fontSize: 11 }}>
                              {editParsing ? 'Parsing...' : 'Upload PDF'}
                            </Button>
                          </Upload>
                        </Col>
                        <Col span={10}>
                          <Text type="secondary" style={{ fontSize: 10 }}>Category</Text>
                          <Select
                            size="small"
                            style={{ width: '100%' }}
                            value={editValues.estimate_category}
                            onChange={v => setEditValues({ ...editValues, estimate_category: v })}
                            allowClear
                            placeholder="Select..."
                          >
                            {ESTIMATE_CATEGORY_OPTIONS.map(opt => (
                              <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                            ))}
                          </Select>
                        </Col>
                      </Row>
                      </>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                        <span><Text type="secondary" style={{ fontSize: 11 }}>RCV </Text><Text strong style={{ fontSize: 12 }}>{formatCurrency(dispRcv)}</Text></span>
                        <span><Text type="secondary" style={{ fontSize: 11 }}>ACV </Text><Text strong style={{ fontSize: 12 }}>{formatCurrency(dispAcv)}</Text></span>
                        <span><Text type="secondary" style={{ fontSize: 11 }}>Dep </Text><Text style={{ fontSize: 12 }}>{formatCurrency(dispDep)}</Text></span>
                        {dispDed > 0 && <span><Text type="secondary" style={{ fontSize: 11 }}>Ded </Text><Text style={{ fontSize: 12 }}>{formatCurrency(dispDed)}</Text></span>}
                      </div>
                    )}
                    {ver.date_received && (
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        {dayjs(ver.date_received).format('MM/DD/YYYY')}
                        {ver.received_from && ` · ${ver.received_from}`}
                      </Text>
                    )}
                  </div>
                  <Space direction="vertical" size={2} style={{ flexShrink: 0 }}>
                    {ver.file_download_id && (
                      <a
                        href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="small" type="text" icon={<FilePdfOutlined style={{ color: '#d44c47' }} />} style={{ fontSize: 11 }}>
                          PDF
                        </Button>
                      </a>
                    )}
                    {!isEditing ? (
                      <Space size={2}>
                        <Button size="small" type="text" icon={<EditOutlined />} style={{ fontSize: 11 }}
                          onClick={() => startEdit(ver)}>
                          Edit
                        </Button>
                        <Popconfirm
                          title="Delete this estimate?"
                          description={`Rev #${ver.revision_number} will be permanently deleted.`}
                          onConfirm={() => handleDelete(ver)}
                          okText="Delete"
                          okButtonProps={{ danger: true }}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }} />
                        </Popconfirm>
                      </Space>
                    ) : (
                      <Space size={2}>
                        <Button size="small" type="primary" loading={saving}
                          onClick={() => saveEdit(ver)} style={{ fontSize: 11 }}>
                          Save
                        </Button>
                        <Button size="small" onClick={cancelEdit} style={{ fontSize: 11 }}>
                          Cancel
                        </Button>
                      </Space>
                    )}
                  </Space>
                </div>

                {/* Section Breakdown */}
                {(hasSections || isEditing) && (
                  <div style={{ marginTop: 6, borderTop: '1px dashed #e9e9e7', paddingTop: 6 }}>
                    {Object.keys(SECTION_COLORS).map(cat => {
                      const group = grouped[cat];
                      if (!group || group.items.length === 0) return null;
                      const cfg = SECTION_COLORS[cat];
                      const catRcv = group.items.reduce((sum: number, s: any) => sum + (s.rcv || 0), 0);
                      const catAcv = group.items.reduce((sum: number, s: any) => sum + (s.net_acv || 0), 0);

                      return (
                        <div key={cat} style={{
                          marginBottom: 4, padding: '4px 6px', borderRadius: 4,
                          background: cfg.bg, borderLeft: `3px solid ${cfg.border}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text strong style={{ fontSize: 11, color: cfg.color }}>{cfg.label}</Text>
                            <Text style={{ fontSize: 11 }}>
                              RCV <Text strong style={{ fontSize: 11 }}>{formatCurrency(catRcv)}</Text>
                              <Text type="secondary" style={{ fontSize: 11 }}> · ACV {formatCurrency(catAcv)}</Text>
                            </Text>
                          </div>
                          {group.items.map((s: any, sIdx: number) => {
                            const globalIdx = group.indices[sIdx];
                            return isEditing ? (
                              <Row key={sIdx} gutter={4} align="middle" style={{ marginTop: 2 }}>
                                <Col flex="auto">
                                  <Input size="small" value={s.section_name} style={{ fontSize: 11 }}
                                    onChange={e => updateEditSection(globalIdx, 'section_name', e.target.value)} />
                                </Col>
                                <Col flex="90px">
                                  <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%', fontSize: 11 }}
                                    value={s.rcv} onChange={v => updateEditSection(globalIdx, 'rcv', v || 0)} />
                                </Col>
                                <Col flex="90px">
                                  <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%', fontSize: 11 }}
                                    value={s.depreciation} onChange={v => updateEditSection(globalIdx, 'depreciation', v || 0)}
                                    placeholder="Dep" />
                                </Col>
                                <Col flex="24px">
                                  <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                    style={{ padding: 0, height: 24, width: 24, minWidth: 24 }}
                                    onClick={() => removeEditSection(globalIdx)} />
                                </Col>
                              </Row>
                            ) : (
                              <div key={sIdx} style={{
                                display: 'flex', justifyContent: 'space-between',
                                fontSize: 10, padding: '1px 4px', color: '#666',
                              }}>
                                <span>{s.section_name}</span>
                                <span>{formatCurrency(s.rcv)} (dep: {formatCurrency(s.depreciation)})</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {isEditing && (
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={addEditSection}
                        style={{ width: '100%', marginTop: 4, fontSize: 11 }}
                      >
                        Add Section
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* WM Estimate fallback (when no WM negotiation record but claim has WM data) */}
      {showWmFallback && (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 6,
          border: '1px solid #e6f0fa', background: '#f6fbff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>WM</Tag>
            <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>Separate Estimate</Tag>
          </div>
          <div style={{ fontSize: 13 }}>
            <Text type="secondary">WM Amount: </Text>
            <Text strong>${Number(claimWmAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>(no PDF uploaded)</Text>
          </div>
        </div>
      )}

      {/* Supplement Estimates — grouped by status, identified/in_progress first */}
      {hasSupplements && (() => {
        const STATUS_ORDER: string[] = ['identified', 'in_progress', 'submitted', 'under_review', 'approved', 'denied', 'withdrawn'];
        const STATUS_LABELS: Record<string, string> = {
          identified: 'Identified', in_progress: 'In Progress', submitted: 'Submitted',
          under_review: 'Under Review', approved: 'Approved', denied: 'Denied', withdrawn: 'Withdrawn',
        };
        const grouped: Record<string, any[]> = {};
        supplements.forEach((sup: any) => {
          const st = sup.status || 'identified';
          if (!grouped[st]) grouped[st] = [];
          grouped[st].push(sup);
        });
        const orderedStatuses = STATUS_ORDER.filter(st => grouped[st]?.length > 0);

        return (
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Supplement Estimates</Text>
            {orderedStatuses.map(status => (
              <div key={status} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Tag color={(SUPPLEMENT_STATUS_COLORS as any)[status] || 'default'} style={{ margin: 0, fontSize: 11 }}>
                    {STATUS_LABELS[status] || status}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>({grouped[status].length})</Text>
                </div>
                {grouped[status].map((sup: any) => {
                  const supBidItems = (sup.bid_items || []).filter((b: any) => b.custom_document_file_id);
                  const totalAmount = sup.supplement_amount || sup.our_estimate_amount || 0;
                  return (
                    <div
                      key={sup.id}
                      onClick={() => navigate(`/supplements/${sup.id}`)}
                      style={{
                        padding: '6px 10px', marginBottom: 4, borderRadius: 6,
                        border: '1px solid #e9e9e7', background: '#f7f7f5', cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#eef5fa'; e.currentTarget.style.borderColor = '#c6e0ee'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#f7f7f5'; e.currentTarget.style.borderColor = '#e9e9e7'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                          <Text strong style={{ fontSize: 12 }}>{sup.title}</Text>
                          {sup.request_type === 'estimate_request' && (
                            <Tag color="geekblue" style={{ margin: 0, fontSize: 10 }}>Est. Request</Tag>
                          )}
                        </div>
                        {totalAmount > 0 && (
                          <Text strong style={{ fontSize: 12, flexShrink: 0 }}>{formatCurrency(totalAmount)}</Text>
                        )}
                      </div>
                      {sup.reason && (
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{sup.reason}</Text>
                      )}
                      {/* Bid item PDFs under this supplement */}
                      {supBidItems.length > 0 && (
                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #e9e9e7' }}>
                          {supBidItems.map((item: any) => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '2px 6px', marginBottom: 2, background: '#fff', borderRadius: 4,
                              }}
                            >
                              <Space size={6}>
                                <Tag style={{ margin: 0, fontSize: 10 }}>{item.estimate_type?.toUpperCase()}</Tag>
                                <Text style={{ fontSize: 11 }}>{item.title || item.estimate_type}</Text>
                                {item.custom_amount != null && (
                                  <Text type="secondary" style={{ fontSize: 11 }}>{formatCurrency(item.custom_amount)}</Text>
                                )}
                              </Space>
                              <a
                                href={`${fileService.getDownloadUrl(item.custom_document_file_id)}?inline=true`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                              >
                                <Button type="text" size="small" icon={<FilePdfOutlined style={{ color: '#d44c47' }} />} style={{ fontSize: 11 }}>
                                  PDF
                                </Button>
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
};

const ClaimFollowUpDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [hideResolved, setHideResolved] = useState(true);
  const [supplementFilter, setSupplementFilter] = useState<string | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<QuickFilter | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState<string | undefined>();
  const [resolveDeniedAction, setResolveDeniedAction] = useState<string | undefined>();
  const [resolveFile, setResolveFile] = useState<File | undefined>();
  const [resolveWmFile, setResolveWmFile] = useState<File | undefined>();
  const [parsedWmAmount, setParsedWmAmount] = useState<number | undefined>();
  const [isParsingWm, setIsParsingWm] = useState(false);
  const [parsedSections, setParsedSections] = useState<any[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [existingPdfName, setExistingPdfName] = useState<string | undefined>();
  const [existingPdfId, setExistingPdfId] = useState<string | undefined>();
  const [existingWmPdfName, setExistingWmPdfName] = useState<string | undefined>();
  const [existingWmPdfId, setExistingWmPdfId] = useState<string | undefined>();
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  // 수령 내역 기록 모달 (분할/추가 수령을 누적 기록)
  const [paymentModalTask, setPaymentModalTask] = useState<FollowUpTask | null>(null);
  const [paymentForm] = Form.useForm();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editEstimateFile, setEditEstimateFile] = useState<File | undefined>();
  const [editWmFile, setEditWmFile] = useState<File | undefined>();
  const [editParsedSections, setEditParsedSections] = useState<any[] | null>(null);
  const [editIsParsing, setEditIsParsing] = useState(false);
  const [editEstimateSaving, setEditEstimateSaving] = useState(false);
  const [editExistingEstimates, setEditExistingEstimates] = useState<any[]>([]);
  const [claimDrawerOpen, setClaimDrawerOpen] = useState(false);
  const [selectedClaimGroup, setSelectedClaimGroup] = useState<ClaimGroup | null>(null);
  const [drawerEmailTaskId, setDrawerEmailTaskId] = useState<string | undefined>();
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<FollowUpTask | null>(null);
  const [expandedClaims, setExpandedClaims] = useState<string[]>([]);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editEstimateForm] = Form.useForm();
  const [resolveForm] = Form.useForm();

  // Queries
  // Always load every task: claims are built from all of their tasks, and the
  // Status/Type filters pick claims client-side. Filtering on the server cut
  // each claim's pipeline down to the matching tasks only.
  const { data: tasks = [], isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['followup-tasks', 'all'],
    queryFn: () => claimFollowUpService.getAllTasks({
      sort_by: 'next_followup_date',
      sort_order: 'asc',
    }),
  });

  // Insurance company email lookup
  const { data: insuranceEmails = {} } = useQuery({
    queryKey: ['insurance-emails'],
    queryFn: () => companyService.getInsuranceEmails(),
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  // Group tasks by claim
  const claimGroups = useMemo((): ClaimGroup[] => {
    const groupMap = new Map<string, ClaimGroup>();

    tasks.forEach((task) => {
      const key = task.claim_id;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          claim_id: key,
          property_address: task.property_address || '',
          claim_number: task.claim_number || '',
          insurance_company: task.insurance_company || '',
          tasks: [],
          activeStages: new Set<TaskType>(),
          hasOverdue: false,
          hasUrgent: false,
          wmCostStatus: '',
          hasInsuranceEstimate: false,
          nextFollowupDate: null,
          supplementStatuses: {},
          bidEstimateSummary: {},
          pendingInfoRequests: 0,
          pa_name: task.pa_name || '',
          pa_company: task.pa_company || '',
          pa_email: task.pa_email || '',
          pa_phone: task.pa_phone || '',
          expectedAmount: task.claim_expected_amount || 0,
          receivedAmount: task.claim_received_amount || 0,
          deductible: task.claim_deductible || 0,
          hasPaymentIssue: false,
          progress: null,
        });
      }
      const group = groupMap.get(key)!;
      group.tasks.push(task);

      if (PAYMENT_TASK_TYPES.includes(task.task_type)
          && task.payment_status && PAYMENT_ISSUE_STATUSES.includes(task.payment_status)) {
        group.hasPaymentIssue = true;
      }

      // Merge supplement statuses from task
      if (task.supplement_statuses) {
        Object.entries(task.supplement_statuses).forEach(([status, count]) => {
          group.supplementStatuses[status] = count;
        });
      }

      // Track pending info requests
      if (task.pending_info_requests && task.pending_info_requests > group.pendingInfoRequests) {
        group.pendingInfoRequests = task.pending_info_requests;
      }

      // Track active (non-resolved) stages
      if (!['resolved', 'cancelled'].includes(task.status)) {
        group.activeStages.add(task.task_type);
      }

      // Track WM cost status from claim
      if (task.wm_cost_status && !group.wmCostStatus) {
        group.wmCostStatus = task.wm_cost_status;
      }
      // Track insurance estimate status
      if (task.has_insurance_estimate) {
        group.hasInsuranceEstimate = true;
      }
      // Merge bid estimate summary
      if (task.bid_estimate_summary) {
        Object.entries(task.bid_estimate_summary).forEach(([st, cnt]) => {
          group.bidEstimateSummary[st] = cnt as number;
        });
      }

      // Check urgent priority on active tasks
      if (task.priority === 'urgent' && !['resolved', 'cancelled'].includes(task.status)) {
        group.hasUrgent = true;
      }

      // Check overdue — awaiting_confirmation은 타인 확인 대기이므로 제외
      const date = task.next_followup_date || task.due_date;
      if (isTaskOverdue(task)) {
        group.hasOverdue = true;
      }

      // Track earliest next followup
      if (date && !['resolved', 'cancelled'].includes(task.status)) {
        if (!group.nextFollowupDate || dayjs(date).isBefore(dayjs(group.nextFollowupDate))) {
          group.nextFollowupDate = date;
        }
      }
    });

    groupMap.forEach((group) => {
      group.progress = buildClaimProgress(group);
    });

    // Sort: overdue first, then urgent, then by nextFollowupDate
    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.hasOverdue && !b.hasOverdue) return -1;
      if (!a.hasOverdue && b.hasOverdue) return 1;
      if (a.hasUrgent && !b.hasUrgent) return -1;
      if (!a.hasUrgent && b.hasUrgent) return 1;
      if (!a.nextFollowupDate) return 1;
      if (!b.nextFollowupDate) return -1;
      return dayjs(a.nextFollowupDate).unix() - dayjs(b.nextFollowupDate).unix();
    });
  }, [tasks]);

  // A task counts toward the Status/Type filters when it matches both.
  const taskMatchesFilters = useCallback((t: FollowUpTask) => {
    if (typeFilter && t.task_type !== typeFilter) return false;
    if (statusFilter === 'overdue') return t.status === 'overdue' || isTaskOverdue(t);
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  }, [statusFilter, typeFilter]);

  // Claim-level counts for the quick filters (claims with open work only)
  const quickCounts = useMemo(() => {
    const open = claimGroups.filter(g => g.tasks.some(isTaskActive));
    const counts: Record<string, number> = { all: open.length };
    QUICK_FILTERS.forEach(f => { counts[f.key] = open.filter(f.match).length; });
    return counts;
  }, [claimGroups]);

  // Filter claim groups: status/type, hide resolved, quick filter, supplement filter
  const filteredClaimGroups = useMemo(() => {
    let filtered = claimGroups;
    const hidingResolved = hideResolved && statusFilter !== 'resolved';

    if (statusFilter || typeFilter) {
      // A claim shows when one of its tasks matches; its pipeline still
      // uses every task so the row never shows half a claim.
      filtered = filtered.filter(group => {
        const matching = group.tasks.filter(taskMatchesFilters);
        if (matching.length === 0) return false;
        return hidingResolved ? matching.some(isTaskActive) : true;
      });
    } else if (hidingResolved) {
      // Hide resolved: only show claims with at least one active task
      filtered = filtered.filter(group => group.tasks.some(isTaskActive));
    }

    if (quickFilter) {
      const qf = QUICK_FILTERS.find(f => f.key === quickFilter);
      if (qf) filtered = filtered.filter(g => g.tasks.some(isTaskActive) && qf.match(g));
    }

    // Supplement filter
    if (supplementFilter === 'needs_writing') {
      // Supplements identified or in progress (not yet submitted)
      filtered = filtered.filter(needsSupplementWriting);
    } else if (supplementFilter === 'submitted') {
      // Supplements submitted or under review (waiting for response)
      filtered = filtered.filter(group =>
        (group.supplementStatuses['submitted'] || 0) > 0
        || (group.supplementStatuses['under_review'] || 0) > 0
      );
    }

    return filtered;
  }, [claimGroups, hideResolved, statusFilter, typeFilter, taskMatchesFilters, quickFilter, supplementFilter]);

  const visibleTaskCount = useMemo(
    () => filteredClaimGroups.reduce((n, g) => n + g.tasks.filter(taskMatchesFilters).length, 0),
    [filteredClaimGroups, taskMatchesFilters],
  );

  const hasAnyFilter = !!(statusFilter || typeFilter || supplementFilter || quickFilter);
  const clearFilters = () => {
    setStatusFilter(undefined);
    setTypeFilter(undefined);
    setSupplementFilter(undefined);
    setQuickFilter(undefined);
  };

  // Any task on a claim carries that claim's PA/adjuster enrichment, so one
  // task is enough to resolve the contact behind an assigned role.
  const claimEnrichment = useCallback((claimId?: string): FollowUpTask | null => {
    if (!claimId) return null;
    return tasks.find(t => String(t.claim_id) === String(claimId)) || null;
  }, [tasks]);

  /** Fill name/email/phone from whichever contact the chosen role points at. */
  const applyRoleContact = useCallback((
    form: FormInstance,
    role: string,
    claimId?: string,
  ) => {
    const contact = contactForRole(role, claimEnrichment(claimId));
    if (contact) {
      form.setFieldsValue({
        assigned_to_name: contact.name,
        assigned_to_email: contact.email,
        assigned_to_phone: contact.phone,
      });
    } else if (role === 'public_adjuster' || role === 'adjuster') {
      // Not every claim has one on file. Say so instead of silently
      // leaving the previous role's contact in the fields.
      message.info(
        `No ${ASSIGNED_ROLE_LABELS[role]} on file for this claim — enter the contact manually.`
      );
    } else if (role === 'contractor') {
      // No claim-level contractor contact — clear rather than keep the
      // previous role's person.
      form.setFieldsValue({
        assigned_to_name: '', assigned_to_email: '', assigned_to_phone: '',
      });
    }
  }, [claimEnrichment]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: FollowUpTaskCreate) => claimFollowUpService.createTask(data),
    onSuccess: () => {
      message.success('Follow-up task created');
      setCreateModalOpen(false);
      createForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to create task'),
  });

  // 수령 내역 조회 — 모달이 열린 claim에 대해서만
  const { data: paymentSummary, isLoading: paymentsLoading } = useQuery({
    queryKey: ['claim-payments', paymentModalTask?.claim_id],
    queryFn: () => claimFollowUpService.getClaimPayments(paymentModalTask!.claim_id),
    enabled: !!paymentModalTask?.claim_id,
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ claimId, payload }: { claimId: string; payload: PaymentReceiptCreate }) =>
      claimFollowUpService.recordClaimPayment(claimId, payload),
    onSuccess: (_, variables) => {
      message.success('Payment recorded');
      paymentForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['claim-payments', variables.claimId] });
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to record payment'),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: ({ claimId, paymentId }: { claimId: string; paymentId: string }) =>
      claimFollowUpService.deleteClaimPayment(claimId, paymentId),
    onSuccess: (_, variables) => {
      message.success('Payment removed');
      queryClient.invalidateQueries({ queryKey: ['claim-payments', variables.claimId] });
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to remove payment'),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: any }) =>
      claimFollowUpService.resolveTask(taskId, body),
    onSuccess: (_, variables) => {
      const outcome = variables.body?.outcome;
      const deniedAction = variables.body?.denied_action;
      if (outcome === 'estimate_received') {
        message.success('Task resolved - Insurance estimate received. Rebuild project created.');
      } else if (outcome === 'wm_estimate_only') {
        message.success('Task resolved - WM estimate recorded. WM Payment task created.');
      } else if (outcome === 'estimate_requested') {
        message.success('Task resolved - Estimate request created. Check Estimates page.');
      } else if (outcome === 'denied' && deniedAction && deniedAction !== 'complete') {
        const labels: Record<string, string> = { dispute: 'Dispute', appraisal: 'Appraisal', attorney: 'Attorney' };
        message.info(`Claim denied - Proceeding with ${labels[deniedAction] || deniedAction}. Task updated.`);
      } else if (outcome === 'denied') {
        message.warning('Task resolved - Claim denied.');
      } else {
        message.success('Task resolved');
      }
      setResolveModalOpen(false);
      setResolveOutcome(undefined);
      setResolveDeniedAction(undefined);
      setResolveFile(undefined);
      setResolveWmFile(undefined);
      setParsedWmAmount(undefined);
      setExistingPdfName(undefined);
      setExistingPdfId(undefined);
      setExistingWmPdfName(undefined);
      setExistingWmPdfId(undefined);
      resolveForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || 'Failed to resolve task';
      if (err?.response?.status === 404) {
        message.error('Task not found. It may have been deleted. Refreshing list...');
        queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
        setResolveModalOpen(false);
        resolveForm.resetFields();
      } else {
        message.error(detail);
      }
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: any }) =>
      claimFollowUpService.updateTask(taskId, data),
    onSuccess: () => {
      message.success('Task updated');
      setEditModalOpen(false);
      editForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => claimFollowUpService.reopenTask(taskId),
    onSuccess: () => {
      message.success('Task reopened');
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => claimFollowUpService.deleteTask(taskId),
    onSuccess: () => {
      message.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
    },
  });

  const recalcTotals = (sections: any[]) => {
    const totalRcv = sections.reduce((sum, s) => sum + (s.rcv || 0), 0);
    const totalDep = sections.reduce((sum, s) => sum + (s.depreciation || 0), 0);
    const ded = resolveForm.getFieldValue('deductible') || 0;
    const totalAcv = totalRcv - totalDep;
    resolveForm.setFieldsValue({
      rcv_amount: Math.round(totalRcv * 100) / 100,
      acv_amount: Math.round(totalAcv * 100) / 100,
      depreciation_amount: Math.round(totalDep * 100) / 100,
    });
  };

  const isOverdue = isTaskOverdue;

  // Helper: open resolve modal for a given task
  const openResolveForTask = async (task: FollowUpTask) => {
    setSelectedTask(task);
    resolveForm.resetFields();
    setResolveOutcome(undefined);
    setParsedSections(null);
    setResolveFile(undefined);
    setResolveWmFile(undefined);
    setParsedWmAmount(undefined);
    setExistingPdfName(undefined);
    setExistingPdfId(undefined);
    setExistingWmPdfName(undefined);
    setExistingWmPdfId(undefined);
    setResolveModalOpen(true);
    if (task.resolution_notes) {
      resolveForm.setFieldsValue({ resolution_notes: task.resolution_notes });
    }
    // Only estimate-intake stages need the insurance-estimate autofill.
    // Payment / supplement / other stages resolve independently and must
    // not be forced into the "Insurance Estimate Received" flow.
    const isEstimateIntakeStage = ['estimate_request', 'wm_docs_sent'].includes(task.task_type);
    if (isEstimateIntakeStage && task.claim_id) {
      try {
        const estimates = await supplementService.listInsuranceEstimates(task.claim_id);
        if (estimates.length > 0) {
          const combined = estimates.find((e: any) => e.estimate_category === 'combined');
          const recon = estimates.find((e: any) => e.estimate_category === 'reconstruction');
          const wm = estimates.find((e: any) => e.estimate_category === 'water_mitigation');
          const main = combined || recon
            || estimates.find((e: any) => (e.rcv_amount || 0) > 0)
            || estimates[0];
          const formValues: any = {
            outcome: 'estimate_received',
            rcv_amount: main.rcv_amount || 0,
            acv_amount: main.acv_amount || 0,
            depreciation_amount: main.depreciation_amount || 0,
            deductible: main.deductible || 0,
          };
          if (combined) {
            formValues.wm_cost_status = 'included_in_rebuild';
          } else if (wm && wm.document_url && wm.document_url !== main.document_url) {
            formValues.wm_cost_status = 'separate_estimate';
          }
          resolveForm.setFieldsValue(formValues);
          setResolveOutcome('estimate_received');
          if (main.sections_data?.length) setParsedSections(main.sections_data);
          if (main.document_name) {
            setExistingPdfName(main.document_name);
            setExistingPdfId(main.file_download_id || main.document_url);
          }
          if (wm && wm.document_url && wm.document_url !== main.document_url) {
            if (wm.document_name) {
              setExistingWmPdfName(wm.document_name);
              setExistingWmPdfId(wm.file_download_id || wm.document_url);
            }
            if (wm.rcv_amount) {
              setParsedWmAmount(wm.rcv_amount);
              resolveForm.setFieldsValue({ wm_estimate_amount: wm.rcv_amount });
            }
          }
        }
      } catch {
        // Ignore - just open empty modal
      }
    }
  };

  // Columns for expanded task table (aggregated by stage)
  const taskColumns: ColumnsType<StageAggregated> = [
    {
      title: 'Stage',
      dataIndex: 'task_type',
      key: 'task_type',
      width: 180,
      render: (type: TaskType) => (
        <span>{TASK_TYPE_OPTIONS.find(o => o.value === type)?.label || type}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: string) => {
        const label = TASK_STATUS_LABELS[status] || status.replace(/_/g, ' ');
        if (status === 'overdue') return <Text type="danger" strong>{label}</Text>;
        const muted = ['resolved', 'cancelled', 'awaiting_confirmation'].includes(status);
        return <Text type={muted ? 'secondary' : undefined}>{label}</Text>;
      },
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      render: (priority: string, record: StageAggregated) => {
        if (record.status === 'resolved' || record.status === 'cancelled') {
          return <Text type="secondary">-</Text>;
        }
        const label = priority.charAt(0).toUpperCase() + priority.slice(1);
        if (priority === 'urgent') return <Text type="danger" strong>{label}</Text>;
        if (priority === 'high') return <Text type="warning" strong>{label}</Text>;
        return <Text type="secondary">{label}</Text>;
      },
    },
    {
      title: 'Next Follow-up',
      key: 'next_followup_date',
      width: 130,
      render: (_, record: StageAggregated) => {
        if (record.status === 'resolved') return <Text type="success">Resolved</Text>;
        const date = record.next_followup_date;
        if (!date) return <Text type="secondary">-</Text>;
        const d = dayjs(date);
        const overdue = d.isBefore(dayjs());
        return (
          <Tooltip title={d.format('YYYY-MM-DD HH:mm')}>
            <Text type={overdue ? 'danger' : undefined}>
              {d.fromNow()}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Assigned To',
      key: 'assigned_to',
      width: 140,
      ellipsis: true,
      render: (_, record: StageAggregated) => {
        if (!record.assigned_to_name) return <Text type="secondary">-</Text>;
        return (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>{record.assigned_to_name}</Text>
            {record.assigned_to_role && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {ROLE_SHORT_LABELS[record.assigned_to_role] || record.assigned_to_role}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_, record: StageAggregated) => {
        const task = record.primaryTask;
        return (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'email',
                  icon: <MailOutlined />,
                  label: 'Send Email',
                  onClick: () => navigate(`/claim-followup/${task.id}/email`),
                },
                // 수령 내역은 payment 단계에서만 — 여러 번 나눠 받는 걸 누적 기록
                ...(PAYMENT_TASK_TYPES.includes(task.task_type) ? [{
                  key: 'payments',
                  icon: <DollarOutlined />,
                  label: 'Record Payment',
                  onClick: () => { setPaymentModalTask(task); paymentForm.resetFields(); },
                }] : []),
                {
                  key: 'resolve',
                  icon: <CheckCircleOutlined />,
                  label: 'Resolve',
                  disabled: record.status === 'resolved',
                  onClick: () => openResolveForTask(task),
                },
                {
                  key: 'reopen',
                  icon: <ClockCircleOutlined />,
                  label: 'Reopen',
                  disabled: record.status !== 'resolved',
                  onClick: () => reopenMutation.mutate(task.id),
                },
                {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: 'Edit',
                  onClick: async () => {
                    setSelectedTask(task);
                    editForm.setFieldsValue({
                      title: task.title,
                      task_type: task.task_type,
                      status: task.status,
                      priority: task.priority,
                      assigned_to_name: task.assigned_to_name,
                      assigned_to_email: task.assigned_to_email,
                      assigned_to_phone: task.assigned_to_phone,
                      assigned_to_role: task.assigned_to_role,
                      auto_followup_enabled: task.auto_followup_enabled,
                      followup_interval_days: task.followup_interval_days,
                      max_followup_count: task.max_followup_count,
                      payment_status: task.payment_status,
                      payment_note: task.payment_note,
                    });
                    setEditEstimateFile(undefined);
                    setEditWmFile(undefined);
                    setEditParsedSections(null);
                    setEditExistingEstimates([]);
                    editEstimateForm.resetFields();
                    try {
                      const estimates = await supplementService.listInsuranceEstimates(task.claim_id);
                      setEditExistingEstimates(estimates || []);
                      if (estimates.length > 0) {
                        const latest = estimates[0];
                        const formVals: any = {
                          acv_amount: latest.acv_amount || 0,
                          rcv_amount: latest.rcv_amount || 0,
                          depreciation_amount: latest.depreciation_amount || 0,
                          deductible: latest.deductible || 0,
                        };
                        if ((latest as any).claim_wm_cost_status) {
                          formVals.wm_cost_status = (latest as any).claim_wm_cost_status;
                        }
                        if ((latest as any).claim_wm_estimate_amount) {
                          formVals.wm_estimate_amount = (latest as any).claim_wm_estimate_amount;
                        }
                        editEstimateForm.setFieldsValue(formVals);
                        if (latest.sections_data) setEditParsedSections(latest.sections_data);
                      }
                    } catch { /* ignore */ }
                    setEditModalOpen(true);
                  },
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    Modal.confirm({
                      title: 'Delete this task?',
                      onOk: () => deleteMutation.mutate(task.id),
                    });
                  },
                },
              ],
            }}
          >
            <Button type="text" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];

  const handleCreateSubmit = () => {
    createForm.validateFields().then(values => {
      // If custom stage selected, use the custom_task_type value as task_type
      if (values.task_type === '__custom__') {
        const customType = (values.custom_task_type || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!customType) {
          message.warning('Please enter a custom stage name');
          return;
        }
        values.task_type = customType;
      }
      delete values.custom_task_type;
      const payload: FollowUpTaskCreate = {
        ...values,
        next_followup_date: values.next_followup_date?.toISOString() || undefined,
      };
      // Default depreciation phase for new depreciation_recovery tasks
      if (values.task_type === 'depreciation_recovery') {
        (payload as any).depreciation_phase = 'in_construction';
      }
      createMutation.mutate(payload);
    });
  };

  // ── Claim row renderers ──

  // Clicking a stage keeps its old shortcut: open work → resolve, done → reopen.
  const handleStepClick = (step: ProgressStep) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (step.activeTask) {
      openResolveForTask(step.activeTask);
    } else if (step.resolvedTask) {
      const task = step.resolvedTask;
      Modal.confirm({
        title: 'Reopen Task',
        content: `Reopen "${task.title || step.title}"?`,
        okText: 'Reopen',
        onOk: () => reopenMutation.mutate(task.id),
      });
    }
  };

  const stepTooltip = (step: ProgressStep) => {
    const action = step.activeTask ? 'Click to resolve' : step.resolvedTask ? 'Click to reopen' : '';
    return [
      step.detail ? `${step.title}: ${step.detail}` : step.title,
      step.note,
      action,
    ].filter(Boolean).join(' — ');
  };

  const renderStep = (step: ProgressStep, variant: 'track' | 'extra') => {
    const tip = stepTooltip(step);
    const clickable = !!(step.activeTask || step.resolvedTask);
    const className = variant === 'track'
      ? `cf-step cf-step--${step.state}`
      : `cf-extra cf-extra--${step.state}`;
    const content = variant === 'track' ? (
      <>
        <span className="cf-step-bar" />
        <span className="cf-step-label">{isMobile ? step.shortLabel : step.label}</span>
      </>
    ) : (
      <>{step.label}{step.detail ? ` · ${step.detail}` : ''}</>
    );
    return (
      <Tooltip key={step.key} title={tip}>
        {clickable ? (
          <button type="button" className={className} onClick={handleStepClick(step)} aria-label={tip}>
            {content}
          </button>
        ) : (
          <span className={className} aria-label={tip} onClick={e => e.stopPropagation()}>
            {content}
          </span>
        )}
      </Tooltip>
    );
  };

  // Fixed-slot stage track: the same stage sits in the same place on every claim.
  const renderStageTrack = (group: ClaimGroup) => {
    const progress = group.progress;
    if (!progress) return null;
    return (
      <div className="cf-track-row">
        <div className="cf-track">
          {progress.track.map(step => renderStep(step, 'track'))}
        </div>
        {progress.extras.length > 0 && (
          <div className="cf-extras">
            {progress.extras.map(step => renderStep(step, 'extra'))}
          </div>
        )}
      </div>
    );
  };

  const renderDue = (step: ProgressStep) => {
    const task = step.activeTask;
    const date = task?.next_followup_date || task?.due_date;
    if (!date) return null;
    const d = dayjs(date);
    const full = d.format('YYYY-MM-DD HH:mm');
    if (step.state === 'overdue') {
      const days = dayjs().startOf('day').diff(d.startOf('day'), 'day');
      return (
        <Tooltip title={`Follow-up was due ${full}`}>
          <Text type="danger" strong className="cf-due">
            {days >= 1 ? `${days} day${days === 1 ? '' : 's'} overdue` : 'Due today'}
          </Text>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={full}>
        <Text type="secondary" className="cf-due">
          {d.isSame(dayjs(), 'day') ? 'Follow up today' : `Follow up ${d.fromNow()}`}
        </Text>
      </Tooltip>
    );
  };

  // "What is this claim on right now" — one line, read before the track.
  const renderHeadline = (group: ClaimGroup) => {
    const focus = group.progress?.focus;
    if (!focus) {
      const anyDone = group.progress?.track.some(s => s.state === 'done');
      return (
        <div className="cf-headline">
          <Text type="secondary">{anyDone ? 'No open stages' : 'No stages yet'}</Text>
        </div>
      );
    }
    const task = focus.activeTask;
    const who = task?.assigned_to_name
      ? `${task.assigned_to_name}${task.assigned_to_role ? ` (${ROLE_SHORT_LABELS[task.assigned_to_role] || task.assigned_to_role})` : ''}`
      : '';
    return (
      <div className="cf-headline">
        <span className="cf-headline-main">
          <Text strong className={`cf-focus cf-focus--${focus.state}`}>{focus.title}</Text>
          {focus.detail && <Text className="cf-headline-detail">{focus.detail}</Text>}
          {who && <Text type="secondary" className="cf-headline-who">{who}</Text>}
        </span>
        {renderDue(focus)}
      </div>
    );
  };

  const renderMoney = (group: ClaimGroup) => {
    const { expectedAmount: expected, receivedAmount: received, deductible } = group;
    if (!expected && !received) {
      return <Text type="secondary" className="cf-money">No amounts yet</Text>;
    }
    const tip = [
      `Received ${formatCurrency(received)}`,
      expected ? `of ${formatCurrency(expected)} expected` : '',
      deductible ? `· deductible ${formatCurrency(deductible)}` : '',
    ].filter(Boolean).join(' ');
    return (
      <Tooltip title={tip}>
        <span className="cf-money">
          <Text strong>{formatWholeDollars(received)}</Text>
          <Text type="secondary">
            {expected ? ` of ${formatWholeDollars(expected)} received` : ' received'}
          </Text>
        </span>
      </Tooltip>
    );
  };

  // Which resolve-form sections apply depends on the task's stage — each
  // stage resolves differently, so we don't ask for irrelevant inputs.
  const isPaymentTask = !!selectedTask && PAYMENT_TASK_TYPES.includes(selectedTask.task_type);
  const isEstimateOutcomeTask = !!selectedTask && ESTIMATE_OUTCOME_TASK_TYPES.includes(selectedTask.task_type);

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>Claim Follow-up</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetchTasks()} size={isMobile ? 'small' : 'middle'}>
            {isMobile ? '' : 'Refresh'}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)} size={isMobile ? 'small' : 'middle'}>
            New Task
          </Button>
        </Space>
      </div>

      {/* Quick filters — counts are claims with open work, not tasks */}
      <div className="cf-quick" role="group" aria-label="Quick filters">
        <button
          type="button"
          className={`cf-quick-item${!quickFilter ? ' is-selected' : ''}`}
          aria-pressed={!quickFilter}
          onClick={() => setQuickFilter(undefined)}
        >
          <span className="cf-quick-count">{tasksLoading ? '–' : quickCounts.all}</span>
          <span className="cf-quick-label">Active claims</span>
        </button>
        {QUICK_FILTERS.map(f => {
          const count = quickCounts[f.key] || 0;
          const selected = quickFilter === f.key;
          const alert = f.key === 'overdue' && count > 0;
          return (
            <Tooltip key={f.key} title={f.hint}>
              <button
                type="button"
                className={`cf-quick-item${selected ? ' is-selected' : ''}${alert ? ' is-alert' : ''}`}
                aria-pressed={selected}
                onClick={() => setQuickFilter(selected ? undefined : f.key)}
              >
                <span className="cf-quick-count">{tasksLoading ? '–' : count}</span>
                <span className="cf-quick-label">{f.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col xs={12} sm={8} md={6}>
            <Select
              placeholder="Status"
              allowClear
              style={{ width: '100%' }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'pending', label: 'Pending' },
                { value: 'awaiting_response', label: 'Awaiting Response' },
                { value: 'awaiting_confirmation', label: 'Awaiting Confirmation' },
                { value: 'responded', label: 'Responded' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'overdue', label: 'Overdue' },
              ]}
            />
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Select
              placeholder="Type"
              allowClear
              style={{ width: '100%' }}
              value={typeFilter}
              onChange={setTypeFilter}
              options={TASK_TYPE_OPTIONS}
            />
          </Col>
          <Col xs={12} sm={8} md={5}>
            <Select
              placeholder="Supplement"
              allowClear
              style={{ width: '100%' }}
              value={supplementFilter}
              onChange={setSupplementFilter}
              options={[
                { value: 'needs_writing', label: 'Needs Writing (Not Submitted)' },
                { value: 'submitted', label: 'Submitted / Under Review' },
              ]}
            />
          </Col>
          <Col xs={12} sm={4} md={3}>
            <Tooltip title={hideResolved ? 'Showing active only' : 'Showing all including resolved'}>
              <Button
                size="small"
                type={hideResolved ? 'primary' : 'default'}
                icon={hideResolved ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => setHideResolved(!hideResolved)}
                style={{ width: '100%' }}
              >
                {hideResolved ? 'Active Only' : 'Show All'}
              </Button>
            </Tooltip>
          </Col>
          <Col xs={12} sm={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredClaimGroups.length} claims, {visibleTaskCount} tasks
            </Text>
          </Col>
        </Row>
      </Card>

      {/* What the stage colours mean — reuses the track's own bar styles */}
      {filteredClaimGroups.length > 0 && (
        <ul className="cf-legend" aria-label="Stage colors">
          {STAGE_LEGEND.map(item => (
            <li key={item.state} className={`cf-legend-item cf-step--${item.state}`}>
              <span className="cf-step-bar" aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      {/* Claim Groups */}
      <Collapse
        activeKey={expandedClaims}
        onChange={(keys) => setExpandedClaims(keys as string[])}
        style={{ background: 'transparent', border: 'none' }}
        items={filteredClaimGroups.map((group) => {
          const insEmail = insuranceEmails[group.insurance_company];
          const paTip = `PA: ${group.pa_name}${group.pa_company ? ` (${group.pa_company})` : ''}${group.pa_email ? ` · ${group.pa_email}` : ''}${group.pa_phone ? ` · ${group.pa_phone}` : ''}`;

          return {
            key: group.claim_id,
            className: group.hasOverdue ? 'cf-claim-item cf-claim-item--overdue' : 'cf-claim-item',
            label: (
              <div className="cf-claim">
                {/* Who: address, carrier, claim #, PA — and is money in */}
                <div className="cf-claim-top">
                  <div className="cf-claim-id">
                    <a
                      className="cf-address"
                      href={`/claim-followup/claim/${group.claim_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/claim-followup/claim/${group.claim_id}`);
                      }}
                    >
                      {group.property_address || 'No Address'}
                    </a>
                    <span className="cf-meta">
                      <Tooltip title={insEmail}>
                        <span>
                          {group.insurance_company || 'N/A'}
                          {insEmail && <MailOutlined className="cf-meta-icon" aria-label={insEmail} />}
                        </span>
                      </Tooltip>
                      <span>#{group.claim_number}</span>
                      {group.pa_name && (
                        <Tooltip title={paTip}>
                          <span>PA: {group.pa_name}</span>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                  {renderMoney(group)}
                </div>
                {/* Where: the one stage this claim is on, and when it is due */}
                {renderHeadline(group)}
                {renderStageTrack(group)}
              </div>
            ),
            children: (
              <>
              <Table<StageAggregated>
                dataSource={aggregateByStage(group.tasks, isOverdue)}
                columns={taskColumns}
                rowKey="task_type"
                size="small"
                pagination={false}
                scroll={{ x: 900 }}
                rowClassName={(record: StageAggregated) => record.status === 'overdue' ? 'ant-table-row-overdue' : ''}
                onRow={(record: StageAggregated) => ({
                  onClick: (e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('.ant-dropdown-trigger') || target.closest('.ant-btn') || target.closest('.ant-dropdown')) return;
                    setDetailTask(record.primaryTask);
                    setTaskDetailOpen(true);
                  },
                  style: { cursor: 'pointer' },
                })}
              />
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => {
                  createForm.resetFields();
                  createForm.setFieldsValue({ claim_id: group.claim_id });
                  setCreateModalOpen(true);
                }}
              >
                Add Stage
              </Button>
              </>
            ),
          };
        })}
      />

      {tasksLoading && (
        <Card size="small"><Skeleton active paragraph={{ rows: 3 }} /></Card>
      )}

      {filteredClaimGroups.length === 0 && !tasksLoading && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          {hasAnyFilter ? (
            <Space direction="vertical" size={8}>
              <Text type="secondary">No claims match these filters</Text>
              <Button size="small" onClick={clearFilters}>Clear filters</Button>
            </Space>
          ) : (
            <Text type="secondary">No follow-up tasks found</Text>
          )}
        </Card>
      )}

      {/* Create Task Modal */}
      <Modal
        title="Create Follow-up Task"
        open={createModalOpen}
        onOk={handleCreateSubmit}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createMutation.isPending}
        width={isMobile ? '95vw' : 600}
        style={isMobile ? { top: 10 } : undefined}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="claim_id" label="Claim" rules={[{ required: true, message: 'Please select a claim' }]}>
            <ClaimSearchSelect />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Task Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} placeholder="Select type"
                  onChange={(value) => {
                    createForm.setFieldValue('custom_task_type', undefined);
                    // Prefill title from the stage label so picking a type
                    // is enough — no need to also type a title by hand.
                    if (value !== '__custom__' && !createForm.getFieldValue('title')) {
                      const label = TASK_TYPE_OPTIONS.find(o => o.value === value)?.label;
                      if (label) createForm.setFieldValue('title', label);
                    }
                    // Supplements are negotiated with the PA — assign it.
                    if (isSupplementTaskType(value)) {
                      createForm.setFieldValue('assigned_to_role', 'public_adjuster');
                      applyRoleContact(
                        createForm, 'public_adjuster',
                        createForm.getFieldValue('claim_id'),
                      );
                    }
                  }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="priority" label="Priority" initialValue="normal">
                <Select options={[
                  { value: 'low', label: 'Low' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' },
                  { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.task_type !== cur.task_type}>
            {({ getFieldValue }) => getFieldValue('task_type') === '__custom__' && (
              <Form.Item name="custom_task_type" label="Custom Stage Name"
                rules={[{ required: true, message: 'Enter a custom stage name' }]}>
                <Input placeholder="e.g., Check with PA, Talk to homeowner, Waiting for approval"
                  onChange={(e) => {
                    if (!createForm.getFieldValue('title')) {
                      createForm.setFieldValue('title', e.target.value);
                    }
                  }} />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Follow up on documents sent to adjuster" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Optional details" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="next_followup_date" label="First Follow-up Date">
                <DatePicker showTime style={{ width: '100%' }} placeholder="Default: 3 days from now" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_role" label="Assigned To Role" initialValue="adjuster">
                <Select
                  options={ASSIGNED_ROLE_OPTIONS}
                  onChange={(role) => applyRoleContact(
                    createForm, role, createForm.getFieldValue('claim_id'),
                  )}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_name" label="Assigned To Name">
                <Input placeholder="Adjuster name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_email" label="Assigned To Email">
                <Input placeholder="adjuster@insurance.com" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="auto_followup_enabled" label="Auto Follow-up" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auto_followup_enabled !== cur.auto_followup_enabled}>
            {({ getFieldValue }) => getFieldValue('auto_followup_enabled') && (
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item name="followup_interval_days" label="Follow-up Interval (days)" initialValue={3}>
                    <InputNumber min={1} max={30} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="max_followup_count" label="Max Follow-ups" initialValue={5}>
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </Form.Item>
        </Form>
      </Modal>

      {/* Resolve Task Modal */}
      <Modal
        title={resolveOutcome === 'denied' && resolveDeniedAction && resolveDeniedAction !== 'complete'
          ? `Denied - Next Action: ${selectedTask?.title}`
          : `Resolve: ${selectedTask?.title}`}
        open={resolveModalOpen}
        okText={resolveOutcome === 'denied' && resolveDeniedAction && resolveDeniedAction !== 'complete'
          ? 'Update Task'
          : 'Resolve'}
        width={isMobile ? '95vw' : 650}
        style={isMobile ? { top: 10 } : undefined}
        onOk={() => {
          resolveForm.validateFields().then(values => {
            if (selectedTask) {
              resolveMutation.mutate({
                taskId: selectedTask.id,
                body: {
                  resolution_notes: values.resolution_notes,
                  outcome: values.outcome,
                  denied_action: values.denied_action,
                  acv_amount: values.acv_amount,
                  rcv_amount: values.rcv_amount,
                  depreciation_amount: values.depreciation_amount,
                  deductible: values.deductible,
                  wm_cost_status: values.wm_cost_status,
                  wm_estimate_amount: parsedWmAmount ?? values.wm_estimate_amount,
                  sections_data: parsedSections,
                  payment_status: values.payment_status,
                  payment_note: values.payment_note,
                  file: resolveFile,
                  wm_estimate_file: resolveWmFile,
                },
              });
            }
          }).catch(() => {
            // Form validation failed — antd shows field-level errors
          });
        }}
        onCancel={() => {
          setResolveModalOpen(false);
          setResolveOutcome(undefined);
          setResolveFile(undefined);
          setResolveWmFile(undefined);
          setParsedWmAmount(undefined);
          setParsedSections(null);
          setExistingPdfName(undefined);
          setExistingPdfId(undefined);
          setExistingWmPdfName(undefined);
          setExistingWmPdfId(undefined);
          resolveForm.resetFields();
        }}
        confirmLoading={resolveMutation.isPending}
      >
        <Form form={resolveForm} layout="vertical">
          {isPaymentTask && (
            <div style={{ marginBottom: 12, padding: '6px 8px', background: '#f7f7f5', borderRadius: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Payment stage — just record the payment status below. No estimate info needed here.
              </Text>
            </div>
          )}

          {!isPaymentTask && !isEstimateOutcomeTask && (
            <div style={{ marginBottom: 12, padding: '6px 8px', background: '#f7f7f5', borderRadius: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Add resolution notes if needed, then click Resolve to complete this stage.
              </Text>
            </div>
          )}

          {isEstimateOutcomeTask && (
            <Form.Item name="outcome" label="Outcome" rules={[{ required: true, message: 'Select an outcome' }]}>
              <Select placeholder="What was the result?" onChange={(v) => { setResolveOutcome(v); setResolveDeniedAction(undefined); resolveForm.setFieldsValue({ denied_action: undefined }); }}>
                <Select.Option value="estimate_received">Insurance Estimate Received</Select.Option>
                <Select.Option value="wm_estimate_only">WM Estimate Only (Rebuild Unknown)</Select.Option>
                <Select.Option value="estimate_requested">Insurance Requested Our Estimate</Select.Option>
                <Select.Option value="denied">Claim Denied</Select.Option>
                <Select.Option value="other">Other</Select.Option>
              </Select>
            </Form.Item>
          )}

          {isEstimateOutcomeTask && resolveOutcome === 'denied' && (
            <Form.Item
              name="denied_action"
              label="Next Action"
              rules={[{ required: true, message: 'Select next action' }]}
            >
              <Select placeholder="What would you like to do?" onChange={(v) => setResolveDeniedAction(v)}>
                <Select.Option value="complete">
                  <span>Complete</span>
                  <span style={{ color: '#73726e', fontSize: 12, marginLeft: 8 }}>Close the claim</span>
                </Select.Option>
                <Select.Option value="dispute">
                  <span>Dispute</span>
                  <span style={{ color: '#73726e', fontSize: 12, marginLeft: 8 }}>Create estimate & dispute with insurance</span>
                </Select.Option>
                <Select.Option value="appraisal">
                  <span>Appraisal</span>
                  <span style={{ color: '#73726e', fontSize: 12, marginLeft: 8 }}>Proceed to appraisal process</span>
                </Select.Option>
                <Select.Option value="attorney">
                  <span>Attorney</span>
                  <span style={{ color: '#73726e', fontSize: 12, marginLeft: 8 }}>Refer to attorney</span>
                </Select.Option>
              </Select>
            </Form.Item>
          )}

          {resolveOutcome === 'estimate_received' && (
            <>
              <Form.Item label="Insurance Estimate PDF">
                <Space direction="vertical" style={{ width: '100%' }}>
                  {existingPdfName && !resolveFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#edf3ec', borderRadius: 4, border: '1px solid #d3e5d0' }}>
                      <FilePdfOutlined style={{ color: '#d44c47' }} />
                      {existingPdfId ? (
                        <a href={`${fileService.getDownloadUrl(existingPdfId)}?inline=true`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12 }}>
                          {existingPdfName}
                        </a>
                      ) : (
                        <Text style={{ flex: 1, fontSize: 12 }}>{existingPdfName}</Text>
                      )}
                      <Tag color="green" style={{ margin: 0, fontSize: 10 }}>Uploaded</Tag>
                    </div>
                  )}
                  <Upload
                    maxCount={1}
                    accept=".pdf"
                    beforeUpload={async (file) => {
                      setResolveFile(file);
                      setParsedSections(null);
                      if (file.name.toLowerCase().endsWith('.pdf')) {
                        setIsParsing(true);
                        try {
                          const result = await claimFollowUpService.parseEstimatePdf(file);
                          setParsedSections(result.sections);
                          if (result.totals?.deductible) {
                            resolveForm.setFieldsValue({ deductible: result.totals.deductible });
                          }
                          recalcTotals(result.sections);
                          message.success(`Parsed ${result.sections.length} sections from PDF`);
                        } catch (err: any) {
                          message.warning('PDF parsing failed. Enter amounts manually.');
                        } finally {
                          setIsParsing(false);
                        }
                      }
                      return false;
                    }}
                    onRemove={() => { setResolveFile(undefined); setParsedSections(null); }}
                    fileList={resolveFile ? [{ uid: '-1', name: resolveFile.name, status: 'done' }] : []}
                  >
                    <Button icon={<UploadOutlined />} loading={isParsing}>
                      {isParsing ? 'Parsing PDF...' : existingPdfName ? 'Replace PDF' : 'Upload & Parse Estimate PDF'}
                    </Button>
                  </Upload>
                </Space>
              </Form.Item>

              {/* Editable Sections */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    Estimate Sections
                  </Text>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => {
                    setParsedSections([...(parsedSections || []), { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }]);
                  }}>Add Section</Button>
                </div>

                {(parsedSections || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '12px', background: '#f7f7f5', borderRadius: 6, marginBottom: 8 }}>
                    <Text type="secondary">No sections. Upload PDF to auto-parse or add manually.</Text>
                  </div>
                ) : (
                  <>
                    {(parsedSections || []).map((section, idx) => (
                      <div key={idx} style={{ background: '#f7f7f5', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                        <Row gutter={8} align="middle">
                          <Col flex="auto">
                            <Input
                              size="small"
                              placeholder="Section name (e.g. Dwelling, Water Mitigation, Code Upgrade)"
                              value={section.section_name}
                              onChange={e => {
                                const updated = [...(parsedSections || [])];
                                updated[idx] = { ...updated[idx], section_name: e.target.value };
                                setParsedSections(updated);
                              }}
                            />
                          </Col>
                          <Col flex="none">
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                              const updated = (parsedSections || []).filter((_, i) => i !== idx);
                              setParsedSections(updated);
                              recalcTotals(updated);
                            }} />
                          </Col>
                        </Row>
                        <Row gutter={8} style={{ marginTop: 4 }}>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>RCV</Text>
                            <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                              value={section.rcv} onChange={v => {
                                const updated = [...(parsedSections || [])];
                                const rcv = v || 0;
                                const dep = updated[idx].depreciation || 0;
                                updated[idx] = { ...updated[idx], rcv, net_acv: Math.round((rcv - dep) * 100) / 100 };
                                setParsedSections(updated);
                                recalcTotals(updated);
                              }} />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                            <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                              value={section.depreciation} onChange={v => {
                                const updated = [...(parsedSections || [])];
                                const dep = v || 0;
                                const rcv = updated[idx].rcv || 0;
                                updated[idx] = { ...updated[idx], depreciation: dep, net_acv: Math.round((rcv - dep) * 100) / 100 };
                                setParsedSections(updated);
                                recalcTotals(updated);
                              }} />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Net ACV</Text>
                            <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                              value={section.net_acv} disabled />
                          </Col>
                        </Row>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Totals (auto-calculated) */}
              <div style={{ background: '#e7f3f8', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Totals</Text>
                <Row gutter={[8, 8]}>
                  <Col xs={12} sm={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total RCV</Text>
                    <Form.Item name="rcv_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total ACV</Text>
                    <Form.Item name="acv_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                    <Form.Item name="depreciation_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Deductible</Text>
                    <Form.Item name="deductible" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              </div>

              {/* WM Cost Status */}
              <div style={{ background: '#edf3ec', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #d3e5d0' }}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Water Mitigation Costs</Text>
                <Form.Item
                  name="wm_cost_status"
                  style={{ marginBottom: 0 }}
                  rules={[{ required: true, message: 'WM cost status is required' }]}
                >
                  <Select placeholder="Does estimate include WM costs?">
                    <Select.Option value="included_in_rebuild">
                      Included in Rebuild Estimate
                    </Select.Option>
                    <Select.Option value="separate_estimate">
                      Received as Separate WM Estimate
                    </Select.Option>
                    <Select.Option value="not_received">
                      Not Received - Need Follow-up
                    </Select.Option>
                    <Select.Option value="not_applicable">
                      N/A (No WM on this claim)
                    </Select.Option>
                  </Select>
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.wm_cost_status !== cur.wm_cost_status}>
                  {({ getFieldValue }) => {
                    const wmStatus = getFieldValue('wm_cost_status');
                    if (wmStatus === 'separate_estimate') {
                      return (
                        <div style={{ marginTop: 8 }}>
                          <Form.Item label="WM Estimate PDF (Optional)" style={{ marginBottom: 8 }}>
                            {existingWmPdfName && !resolveWmFile && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', marginBottom: 6, background: '#edf3ec', borderRadius: 4, border: '1px solid #d3e5d0' }}>
                                <FilePdfOutlined style={{ color: '#d44c47' }} />
                                {existingWmPdfId ? (
                                  <a href={`${fileService.getDownloadUrl(existingWmPdfId)}?inline=true`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12 }}>
                                    {existingWmPdfName}
                                  </a>
                                ) : (
                                  <Text style={{ flex: 1, fontSize: 12 }}>{existingWmPdfName}</Text>
                                )}
                                <Tag color="green" style={{ margin: 0, fontSize: 10 }}>Uploaded</Tag>
                              </div>
                            )}
                            <Upload
                              maxCount={1}
                              accept=".pdf"
                              beforeUpload={async (file) => {
                                setResolveWmFile(file);
                                setParsedWmAmount(undefined);
                                if (file.name.toLowerCase().endsWith('.pdf')) {
                                  setIsParsingWm(true);
                                  try {
                                    const result = await claimFollowUpService.parseEstimatePdf(file);
                                    const amt = result.totals?.rcv_amount || result.totals?.acv_amount;
                                    if (amt) {
                                      setParsedWmAmount(amt);
                                      resolveForm.setFieldsValue({ wm_estimate_amount: amt });
                                      message.success(`Auto-parsed WM amount: $${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
                                    } else {
                                      message.warning('Could not auto-parse WM amount. Enter manually.');
                                    }
                                  } catch {
                                    message.warning('WM PDF parsing failed. Enter amount manually.');
                                  } finally {
                                    setIsParsingWm(false);
                                  }
                                }
                                return false;
                              }}
                              onRemove={() => { setResolveWmFile(undefined); setParsedWmAmount(undefined); }}
                              fileList={resolveWmFile ? [{ uid: '-2', name: resolveWmFile.name, status: 'done' }] : []}
                            >
                              <Button icon={<UploadOutlined />} loading={isParsingWm} size="small">
                                {isParsingWm ? 'Parsing...' : existingWmPdfName ? 'Replace WM PDF' : 'Upload WM Estimate PDF'}
                              </Button>
                            </Upload>
                          </Form.Item>
                          <Form.Item name="wm_estimate_amount" label="WM Estimate Amount" style={{ marginBottom: 0 }}>
                            <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} placeholder="0.00" />
                          </Form.Item>
                        </div>
                      );
                    }
                    if (wmStatus === 'not_received') {
                      return (
                        <div style={{ marginTop: 8, padding: '6px 8px', background: '#fbecdd', borderRadius: 4, border: '1px solid #f6dcc1' }}>
                          <Text style={{ fontSize: 12, color: '#a87b1e' }}>
                            A <strong>WM Payment Check</strong> follow-up task will be auto-created to request WM cost coverage from the insurance company.
                          </Text>
                        </div>
                      );
                    }
                    return null;
                  }}
                </Form.Item>
              </div>
            </>
          )}

          {/* WM Estimate Only - just WM amount, no rebuild info needed */}
          {resolveOutcome === 'wm_estimate_only' && (
            <div style={{ background: '#edf3ec', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #d3e5d0' }}>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Water Mitigation Estimate</Text>
              <Form.Item name="wm_estimate_amount" label="WM Amount (if known)">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} placeholder="Enter if known" />
              </Form.Item>
              <Form.Item label="WM Estimate PDF (Optional)" style={{ marginBottom: 0 }}>
                <Upload
                  maxCount={1}
                  accept=".pdf"
                  beforeUpload={(file) => {
                    setResolveWmFile(file);
                    return false;
                  }}
                  onRemove={() => setResolveWmFile(undefined)}
                  fileList={resolveWmFile ? [{ uid: '-2', name: resolveWmFile.name, status: 'done' as const }] : []}
                >
                  <Button icon={<UploadOutlined />} size="small">Upload WM PDF</Button>
                </Upload>
              </Form.Item>
              <div style={{ marginTop: 8, padding: '6px 8px', background: '#e7f3f8', borderRadius: 4, border: '1px solid #c6e0ee' }}>
                <Text style={{ fontSize: 12, color: '#1f74c9' }}>
                  Amount and PDF are both optional. Rebuild estimate can be added later.
                </Text>
              </div>
            </div>
          )}

          {/* Payment Status for payment tasks */}
          {isPaymentTask && (
            <div style={{ background: '#e7f3f8', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #c6e0ee' }}>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Payment Status</Text>
              <Form.Item name="payment_status" style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Select payment status' }]}>
                <Select placeholder="What is the payment status?">
                  <Select.Option value="received">Received</Select.Option>
                  <Select.Option value="issued">Issued (Amount Unknown)</Select.Option>
                  <Select.Option value="homeowner_holding">Homeowner Holding Check</Select.Option>
                  <Select.Option value="lost">Check Lost in Transit</Select.Option>
                  <Select.Option value="reissued">Reissued</Select.Option>
                  <Select.Option value="partial">Partial Payment</Select.Option>
                  <Select.Option value="pending">Still Pending</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="payment_note" label="Payment Note" style={{ marginBottom: 0 }}>
                <TextArea rows={2} placeholder="e.g. Homeowner has check since 6/1 / Check lost, reissue requested to State Farm" />
              </Form.Item>
            </div>
          )}

          <Form.Item name="resolution_notes" label="Resolution Notes">
            <TextArea rows={3} placeholder="Additional details..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Record Payment Modal — 분할/추가 수령을 누적 기록한다.
          기록해도 단계가 닫히지 않는다: supplement로 더 들어올 수 있음 */}
      <Modal
        title={`Payments: ${paymentModalTask?.property_address || paymentModalTask?.claim_number || ''}`}
        open={!!paymentModalTask}
        width={isMobile ? '95vw' : 720}
        style={isMobile ? { top: 10 } : undefined}
        onCancel={() => { setPaymentModalTask(null); paymentForm.resetFields(); }}
        footer={<Button onClick={() => { setPaymentModalTask(null); paymentForm.resetFields(); }}>Close</Button>}
      >
        {paymentSummary && (
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={8}>
              <Statistic title="Expected" value={paymentSummary.total_expected}
                precision={2} prefix="$" valueStyle={{ fontSize: 16 }} />
            </Col>
            <Col span={8}>
              <Statistic title="Received" value={paymentSummary.total_received}
                precision={2} prefix="$" valueStyle={{ fontSize: 16, color: '#448361' }} />
            </Col>
            <Col span={8}>
              <Statistic title="Remaining" value={paymentSummary.remaining}
                precision={2} prefix="$"
                valueStyle={{ fontSize: 16, color: paymentSummary.remaining > 0 ? '#b5403b' : '#73726e' }} />
            </Col>
          </Row>
        )}

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Recording a payment does not close this stage"
          description="Payments can arrive in installments, and an approved supplement can bring more money in later."
        />

        <Table<PaymentReceipt>
          dataSource={paymentSummary?.payments || []}
          rowKey="id"
          size="small"
          loading={paymentsLoading}
          pagination={false}
          locale={{ emptyText: 'No payments recorded yet' }}
          style={{ marginBottom: 16 }}
          columns={[
            {
              title: 'Received', dataIndex: 'received_date', width: 110,
              render: (v?: string, r?: PaymentReceipt) =>
                v ? dayjs(v).format('MM/DD/YYYY')
                  : (r?.created_at ? dayjs(r.created_at).format('MM/DD/YYYY') : '-'),
            },
            {
              title: 'Amount', dataIndex: 'amount', width: 110, align: 'right' as const,
              render: (v: number) => <Text strong>${(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>,
            },
            {
              title: 'Type', dataIndex: 'payment_type', width: 110,
              render: (v?: string) => <Tag>{PAYMENT_RECEIPT_TYPE_LABELS[v as keyof typeof PAYMENT_RECEIPT_TYPE_LABELS] || v || '-'}</Tag>,
            },
            { title: 'Check #', dataIndex: 'check_number', width: 100, render: (v?: string) => v || '-' },
            { title: 'Notes', dataIndex: 'notes', ellipsis: true, render: (v?: string) => v || '-' },
            {
              title: '', width: 40,
              render: (_: any, r: PaymentReceipt) => (
                <Popconfirm title="Remove this payment?"
                  onConfirm={() => deletePaymentMutation.mutate({
                    claimId: paymentModalTask!.claim_id, paymentId: r.id,
                  })}>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />

        <Divider style={{ margin: '8px 0' }}>Record a payment</Divider>
        <Form
          form={paymentForm}
          layout="vertical"
          onFinish={(values) => {
            if (!paymentModalTask) return;
            const payload: PaymentReceiptCreate = {
              amount: values.amount,
              payment_type: values.payment_type || 'insurance',
              received_date: values.received_date?.toISOString(),
              check_number: values.check_number,
              confirmed_by: values.confirmed_by,
              notes: values.notes,
              payment_category: paymentModalTask.task_type === 'wm_payment_check'
                ? 'water_mitigation' : undefined,
            };
            recordPaymentMutation.mutate({ claimId: paymentModalTask.claim_id, payload });
          }}
        >
          <Row gutter={8}>
            <Col xs={12} sm={6}>
              <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter amount' }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="payment_type" label="Type" initialValue="insurance">
                <Select options={Object.entries(PAYMENT_RECEIPT_TYPE_LABELS).map(
                  ([value, label]) => ({ value, label }))} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="received_date" label="Received">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="check_number" label="Check #">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={8}>
            <Col xs={24} sm={8}>
              <Form.Item name="confirmed_by" label="Confirmed by"
                tooltip="직접 확인할 수 없는 정보이므로, 누가 확인해 주었는지 남긴다">
                <Input placeholder="e.g. Mike (field)" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={16}>
              <Form.Item name="notes" label="Notes">
                <Input placeholder="e.g. 1st installment, ACV portion" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={recordPaymentMutation.isPending}>
            Add Payment
          </Button>
        </Form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        title={`Edit: ${selectedTask?.title}`}
        open={editModalOpen}
        width={isMobile ? '95vw' : 650}
        style={isMobile ? { top: 10 } : undefined}
        onOk={() => {
          editForm.validateFields().then(values => {
            if (selectedTask) {
              editMutation.mutate({ taskId: selectedTask.id, data: values });
            }
          });
        }}
        onCancel={() => {
          setEditModalOpen(false);
          editForm.resetFields();
          editEstimateForm.resetFields();
          setEditEstimateFile(undefined);
          setEditWmFile(undefined);
          setEditParsedSections(null);
        }}
        confirmLoading={editMutation.isPending}
      >
        <Form form={editForm} layout="vertical" size="small">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="Status">
                <Select options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'awaiting_response', label: 'Awaiting Response' },
                  { value: 'awaiting_confirmation', label: 'Awaiting Confirmation' },
                  { value: 'responded', label: 'Responded' },
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="priority" label="Priority">
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_role" label="Assigned Role">
                <Select
                  options={ASSIGNED_ROLE_OPTIONS}
                  onChange={(role) => applyRoleContact(
                    editForm, role, selectedTask?.claim_id,
                  )}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_name" label="Assigned Name">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_email" label="Assigned Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="assigned_to_phone" label="Phone">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={8} sm={8}>
              <Form.Item name="auto_followup_enabled" label="Auto Follow-up" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={8} sm={8}>
              <Form.Item name="followup_interval_days" label="Interval (days)">
                <InputNumber min={1} max={30} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={8} sm={8}>
              <Form.Item name="max_followup_count" label="Max Count">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Payment Status for payment tasks */}
          {selectedTask && ['payment_check', 'wm_payment_check'].includes(selectedTask.task_type) && (
            <div style={{ background: '#e7f3f8', borderRadius: 6, padding: '10px 12px', marginTop: 8, border: '1px solid #c6e0ee' }}>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Payment Status</Text>
              <Form.Item name="payment_status" style={{ marginBottom: 8 }}>
                <Select placeholder="Payment status" allowClear>
                  <Select.Option value="pending">Pending</Select.Option>
                  <Select.Option value="issued">Issued (Amount Unknown)</Select.Option>
                  <Select.Option value="homeowner_holding">Homeowner Holding Check</Select.Option>
                  <Select.Option value="lost">Check Lost in Transit</Select.Option>
                  <Select.Option value="reissued">Reissued</Select.Option>
                  <Select.Option value="received">Received</Select.Option>
                  <Select.Option value="partial">Partial Payment</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="payment_note" label="Payment Note" style={{ marginBottom: 0 }}>
                <TextArea rows={2} placeholder="e.g. Homeowner has check / Check lost, reissue requested" />
              </Form.Item>
            </div>
          )}
        </Form>

        {/* Estimate Data Section */}
        <Divider style={{ margin: '12px 0 8px' }} />
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 6, padding: '10px 12px' }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Insurance Estimate Data</Text>

          {/* Existing uploaded PDFs */}
          {editExistingEstimates.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Uploaded Estimates</Text>
              {editExistingEstimates.map((est: any) => {
                const catLabel = est.estimate_category === 'water_mitigation' ? 'WM'
                  : est.estimate_category === 'reconstruction' ? 'Reconstruction'
                  : est.estimate_category === 'combined' ? 'Combined' : est.estimate_category || '';
                return (
                  <div key={est.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                    background: '#f6fbff', borderRadius: 4, border: '1px solid #e6f0fa', marginBottom: 4,
                  }}>
                    {est.file_download_id
                      ? <FilePdfOutlined style={{ color: '#d44c47', fontSize: 14 }} />
                      : <FileTextOutlined style={{ color: '#73726e', fontSize: 14 }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {est.file_download_id ? (
                        <a
                          href={`${fileService.getDownloadUrl(est.file_download_id)}?inline=true`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12 }}
                        >
                          {est.document_name || `Rev #${est.revision_number}`}
                        </a>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>{est.document_name || `Rev #${est.revision_number}`} <span style={{ fontSize: 10 }}>(no PDF)</span></Text>
                      )}
                    </div>
                    {catLabel && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{catLabel}</Tag>}
                    <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      RCV ${Number(est.rcv_amount || 0).toLocaleString()}
                    </Text>
                  </div>
                );
              })}
            </div>
          )}

          <Form form={editEstimateForm} layout="vertical" size="small">
            {/* Upload new / replace PDF */}
            <Form.Item label="Upload Estimate PDF" style={{ marginBottom: 8 }}>
              <Upload
                maxCount={1}
                accept=".pdf"
                beforeUpload={async (file) => {
                  setEditEstimateFile(file);
                  setEditParsedSections(null);
                  if (file.name.toLowerCase().endsWith('.pdf')) {
                    setEditIsParsing(true);
                    try {
                      const result = await claimFollowUpService.parseEstimatePdf(file);
                      if (result.sections?.length) {
                        setEditParsedSections(result.sections);
                        const totalRcv = result.sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
                        const totalDep = result.sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
                        const ded = result.totals?.deductible || editEstimateForm.getFieldValue('deductible') || 0;
                        editEstimateForm.setFieldsValue({
                          rcv_amount: Math.round(totalRcv * 100) / 100,
                          depreciation_amount: Math.round(totalDep * 100) / 100,
                          acv_amount: Math.round((totalRcv - totalDep) * 100) / 100,
                          deductible: ded,
                        });
                        message.success(`Parsed ${result.sections.length} sections from PDF`);
                      }
                    } catch { message.warning('PDF parsing failed. Enter amounts manually.'); }
                    finally { setEditIsParsing(false); }
                  }
                  return false;
                }}
                onRemove={() => { setEditEstimateFile(undefined); setEditParsedSections(null); }}
                fileList={editEstimateFile ? [{ uid: '-1', name: editEstimateFile.name, status: 'done' as const }] : []}
              >
                <Button icon={<UploadOutlined />} loading={editIsParsing} size="small">
                  {editIsParsing ? 'Parsing...' : 'Upload & Parse PDF'}
                </Button>
              </Upload>
            </Form.Item>

            <Row gutter={6}>
              <Col span={6}>
                <Form.Item name="rcv_amount" label="RCV" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="depreciation_amount" label="Dep" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="deductible" label="Ded" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="acv_amount" label="ACV" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={6}>
              <Col span={12}>
                <Form.Item name="wm_cost_status" label="WM Cost Status" style={{ marginBottom: 6 }}>
                  <Select allowClear placeholder="Select...">
                    <Select.Option value="included_in_rebuild">Included in Rebuild</Select.Option>
                    <Select.Option value="separate_estimate">Separate Estimate</Select.Option>
                    <Select.Option value="not_received">Not Received</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="wm_estimate_amount" label="WM Amount" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item label="WM Estimate PDF" style={{ marginBottom: 8 }}>
              <Upload
                maxCount={1}
                accept=".pdf"
                beforeUpload={(file) => { setEditWmFile(file); return false; }}
                onRemove={() => setEditWmFile(undefined)}
                fileList={editWmFile ? [{ uid: '-2', name: editWmFile.name, status: 'done' as const }] : []}
              >
                <Button icon={<UploadOutlined />} size="small">Upload WM PDF</Button>
              </Upload>
            </Form.Item>

            <Button
              type="primary"
              size="small"
              loading={editEstimateSaving}
              onClick={async () => {
                if (!selectedTask) return;
                setEditEstimateSaving(true);
                try {
                  const vals = editEstimateForm.getFieldsValue();
                  await claimFollowUpService.saveEstimate(selectedTask.id, {
                    acv_amount: vals.acv_amount,
                    rcv_amount: vals.rcv_amount,
                    depreciation_amount: vals.depreciation_amount,
                    deductible: vals.deductible,
                    wm_cost_status: vals.wm_cost_status,
                    wm_estimate_amount: vals.wm_estimate_amount,
                    sections_data: editParsedSections,
                    file: editEstimateFile,
                    wm_estimate_file: editWmFile,
                  });
                  message.success('Estimate data saved');
                  // Reload existing estimates
                  const freshEstimates = await supplementService.listInsuranceEstimates(selectedTask.claim_id);
                  setEditExistingEstimates(freshEstimates || []);
                  setEditEstimateFile(undefined);
                  setEditWmFile(undefined);
                  queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
                  queryClient.invalidateQueries({ queryKey: ['supplements'] });
                } catch (err: any) {
                  message.error(err?.response?.data?.detail || 'Failed to save estimate');
                } finally {
                  setEditEstimateSaving(false);
                }
              }}
              style={{ width: '100%' }}
            >
              Save Estimate Data
            </Button>
          </Form>
        </div>
      </Modal>

      {/* Claim Detail Drawer */}
      <Drawer
        title={
          <Space direction="vertical" size={0}>
            <Text strong style={{ fontSize: isMobile ? 14 : 16 }}>{selectedClaimGroup?.property_address || 'Claim Detail'}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              #{selectedClaimGroup?.claim_number} — {selectedClaimGroup?.insurance_company}
              {selectedClaimGroup?.insurance_company && insuranceEmails[selectedClaimGroup.insurance_company] && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  <MailOutlined style={{ marginRight: 3 }} />
                  {insuranceEmails[selectedClaimGroup.insurance_company]}
                </Text>
              )}
            </Text>
          </Space>
        }
        open={claimDrawerOpen}
        onClose={() => { setClaimDrawerOpen(false); setSelectedClaimGroup(null); }}
        width={isMobile ? '100%' : 680}
        destroyOnHidden
      >
        {selectedClaimGroup && (() => {
          const group = selectedClaimGroup;
          const activeTasks = group.tasks.filter(t => !['resolved', 'cancelled'].includes(t.status));
          const resolvedTasks = group.tasks.filter(t => t.status === 'resolved');

          return (
            <>
              {/* Claim Status Overview */}
              <Card size="small" style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Stage Pipeline</Text>
                  <Space size={4} wrap>
                    {renderStageTrack(group)}
                  </Space>
                </div>

                {/* PA Info */}
                {group.pa_name && (
                  <div style={{ marginBottom: 12, padding: '6px 8px', background: '#eef5fa', borderRadius: 6, borderLeft: '3px solid #597ef7' }}>
                    <Text strong style={{ fontSize: 12, color: '#2f54eb', display: 'block', marginBottom: 2 }}>Public Adjuster</Text>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                      <span><Text type="secondary" style={{ fontSize: 11 }}>Name: </Text>{group.pa_name}</span>
                      {group.pa_company && <span><Text type="secondary" style={{ fontSize: 11 }}>Company: </Text>{group.pa_company}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginTop: 2 }}>
                      {group.pa_email && (
                        <span>
                          <Text type="secondary" style={{ fontSize: 11 }}>Email: </Text>
                          <a href={`mailto:${group.pa_email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>{group.pa_email}</a>
                        </span>
                      )}
                      {group.pa_phone && (
                        <span>
                          <Text type="secondary" style={{ fontSize: 11 }}>Phone: </Text>
                          <a href={`tel:${group.pa_phone}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>{group.pa_phone}</a>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Supplement & Info Request Status */}
                {(() => {
                  const ss = group.supplementStatuses;
                  const hasSupp = Object.keys(ss).length > 0;
                  const hasResolvedEstimate = group.tasks.some(t => t.status === 'resolved' && t.task_type === 'estimate_request');

                  if (!hasSupp && !hasResolvedEstimate && group.pendingInfoRequests === 0) return null;

                  return (
                    <div style={{ marginBottom: 12, padding: '6px 8px', background: '#f7f7f5', borderRadius: 6 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Supplement Status</Text>
                      <Space size={4} wrap>
                        {hasSupp ? (
                          <>
                            {ss['identified'] && (
                              <Tag color="orange" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                                onClick={() => navigate('/supplements')}>
                                Review Needed ({ss['identified']})
                              </Tag>
                            )}
                            {ss['in_progress'] && (
                              <Tag color="processing" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                                onClick={() => navigate('/supplements')}>
                                In Progress ({ss['in_progress']})
                              </Tag>
                            )}
                            {ss['submitted'] && (
                              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>Submitted ({ss['submitted']})</Tag>
                            )}
                            {ss['under_review'] && (
                              <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>Under Review ({ss['under_review']})</Tag>
                            )}
                            {ss['approved'] && (
                              <Tag color="green" style={{ margin: 0, fontSize: 11 }}>Approved ({ss['approved']})</Tag>
                            )}
                            {ss['denied'] && (
                              <Tag color="red" style={{ margin: 0, fontSize: 11 }}>Denied ({ss['denied']})</Tag>
                            )}
                          </>
                        ) : hasResolvedEstimate ? (
                          <Tag color="warning" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                            onClick={() => navigate('/supplements')}>
                            Supplement Pending - Needs Creation
                          </Tag>
                        ) : null}
                        {group.pendingInfoRequests > 0 && (
                          <Tag color="volcano" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}
                            onClick={() => navigate('/supplements')}>
                            Info Waiting ({group.pendingInfoRequests})
                          </Tag>
                        )}
                      </Space>
                    </div>
                  );
                })()}

                <Row gutter={[8, 8]}>
                  <Col span={8}>
                    <Statistic title="Active Tasks" value={activeTasks.length} valueStyle={{ fontSize: 18, color: '#1f74c9' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Resolved" value={resolvedTasks.length} valueStyle={{ fontSize: 18, color: '#448361' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="Next Follow-up"
                      value={group.nextFollowupDate ? dayjs(group.nextFollowupDate).format('MM/DD') : '-'}
                      valueStyle={{
                        fontSize: 18,
                        color: group.hasOverdue ? '#b5403b' : undefined,
                      }}
                    />
                  </Col>
                </Row>
              </Card>

              {/* Tasks Summary (aggregated by stage) */}
              <Card size="small" title="Tasks" style={{ marginBottom: 16 }}>
                <Table<StageAggregated>
                  size="small"
                  dataSource={aggregateByStage(group.tasks, isOverdue)}
                  rowKey="task_type"
                  pagination={false}
                  columns={[
                    {
                      title: 'Stage', dataIndex: 'task_type', width: 140,
                      render: (t: TaskType) => getStageLabel(t),
                    },
                    {
                      title: 'Status', dataIndex: 'status', width: 130,
                      render: (s: string) => (
                        <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ').toUpperCase()}</Tag>
                      ),
                    },
                    {
                      title: 'Assigned', dataIndex: 'assigned_to_name', width: 120, ellipsis: true,
                      render: (n?: string) => n || <Text type="secondary">-</Text>,
                    },
                    {
                      title: '', key: 'actions', width: 80, align: 'center' as const,
                      render: (_: any, record: StageAggregated) => (
                        <Space size={4}>
                          <Tooltip title="Send Email">
                            <Button
                              type="link"
                              size="small"
                              icon={<MailOutlined />}
                              onClick={() => setDrawerEmailTaskId(record.primaryTask.id)}
                            />
                          </Tooltip>
                          <Tooltip title="Open full page">
                            <Button
                              type="link"
                              size="small"
                              icon={<RightOutlined />}
                              onClick={() => navigate(`/claim-followup/${record.primaryTask.id}/email`)}
                            />
                          </Tooltip>
                        </Space>
                      ),
                    },
                  ]}
                  rowClassName={(record: StageAggregated) => record.primaryTask.id === drawerEmailTaskId ? 'ant-table-row-selected' : ''}
                />
              </Card>

              <Divider style={{ margin: '12px 0' }} />

              {/* Email + Communication */}
              <Tabs
                defaultActiveKey="estimates"
                size="small"
                items={[
                  {
                    key: 'estimates',
                    label: <span><FilePdfOutlined /> Estimates</span>,
                    children: (
                      <ClaimEstimatesPanel claimId={group.claim_id} />
                    ),
                  },
                  {
                    key: 'email',
                    label: <span><MailOutlined /> Send Email</span>,
                    children: (
                      <EmailComposer
                        claimId={group.claim_id}
                        followupTaskId={drawerEmailTaskId}
                        taskType={group.tasks.find(t => t.id === drawerEmailTaskId)?.task_type}
                        wmJobId={group.tasks.find(t => t.id === drawerEmailTaskId)?.wm_job_id}
                        contactCount={group.tasks.find(t => t.id === drawerEmailTaskId)?.contact_count || 0}
                        defaultTo={
                          (() => {
                            const task = group.tasks.find(t => t.id === drawerEmailTaskId);
                            return task?.assigned_to_email || group.tasks[0]?.assigned_to_email || '';
                          })()
                        }
                        onSent={() => {
                          message.success('Email sent');
                          queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
                        }}
                        onCancel={() => setClaimDrawerOpen(false)}
                      />
                    ),
                  },
                  {
                    key: 'history',
                    label: <span><ClockCircleOutlined /> Communication History</span>,
                    children: (
                      <CommunicationTimeline claimId={group.claim_id} taskId={drawerEmailTaskId} />
                    ),
                  },
                ]}
              />
            </>
          );
        })()}
      </Drawer>

      {/* Task Activity Detail Drawer */}
      <Drawer
        title={
          detailTask ? (
            <Space direction="vertical" size={0}>
              <Text strong style={{ fontSize: 16 }}>{detailTask.title}</Text>
            </Space>
          ) : 'Task Activity'
        }
        open={taskDetailOpen}
        onClose={() => { setTaskDetailOpen(false); setDetailTask(null); }}
        width={isMobile ? '100%' : 560}
        destroyOnHidden
      >
        {detailTask && (
          <>
            {/* Status & Priority row */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <Tag color="blue">{getStageLabel(detailTask.task_type)}</Tag>
              <Tag color={STATUS_COLORS[isOverdue(detailTask) ? 'overdue' : detailTask.status] || 'default'}>
                {(isOverdue(detailTask) ? 'OVERDUE' : detailTask.status).replace('_', ' ').toUpperCase()}
              </Tag>
              <Tag color={PRIORITY_TAG_COLORS[detailTask.priority] || 'default'}>
                {detailTask.priority.toUpperCase()}
              </Tag>
            </div>

            {/* Depreciation Phase Tracker */}
            {detailTask.task_type === 'depreciation_recovery' && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <DepreciationPhaseTracker
                  task={detailTask}
                  onUpdated={() => {
                    refetchTasks();
                    // Refresh detail task
                    claimFollowUpService.getTask(detailTask.id).then(t => setDetailTask(t)).catch(() => {});
                  }}
                />
              </Card>
            )}

            {/* Task Info Card */}
            <Card size="small" style={{ marginBottom: 12 }}>
              {detailTask.assigned_to_name && (
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Assigned To</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <UserOutlined />
                    <Text strong>{detailTask.assigned_to_name}</Text>
                    {detailTask.assigned_to_role && (
                      <Tag style={{ margin: 0, fontSize: 11 }}>{detailTask.assigned_to_role}</Tag>
                    )}
                  </div>
                  {detailTask.assigned_to_email && (
                    <div style={{ marginTop: 2, marginLeft: 20 }}>
                      <MailOutlined style={{ marginRight: 4, fontSize: 12 }} />
                      <Text style={{ fontSize: 13 }}>{detailTask.assigned_to_email}</Text>
                    </div>
                  )}
                  {detailTask.assigned_to_phone && (
                    <div style={{ marginTop: 2, marginLeft: 20 }}>
                      <PhoneOutlined style={{ marginRight: 4, fontSize: 12 }} />
                      <Text style={{ fontSize: 13 }}>{detailTask.assigned_to_phone}</Text>
                    </div>
                  )}
                </div>
              )}
              <Row gutter={16}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Created</Text>
                  <div><Text style={{ fontSize: 13 }}>{detailTask.created_at ? dayjs(detailTask.created_at).format('YYYY-MM-DD HH:mm') : '-'}</Text></div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Last Contact</Text>
                  <div><Text style={{ fontSize: 13 }}>{detailTask.last_contacted_at ? dayjs(detailTask.last_contacted_at).format('YYYY-MM-DD HH:mm') : '-'}</Text></div>
                </Col>
              </Row>
              {detailTask.next_followup_date && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Next Follow-up</Text>
                  <div>
                    <Text style={{ fontSize: 13 }} type={isOverdue(detailTask) ? 'danger' : undefined}>
                      {dayjs(detailTask.next_followup_date).format('YYYY-MM-DD')} ({dayjs(detailTask.next_followup_date).fromNow()})
                    </Text>
                  </div>
                </div>
              )}
              {detailTask.resolved_at && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Resolved</Text>
                  <div><Text style={{ fontSize: 13 }}>{dayjs(detailTask.resolved_at).format('YYYY-MM-DD HH:mm')}</Text></div>
                </div>
              )}
              {detailTask.resolution_notes && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Resolution Notes</Text>
                  <div style={{ padding: '4px 8px', background: '#f7f7f5', borderRadius: 4, marginTop: 2 }}>
                    <Text style={{ fontSize: 13 }}>{detailTask.resolution_notes}</Text>
                  </div>
                </div>
              )}
            </Card>

            {/* Insurance Estimates */}
            <Card size="small" style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Insurance Estimates</Text>
              <ClaimEstimatesPanel claimId={detailTask.claim_id} />
            </Card>

            {/* Quick Actions */}
            <Space style={{ marginBottom: 12 }} wrap>
              <Button
                icon={<MailOutlined />}
                onClick={() => navigate(`/claim-followup/${detailTask.id}/email`)}
              >
                Send Email
              </Button>
              {detailTask.status !== 'resolved' && (
                <Button
                  icon={<CheckCircleOutlined />}
                  onClick={() => {
                    setTaskDetailOpen(false);
                    openResolveForTask(detailTask);
                  }}
                >
                  Resolve
                </Button>
              )}
              {detailTask.status === 'resolved' && (
                <Button
                  icon={<ClockCircleOutlined />}
                  onClick={() => {
                    reopenMutation.mutate(detailTask.id);
                    setTaskDetailOpen(false);
                  }}
                >
                  Reopen
                </Button>
              )}
            </Space>

            <Divider style={{ margin: '8px 0 12px' }} />

            {/* Activity Timeline */}
            <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
              <HistoryOutlined style={{ marginRight: 6 }} />
              Activity History
            </Text>
            <CommunicationTimeline claimId={detailTask.claim_id} taskId={detailTask.id} />
          </>
        )}
      </Drawer>

      <style>{`
        .ant-table-row-overdue {
          background-color: #fdebec !important;
        }
        .ant-table-row-overdue:hover > td {
          background-color: #ffece8 !important;
        }
        .ant-collapse > .ant-collapse-item > .ant-collapse-header {
          padding: 12px 16px !important;
          align-items: flex-start !important;
        }

        /* Quick filters */
        .cf-quick {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }
        .cf-quick-item {
          display: flex; align-items: baseline; gap: 8px;
          padding: 8px 12px; min-height: 44px;
          background: #fff; border: 1px solid var(--color-neutral-200, #e9e9e7); border-radius: var(--radius-md, 6px);
          font: inherit; text-align: left; cursor: pointer;
          transition: border-color .15s ease-out, background-color .15s ease-out;
        }
        .cf-quick-item:hover { border-color: var(--color-neutral-400, #dfdfdc); background: var(--color-ink-hover, rgba(55,53,47,.06)); }
        
        .cf-quick-item.is-selected { border-color: var(--color-primary, #1f74c9); background: var(--tag-blue-bg, #e7f3f8); }
        .cf-quick-count {
          font-size: 20px; font-weight: 600; line-height: 1.2;
          color: var(--color-neutral-900, #37352f); font-variant-numeric: tabular-nums;
        }
        .cf-quick-item.is-alert .cf-quick-count { color: var(--tag-red-text, #b93a35); }
        .cf-quick-label { font-size: 12px; color: var(--color-neutral-700, #5f5e5b); }

        /* Claim rows */
        .ant-collapse > .cf-claim-item {
          margin-bottom: 8px;
          border: 1px solid var(--color-neutral-200, #e9e9e7) !important;
          border-radius: var(--radius-md, 6px) !important;
          background: var(--color-surface, #fff);
          overflow: hidden;
        }
        .ant-collapse > .cf-claim-item--overdue { border-color: #efc2c0 !important; }
        .cf-claim-item > .ant-collapse-header { flex-wrap: nowrap !important; }
        .cf-claim-item > .ant-collapse-header > .ant-collapse-header-text { min-width: 0; }
        .cf-claim { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
        .cf-claim-top {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 4px 16px; flex-wrap: wrap;
        }
        .cf-claim-id {
          display: flex; align-items: baseline; gap: 4px 10px;
          flex-wrap: wrap; flex: 1 1 260px; min-width: 0;
        }
        .cf-address {
          font-size: 14px; font-weight: 600; color: var(--color-neutral-900, #37352f);
          max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cf-address:hover { color: var(--color-primary, #1f74c9); text-decoration: underline; text-underline-offset: 2px; }
        
        .cf-meta { display: inline-flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; color: var(--color-neutral-600, #73726e); }
        .cf-meta-icon { margin-left: 4px; font-size: 11px; }
        .cf-money { font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }

        .cf-headline {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 2px 16px; flex-wrap: wrap; font-size: 13px;
        }
        .cf-headline-main { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 0 8px; min-width: 0; }
        .cf-headline-detail::before, .cf-headline-who::before { content: '·'; margin-right: 8px; color: var(--color-neutral-400, #dfdfdc); }
        .cf-focus--overdue { color: var(--tag-red-text, #b93a35) !important; }
        .cf-focus--issue { color: var(--tag-orange-text, #a65208) !important; }
        .cf-due { font-size: 12px; white-space: nowrap; }

        /* Stage track: fixed slots, colour only where attention is needed */
        .cf-track-row { display: flex; align-items: flex-end; gap: 6px 16px; flex-wrap: wrap; }
        .cf-track { display: flex; gap: 4px; flex: 1 1 360px; max-width: 600px; min-width: 0; }
        .cf-step {
          flex: 1 1 0; min-width: 0;
          display: flex; flex-direction: column; gap: 4px;
          padding: 2px 0; margin: 0; background: none; border: 0;
          font: inherit; text-align: left; cursor: default;
        }
        button.cf-step { cursor: pointer; }
        .cf-step-bar {
          display: block; height: 6px; border-radius: 3px; background: var(--color-neutral-100, #f1f1ef);
          transition: background-color .15s ease-out, box-shadow .15s ease-out;
        }
        .cf-step-label {
          font-size: 11px; line-height: 14px; color: var(--color-neutral-600, #73726e);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cf-step--done .cf-step-bar { background: #b9b7b0; }
        .cf-step--active .cf-step-bar { background: var(--color-neutral-900, #37352f); }
        .cf-step--active .cf-step-label { color: var(--color-neutral-900, #37352f); font-weight: 600; }
        .cf-step--overdue .cf-step-bar { background: var(--color-error, #d44c47); }
        .cf-step--overdue .cf-step-label { color: var(--tag-red-text, #b93a35); font-weight: 600; }
        .cf-step--issue .cf-step-bar { background: var(--color-warning, #d9730d); }
        .cf-step--issue .cf-step-label { color: var(--tag-orange-text, #a65208); font-weight: 600; }
        .cf-step--waiting .cf-step-bar {
          background: repeating-linear-gradient(-45deg, #b9b7b0 0 3px, #f1f1ef 3px 6px);
        }
        .cf-step--waiting .cf-step-label, .cf-step--todo .cf-step-label { color: var(--color-neutral-700, #5f5e5b); }
        .cf-step--todo .cf-step-bar { background: #fff; box-shadow: inset 0 0 0 1px #b9b7b0; }
        button.cf-step:hover .cf-step-bar { box-shadow: 0 0 0 2px rgba(55,53,47,.1); }
        button.cf-step--todo:hover .cf-step-bar { box-shadow: inset 0 0 0 1px #b9b7b0, 0 0 0 2px rgba(55,53,47,.1); }
        button.cf-step:hover .cf-step-label { text-decoration: underline; text-underline-offset: 2px; }
        button.cf-step:focus-visible { border-radius: var(--radius-sm, 4px); }

        .cf-extras { display: flex; flex-wrap: wrap; gap: 4px; }
        .cf-extra {
          font: inherit; font-size: 12px; line-height: 20px;
          padding: 0 8px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--color-neutral-200, #e9e9e7);
          background: var(--color-neutral-50, #f7f7f5); color: var(--color-neutral-700, #5f5e5b); cursor: default;
        }
        button.cf-extra { cursor: pointer; }
        button.cf-extra:hover { border-color: var(--color-neutral-400, #dfdfdc); }
        .cf-extra--active { color: var(--color-neutral-900, #37352f); border-color: var(--color-neutral-400, #dfdfdc); }
        .cf-extra--overdue { color: var(--tag-red-text, #b93a35); border-color: #efc2c0; background: var(--tag-red-bg, #fdebec); }

        .cf-legend {
          display: flex; flex-wrap: wrap; gap: 4px 16px;
          margin: 0 0 8px; padding: 0 4px; list-style: none;
          font-size: 12px; color: var(--color-neutral-700, #5f5e5b);
        }
        .cf-legend-item { display: inline-flex; align-items: center; gap: 6px; }
        .cf-legend-item .cf-step-bar { width: 20px; flex: none; }
        .ant-collapse-content-box {
          padding: 8px 12px 12px !important;
          border-top: 1px solid #e9e9e7;
        }
        @media (max-width: 576px) {
          .ant-collapse > .ant-collapse-item > .ant-collapse-header {
            padding: 8px 12px !important;
          }
          .cf-step-label { font-size: 10px; }
          .ant-modal {
            margin: 8px !important;
          }
          .ant-drawer-content-wrapper {
            width: 100% !important;
          }
          .ant-statistic-title {
            font-size: 11px !important;
          }
          .ant-statistic-content {
            font-size: 16px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ClaimFollowUpDashboard;
