import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Col, ConfigProvider, DatePicker, Dropdown, Form, Grid, Input, InputNumber, Modal, Row, Select,
  Skeleton, Switch, Tabs, Tooltip, message,
} from 'antd';
import type { FormInstance, MenuProps } from 'antd';
import {
  ArrowLeftOutlined, CalendarOutlined, CheckOutlined, ClockCircleOutlined, DeleteOutlined,
  DownOutlined, EditOutlined, EllipsisOutlined, FilePdfOutlined, MailOutlined, PhoneOutlined,
  PlusOutlined, ReloadOutlined, RightOutlined, RollbackOutlined, StopOutlined, SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { companyService } from '../services/companyService';
import {
  EmailComposer, CommunicationTimeline, DepreciationPhaseTracker, ClaimEstimatesPanel, ResolveTaskModal,
} from '../components/claim-followup';
import type { ClaimContact } from '../components/claim-followup/EmailComposer';
import {
  TASK_TYPE_OPTIONS, PAYMENT_TASK_TYPES, PAYMENT_STATUS_LABELS, PAYMENT_ISSUE_STATUSES,
  TASK_STATUS_LABELS, TASK_STATUS_TONES, getStageLabel, isTaskActive, isTaskOverdue, buildClaimProgress,
} from '../components/claim-followup/claimProgress';
import type { ProgressStep } from '../components/claim-followup/claimProgress';
import { templateValuesFromTask } from '../components/claim-followup/emailTemplates';
import { useUndoableTaskDelete } from '../components/claim-followup/useUndoableTaskDelete';
import { PageHeader, Pill, PropertyList, useSheetModal } from '../components/common/ui';
import FollowUpDateTimePicker from '../components/claim-followup/FollowUpDateTimePicker';
import { comfortTheme } from '../styles/antTheme';
import { SUPPLEMENT_STATUSES, SupplementStatusPill, formatCurrency } from '../components/supplement/supplementUi';
import type {
  FollowUpTask, FollowUpTaskCreate, FollowUpTaskUpdate, TaskStatus,
} from '../types/claimFollowUp';
import {
  KNOWN_TASK_TYPES,
  ASSIGNED_ROLE_LABELS,
  ASSIGNED_ROLE_OPTIONS,
  contactForRole,
  isSupplementTaskType,
} from '../types/claimFollowUp';

dayjs.extend(relativeTime);

const { TextArea } = Input;

/** Statuses a person sets by hand on open work; resolving goes through the Resolve form */
const OPEN_STATUS_OPTIONS: TaskStatus[] = ['pending', 'awaiting_response', 'awaiting_confirmation', 'responded'];

const WM_COST_STATUS_LABELS: Record<string, string> = {
  included_in_rebuild: 'Included in rebuild estimate',
  separate_estimate: 'Separate WM estimate',
  not_received: 'Not received — needs follow-up',
  not_applicable: 'N/A (no WM on this claim)',
};

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
];

const dateOf = (t: FollowUpTask) => t.next_followup_date || t.due_date;

/** Whole days between today and a date: negative when it has passed */
const daysFromToday = (d: Dayjs) => d.startOf('day').diff(dayjs().startOf('day'), 'day');

