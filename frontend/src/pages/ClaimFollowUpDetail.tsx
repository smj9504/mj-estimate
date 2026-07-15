import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, Select,
  DatePicker, Switch, InputNumber, message, Typography, Row, Col,
  Statistic, Tooltip, Dropdown, Divider, Tabs, Badge, Progress,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, ReloadOutlined, CheckCircleOutlined,
  ClockCircleOutlined, MailOutlined, SendOutlined, EllipsisOutlined,
  AlertOutlined, FileTextOutlined, DollarOutlined, AuditOutlined,
  EditOutlined, DeleteOutlined, RightOutlined, FilePdfOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { supplementService } from '../services/supplementService';
import { companyService } from '../services/companyService';
import { EmailComposer, CommunicationTimeline, DepreciationPhaseTracker } from '../components/claim-followup';
import { ClaimEstimatesPanel } from './ClaimFollowUpDashboard';
import type {
  FollowUpTask, FollowUpTaskCreate, FollowUpTaskUpdate, TaskType,
} from '../types/claimFollowUp';
import { KNOWN_TASK_TYPES } from '../types/claimFollowUp';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue', awaiting_response: 'orange', responded: 'cyan',
  resolved: 'green', overdue: 'red', cancelled: 'default',
};

const PRIORITY_TAG_COLORS: Record<string, string> = {
  low: 'default', normal: 'blue', high: 'orange', urgent: 'red',
};

const TASK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'wm_docs_sent', label: 'WM Docs (Invoice/COS/EWA/Photo)' },
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

const STAGE_LABELS: Record<string, string> = {
  wm_docs_sent: 'WM Docs', estimate_request: 'Est. Request',
  supplement_sent: 'Supplement', payment_check: 'Rebuild Payment',
  wm_payment_check: 'WM Payment', depreciation_recovery: 'Depreciation',
  docs_sent: 'Other Docs', general: 'General', dispute: 'Dispute',
  appraisal: 'Appraisal', attorney_referral: 'Attorney',
};

const getStageLabel = (stage: string): string =>
  STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const STAGE_ORDER: string[] = [
  'wm_docs_sent', 'wm_payment_check', 'payment_check', 'supplement_sent',
  'estimate_request', 'dispute', 'appraisal', 'attorney_referral',
  'depreciation_recovery', 'docs_sent', 'general',
];

const isOverdue = (t: FollowUpTask) =>
  t.status !== 'resolved' && t.status !== 'cancelled' && t.next_followup_date
  && dayjs(t.next_followup_date).isBefore(dayjs());

