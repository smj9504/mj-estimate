import React, { useState, useMemo } from 'react';
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
  Badge,
  Dropdown,
  Collapse,
  Progress,
  Upload,
} from 'antd';
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
  EnvironmentOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import type {
  FollowUpTask,
  FollowUpTaskCreate,
  FollowUpTaskUpdate,
  TaskType,
  TaskStatus,
  TaskPriority,
} from '../types/claimFollowUp';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { TextArea } = Input;

const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'wm_docs_sent', label: 'WM Docs (Invoice/COS/EWA/Photo)' },
  { value: 'supplement_sent', label: 'Supplement Sent' },
  { value: 'depreciation_recovery', label: 'Depreciation Recovery Docs' },
  { value: 'estimate_request', label: 'Estimate Request' },
  { value: 'payment_check', label: 'Payment Check' },
  { value: 'docs_sent', label: 'Other Documents' },
  { value: 'general', label: 'General' },
];

const TASK_TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  wm_docs_sent: <SendOutlined />,
  supplement_sent: <FileTextOutlined />,
  depreciation_recovery: <DollarOutlined />,
  estimate_request: <AuditOutlined />,
  payment_check: <DollarOutlined />,
  docs_sent: <FileTextOutlined />,
  general: <ClockCircleOutlined />,
};

// Ordered stages for the pipeline view
const STAGE_ORDER: TaskType[] = [
  'wm_docs_sent',
  'estimate_request',
  'supplement_sent',
  'payment_check',
  'depreciation_recovery',
  'docs_sent',
  'general',
];

