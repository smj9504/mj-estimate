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
import type { FormInstance, MenuProps } from 'antd';
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
  FilterOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { supplementService } from '../services/supplementService';
import { companyService } from '../services/companyService';
import { fileService } from '../services/fileService';
import ClaimSearchSelect from '../components/common/ClaimSearchSelect';
import { useSheetModal } from '../components/common/ui';
import {
  EmailComposer, CommunicationTimeline, DepreciationPhaseTracker, ClaimEstimatesPanel, ResolveTaskModal,
  FollowUpDateTimePicker,
} from '../components/claim-followup';
import {
  TASK_TYPE_OPTIONS, PAYMENT_TASK_TYPES, STAGE_ORDER, getStageLabel,
  isTaskActive, isTaskOverdue, PAYMENT_ISSUE_STATUSES, TASK_STATUS_LABELS, ROLE_SHORT_LABELS,
  STAGE_LEGEND, buildClaimProgress,
} from '../components/claim-followup/claimProgress';
import type { ClaimProgress, ProgressStep } from '../components/claim-followup/claimProgress';
import { templateValuesFromTask } from '../components/claim-followup/emailTemplates';
import { useUndoableTaskDelete } from '../components/claim-followup/useUndoableTaskDelete';
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
  KNOWN_TASK_TYPES,
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

/** Phones and small tablets: below the 768px line where the app shell switches to its phone layout */
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
};

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
  estimateOrigin: string;
  contractorEstimateStage: string;
  rebuildEstimateCompanyName: string | null;
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

const ClaimFollowUpDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { sheetProps } = useSheetModal();
  // Phones keep the filter selects folded behind a Filters button
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [hideResolved, setHideResolved] = useState(true);
  const [supplementFilter, setSupplementFilter] = useState<string | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<QuickFilter | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resolvingTask, setResolvingTask] = useState<FollowUpTask | null>(null);
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

  // Queries
  // Always load every task: claims are built from all of their tasks, and the
  // Status/Type filters pick claims client-side. Filtering on the server cut
  // each claim's pipeline down to the matching tasks only.
  const { data: fetchedTasks = [], isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['followup-tasks', 'all'],
    queryFn: () => claimFollowUpService.getAllTasks({
      sort_by: 'next_followup_date',
      sort_order: 'asc',
    }),
  });

  // A deleted task stays hidden while its Undo toast is up
  const { pendingIds: deletingIds, requestDelete } = useUndoableTaskDelete(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['followup-tasks'] }),
    queryClient.invalidateQueries({ queryKey: ['followup-stats'] }),
  ]));
  const tasks = useMemo(
    () => (deletingIds.size ? fetchedTasks.filter(t => !deletingIds.has(t.id)) : fetchedTasks),
    [fetchedTasks, deletingIds],
  );

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
          estimateOrigin: task.estimate_origin || '',
          contractorEstimateStage: task.contractor_estimate_stage || '',
          rebuildEstimateCompanyName: task.rebuild_estimate_company_name || null,
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
  // Filters set in the folded panel, so the Filters button can say so
  const panelFilterCount = [statusFilter, typeFilter, supplementFilter].filter(Boolean).length
    + (hideResolved ? 0 : 1);
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

  const isOverdue = isTaskOverdue;

  // Helper: open resolve modal for a given task
  const openResolveForTask = (task: FollowUpTask) => setResolvingTask(task);

  const openTaskDetail = (task: FollowUpTask) => {
    setDetailTask(task);
    setTaskDetailOpen(true);
  };

  const openEditTask = async (task: FollowUpTask) => {
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
  };

  // One stage's actions: the table's ⋯ column on desktop, each row's ⋯ button on phones
  const stageMenuItems = (record: StageAggregated): MenuProps['items'] => {
    const task = record.primaryTask;
    return [
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
        disabled: record.status !== 'resolved' && record.status !== 'cancelled',
        onClick: () => reopenMutation.mutate(task.id),
      },
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Edit',
        onClick: () => { openEditTask(task); },
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
            onOk: () => requestDelete(task.id),
          });
        },
      },
    ];
  };

  // Phones: each stage is a row (stage name, then status · priority · due, then
  // who) instead of a seven-column table that only has room for two columns.
  const renderStageList = (group: ClaimGroup) => (
    <ul className="cf-stages">
      {aggregateByStage(group.tasks, isOverdue).map(record => {
        const label = getStageLabel(record.task_type);
        const closed = record.status === 'resolved' || record.status === 'cancelled';
        const statusLabel = TASK_STATUS_LABELS[record.status] || record.status.replace(/_/g, ' ');
        const date = closed ? undefined : record.next_followup_date;
        const dateOverdue = !!date && dayjs(date).isBefore(dayjs());
        const role = record.assigned_to_role
          ? (ROLE_SHORT_LABELS[record.assigned_to_role] || record.assigned_to_role)
          : '';
        return (
          <li key={record.task_type} className={`cf-stage${record.status === 'overdue' ? ' is-overdue' : ''}`}>
            <button type="button" className="cf-stage-main" onClick={() => openTaskDetail(record.primaryTask)}>
              <span className="cf-stage-name">{label}</span>
              <span className="cf-stage-meta-clip">
                <span className="cf-stage-meta">
                  {record.status === 'overdue'
                    ? <Text type="danger" strong>{statusLabel}</Text>
                    : <Text type={closed || record.status === 'awaiting_confirmation' ? 'secondary' : undefined}>{statusLabel}</Text>}
                  {!closed && record.priority === 'urgent' && <Text type="danger" strong>Urgent</Text>}
                  {!closed && record.priority === 'high' && <Text type="warning" strong>High</Text>}
                  {date && <Text type={dateOverdue ? 'danger' : 'secondary'}>Follow up {dayjs(date).fromNow()}</Text>}
                </span>
              </span>
              {record.assigned_to_name && (
                <Text type="secondary" className="cf-stage-who">
                  {record.assigned_to_name}{role ? ` (${role})` : ''}
                </Text>
              )}
            </button>
            <Dropdown menu={{ items: stageMenuItems(record) }} trigger={['click']} placement="bottomRight">
              <Button type="text" className="cf-stage-more" icon={<EllipsisOutlined />} aria-label={`Actions for ${label}`} />
            </Dropdown>
          </li>
        );
      })}
    </ul>
  );

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
      render: (_, record: StageAggregated) => (
        <Dropdown menu={{ items: stageMenuItems(record) }}>
          <Button type="text" icon={<EllipsisOutlined />} aria-label={`Actions for ${getStageLabel(record.task_type)}`} />
        </Dropdown>
      ),
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


  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>Claim Follow-up</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetchTasks()} aria-label="Refresh">
            {isMobile ? null : 'Refresh'}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
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

      {/* Phones: count + a Filters button; the selects fold away below it */}
      {isMobile && (
        <div className="cf-toolbar">
          <Text type="secondary" className="cf-toolbar-count">
            {filteredClaimGroups.length} claims, {visibleTaskCount} tasks
          </Text>
          <Button
            icon={<FilterOutlined />}
            aria-expanded={filtersOpen}
            aria-controls="cf-filters"
            onClick={() => setFiltersOpen(open => !open)}
          >
            Filters{panelFilterCount > 0 ? ` (${panelFilterCount})` : ''}
          </Button>
        </div>
      )}

      {/* Filters */}
      {(!isMobile || filtersOpen) && (
      <Card size="small" style={{ marginBottom: 16 }} id="cf-filters">
        <Row gutter={[8, 8]} align="middle">
          <Col xs={24} sm={12} md={6}>
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
          <Col xs={24} sm={12} md={6}>
            <Select
              placeholder="Type"
              allowClear
              style={{ width: '100%' }}
              value={typeFilter}
              onChange={setTypeFilter}
              options={TASK_TYPE_OPTIONS}
            />
          </Col>
          <Col xs={24} sm={12} md={5}>
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
          <Col xs={24} sm={12} md={3}>
            <Tooltip title={hideResolved ? 'Showing active only' : 'Showing all including resolved'}>
              <Button
                size={isMobile ? 'middle' : 'small'}
                type={hideResolved ? 'primary' : 'default'}
                icon={hideResolved ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => setHideResolved(!hideResolved)}
                style={{ width: '100%' }}
              >
                {hideResolved ? 'Active Only' : 'Show All'}
              </Button>
            </Tooltip>
          </Col>
          {!isMobile && (
            <Col xs={12} sm={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {filteredClaimGroups.length} claims, {visibleTaskCount} tasks
              </Text>
            </Col>
          )}
        </Row>
      </Card>
      )}

      {/* What the stage colours mean — reuses the track's own bar styles.
          Phones fold it away: it is reference, not something read every visit. */}
      {filteredClaimGroups.length > 0 && (() => {
        const legend = (
          <ul className="cf-legend" aria-label="Stage colors">
            {STAGE_LEGEND.map(item => (
              <li key={item.state} className={`cf-legend-item cf-step--${item.state}`}>
                <span className="cf-step-bar" aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        );
        return isMobile ? (
          <details className="cf-legend-fold">
            <summary><RightOutlined className="cf-legend-caret" aria-hidden="true" />Stage colors</summary>
            {legend}
          </details>
        ) : legend;
      })()}

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
              {isMobile ? renderStageList(group) : (
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
                    openTaskDetail(record.primaryTask);
                  },
                  style: { cursor: 'pointer' },
                })}
              />
              )}
              <Button
                type="dashed"
                size={isMobile ? 'middle' : 'small'}
                block={isMobile}
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
        width={600}
        {...sheetProps}
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
                <FollowUpDateTimePicker placeholder="Default: 3 days from now" />
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
      <ResolveTaskModal task={resolvingTask} onClose={() => setResolvingTask(null)} />

      {/* Record Payment Modal — 분할/추가 수령을 누적 기록한다.
          기록해도 단계가 닫히지 않는다: supplement로 더 들어올 수 있음 */}
      <Modal
        title={`Payments: ${paymentModalTask?.property_address || paymentModalTask?.claim_number || ''}`}
        open={!!paymentModalTask}
        width={720}
        {...sheetProps}
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

        {/* Phones: one row per payment instead of a six-column table */}
        {isMobile ? (
          paymentsLoading ? (
            <Skeleton active title={false} paragraph={{ rows: 2 }} />
          ) : (paymentSummary?.payments || []).length === 0 ? (
            <p className="cf-pays-empty">No payments recorded yet</p>
          ) : (
            <ul className="cf-pays">
              {(paymentSummary?.payments || []).map((r: PaymentReceipt) => (
                <li key={r.id} className="cf-pay">
                  <div className="cf-pay-main">
                    <span className="cf-pay-top">
                      <Text strong>${(r.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                      <Tag style={{ margin: 0 }}>
                        {PAYMENT_RECEIPT_TYPE_LABELS[r.payment_type as keyof typeof PAYMENT_RECEIPT_TYPE_LABELS] || r.payment_type || '-'}
                      </Tag>
                    </span>
                    <Text type="secondary" className="cf-pay-meta">
                      {r.received_date ? dayjs(r.received_date).format('MM/DD/YYYY')
                        : (r.created_at ? dayjs(r.created_at).format('MM/DD/YYYY') : '-')}
                      {r.check_number && ` · Check #${r.check_number}`}
                      {r.notes && ` · ${r.notes}`}
                    </Text>
                  </div>
                  <Popconfirm title="Remove this payment?"
                    onConfirm={() => deletePaymentMutation.mutate({
                      claimId: paymentModalTask!.claim_id, paymentId: r.id,
                    })}>
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove payment" className="cf-pay-remove" />
                  </Popconfirm>
                </li>
              ))}
            </ul>
          )
        ) : (
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
        )}

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
          <Button type="primary" htmlType="submit" loading={recordPaymentMutation.isPending} block={isMobile}>
            Add Payment
          </Button>
        </Form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        title={`Edit: ${selectedTask?.title}`}
        open={editModalOpen}
        width={650}
        {...sheetProps}
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
        <Form form={editForm} layout="vertical" size={isMobile ? 'middle' : 'small'}>
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
            <Col xs={24} sm={8}>
              <Form.Item name="auto_followup_enabled" label="Auto Follow-up" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="followup_interval_days" label="Interval (days)">
                <InputNumber min={1} max={30} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
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

          <Form form={editEstimateForm} layout="vertical" size={isMobile ? 'middle' : 'small'}>
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
                <Button icon={<UploadOutlined />} loading={editIsParsing} size={isMobile ? 'middle' : 'small'}>
                  {editIsParsing ? 'Parsing...' : 'Upload & Parse PDF'}
                </Button>
              </Upload>
            </Form.Item>

            <Row gutter={6}>
              <Col xs={12} sm={6}>
                <Form.Item name="rcv_amount" label="RCV" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="depreciation_amount" label="Dep" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="deductible" label="Ded" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item name="acv_amount" label="ACV" style={{ marginBottom: 6 }}>
                  <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={6}>
              <Col xs={24} sm={12}>
                <Form.Item name="wm_cost_status" label="WM Cost Status" style={{ marginBottom: 6 }}>
                  <Select allowClear placeholder="Select...">
                    <Select.Option value="paid_per_invoice">Paid per Our Invoice</Select.Option>
                    <Select.Option value="included_in_rebuild">Included in Rebuild</Select.Option>
                    <Select.Option value="separate_estimate">Separate Estimate</Select.Option>
                    <Select.Option value="not_received">Not Received</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
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
                <Button icon={<UploadOutlined />} size={isMobile ? 'middle' : 'small'}>Upload WM PDF</Button>
              </Upload>
            </Form.Item>

            <Button
              type="primary"
              size={isMobile ? 'middle' : 'small'}
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
                        templateValues={templateValuesFromTask(group.tasks[0])}
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
        /* Phones: count + Filters button above the folded filter panel */
        .cf-toolbar {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          margin-bottom: 12px;
        }
        .cf-toolbar-count { font-size: 13px; font-variant-numeric: tabular-nums; }
        .cf-legend-fold { margin: 0 0 8px; }
        .cf-legend-fold > summary {
          display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 4px;
          font-size: 13px; color: var(--color-neutral-700, #5f5e5b); cursor: pointer;
          list-style: none;
        }
        .cf-legend-fold > summary::-webkit-details-marker { display: none; }
        .cf-legend-caret { font-size: 10px; transition: transform .15s ease-out; }
        .cf-legend-fold[open] .cf-legend-caret { transform: rotate(90deg); }
        .cf-legend-fold[open] > summary { margin-bottom: 4px; }

        /* Phones: one row per stage inside an expanded claim */
        .cf-stages { margin: 0; padding: 0; list-style: none; }
        .cf-stage {
          display: flex; align-items: center; gap: 4px;
          border-bottom: 1px solid var(--color-neutral-200, #e9e9e7);
        }
        .cf-stage:last-child { border-bottom: 0; }
        .cf-stage.is-overdue {
          margin: 0 -12px; padding: 0 0 0 12px; background: var(--tag-red-bg, #fdebec);
        }
        .cf-stage-main {
          display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0;
          min-height: 56px; margin: 0; padding: 10px 0; border: 0; background: none;
          font: inherit; text-align: left; color: inherit; cursor: pointer;
        }
        .cf-stage-name { font-size: 15px; font-weight: 500; line-height: 1.35; color: var(--color-neutral-900, #37352f); }
        /* "·" between facts, clipped at the start of each wrapped line */
        .cf-stage-meta-clip { display: block; overflow: hidden; }
        .cf-stage-meta {
          display: flex; flex-wrap: wrap; margin-left: -15px;
          font-size: 13px; line-height: 20px;
        }
        .cf-stage-meta > *::before {
          content: '·'; display: inline-block; width: 15px; text-align: center;
          font-weight: 400; color: #b9b7b0;
        }
        .cf-stage-who { font-size: 13px; line-height: 20px; }
        .cf-stage-more.ant-btn { flex: none; width: 44px; height: 44px; }

        /* Phones: payments as rows in the Payments dialog */
        .cf-pays { margin: 0 0 16px; padding: 0; list-style: none; border-top: 1px solid var(--color-neutral-200, #e9e9e7); }
        .cf-pay {
          display: flex; align-items: center; gap: 8px; padding: 10px 0;
          border-bottom: 1px solid var(--color-neutral-200, #e9e9e7);
        }
        .cf-pay-main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
        .cf-pay-top { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
        .cf-pay-meta { font-size: 13px; overflow-wrap: anywhere; }
        .cf-pay-remove.ant-btn { flex: none; width: 40px; height: 40px; }
        .cf-pays-empty { margin: 0 0 16px; padding: 12px 0; color: var(--color-neutral-600, #73726e); }

        @media (max-width: 767px) {
          .ant-collapse > .cf-claim-item > .ant-collapse-header {
            padding: 12px !important;
          }
          .cf-claim-item .ant-collapse-content-box { padding: 0 12px 12px !important; }
          .cf-quick { display: flex; flex-wrap: wrap; gap: 6px; }
          .cf-quick-item {
            flex: 0 0 auto; align-items: center; gap: 6px;
            min-height: 40px; padding: 6px 10px;
          }
          .cf-quick-count { font-size: 16px; }
          .cf-quick-label { font-size: 13px; white-space: nowrap; }
          .cf-address {
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
            font-size: 15px; white-space: normal;
          }
          .cf-headline-who { flex-basis: 100%; }
          .cf-headline-who::before { content: none; }
          .cf-step { padding: 4px 0 6px; }
          .cf-step-label { font-size: 11px; }
        }
      `}</style>
    </div>
  );
};

export default ClaimFollowUpDashboard;