const ClaimFollowUpDetail: React.FC = () => {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [emailTaskId, setEmailTaskId] = useState<string | undefined>();

  // Fetch tasks for this claim
  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ['claim-followup-detail', claimId],
    queryFn: () => claimFollowUpService.getTasksByClaimId(claimId!),
    enabled: !!claimId,
  });

  // Insurance emails lookup
  const { data: insuranceEmails = {} } = useQuery({
    queryKey: ['insurance-emails'],
    queryFn: () => companyService.getInsuranceEmails(),
    staleTime: 5 * 60 * 1000,
  });

  // Derive claim-level info from tasks
  const claimInfo = useMemo(() => {
    if (!tasks.length) return null;
    const first = tasks[0];
    return {
      property_address: first.property_address || '',
      claim_number: first.claim_number || '',
      insurance_company: first.insurance_company || '',
      pa_name: first.pa_name || '',
      pa_company: first.pa_company || '',
      pa_email: first.pa_email || '',
      pa_phone: first.pa_phone || '',
      wmCostStatus: first.wm_cost_status || '',
      hasInsuranceEstimate: tasks.some(t => t.has_insurance_estimate),
    };
  }, [tasks]);

  const supplementStatuses = useMemo(() => {
    const ss: Record<string, number> = {};
    tasks.forEach(t => {
      if (t.supplement_statuses) {
        Object.entries(t.supplement_statuses).forEach(([status, count]) => {
          ss[status] = count as number;
        });
      }
    });
    return ss;
  }, [tasks]);

  const activeTasks = useMemo(() => tasks.filter(t => !['resolved', 'cancelled'].includes(t.status)), [tasks]);
  const resolvedTasks = useMemo(() => tasks.filter(t => t.status === 'resolved'), [tasks]);

  const nextFollowupDate = useMemo(() => {
    const dates = activeTasks
      .map(t => t.next_followup_date || t.due_date)
      .filter(Boolean) as string[];
    return dates.sort()[0] || null;
  }, [activeTasks]);

  const hasOverdue = useMemo(() => activeTasks.some(t => isOverdue(t)), [activeTasks]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: FollowUpTaskCreate) => claimFollowUpService.createTask(data),
    onSuccess: () => {
      message.success('Task created');
      setCreateModalOpen(false);
      createForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
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
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: any }) =>
      claimFollowUpService.resolveTask(taskId, body),
    onSuccess: () => {
      message.success('Task resolved');
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (taskId: string) => claimFollowUpService.reopenTask(taskId),
    onSuccess: () => {
      message.success('Task reopened');
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => claimFollowUpService.deleteTask(taskId),
    onSuccess: () => {
      message.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
    },
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

  // Build stage pipeline tags
  const renderStagePipeline = () => {
    if (!tasks.length) return null;
    const resolvedTypes = new Set(resolvedTasks.map(t => t.task_type));
    const activeTypes = new Set(activeTasks.map(t => t.task_type));
    const allTaskTypes = new Set(tasks.map(t => t.task_type));
    const knownSet = new Set<string>(STAGE_ORDER);

    const stages = [
      ...STAGE_ORDER.filter(s => resolvedTypes.has(s) || activeTypes.has(s)),
      ...Array.from(allTaskTypes).filter(s => !knownSet.has(s)),
    ];

    if (!stages.length) return null;

    return (
      <Space size={4} wrap>
        {stages.map((stage, idx) => {
          const isResolved = resolvedTypes.has(stage) && !activeTypes.has(stage);
          const isActive = activeTypes.has(stage);
          const stageTask = tasks.find(t => t.task_type === stage && !['resolved', 'cancelled'].includes(t.status));
          const isStageOverdue = stageTask ? isOverdue(stageTask) : false;

          let bgColor: string; let txtColor: string; let border: string;
          if (isResolved) { bgColor = '#f6ffed'; txtColor = '#52c41a'; border = '1px solid #b7eb8f'; }
          else if (isStageOverdue) { bgColor = '#ff4d4f'; txtColor = '#fff'; border = 'none'; }
          else if (isActive) { bgColor = '#1890ff'; txtColor = '#fff'; border = 'none'; }
          else { bgColor = '#d9d9d9'; txtColor = '#999'; border = 'none'; }

          return (
            <React.Fragment key={stage}>
              {idx > 0 && <RightOutlined style={{ fontSize: 10, color: '#d9d9d9' }} />}
              <Tag style={{ backgroundColor: bgColor, color: txtColor, border, fontSize: 11, margin: 0, lineHeight: '22px' }}>
                {isResolved && <CheckCircleOutlined style={{ marginRight: 3, fontSize: 10 }} />}
                {getStageLabel(stage)}
              </Tag>
            </React.Fragment>
          );
        })}
      </Space>
    );
  };

  const insEmail = claimInfo?.insurance_company ? insuranceEmails[claimInfo.insurance_company] : undefined;

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/claim-followup')} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <EnvironmentOutlined style={{ color: '#1890ff', fontSize: 16 }} />
            <Title level={4} style={{ margin: 0 }}>{claimInfo?.property_address || 'Loading...'}</Title>
          </div>
          <Space size={8} style={{ marginTop: 4 }}>
            {claimInfo?.insurance_company && (
              <Tag>{claimInfo.insurance_company}{insEmail && <> <MailOutlined style={{ fontSize: 10 }} /></>}</Tag>
            )}
            {claimInfo?.claim_number && (
              <Text type="secondary">#{claimInfo.claim_number}</Text>
            )}
            {claimInfo?.pa_name && (
              <Tag color="geekblue">PA: {claimInfo.pa_name}</Tag>
            )}
          </Space>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            createForm.resetFields();
            setCreateModalOpen(true);
          }}>Add Stage</Button>
        </Space>
      </div>

      {/* Stage Pipeline + Stats */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Stage Pipeline</Text>
          {renderStagePipeline()}
        </div>

        {/* PA Info */}
        {claimInfo?.pa_name && (
          <div style={{ marginBottom: 12, padding: '6px 8px', background: '#f0f5ff', borderRadius: 6, borderLeft: '3px solid #597ef7' }}>
            <Text strong style={{ fontSize: 12, color: '#2f54eb', display: 'block', marginBottom: 2 }}>Public Adjuster</Text>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
              <span><Text type="secondary" style={{ fontSize: 11 }}>Name: </Text>{claimInfo.pa_name}</span>
              {claimInfo.pa_company && <span><Text type="secondary" style={{ fontSize: 11 }}>Company: </Text>{claimInfo.pa_company}</span>}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginTop: 2 }}>
              {claimInfo.pa_email && (
                <span><Text type="secondary" style={{ fontSize: 11 }}>Email: </Text><a href={`mailto:${claimInfo.pa_email}`}>{claimInfo.pa_email}</a></span>
              )}
              {claimInfo.pa_phone && (
                <span><Text type="secondary" style={{ fontSize: 11 }}>Phone: </Text><a href={`tel:${claimInfo.pa_phone}`}>{claimInfo.pa_phone}</a></span>
              )}
            </div>
          </div>
        )}

        {/* Supplement Status */}
        {Object.keys(supplementStatuses).length > 0 && (
          <div style={{ marginBottom: 12, padding: '6px 8px', background: '#fafafa', borderRadius: 6 }}>
            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Supplement Status</Text>
            <Space size={4} wrap>
              {supplementStatuses['identified'] && <Tag color="orange" style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/supplements')}>Review Needed ({supplementStatuses['identified']})</Tag>}
              {supplementStatuses['in_progress'] && <Tag color="processing" style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/supplements')}>In Progress ({supplementStatuses['in_progress']})</Tag>}
              {supplementStatuses['submitted'] && <Tag color="blue" style={{ margin: 0 }}>Submitted ({supplementStatuses['submitted']})</Tag>}
              {supplementStatuses['under_review'] && <Tag color="geekblue" style={{ margin: 0 }}>Under Review ({supplementStatuses['under_review']})</Tag>}
              {supplementStatuses['approved'] && <Tag color="green" style={{ margin: 0 }}>Approved ({supplementStatuses['approved']})</Tag>}
              {supplementStatuses['denied'] && <Tag color="red" style={{ margin: 0 }}>Denied ({supplementStatuses['denied']})</Tag>}
            </Space>
          </div>
        )}

        <Row gutter={[8, 8]}>
          <Col span={8}>
            <Statistic title="Active Tasks" value={activeTasks.length} valueStyle={{ fontSize: 18, color: '#1890ff' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Resolved" value={resolvedTasks.length} valueStyle={{ fontSize: 18, color: '#52c41a' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Next Follow-up" value={nextFollowupDate ? dayjs(nextFollowupDate).format('MM/DD') : '-'}
              valueStyle={{ fontSize: 18, color: hasOverdue ? '#cf1322' : undefined }} />
          </Col>
        </Row>
      </Card>

      {/* Depreciation Recovery Phase Tracker */}
      {tasks.filter(t => t.task_type === 'depreciation_recovery' && t.status !== 'cancelled').map(depTask => (
        <Card key={depTask.id} size="small" title={`Depreciation Recovery: ${depTask.title}`} style={{ marginBottom: 16 }}>
          <DepreciationPhaseTracker task={depTask} onUpdated={() => refetch()} />
        </Card>
      ))}

      {/* Tasks Table */}
      <Card size="small" title="Tasks" style={{ marginBottom: 16 }}>
        <Table<FollowUpTask>
          size="small"
          dataSource={tasks}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          columns={[
            {
              title: 'Stage', dataIndex: 'task_type', width: 140,
              render: (t: string) => getStageLabel(t),
            },
            {
              title: 'Title', dataIndex: 'title', ellipsis: true,
            },
            {
              title: 'Status', dataIndex: 'status', width: 130,
              render: (s: string, record) => {
                const overdue = isOverdue(record);
                return <Tag color={STATUS_COLORS[overdue ? 'overdue' : s] || 'default'}>{(overdue ? 'OVERDUE' : s).replace('_', ' ').toUpperCase()}</Tag>;
              },
            },
            {
              title: 'Priority', dataIndex: 'priority', width: 90,
              render: (p: string) => <Tag color={PRIORITY_TAG_COLORS[p] || 'default'}>{p.toUpperCase()}</Tag>,
            },
            {
              title: 'Next Follow-up', dataIndex: 'next_followup_date', width: 120,
              render: (d?: string, record?: FollowUpTask) => {
                if (record?.status === 'resolved') return <Text type="success">Resolved</Text>;
                if (!d) return <Text type="secondary">-</Text>;
                const dt = dayjs(d);
                const overdue = dt.isBefore(dayjs());
                return <Tooltip title={dt.format('YYYY-MM-DD HH:mm')}><Text type={overdue ? 'danger' : undefined}>{dt.fromNow()}</Text></Tooltip>;
              },
            },
            {
              title: 'Assigned', dataIndex: 'assigned_to_name', width: 120, ellipsis: true,
              render: (n?: string, r?: any) => (
                <div>
                  <div>{n || <Text type="secondary">-</Text>}</div>
                  {r?.assigned_to_role && <Text type="secondary" style={{ fontSize: 11 }}>{r.assigned_to_role}</Text>}
                </div>
              ),
            },
            {
              title: '', key: 'actions', width: 44, align: 'center',
              render: (_, task) => (
                <Dropdown menu={{
                  items: [
                    { key: 'email', icon: <MailOutlined />, label: 'Send Email',
                      onClick: () => setEmailTaskId(task.id) },
                    { key: 'resolve', icon: <CheckCircleOutlined />, label: 'Resolve',
                      disabled: task.status === 'resolved',
                      onClick: () => resolveMutation.mutate({ taskId: task.id, body: { outcome: 'resolved' } }) },
                    { key: 'reopen', icon: <ClockCircleOutlined />, label: 'Reopen',
                      disabled: task.status !== 'resolved',
                      onClick: () => reopenMutation.mutate(task.id) },
                    { key: 'edit', icon: <EditOutlined />, label: 'Edit',
                      onClick: () => {
                        setSelectedTask(task);
                        const isKnown = (KNOWN_TASK_TYPES as readonly string[]).includes(task.task_type);
                        editForm.setFieldsValue({
                          title: task.title,
                          task_type: isKnown ? task.task_type : '__custom__',
                          custom_task_type: isKnown ? undefined : task.task_type,
                          status: task.status,
                          priority: task.priority,
                          assigned_to_name: task.assigned_to_name,
                          assigned_to_email: task.assigned_to_email,
                          assigned_to_role: task.assigned_to_role,
                          auto_followup_enabled: task.auto_followup_enabled,
                          followup_interval_days: task.followup_interval_days,
                          max_followup_count: task.max_followup_count,
                        });
                        setEditModalOpen(true);
                      }},
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
                      onClick: () => Modal.confirm({ title: 'Delete this task?', onOk: () => deleteMutation.mutate(task.id) }) },
                  ],
                }}>
                  <Button type="text" size="small" icon={<EllipsisOutlined />} />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      {/* Tabs: Estimates / Email / History */}
      <Card size="small">
        <Tabs
          activeKey={emailTaskId ? 'email' : 'estimates'}
          onChange={(key) => { if (key !== 'email') setEmailTaskId(undefined); }}
          size="small"
          items={[
            {
              key: 'estimates',
              label: <span><FilePdfOutlined /> Estimates</span>,
              children: claimId ? <ClaimEstimatesPanel claimId={claimId} /> : null,
            },
            {
              key: 'email',
              label: <span><MailOutlined /> Send Email</span>,
              children: claimId ? (
                <EmailComposer
                  claimId={claimId}
                  followupTaskId={emailTaskId}
                  taskType={tasks.find(t => t.id === emailTaskId)?.task_type}
                  wmJobId={tasks.find(t => t.id === emailTaskId)?.wm_job_id}
                  contactCount={tasks.find(t => t.id === emailTaskId)?.contact_count || 0}
                  defaultTo={tasks.find(t => t.id === emailTaskId)?.assigned_to_email || tasks[0]?.assigned_to_email || ''}
                  onSent={() => {
                    message.success('Email sent');
                    queryClient.invalidateQueries({ queryKey: ['claim-followup-detail', claimId] });
                  }}
                />
              ) : null,
            },
            {
              key: 'history',
              label: <span><ClockCircleOutlined /> Communication History</span>,
              children: claimId ? <CommunicationTimeline claimId={claimId} taskId={emailTaskId} /> : null,
            },
          ]}
        />
      </Card>

      {/* Create Task Modal */}
      <Modal title="Add Stage" open={createModalOpen} onOk={handleCreateSubmit}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createMutation.isPending} width={600}>
        <Form form={createForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Task Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} placeholder="Select type"
                  onChange={() => createForm.setFieldValue('custom_task_type', undefined)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="priority" label="Priority" initialValue="normal">
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
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
                <DatePicker showTime style={{ width: '100%' }} placeholder="Default: 3 days" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_role" label="Assigned Role" initialValue="adjuster">
                <Select options={[
                  { value: 'adjuster', label: 'Adjuster' },
                  { value: 'public_adjuster', label: 'Public Adjuster' },
                  { value: 'contractor', label: 'Contractor' },
                ]} />
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
        onOk={() => editForm.validateFields().then(values => {
          if (!selectedTask) return;
          if (values.task_type === '__custom__') {
            const ct = (values.custom_task_type || '').trim().toLowerCase().replace(/\s+/g, '_');
            if (!ct) { message.warning('Enter a custom stage name'); return; }
            values.task_type = ct;
          }
          delete values.custom_task_type;
          editMutation.mutate({ taskId: selectedTask.id, data: values });
        })}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={editMutation.isPending} width={600}>
        <Form form={editForm} layout="vertical" size="small">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
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
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
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
            <Col xs={24} sm={12}>
              <Form.Item name="assigned_to_name" label="Name"><Input /></Form.Item>
            </Col>
            <Col xs={24} sm={12}>
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

export default ClaimFollowUpDetail;