const STAGE_LABELS: Record<TaskType, string> = {
  wm_docs_sent: 'WM Docs',
  estimate_request: 'Est. Request',
  supplement_sent: 'Supplement',
  payment_check: 'Payment',
  depreciation_recovery: 'Depreciation',
  docs_sent: 'Other Docs',
  general: 'General',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue',
  awaiting_response: 'orange',
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

interface ClaimGroup {
  claim_id: string;
  property_address: string;
  claim_number: string;
  insurance_company: string;
  tasks: FollowUpTask[];
  activeStages: Set<TaskType>;
  currentStage: TaskType | null;
  hasOverdue: boolean;
  nextFollowupDate: string | null;
  supplementStatuses: Record<string, number>;
}

const ClaimFollowUpDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState<string | undefined>();
  const [resolveFile, setResolveFile] = useState<File | undefined>();
  const [parsedSections, setParsedSections] = useState<any[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resolveForm] = Form.useForm();

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['followup-stats'],
    queryFn: () => claimFollowUpService.getDashboardStats(),
  });

  const { data: tasks = [], isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['followup-tasks', statusFilter, typeFilter],
    queryFn: () => claimFollowUpService.getTasks({
      status: statusFilter,
      task_type: typeFilter,
      page_size: 100,
      sort_by: 'next_followup_date',
      sort_order: 'asc',
    }),
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
          currentStage: null,
          hasOverdue: false,
          nextFollowupDate: null,
          supplementStatuses: {},
        });
      }
      const group = groupMap.get(key)!;
      group.tasks.push(task);

      // Merge supplement statuses from task
      if (task.supplement_statuses) {
        Object.entries(task.supplement_statuses).forEach(([status, count]) => {
          group.supplementStatuses[status] = count;
        });
      }

      // Track active (non-resolved) stages
      if (!['resolved', 'cancelled'].includes(task.status)) {
        group.activeStages.add(task.task_type);
      }

      // Check overdue
      const date = task.next_followup_date || task.due_date;
      if (date && dayjs(date).isBefore(dayjs()) && ['pending', 'awaiting_response'].includes(task.status)) {
        group.hasOverdue = true;
      }

      // Track earliest next followup
      if (date && !['resolved', 'cancelled'].includes(task.status)) {
        if (!group.nextFollowupDate || dayjs(date).isBefore(dayjs(group.nextFollowupDate))) {
          group.nextFollowupDate = date;
        }
      }
    });

    // Determine current stage for each group (latest active stage in order)
    groupMap.forEach((group) => {
      for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
        if (group.activeStages.has(STAGE_ORDER[i])) {
          group.currentStage = STAGE_ORDER[i];
          break;
        }
      }
    });

    // Sort: overdue first, then by nextFollowupDate
    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.hasOverdue && !b.hasOverdue) return -1;
      if (!a.hasOverdue && b.hasOverdue) return 1;
      if (!a.nextFollowupDate) return 1;
      if (!b.nextFollowupDate) return -1;
      return dayjs(a.nextFollowupDate).unix() - dayjs(b.nextFollowupDate).unix();
    });
  }, [tasks]);

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

  const resolveMutation = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: any }) =>
      claimFollowUpService.resolveTask(taskId, body),
    onSuccess: (_, variables) => {
      const outcome = variables.body?.outcome;
      if (outcome === 'estimate_received') {
        message.success('Task resolved - Insurance estimate received. Rebuild project created.');
      } else if (outcome === 'denied') {
        message.warning('Task resolved - Claim denied.');
      } else {
        message.success('Task resolved');
      }
      setResolveModalOpen(false);
      setResolveOutcome(undefined);
      setResolveFile(undefined);
      resolveForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['followup-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['followup-stats'] });
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
    const totalAcv = totalRcv - totalDep;
    resolveForm.setFieldsValue({
      rcv_amount: Math.round(totalRcv * 100) / 100,
      acv_amount: Math.round(totalAcv * 100) / 100,
      depreciation_amount: Math.round(totalDep * 100) / 100,
    });
  };

  const isOverdue = (task: FollowUpTask) => {
    const date = task.next_followup_date || task.due_date;
    if (!date) return false;
    return dayjs(date).isBefore(dayjs()) &&
      ['pending', 'awaiting_response'].includes(task.status);
  };

  // Columns for expanded task table (within each claim group)
  const taskColumns: ColumnsType<FollowUpTask> = [
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
      render: (status: string, record) => {
        const displayStatus = isOverdue(record) ? 'overdue' : status;
        return (
          <Tag color={STATUS_COLORS[displayStatus] || 'default'}>
            {displayStatus.replace('_', ' ').toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      render: (priority: string) => (
        <Tag color={PRIORITY_TAG_COLORS[priority] || 'default'}>
          {priority.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Next Follow-up',
      key: 'next_followup_date',
      width: 130,
      render: (_, record) => {
        if (record.status === 'resolved') return <Text type="success">Resolved</Text>;
        const date = record.next_followup_date || record.due_date;
        if (!date) return <Text type="secondary">-</Text>;
        const d = dayjs(date);
        const overdue = isOverdue(record);
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
      render: (_, record) => {
        if (!record.assigned_to_name) return <Text type="secondary">-</Text>;
        return (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>{record.assigned_to_name}</Text>
            {record.assigned_to_role && (
              <Tag style={{ fontSize: 10, margin: 0 }}>
                {record.assigned_to_role === 'public_adjuster' ? 'PA' : record.assigned_to_role}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Contacts',
      dataIndex: 'contact_count',
      key: 'contact_count',
      width: 80,
      align: 'center',
      render: (count: number) => (
        <Badge count={count} showZero style={{ backgroundColor: count > 0 ? '#52c41a' : '#d9d9d9' }} />
      ),
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
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'email',
                icon: <MailOutlined />,
                label: 'Send Email',
                onClick: () => navigate(`/claim-followup/${record.id}/email`),
              },
              {
                key: 'resolve',
                icon: <CheckCircleOutlined />,
                label: 'Resolve',
                disabled: record.status === 'resolved',
                onClick: () => {
                  setSelectedTask(record);
                  setResolveModalOpen(true);
                },
              },
              {
                key: 'reopen',
                icon: <ClockCircleOutlined />,
                label: 'Reopen',
                disabled: record.status !== 'resolved',
                onClick: () => reopenMutation.mutate(record.id),
              },
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => {
                  setSelectedTask(record);
                  editForm.setFieldsValue({
                    title: record.title,
                    task_type: record.task_type,
                    status: record.status,
                    priority: record.priority,
                    assigned_to_name: record.assigned_to_name,
                    assigned_to_email: record.assigned_to_email,
                    assigned_to_phone: record.assigned_to_phone,
                    assigned_to_role: record.assigned_to_role,
                    auto_followup_enabled: record.auto_followup_enabled,
                    followup_interval_days: record.followup_interval_days,
                    max_followup_count: record.max_followup_count,
                  });
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
                    onOk: () => deleteMutation.mutate(record.id),
                  });
                },
              },
            ],
          }}
        >
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  const handleCreateSubmit = () => {
    createForm.validateFields().then(values => {
      const payload: FollowUpTaskCreate = {
        ...values,
        next_followup_date: values.next_followup_date?.toISOString() || undefined,
      };
      createMutation.mutate(payload);
    });
  };

  // Stage pipeline indicator for a claim group
  const renderStagePipeline = (group: ClaimGroup) => {
    const resolvedTypes = new Set(
      group.tasks.filter(t => t.status === 'resolved').map(t => t.task_type)
    );
    const activeTypes = group.activeStages;

    // Only show stages that this claim actually has tasks for
    const relevantStages = STAGE_ORDER.filter(
      stage => resolvedTypes.has(stage) || activeTypes.has(stage)
    );

    if (relevantStages.length === 0) return null;

    return (
      <Space size={4} wrap>
        {relevantStages.map((stage, idx) => {
          const isResolved = resolvedTypes.has(stage);
          const isActive = activeTypes.has(stage);
          const stageTask = group.tasks.find(t => t.task_type === stage && !['resolved', 'cancelled'].includes(t.status));
          const isStageOverdue = stageTask ? isOverdue(stageTask) : false;

          let color = '#d9d9d9'; // not reached
          let textColor = '#999';
          if (isResolved && !isActive) {
            color = '#52c41a'; // completed
            textColor = '#fff';
          } else if (isStageOverdue) {
            color = '#ff4d4f'; // overdue
            textColor = '#fff';
          } else if (isActive) {
            color = '#1890ff'; // active
            textColor = '#fff';
          }

          return (
            <React.Fragment key={stage}>
              {idx > 0 && <RightOutlined style={{ fontSize: 10, color: '#d9d9d9' }} />}
              <Tag
                style={{
                  backgroundColor: color,
                  color: textColor,
                  border: 'none',
                  fontSize: 11,
                  margin: 0,
                  whiteSpace: 'nowrap',
                  lineHeight: '20px',
                }}
              >
                {STAGE_LABELS[stage]}
              </Tag>
            </React.Fragment>
          );
        })}
      </Space>
    );
  };

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Claim Follow-up</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetchTasks()}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            New Task
          </Button>
        </Space>
      </div>

      {/* Stats Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="Pending"
              value={stats?.pending || 0}
              prefix={<ClockCircleOutlined style={{ color: '#1890ff' }} />}
              loading={statsLoading}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="Awaiting Response"
              value={stats?.awaiting_response || 0}
              prefix={<MailOutlined style={{ color: '#fa8c16' }} />}
              loading={statsLoading}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="Overdue"
              value={stats?.overdue || 0}
              valueStyle={{ color: (stats?.overdue || 0) > 0 ? '#cf1322' : undefined }}
              prefix={<AlertOutlined style={{ color: '#cf1322' }} />}
              loading={statsLoading}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="Total Active"
              value={stats?.total_tasks || 0}
              prefix={<FileTextOutlined />}
              loading={statsLoading}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 160 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'awaiting_response', label: 'Awaiting Response' },
              { value: 'responded', label: 'Responded' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'overdue', label: 'Overdue' },
            ]}
          />
          <Select
            placeholder="Type"
            allowClear
            style={{ width: 160 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={TASK_TYPE_OPTIONS}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {claimGroups.length} claims, {tasks.length} tasks
          </Text>
        </Space>
      </Card>

      {/* Claim Groups */}
      <Collapse
        defaultActiveKey={claimGroups.filter(g => g.hasOverdue).map(g => g.claim_id)}
        style={{ background: 'transparent', border: 'none' }}
        items={claimGroups.map((group) => {
          const activeTasks = group.tasks.filter(t => !['resolved', 'cancelled'].includes(t.status));
          const resolvedTasks = group.tasks.filter(t => t.status === 'resolved');
          const totalTasks = group.tasks.length;
          const progressPct = totalTasks > 0 ? Math.round((resolvedTasks.length / totalTasks) * 100) : 0;

          return {
            key: group.claim_id,
            style: {
              marginBottom: 8,
              border: group.hasOverdue ? '1px solid #ffccc7' : '1px solid #f0f0f0',
              borderRadius: 8,
              background: group.hasOverdue ? '#fff2f0' : '#fff',
            },
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <EnvironmentOutlined style={{ color: group.hasOverdue ? '#ff4d4f' : '#1890ff', fontSize: 16 }} />
                  <Text strong style={{ fontSize: 14, color: group.hasOverdue ? '#cf1322' : undefined }}>
                    {group.property_address || 'No Address'}
                  </Text>
                </div>
                <div style={{ flex: '0 0 auto' }}>
                  <Tag style={{ fontSize: 11, margin: 0 }}>
                    {group.insurance_company || 'N/A'}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                    #{group.claim_number}
                  </Text>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Space size={8} wrap>
                    {renderStagePipeline(group)}
                    {Object.keys(group.supplementStatuses).length > 0 && (
                      <Tooltip title={Object.entries(group.supplementStatuses).map(([s, c]) => `${s}: ${c}`).join(', ')}>
                        <Tag
                          color={
                            group.supplementStatuses['identified'] ? 'orange' :
                            group.supplementStatuses['in_progress'] || group.supplementStatuses['submitted'] ? 'blue' :
                            group.supplementStatuses['approved'] ? 'green' :
                            group.supplementStatuses['denied'] ? 'red' : 'default'
                          }
                          style={{ fontSize: 11, margin: 0, cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); navigate('/supplements'); }}
                        >
                          Supplement: {
                            group.supplementStatuses['identified'] ? 'Review Needed' :
                            group.supplementStatuses['in_progress'] ? 'In Progress' :
                            group.supplementStatuses['submitted'] ? 'Submitted' :
                            group.supplementStatuses['under_review'] ? 'Under Review' :
                            group.supplementStatuses['approved'] ? 'Approved' :
                            group.supplementStatuses['denied'] ? 'Denied' : 'Active'
                          }
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                </div>
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {group.nextFollowupDate && (
                    <Tooltip title={`Next: ${dayjs(group.nextFollowupDate).format('YYYY-MM-DD')}`}>
                      <Text
                        type={group.hasOverdue ? 'danger' : 'secondary'}
                        style={{ fontSize: 11 }}
                      >
                        {dayjs(group.nextFollowupDate).fromNow()}
                      </Text>
                    </Tooltip>
                  )}
                  <Tooltip title={`${resolvedTasks.length}/${totalTasks} resolved`}>
                    <Progress
                      percent={progressPct}
                      size="small"
                      style={{ width: 60, margin: 0 }}
                      strokeColor={progressPct === 100 ? '#52c41a' : '#1890ff'}
                      showInfo={false}
                    />
                  </Tooltip>
                  <Badge
                    count={activeTasks.length}
                    style={{ backgroundColor: group.hasOverdue ? '#ff4d4f' : '#1890ff' }}
                  />
                </div>
              </div>
            ),
            children: (
              <Table
                dataSource={group.tasks}
                columns={taskColumns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 900 }}
                rowClassName={(record) => isOverdue(record) ? 'ant-table-row-overdue' : ''}
              />
            ),
          };
        })}
      />

      {claimGroups.length === 0 && !tasksLoading && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">No follow-up tasks found</Text>
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
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="claim_id" label="Claim ID" rules={[{ required: true }]}>
            <Input placeholder="Enter claim ID" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="task_type" label="Task Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} placeholder="Select type" />
              </Form.Item>
            </Col>
            <Col span={12}>
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
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Follow up on documents sent to adjuster" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={3} placeholder="Optional details" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="next_followup_date" label="First Follow-up Date">
                <DatePicker showTime style={{ width: '100%' }} placeholder="Default: 3 days from now" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assigned_to_role" label="Assigned To Role" initialValue="adjuster">
                <Select options={[
                  { value: 'adjuster', label: 'Adjuster' },
                  { value: 'public_adjuster', label: 'Public Adjuster' },
                  { value: 'contractor', label: 'Contractor' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="assigned_to_name" label="Assigned To Name">
                <Input placeholder="Adjuster name" />
              </Form.Item>
            </Col>
            <Col span={12}>
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
                <Col span={12}>
                  <Form.Item name="followup_interval_days" label="Follow-up Interval (days)" initialValue={3}>
                    <InputNumber min={1} max={30} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
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
        title={`Resolve: ${selectedTask?.title}`}
        open={resolveModalOpen}
        width={650}
        onOk={() => {
          resolveForm.validateFields().then(values => {
            if (selectedTask) {
              resolveMutation.mutate({
                taskId: selectedTask.id,
                body: {
                  resolution_notes: values.resolution_notes,
                  outcome: values.outcome,
                  acv_amount: values.acv_amount,
                  rcv_amount: values.rcv_amount,
                  depreciation_amount: values.depreciation_amount,
                  deductible: values.deductible,
                  wm_cost_status: values.wm_cost_status,
                  wm_estimate_amount: values.wm_estimate_amount,
                  sections_data: parsedSections,
                  file: resolveFile,
                },
              });
            }
          });
        }}
        onCancel={() => {
          setResolveModalOpen(false);
          setResolveOutcome(undefined);
          setResolveFile(undefined);
          setParsedSections(null);
          resolveForm.resetFields();
        }}
        confirmLoading={resolveMutation.isPending}
      >
        <Form form={resolveForm} layout="vertical">
          <Form.Item name="outcome" label="Outcome" rules={[{ required: true, message: 'Select an outcome' }]}>
            <Select placeholder="What was the result?" onChange={(v) => setResolveOutcome(v)}>
              <Select.Option value="estimate_received">Insurance Estimate Received</Select.Option>
              <Select.Option value="denied">Claim Denied</Select.Option>
              <Select.Option value="other">Other</Select.Option>
            </Select>
          </Form.Item>

          {resolveOutcome === 'estimate_received' && (
            <>
              <Form.Item label="Insurance Estimate PDF">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Upload
                    maxCount={1}
                    accept=".pdf"
                    beforeUpload={async (file) => {
                      setResolveFile(file);
                      setParsedSections(null);
                      // Auto-parse PDF
                      if (file.name.toLowerCase().endsWith('.pdf')) {
                        setIsParsing(true);
                        try {
                          const result = await claimFollowUpService.parseEstimatePdf(file);
                          setParsedSections(result.sections);
                          // Auto-fill totals from sections
                          recalcTotals(result.sections);
                          if (result.totals?.deductible) {
                            resolveForm.setFieldsValue({ deductible: result.totals.deductible });
                          }
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
                      {isParsing ? 'Parsing PDF...' : 'Upload & Parse Estimate PDF'}
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
                  <div style={{ textAlign: 'center', padding: '12px', background: '#fafafa', borderRadius: 6, marginBottom: 8 }}>
                    <Text type="secondary">No sections. Upload PDF to auto-parse or add manually.</Text>
                  </div>
                ) : (
                  <>
                    {(parsedSections || []).map((section, idx) => (
                      <div key={idx} style={{ background: '#fafafa', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
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
                                updated[idx] = { ...updated[idx], rcv, net_acv: rcv - dep };
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
                                updated[idx] = { ...updated[idx], depreciation: dep, net_acv: rcv - dep };
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
              <div style={{ background: '#e6f7ff', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
                <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Totals</Text>
                <Row gutter={12}>
                  <Col span={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total RCV</Text>
                    <Form.Item name="rcv_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Total ACV</Text>
                    <Form.Item name="acv_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                    <Form.Item name="depreciation_amount" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Deductible</Text>
                    <Form.Item name="deductible" style={{ marginBottom: 0 }}>
                      <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              </div>

              {/* WM Cost Status */}
              <div style={{ background: '#f6ffed', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #b7eb8f' }}>
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
                        <Form.Item name="wm_estimate_amount" label="WM Estimate Amount" style={{ marginTop: 8, marginBottom: 0 }}>
                          <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} placeholder="0.00" />
                        </Form.Item>
                      );
                    }
                    if (wmStatus === 'not_received') {
                      return (
                        <div style={{ marginTop: 8, padding: '6px 8px', background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
                          <Text style={{ fontSize: 12, color: '#d48806' }}>
                            A follow-up task will be auto-created to request WM cost coverage from the insurance company.
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

          <Form.Item name="resolution_notes" label="Resolution Notes">
            <TextArea rows={3} placeholder="Additional details..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        title={`Edit: ${selectedTask?.title}`}
        open={editModalOpen}
        width={550}
        onOk={() => {
          editForm.validateFields().then(values => {
            if (selectedTask) {
              editMutation.mutate({ taskId: selectedTask.id, data: values });
            }
          });
        }}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={editMutation.isPending}
      >
        <Form form={editForm} layout="vertical" size="small">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="task_type" label="Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="Status">
                <Select options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'awaiting_response', label: 'Awaiting Response' },
                  { value: 'responded', label: 'Responded' },
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="priority" label="Priority">
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assigned_to_role" label="Assigned Role">
                <Select options={[
                  { value: 'adjuster', label: 'Adjuster' },
                  { value: 'public_adjuster', label: 'Public Adjuster' },
                  { value: 'contractor', label: 'Contractor' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="assigned_to_name" label="Assigned Name">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assigned_to_email" label="Assigned Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="assigned_to_phone" label="Phone">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="auto_followup_enabled" label="Auto Follow-up" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="followup_interval_days" label="Interval (days)">
                <InputNumber min={1} max={30} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_followup_count" label="Max Count">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <style>{`
        .ant-table-row-overdue {
          background-color: #fff2f0 !important;
        }
        .ant-table-row-overdue:hover > td {
          background-color: #ffece8 !important;
        }
        .ant-collapse > .ant-collapse-item > .ant-collapse-header {
          padding: 10px 16px !important;
          align-items: center !important;
        }
        .ant-collapse-content-box {
          padding: 0 !important;
        }
      `}</style>
    </div>
  );
};

export default ClaimFollowUpDashboard;