const relativeDue = (date: string, overdue: boolean) => {
  const days = daysFromToday(dayjs(date));
  if (overdue) {
    if (days >= 0) return 'Due today';
    return `${-days} day${days === -1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  return dayjs(date).fromNow();
};

/** Overdue first, then work that is ours by date, then work waiting on others */
const compareOpenTasks = (a: FollowUpTask, b: FollowUpTask) => {
  const rank = (t: FollowUpTask) => (isTaskOverdue(t) ? 0 : t.status === 'awaiting_confirmation' ? 2 : 1);
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  const da = dateOf(a) || '9999';
  const db = dateOf(b) || '9999';
  return da.localeCompare(db);
};

const followUpPresets = () => [
  { label: 'Tomorrow', value: dayjs().add(1, 'day') },
  { label: 'In 3 days', value: dayjs().add(3, 'day') },
  { label: 'In 1 week', value: dayjs().add(1, 'week') },
  { label: 'In 2 weeks', value: dayjs().add(2, 'week') },
];

const ClaimFollowUpDetail: React.FC = () => {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;
  const { sheetProps } = useSheetModal();
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [resolvingTask, setResolvingTask] = useState<FollowUpTask | null>(null);
  const [activeTab, setActiveTab] = useState('estimates');
  const [emailTaskId, setEmailTaskId] = useState<string | undefined>();
  const [historyTaskId, setHistoryTaskId] = useState<string | undefined>();
  const [showDone, setShowDone] = useState(false);
  const [flashTaskId, setFlashTaskId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  // Fetch tasks for this claim
  const { data: fetchedTasks = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['claim-followup-detail', claimId],
    queryFn: () => claimFollowUpService.getTasksByClaimId(claimId!),
    enabled: !!claimId,
  });

  // A deleted task stays hidden while its Undo toast is up
  const { pendingIds: deletingIds, requestDelete } = useUndoableTaskDelete(
    () => queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] }),
  );
  const tasks = useMemo(
    () => (deletingIds.size ? fetchedTasks.filter(t => !deletingIds.has(t.id)) : fetchedTasks),
    [fetchedTasks, deletingIds],
  );

  // Insurance emails lookup
  const { data: insuranceEmails = {} } = useQuery({
    queryKey: ['insurance-emails'],
    queryFn: () => companyService.getInsuranceEmails(),
    staleTime: 5 * 60 * 1000,
  });

  // Claim-level facts, merged across this claim's tasks the same way the list does
  const claimInfo = useMemo(() => {
    if (!tasks.length) return null;
    const first = tasks[0];
    const supplementStatuses: Record<string, number> = {};
    const bidEstimateSummary: Record<string, number> = {};
    let wmCostStatus = '';
    tasks.forEach(t => {
      Object.entries(t.supplement_statuses || {}).forEach(([s, c]) => { supplementStatuses[s] = c as number; });
      Object.entries(t.bid_estimate_summary || {}).forEach(([s, c]) => { bidEstimateSummary[s] = c as number; });
      if (t.wm_cost_status && !wmCostStatus) wmCostStatus = t.wm_cost_status;
    });
    return {
      property_address: first.property_address || '',
      claim_number: first.claim_number || '',
      insurance_company: first.insurance_company || '',
      pa_name: first.pa_name || '',
      pa_company: first.pa_company || '',
      pa_email: first.pa_email || '',
      pa_phone: first.pa_phone || '',
      adjuster_name: first.adjuster_name || '',
      adjuster_email: first.adjuster_email || '',
      adjuster_phone: first.adjuster_phone || '',
      expectedAmount: first.claim_expected_amount || 0,
      receivedAmount: first.claim_received_amount || 0,
      deductible: first.claim_deductible || 0,
      wmCostStatus,
      hasInsuranceEstimate: tasks.some(t => t.has_insurance_estimate),
      supplementStatuses,
      bidEstimateSummary,
    };
  }, [tasks]);

  const progress = useMemo(() => (claimInfo ? buildClaimProgress({ tasks, ...claimInfo }) : null), [tasks, claimInfo]);

  const openTasks = useMemo(() => tasks.filter(isTaskActive).sort(compareOpenTasks), [tasks]);
  const doneTasks = useMemo(
    () => tasks
      .filter(t => !isTaskActive(t))
      .sort((a, b) => (b.resolved_at || b.updated_at || '').localeCompare(a.resolved_at || a.updated_at || '')),
    [tasks],
  );
  const overdueCount = useMemo(() => openTasks.filter(isTaskOverdue).length, [openTasks]);

  // The claim's next follow-up is the top of the sorted open list
  const nextTask = useMemo(() => openTasks.find(t => !!dateOf(t)), [openTasks]);
  const nextFollowupDate = nextTask ? dateOf(nextTask)! : null;
  const nextOverdue = !!nextTask && isTaskOverdue(nextTask);

  const insEmail = claimInfo?.insurance_company ? insuranceEmails[claimInfo.insurance_company] : undefined;

  /** People the email composer offers in To/CC */
  const emailContacts = useMemo((): ClaimContact[] => {
    if (!claimInfo) return [];
    const list: ClaimContact[] = [];
    if (claimInfo.adjuster_email) {
      list.push({ name: claimInfo.adjuster_name || claimInfo.adjuster_email, email: claimInfo.adjuster_email, role: 'adjuster', label: 'Adjuster' });
    }
    if (claimInfo.pa_email) {
      list.push({ name: claimInfo.pa_name || claimInfo.pa_email, email: claimInfo.pa_email, role: 'pa', label: 'Public Adjuster' });
    }
    if (insEmail) {
      list.push({ name: claimInfo.insurance_company, email: insEmail, role: 'insurance', label: 'Insurance' });
    }
    tasks.forEach(t => {
      if (t.assigned_to_email) {
        list.push({
          name: t.assigned_to_name || t.assigned_to_email,
          email: t.assigned_to_email,
          role: t.assigned_to_role === 'public_adjuster' ? 'pa' : t.assigned_to_role === 'adjuster' ? 'adjuster' : 'other',
          label: ASSIGNED_ROLE_LABELS[t.assigned_to_role] || 'Contact',
        });
      }
    });
    return list;
  }, [claimInfo, insEmail, tasks]);

  // Every task here carries the claim's details, so the first one will do
  const templateValues = useMemo(() => templateValuesFromTask(tasks[0]), [tasks]);

  /**
   * Fill name/email/phone from the contact the chosen role points at. Every
   * task here belongs to this claim, so any one carries its enrichment.
   */
  const applyRoleContact = useCallback((form: FormInstance, role: string) => {
    const contact = contactForRole(role, tasks[0]);
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
      form.setFieldsValue({
        assigned_to_name: '', assigned_to_email: '', assigned_to_phone: '',
      });
    }
  }, [tasks]);

  const invalidateClaim = () =>
    queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: FollowUpTaskCreate) => claimFollowUpService.createTask(data),
    onSuccess: () => {
      message.success('Task created');
      setCreateModalOpen(false);
      createForm.resetFields();
      invalidateClaim();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const editMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: FollowUpTaskUpdate }) =>
      claimFollowUpService.updateTask(taskId, data),
    onSuccess: () => {
      message.success('Task updated');
      setEditModalOpen(false);
      editForm.resetFields();
      invalidateClaim();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to update task'),
  });

  // Inline changes (status, next follow-up date) from the task rows
  const quickUpdateMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: FollowUpTaskUpdate; done: string }) =>
      claimFollowUpService.updateTask(taskId, data),
    onSuccess: (_, variables) => {
      message.success(variables.done);
      invalidateClaim();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to update task'),
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => claimFollowUpService.reopenTask(taskId),
    onSuccess: () => {
      message.success('Task reopened');
      invalidateClaim();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to reopen task'),
  });

  const handleCreateSubmit = () => {
    createForm.validateFields().then(values => {
      if (values.task_type === '__custom__') {
        const customType = (values.custom_task_type || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!customType) { message.warning('Enter a custom stage name'); return; }
        values.task_type = customType;
      }
      delete values.custom_task_type;
      const payload: FollowUpTaskCreate = {
        ...values,
        claim_id: claimId!,
        next_followup_date: values.next_followup_date?.toISOString() || undefined,
      };
      createMutation.mutate(payload);
    });
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateModalOpen(true);
  };

  const openEdit = (task: FollowUpTask) => {
    setSelectedTask(task);
    const isKnown = (KNOWN_TASK_TYPES as readonly string[]).includes(task.task_type);
    editForm.setFieldsValue({
      title: task.title,
      description: task.description,
      task_type: isKnown ? task.task_type : '__custom__',
      custom_task_type: isKnown ? undefined : task.task_type,
      status: task.status,
      priority: task.priority,
      next_followup_date: task.next_followup_date ? dayjs(task.next_followup_date) : undefined,
      assigned_to_name: task.assigned_to_name,
      assigned_to_email: task.assigned_to_email,
      assigned_to_role: task.assigned_to_role,
      auto_followup_enabled: task.auto_followup_enabled,
      followup_interval_days: task.followup_interval_days,
      max_followup_count: task.max_followup_count,
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = () => {
    editForm.validateFields().then(values => {
      if (!selectedTask) return;
      if (values.task_type === '__custom__') {
        const ct = (values.custom_task_type || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!ct) { message.warning('Enter a custom stage name'); return; }
        values.task_type = ct;
      }
      delete values.custom_task_type;
      const data: FollowUpTaskUpdate = {
        ...values,
        next_followup_date: values.next_followup_date ? (values.next_followup_date as Dayjs).toISOString() : undefined,
      };
      if (!data.next_followup_date) delete data.next_followup_date;
      editMutation.mutate({ taskId: selectedTask.id, data });
    });
  };

  const scrollToWorkspace = () => {
    requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openEmail = (taskId?: string) => {
    setEmailTaskId(taskId);
    setActiveTab('email');
    scrollToWorkspace();
  };

  const openHistory = (taskId?: string) => {
    setHistoryTaskId(taskId);
    setActiveTab('history');
    scrollToWorkspace();
  };

  /** Stage track click: bring that stage's task into view */
  const focusTask = (task: FollowUpTask) => {
    if (!isTaskActive(task)) setShowDone(true);
    setFlashTaskId(task.id);
    requestAnimationFrame(() => {
      document.getElementById(`fu-task-${task.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  useEffect(() => {
    if (!flashTaskId) return;
    const t = window.setTimeout(() => setFlashTaskId(null), 1600);
    return () => window.clearTimeout(t);
  }, [flashTaskId]);

  const setFollowUpDate = (task: FollowUpTask, value: Dayjs | null) => {
    if (!value) return;
    const prev = task.next_followup_date ? dayjs(task.next_followup_date) : null;
    // A date picker sets the day; keep the time the reminder already had
    const next = value.hour(prev ? prev.hour() : 9).minute(prev ? prev.minute() : 0).second(0);
    quickUpdateMutation.mutate({
      taskId: task.id,
      data: { next_followup_date: next.toISOString() },
      done: `Next follow-up set to ${next.format('MMM D')}`,
    });
  };

  const confirmCancel = (task: FollowUpTask) => Modal.confirm({
    title: 'Cancel this task?',
    content: `"${task.title}" moves to Done. You can reopen it from there.`,
    okText: 'Cancel task',
    cancelText: 'Keep',
    onOk: () => quickUpdateMutation.mutateAsync({ taskId: task.id, data: { status: 'cancelled' }, done: 'Task cancelled' }),
  });

  const confirmDelete = (task: FollowUpTask) => Modal.confirm({
    title: 'Delete this task?',
    content: `"${task.title}" and its follow-up schedule will be removed.`,
    okText: 'Delete',
    okButtonProps: { danger: true },
    onOk: () => requestDelete(task.id),
  });

  // ── Renderers ──

  const renderStatusControl = (task: FollowUpTask) => {
    const items: MenuProps['items'] = OPEN_STATUS_OPTIONS.map(s => ({
      key: s,
      label: (
        <span className="fu-status-option">
          <Pill tone={TASK_STATUS_TONES[s]}>{TASK_STATUS_LABELS[s]}</Pill>
          {s === task.status && <CheckOutlined aria-hidden="true" />}
        </span>
      ),
    }));
    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items,
          selectedKeys: [task.status],
          onClick: ({ key }) => {
            if (key === task.status) return;
            quickUpdateMutation.mutate({
              taskId: task.id,
              data: { status: key as TaskStatus },
              done: `Status set to ${TASK_STATUS_LABELS[key].toLowerCase()}`,
            });
          },
        }}
      >
        <button type="button" className="fu-status-trigger" aria-label={`Status: ${TASK_STATUS_LABELS[task.status]}. Change status`}>
          <Pill tone={TASK_STATUS_TONES[task.status] || 'gray'}>{TASK_STATUS_LABELS[task.status] || task.status}</Pill>
          <DownOutlined className="fu-status-caret" aria-hidden="true" />
        </button>
      </Dropdown>
    );
  };

  const renderTaskMeta = (task: FollowUpTask) => {
    const roleLabel = ASSIGNED_ROLE_LABELS[task.assigned_to_role] || task.assigned_to_role;
    const isPayment = PAYMENT_TASK_TYPES.includes(task.task_type);
    return (
      <div className="fu-task-meta">
        {/* Who it is with */}
        <div className="fu-task-meta-line">
          <UserOutlined className="fu-task-meta-icon" aria-hidden="true" />
          {task.assigned_to_name ? (
            <span>
              <span className="fu-task-person">{task.assigned_to_name}</span>
              {roleLabel && <span className="fu-muted"> · {roleLabel}</span>}
            </span>
          ) : (
            <span className="fu-muted">Not assigned</span>
          )}
          {task.assigned_to_email && (
            <a href={`mailto:${task.assigned_to_email}`} className="fu-task-email">{task.assigned_to_email}</a>
          )}
        </div>
        {/* What has happened so far */}
        <div className="fu-task-meta-line">
          {task.auto_followup_enabled && isTaskActive(task)
            ? <SyncOutlined className="fu-task-meta-icon" aria-hidden="true" />
            : <MailOutlined className="fu-task-meta-icon" aria-hidden="true" />}
          {task.contact_count > 0 ? (
            <button type="button" className="fu-link-btn" onClick={() => openHistory(task.id)}>
              Contacted {task.contact_count}×
              {task.last_contacted_at && ` · last ${dayjs(task.last_contacted_at).format('MMM D')}`}
            </button>
          ) : (
            <span className="fu-muted">Not contacted yet</span>
          )}
          {task.auto_followup_enabled && isTaskActive(task) && (
            <span className="fu-muted">
              Auto every {task.followup_interval_days} day{task.followup_interval_days === 1 ? '' : 's'}
              {' '}· {Math.min(task.contact_count, task.max_followup_count)} of {task.max_followup_count}
            </span>
          )}
        </div>
        {isPayment && task.payment_status && (
          <div className="fu-task-meta-line">
            <span className="fu-muted">Payment</span>
            <Pill tone={PAYMENT_ISSUE_STATUSES.includes(task.payment_status) ? 'orange' : task.payment_status === 'received' ? 'green' : 'gray'}>
              {PAYMENT_STATUS_LABELS[task.payment_status] || task.payment_status}
            </Pill>
            {task.payment_note && <span className="fu-muted">{task.payment_note}</span>}
          </div>
        )}
      </div>
    );
  };

  const renderOpenTask = (task: FollowUpTask) => {
    const overdue = isTaskOverdue(task);
    const date = dateOf(task);
    const moreItems: MenuProps['items'] = [
      { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => openEdit(task) },
      { key: 'cancel', icon: <StopOutlined />, label: 'Cancel task', onClick: () => confirmCancel(task) },
      { type: 'divider' },
      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true, onClick: () => confirmDelete(task) },
    ];
    const isHighPriority = task.priority === 'high' || task.priority === 'urgent';
    return (
      <article
        key={task.id}
        id={`fu-task-${task.id}`}
        className={`fu-task${overdue ? ' is-overdue' : ''}${flashTaskId === task.id ? ' is-flash' : ''}`}
      >
        <div className="fu-task-main">
          <div className="fu-task-top">
            {renderStatusControl(task)}
            <span className="fu-task-stage">{getStageLabel(task.task_type)}</span>
            {isHighPriority && (
              <Pill tone={task.priority === 'urgent' ? 'red' : 'orange'}>
                {task.priority === 'urgent' ? 'Urgent' : 'High priority'}
              </Pill>
            )}
          </div>
          <h3 className="fu-task-title">{task.title}</h3>
          {task.description && <p className="fu-task-desc">{task.description}</p>}
          {renderTaskMeta(task)}
        </div>

        <div className="fu-task-side">
          <div className="fu-task-due">
            <span className="fu-task-due-label">Next follow-up</span>
            <div className="fu-task-due-value">
              <DatePicker
                value={date ? dayjs(date) : null}
                onChange={(v) => setFollowUpDate(task, v)}
                presets={followUpPresets()}
                format="MMM D, YYYY"
                allowClear={false}
                inputReadOnly
                variant="borderless"
                placeholder="Set date"
                suffixIcon={<CalendarOutlined />}
                className="fu-date"
                aria-label={`Next follow-up date for ${task.title}`}
              />
              {date && (
                <span className={`fu-task-due-rel${overdue ? ' is-overdue' : ''}`}>
                  {overdue && <ClockCircleOutlined aria-hidden="true" />}
                  {relativeDue(date, overdue)}
                </span>
              )}
            </div>
          </div>
          <div className="fu-task-actions">
            <Button icon={<MailOutlined />} onClick={() => openEmail(task.id)}>Email</Button>
            <Button icon={<CheckOutlined />} onClick={() => setResolvingTask(task)}>Resolve</Button>
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button type="text" className="ui-icon-btn" icon={<EllipsisOutlined />} aria-label={`More actions for ${task.title}`} />
            </Dropdown>
          </div>
        </div>
      </article>
    );
  };

  const renderDoneTask = (task: FollowUpTask) => {
    const isResolved = task.status === 'resolved';
    const canReopen = isResolved || task.status === 'cancelled';
    const moreItems: MenuProps['items'] = [
      { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => openEdit(task) },
      { type: 'divider' },
      { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true, onClick: () => confirmDelete(task) },
    ];
    const when = task.resolved_at || task.updated_at;
    return (
      <article
        key={task.id}
        id={`fu-task-${task.id}`}
        className={`fu-task fu-task--done${flashTaskId === task.id ? ' is-flash' : ''}`}
      >
        <div className="fu-task-main">
          <div className="fu-task-top">
            <Pill tone={TASK_STATUS_TONES[task.status] || 'gray'} icon={isResolved ? <CheckOutlined /> : undefined}>
              {TASK_STATUS_LABELS[task.status] || task.status}
            </Pill>
            <span className="fu-task-stage">{getStageLabel(task.task_type)}</span>
            {when && <span className="fu-muted">{dayjs(when).format('MMM D, YYYY')}</span>}
          </div>
          <h3 className="fu-task-title">{task.title}</h3>
          {task.resolution_notes && <p className="fu-task-desc">{task.resolution_notes}</p>}
          {PAYMENT_TASK_TYPES.includes(task.task_type) && task.payment_status && (
            <div className="fu-task-meta">
              <div className="fu-task-meta-line">
                <span className="fu-muted">Payment</span>
                <Pill tone={task.payment_status === 'received' ? 'green' : PAYMENT_ISSUE_STATUSES.includes(task.payment_status) ? 'orange' : 'gray'}>
                  {PAYMENT_STATUS_LABELS[task.payment_status] || task.payment_status}
                </Pill>
                {task.payment_note && <span className="fu-muted">{task.payment_note}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="fu-task-side">
          <div className="fu-task-actions">
            {canReopen && (
              <Button icon={<RollbackOutlined />} loading={reopenMutation.isPending && reopenMutation.variables === task.id}
                onClick={() => reopenMutation.mutate(task.id)}>
                Reopen
              </Button>
            )}
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <Button type="text" className="ui-icon-btn" icon={<EllipsisOutlined />} aria-label={`More actions for ${task.title}`} />
            </Dropdown>
          </div>
        </div>
      </article>
    );
  };

  const stepTaskFor = (step: ProgressStep) => step.activeTask || step.resolvedTask;

  const renderStep = (step: ProgressStep, variant: 'track' | 'extra') => {
    const task = stepTaskFor(step);
    const tip = [step.title, step.note].filter(Boolean).join(' — ');
    const content = variant === 'track' ? (
      <>
        <span className="fu-step-bar" aria-hidden="true" />
        <span className="fu-step-label">{isMobile ? step.shortLabel : step.label}</span>
        <span className="fu-step-detail">{step.detail || (step.state === 'none' ? 'Not reached' : '')}</span>
      </>
    ) : (
      <>
        <span className="fu-step-label">{step.label}</span>
        {step.detail && <span className="fu-step-detail">{step.detail}</span>}
      </>
    );
    const className = `fu-step fu-step--${variant} fu-step--${step.state}`;
    return (
      <Tooltip key={step.key} title={task ? `${tip} — show task` : tip}>
        {task ? (
          <button type="button" className={className} onClick={() => focusTask(task)}>{content}</button>
        ) : (
          <span className={className}>{content}</span>
        )}
      </Tooltip>
    );
  };

  const renderTrack = () => {
    if (!progress) return null;
    return (
      <nav className="fu-track-wrap" aria-label="Claim stages">
        <div className="fu-track">
          {progress.track.map(step => renderStep(step, 'track'))}
        </div>
        {progress.extras.length > 0 && (
          <div className="fu-track-extras">
            {progress.extras.map(step => renderStep(step, 'extra'))}
          </div>
        )}
      </nav>
    );
  };

  const renderContact = (label: string, name: string, company: string, email: string, phone: string) => (
    <div className="fu-contact">
      <span className="fu-contact-role">{label}</span>
      <span className="fu-contact-name">{name || email}</span>
      {company && <span className="fu-muted">{company}</span>}
      {email && (
        <a href={`mailto:${email}`} className="fu-contact-line">
          <MailOutlined aria-hidden="true" /> {email}
        </a>
      )}
      {phone && (
        <a href={`tel:${phone}`} className="fu-contact-line">
          <PhoneOutlined aria-hidden="true" /> {phone}
        </a>
      )}
    </div>
  );

  const taskOptions = useMemo(() => {
    const toOption = (t: FollowUpTask) => ({ value: t.id, label: `${getStageLabel(t.task_type)} — ${t.title}` });
    return [
      ...(openTasks.length ? [{ label: 'Open tasks', options: openTasks.map(toOption) }] : []),
      ...(doneTasks.length ? [{ label: 'Done', options: doneTasks.map(toOption) }] : []),
    ];
  }, [openTasks, doneTasks]);

  const emailTask = tasks.find(t => t.id === emailTaskId);

  // ── Page ──

  if (isError) {
    return (
      <div className="fu-error">
        <h1 className="ui-section-title">Couldn't load this claim's follow-ups.</h1>
        <p>Check your connection and try again.</p>
        <Button onClick={() => refetch()} icon={<ReloadOutlined />}>Try again</Button>
      </div>
    );
  }

  const supplementEntries = claimInfo
    ? SUPPLEMENT_STATUSES.filter(s => (claimInfo.supplementStatuses[s] || 0) > 0)
    : [];

  return (
    <div className="fu-page">
      <PageHeader
        leading={
          <Tooltip title="Back to follow-ups">
            <Button type="text" className="ui-icon-btn" icon={<ArrowLeftOutlined />}
              aria-label="Back to follow-ups" onClick={() => navigate('/claim-followup')} />
          </Tooltip>
        }
        title={isLoading
          ? <span className="fu-title-skeleton" role="status" aria-label="Loading claim" />
          : (claimInfo?.property_address || 'Claim follow-up')}
        meta={claimInfo && (
          <>
            {overdueCount > 0 && <Pill tone="red" icon={<ClockCircleOutlined />}>{overdueCount} overdue</Pill>}
            {claimInfo.insurance_company && <span>{claimInfo.insurance_company}</span>}
            {claimInfo.claim_number && <span>Claim #{claimInfo.claim_number}</span>}
            {claimInfo.pa_name && <span>PA: {claimInfo.pa_name}</span>}
          </>
        )}
        actions={
          <>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined spin={isFetching && !isLoading} />} aria-label="Refresh" onClick={() => refetch()} />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add Stage</Button>
          </>
        }
      />

      {renderTrack()}

      <Row gutter={isMobile ? [0, 32] : [48, 32]}>
        <Col xs={24} lg={16}>
          {/* Tasks */}
          <section className="ui-section" aria-labelledby="fu-tasks-title">
            <div className="ui-section-head">
              <h2 className="ui-section-title" id="fu-tasks-title">
                Open tasks
                {!isLoading && <span className="fu-count">{openTasks.length}</span>}
              </h2>
            </div>

            {isLoading ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : openTasks.length === 0 ? (
              <div className="fu-empty-block">
                <p>
                  {tasks.length === 0
                    ? 'This claim has no follow-up stages yet. Add the first one to start tracking it.'
                    : 'Nothing open on this claim. Add a stage when the next follow-up starts.'}
                </p>
                <Button icon={<PlusOutlined />} onClick={openCreate}>Add Stage</Button>
              </div>
            ) : (
              <div className="fu-task-list">{openTasks.map(renderOpenTask)}</div>
            )}

            {doneTasks.length > 0 && (
              <div className="fu-done">
                <button
                  type="button"
                  className="fu-done-toggle"
                  aria-expanded={showDone}
                  onClick={() => setShowDone(v => !v)}
                >
                  {showDone ? <DownOutlined aria-hidden="true" /> : <RightOutlined aria-hidden="true" />}
                  Done
                  <span className="fu-count">{doneTasks.length}</span>
                </button>
                {showDone && <div className="fu-task-list">{doneTasks.map(renderDoneTask)}</div>}
              </div>
            )}
          </section>

          {/* Depreciation Recovery Phase Tracker */}
          {tasks.filter(t => t.task_type === 'depreciation_recovery' && t.status !== 'cancelled').map(depTask => (
            <section key={depTask.id} className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">Depreciation recovery</h2>
                <span className="fu-muted">{depTask.title}</span>
              </div>
              <DepreciationPhaseTracker task={depTask} onUpdated={() => refetch()} />
            </section>
          ))}

          {/* Estimates / Email / History */}
          <section className="ui-section fu-workspace" ref={workspaceRef} aria-label="Estimates and email">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'estimates',
                  label: <span><FilePdfOutlined /> Estimates</span>,
                  children: claimId ? <ClaimEstimatesPanel claimId={claimId} /> : null,
                },
                {
                  key: 'email',
                  label: <span><MailOutlined /> {isMobile ? 'Email' : 'Send Email'}</span>,
                  children: claimId ? (
                    <div className="fu-tab-body">
                      <EmailComposer
                        key={emailTaskId || 'claim'}
                        claimId={claimId}
                        followupTaskId={emailTaskId}
                        taskType={emailTask?.task_type}
                        wmJobId={emailTask?.wm_job_id}
                        contactCount={emailTask?.contact_count || 0}
                        contacts={emailContacts}
                        templateValues={templateValues}
                        regarding={
                          <div className="fu-regarding">
                            <Select
                              variant="borderless"
                              value={emailTaskId ?? '__claim__'}
                              onChange={(v) => setEmailTaskId(v === '__claim__' ? undefined : v)}
                              options={[{ value: '__claim__', label: 'This claim (no specific task)' }, ...taskOptions]}
                              style={{ width: '100%' }}
                              aria-label="Task this email is about"
                            />
                            {emailTaskId && (
                              <span className="fu-regarding-hint">
                                Sending marks this task contacted and moves its next follow-up date.
                              </span>
                            )}
                          </div>
                        }
                        defaultTo={emailTask?.assigned_to_email || tasks[0]?.assigned_to_email || ''}
                        onSent={() => {
                          invalidateClaim();
                          queryClient.invalidateQueries({ queryKey: ['communications'] });
                          queryClient.invalidateQueries({ queryKey: ['sent-emails'] });
                          openHistory(emailTaskId);
                        }}
                        onCancel={() => { setEmailTaskId(undefined); setActiveTab('estimates'); }}
                      />
                    </div>
                  ) : null,
                },
                {
                  key: 'history',
                  label: <span><ClockCircleOutlined /> {isMobile ? 'History' : 'Communication History'}</span>,
                  children: claimId ? (
                    <div className="fu-tab-body">
                      <label className="fu-history-filter">
                        <span className="fu-field-label">Show</span>
                        <Select
                          value={historyTaskId ?? '__all__'}
                          onChange={(v) => setHistoryTaskId(v === '__all__' ? undefined : v)}
                          options={[{ value: '__all__', label: 'Everything on this claim' }, ...taskOptions]}
                          style={{ width: '100%' }}
                          aria-label="Filter history by task"
                        />
                      </label>
                      <CommunicationTimeline claimId={claimId} taskId={historyTaskId} />
                    </div>
                  ) : null,
                },
              ]}
            />
          </section>
        </Col>

        <Col xs={24} lg={8}>
          {/* Claim facts */}
          <section className="ui-section">
            <div className="ui-section-head">
              <h2 className="ui-section-title">Claim</h2>
            </div>
            {isLoading ? (
              <Skeleton active title={false} paragraph={{ rows: 5 }} />
            ) : (
              <PropertyList
                labelWidth={120}
                items={[
                  { key: 'claim', label: 'Claim #', value: claimInfo?.claim_number },
                  {
                    key: 'insurance',
                    label: 'Insurance',
                    value: claimInfo?.insurance_company ? (
                      <span className="fu-stack">
                        <span>{claimInfo.insurance_company}</span>
                        {insEmail && <a href={`mailto:${insEmail}`} className="fu-contact-line">{insEmail}</a>}
                      </span>
                    ) : null,
                  },
                  {
                    key: 'next',
                    label: 'Next follow-up',
                    value: nextFollowupDate ? (
                      <span className={nextOverdue ? 'fu-overdue-text' : undefined}>
                        {dayjs(nextFollowupDate).format('MMM D, YYYY')}
                        <span className="fu-muted"> · {relativeDue(nextFollowupDate, nextOverdue)}</span>
                      </span>
                    ) : null,
                  },
                  {
                    key: 'received',
                    label: 'Received',
                    value: claimInfo && (claimInfo.expectedAmount || claimInfo.receivedAmount) ? (
                      <span className="fu-money">
                        <strong>{formatCurrency(claimInfo.receivedAmount)}</strong>
                        {claimInfo.expectedAmount > 0 && (
                          <span className="fu-muted"> of {formatCurrency(claimInfo.expectedAmount)} expected</span>
                        )}
                      </span>
                    ) : null,
                  },
                  {
                    key: 'deductible',
                    label: 'Deductible',
                    hideEmpty: true,
                    value: claimInfo?.deductible ? <span className="fu-money">{formatCurrency(claimInfo.deductible)}</span> : null,
                  },
                  {
                    key: 'estimate',
                    label: 'Ins. estimate',
                    value: claimInfo ? (claimInfo.hasInsuranceEstimate ? 'Received' : 'Not received yet') : null,
                  },
                  {
                    key: 'wm',
                    label: 'WM costs',
                    hideEmpty: true,
                    value: claimInfo?.wmCostStatus ? (WM_COST_STATUS_LABELS[claimInfo.wmCostStatus] || claimInfo.wmCostStatus) : null,
                  },
                ]}
              />
            )}
          </section>

          {/* Contacts */}
          {claimInfo && (
            <section className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">Contacts</h2>
              </div>
              {claimInfo.adjuster_name || claimInfo.adjuster_email || claimInfo.pa_name || claimInfo.pa_email ? (
                <div className="fu-contacts">
                  {(claimInfo.adjuster_name || claimInfo.adjuster_email) && renderContact(
                    'Adjuster', claimInfo.adjuster_name, '', claimInfo.adjuster_email, claimInfo.adjuster_phone,
                  )}
                  {(claimInfo.pa_name || claimInfo.pa_email) && renderContact(
                    'Public Adjuster', claimInfo.pa_name, claimInfo.pa_company, claimInfo.pa_email, claimInfo.pa_phone,
                  )}
                </div>
              ) : (
                <p className="fu-empty">No adjuster or public adjuster on file for this claim.</p>
              )}
            </section>
          )}

          {/* Supplement status */}
          {supplementEntries.length > 0 && claimInfo && (
            <section className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">Supplements</h2>
                <Button type="text" size="small" className="ui-icon-btn" onClick={() => navigate('/supplements')}>
                  Open list
                </Button>
              </div>
              <ul className="fu-sup-summary">
                {supplementEntries.map(s => (
                  <li key={s}>
                    <SupplementStatusPill status={s} />
                    <span className="fu-count">{claimInfo.supplementStatuses[s]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Col>
      </Row>

      <ResolveTaskModal task={resolvingTask} onClose={() => setResolvingTask(null)} />

      {/* Create Task Modal */}
      <Modal title="Add Stage" open={createModalOpen} onOk={handleCreateSubmit}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createMutation.isPending} width={600} forceRender {...sheetProps}>
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Task Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} placeholder="Select type"
                  onChange={(value) => {
                    createForm.setFieldValue('custom_task_type', undefined);
                    // Supplements are negotiated with the PA — assign it.
                    if (isSupplementTaskType(value)) {
                      createForm.setFieldValue('assigned_to_role', 'public_adjuster');
                      applyRoleContact(createForm, 'public_adjuster');
                    }
                  }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="priority" label="Priority" initialValue="normal">
                <Select options={PRIORITY_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.task_type !== cur.task_type}>
            {({ getFieldValue }) => getFieldValue('task_type') === '__custom__' && (
              <Form.Item name="custom_task_type" label="Custom Stage Name"
                rules={[{ required: true, message: 'Enter a custom stage name' }]}>
                <Input placeholder="e.g., Check with PA, Talk to homeowner" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Follow up on documents sent" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} placeholder="Optional details" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="next_followup_date" label="First Follow-up Date">
                <FollowUpDateTimePicker placeholder="Default: 3 days" presets={followUpPresets()} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_role" label="Assigned Role" initialValue="adjuster">
                <Select
                  options={ASSIGNED_ROLE_OPTIONS}
                  onChange={(role) => applyRoleContact(createForm, role)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_name" label="Assigned To Name">
                <Input placeholder="Name" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_email" label="Assigned To Email">
                <Input placeholder="email@example.com" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal title={`Edit: ${selectedTask?.title || ''}`} open={editModalOpen}
        onOk={handleEditSubmit}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={editMutation.isPending} width={600} forceRender {...sheetProps}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} placeholder="Optional details" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS}
                  onChange={() => editForm.setFieldValue('custom_task_type', undefined)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="Status">
                <Select options={[
                  { value: 'pending', label: 'Pending' }, { value: 'awaiting_response', label: 'Awaiting Response' },
                  { value: 'awaiting_confirmation', label: 'Awaiting Confirmation' },
                  { value: 'responded', label: 'Responded' }, { value: 'resolved', label: 'Resolved' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.task_type !== cur.task_type}>
            {({ getFieldValue }) => getFieldValue('task_type') === '__custom__' && (
              <Form.Item name="custom_task_type" label="Custom Stage Name"
                rules={[{ required: true, message: 'Enter a custom stage name' }]}>
                <Input placeholder="e.g., Check with PA" />
              </Form.Item>
            )}
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="priority" label="Priority">
                <Select options={PRIORITY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="next_followup_date" label="Next Follow-up">
                <FollowUpDateTimePicker presets={followUpPresets()} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="assigned_to_role" label="Assigned Role">
                <Select
                  options={ASSIGNED_ROLE_OPTIONS}
                  onChange={(role) => applyRoleContact(editForm, role)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="assigned_to_name" label="Name"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="assigned_to_email" label="Email"><Input /></Form.Item>
            </Col>
          </Row>
          <Form.Item name="auto_followup_enabled" label="Auto Follow-up" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.auto_followup_enabled !== cur.auto_followup_enabled}>
            {({ getFieldValue }) => getFieldValue('auto_followup_enabled') && (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="followup_interval_days" label="Interval (days)">
                    <InputNumber min={1} max={90} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="max_followup_count" label="Max follow-ups">
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

/** The page is read on phones in the field, so it runs one step up the type scale */
const ClaimFollowUpDetailPage: React.FC = () => (
  <ConfigProvider theme={comfortTheme}>
    <ClaimFollowUpDetail />
  </ConfigProvider>
);

export default ClaimFollowUpDetailPage;
