import React, { useState } from 'react';
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
  Tabs,
  Tooltip,
  Badge,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MailOutlined,
  PhoneOutlined,
  SendOutlined,
  EllipsisOutlined,
  AlertOutlined,
  FileTextOutlined,
  DollarOutlined,
  AuditOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import type {
  FollowUpTask,
  FollowUpTaskCreate,
  TaskType,
  TaskStatus,
  TaskPriority,
  TASK_TYPE_LABELS,
  TASK_STATUS_COLORS,
  PRIORITY_COLORS,
} from '../types/claimFollowUp';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { TextArea } = Input;

const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'docs_sent', label: 'Documents Sent' },
  { value: 'payment_check', label: 'Payment Check' },
  { value: 'estimate_request', label: 'Estimate Request' },
  { value: 'supplement_sent', label: 'Supplement Sent' },
  { value: 'general', label: 'General' },
];

const TASK_TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  docs_sent: <FileTextOutlined />,
  payment_check: <DollarOutlined />,
  estimate_request: <AuditOutlined />,
  supplement_sent: <SendOutlined />,
  general: <ClockCircleOutlined />,
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

const ClaimFollowUpDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [createForm] = Form.useForm();
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
      sort_by: 'due_date',
      sort_order: 'asc',
    }),
  });

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
    mutationFn: ({ taskId, notes }: { taskId: string; notes?: string }) =>
      claimFollowUpService.resolveTask(taskId, notes),
    onSuccess: () => {
      message.success('Task resolved');
      setResolveModalOpen(false);
      resolveForm.resetFields();
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

  const isOverdue = (task: FollowUpTask) => {
    return dayjs(task.due_date).isBefore(dayjs()) &&
      ['pending', 'awaiting_response'].includes(task.status);
  };

  const columns: ColumnsType<FollowUpTask> = [
    {
      title: 'Type',
      dataIndex: 'task_type',
      key: 'task_type',
      width: 160,
      render: (type: TaskType) => (
        <Space size={4}>
          {TASK_TYPE_ICONS[type]}
          <span>{TASK_TYPE_OPTIONS.find(o => o.value === type)?.label || type}</span>
        </Space>
      ),
      filters: TASK_TYPE_OPTIONS.map(o => ({ text: o.label, value: o.value })),
      onFilter: (value, record) => record.task_type === value,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record) => (
        <Space direction="vertical" size={0}>
          <Text strong={isOverdue(record)} type={isOverdue(record) ? 'danger' : undefined}>
            {title}
          </Text>
          {record.claim_number && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Claim #{record.claim_number}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Assigned To',
      key: 'assigned_to',
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.assigned_to_name || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.assigned_to_role === 'public_adjuster' ? 'PA' : record.assigned_to_role}
          </Text>
        </Space>
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
      filters: [
        { text: 'Pending', value: 'pending' },
        { text: 'Awaiting Response', value: 'awaiting_response' },
        { text: 'Responded', value: 'responded' },
        { text: 'Resolved', value: 'resolved' },
        { text: 'Overdue', value: 'overdue' },
      ],
      onFilter: (value, record) => record.status === value,
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
      sorter: (a, b) => {
        const order = { urgent: 0, high: 1, normal: 2, low: 3 };
        return (order[a.priority as keyof typeof order] ?? 4) - (order[b.priority as keyof typeof order] ?? 4);
      },
    },
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 130,
      render: (date: string, record) => {
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
      sorter: (a, b) => dayjs(a.due_date).unix() - dayjs(b.due_date).unix(),
      defaultSortOrder: 'ascend',
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
      title: 'Actions',
      key: 'actions',
      width: 120,
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
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => {
                  setSelectedTask(record);
                  // TODO: implement edit modal
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
        due_date: values.due_date.toISOString(),
      };
      createMutation.mutate(payload);
    });
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
        </Space>
      </Card>

      {/* Tasks Table */}
      <Card>
        <Table
          dataSource={tasks}
          columns={columns}
          rowKey="id"
          loading={tasksLoading}
          size="small"
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `${total} tasks` }}
          rowClassName={(record) => isOverdue(record) ? 'ant-table-row-overdue' : ''}
        />
      </Card>

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
              <Form.Item name="due_date" label="Due Date" rules={[{ required: true }]}>
                <DatePicker showTime style={{ width: '100%' }} />
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
        onOk={() => {
          resolveForm.validateFields().then(values => {
            if (selectedTask) {
              resolveMutation.mutate({ taskId: selectedTask.id, notes: values.resolution_notes });
            }
          });
        }}
        onCancel={() => { setResolveModalOpen(false); resolveForm.resetFields(); }}
        confirmLoading={resolveMutation.isPending}
      >
        <Form form={resolveForm} layout="vertical">
          <Form.Item name="resolution_notes" label="Resolution Notes">
            <TextArea rows={4} placeholder="Describe how this was resolved..." />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .ant-table-row-overdue {
          background-color: #fff2f0 !important;
        }
        .ant-table-row-overdue:hover > td {
          background-color: #ffece8 !important;
        }
      `}</style>
    </div>
  );
};

export default ClaimFollowUpDashboard;
