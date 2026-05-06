import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Statistic, Tooltip, Badge,
  Dropdown, Collapse, Descriptions, DatePicker, Divider, Empty,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  EditOutlined, DeleteOutlined, EllipsisOutlined, FileTextOutlined,
  DollarOutlined, SendOutlined, PhoneOutlined, ClockCircleOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { supplementService } from '../services/supplementService';
import type {
  SupplementRequest, SupplementRequestCreate, BidItemEstimate,
  BidItemEstimateCreate, SupplementFollowUp, SupplementStatus,
  SUPPLEMENT_STATUS_COLORS, BID_ITEM_TYPE_LABELS, BID_ITEM_STATUS_COLORS,
} from '../types/supplement';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

const STATUS_COLORS: Record<string, string> = {
  identified: 'blue', in_progress: 'processing', submitted: 'orange',
  under_review: 'geekblue', approved: 'green', denied: 'red', withdrawn: 'default',
};

const BID_TYPE_LABELS: Record<string, string> = {
  bathroom: 'Bathroom', cabinet: 'Cabinet', packing: 'Packing',
  roofing: 'Roofing', kitchen: 'Kitchen', flooring: 'Flooring', other: 'Other',
};

const BID_STATUS_COLORS: Record<string, string> = {
  draft: 'default', sent: 'blue', approved: 'green', revision_needed: 'orange', denied: 'red',
};

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const SupplementManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedSupplement, setSelectedSupplement] = useState<SupplementRequest | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [bidItemModalOpen, setBidItemModalOpen] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [bidItemForm] = Form.useForm();
  const [followupForm] = Form.useForm();

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['supplement-stats'],
    queryFn: () => supplementService.getStats(),
  });

  const { data: supplements = [], isLoading, refetch } = useQuery({
    queryKey: ['supplements', statusFilter],
    queryFn: () => supplementService.list({ status: statusFilter, page_size: 100 }),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: SupplementRequestCreate) => supplementService.create(data),
    onSuccess: () => {
      message.success('Supplement request created');
      setCreateModalOpen(false);
      createForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SupplementRequest> }) =>
      supplementService.update(id, data),
    onSuccess: () => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
      if (selectedSupplement) {
        supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => supplementService.delete(id),
    onSuccess: () => {
      message.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
  });

  const createBidItemMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: BidItemEstimateCreate }) =>
      supplementService.createBidItem(supplementId, data),
    onSuccess: () => {
      message.success('Bid item added');
      setBidItemModalOpen(false);
      bidItemForm.resetFields();
      if (selectedSupplement) {
        supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      }
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
    },
  });

  const createFollowupMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: Partial<SupplementFollowUp> }) =>
      supplementService.createFollowup(supplementId, data),
    onSuccess: () => {
      message.success('Follow-up logged');
      setFollowupModalOpen(false);
      followupForm.resetFields();
      if (selectedSupplement) {
        supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      }
    },
  });

  const columns: ColumnsType<SupplementRequest> = [
    {
      title: 'Claim #',
      key: 'claim',
      width: 140,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.claim_number || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.insurance_company}</Text>
        </Space>
      ),
    },
    { title: 'Title', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: 'Original', dataIndex: 'original_amount', key: 'original', width: 110,
      align: 'right', render: formatCurrency,
    },
    {
      title: 'Supplement', dataIndex: 'supplement_amount', key: 'supplement', width: 110,
      align: 'right', render: (v: number) => <Text strong>{formatCurrency(v)}</Text>,
    },
    {
      title: 'Diff', dataIndex: 'difference', key: 'diff', width: 100, align: 'right',
      render: (v: number) => (
        <Text type={v > 0 ? 'success' : v < 0 ? 'danger' : undefined}>{formatCurrency(v)}</Text>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ').toUpperCase()}</Tag>,
    },
    {
      title: 'Bid Items', dataIndex: 'bid_item_count', key: 'bid_items', width: 80, align: 'center',
      render: (c: number) => <Badge count={c} showZero style={{ backgroundColor: c > 0 ? '#1890ff' : '#d9d9d9' }} />,
    },
    {
      title: '', key: 'actions', width: 80, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button type="link" size="small" onClick={() => {
              supplementService.get(r.id).then(data => { setSelectedSupplement(data); setDetailModalOpen(true); });
            }}>Detail</Button>
          </Tooltip>
          <Dropdown menu={{
            items: [
              { key: 'delete', label: 'Delete', danger: true, icon: <DeleteOutlined />,
                onClick: () => Modal.confirm({ title: 'Delete?', onOk: () => deleteMutation.mutate(r.id) }) },
            ],
          }}>
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Supplement Management</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            New Supplement
          </Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          { title: 'Identified', value: stats?.identified, color: '#1890ff' },
          { title: 'In Progress', value: stats?.in_progress, color: '#722ed1' },
          { title: 'Submitted', value: stats?.submitted, color: '#fa8c16' },
          { title: 'Approved', value: stats?.approved, color: '#52c41a' },
        ].map(s => (
          <Col xs={12} sm={6} key={s.title}>
            <Card size="small">
              <Statistic title={s.title} value={s.value || 0} loading={statsLoading}
                valueStyle={{ color: s.color, fontSize: 20 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Filter + Table */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Select placeholder="Filter by status" allowClear style={{ width: 180 }}
          value={statusFilter} onChange={setStatusFilter}
          options={['identified','in_progress','submitted','under_review','approved','denied'].map(s => ({
            value: s, label: s.replace('_', ' ').toUpperCase(),
          }))} />
      </Card>

      <Card>
        <Table dataSource={supplements} columns={columns} rowKey="id" loading={isLoading}
          size="small" scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showTotal: t => `${t} supplements` }} />
      </Card>

      {/* Create Modal */}
      <Modal title="Create Supplement Request" open={createModalOpen} width={550}
        onOk={() => createForm.validateFields().then(v => createMutation.mutate(v))}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createMutation.isPending}>
        <Form form={createForm} layout="vertical" size="small">
          <Form.Item name="claim_id" label="Claim ID" rules={[{ required: true }]}>
            <Input placeholder="Claim UUID" />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Supplement for bathroom rebuild" />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <TextArea rows={3} placeholder="Why is re-estimation needed?" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="original_amount" label="Original Amount">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="supplement_amount" label="Supplement Amount">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="submitted_to" label="Submit To (PA Name)">
                <Input placeholder="Public adjuster name" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="submitted_to_email" label="PA Email">
                <Input placeholder="pa@example.com" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="priority" label="Priority" initialValue="normal">
            <Select options={[
              { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal title={selectedSupplement?.title} open={detailModalOpen} width={700} footer={null}
        onCancel={() => { setDetailModalOpen(false); setSelectedSupplement(null); }}>
        {selectedSupplement && (
          <div>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Claim #">{selectedSupplement.claim_number}</Descriptions.Item>
              <Descriptions.Item label="Insurance">{selectedSupplement.insurance_company}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Select size="small" value={selectedSupplement.status} style={{ width: 140 }}
                  onChange={v => updateMutation.mutate({ id: selectedSupplement.id, data: { status: v } })}
                  options={['identified','in_progress','submitted','under_review','approved','denied','withdrawn']
                    .map(s => ({ value: s, label: s.replace('_',' ').toUpperCase() }))} />
              </Descriptions.Item>
              <Descriptions.Item label="Priority">{selectedSupplement.priority}</Descriptions.Item>
              <Descriptions.Item label="Original">{formatCurrency(selectedSupplement.original_amount)}</Descriptions.Item>
              <Descriptions.Item label="Supplement">{formatCurrency(selectedSupplement.supplement_amount)}</Descriptions.Item>
              <Descriptions.Item label="Difference">
                <Text type={selectedSupplement.difference > 0 ? 'success' : 'danger'}>
                  {formatCurrency(selectedSupplement.difference)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Submitted To">{selectedSupplement.submitted_to || '-'}</Descriptions.Item>
            </Descriptions>

            {selectedSupplement.reason && (
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary">Reason:</Text>
                <div>{selectedSupplement.reason}</div>
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* Bid Items */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>Bid Item Estimates</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setBidItemModalOpen(true)}>
                Add Bid Item
              </Button>
            </div>

            {(selectedSupplement.bid_items || []).length === 0 ? (
              <Empty description="No bid items yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table size="small" dataSource={selectedSupplement.bid_items} rowKey="id" pagination={false}
                columns={[
                  { title: 'Type', dataIndex: 'estimate_type', width: 100,
                    render: (t: string) => <Tag>{BID_TYPE_LABELS[t] || t}</Tag> },
                  { title: 'Title', dataIndex: 'title', ellipsis: true },
                  { title: 'Amount', dataIndex: 'custom_amount', width: 100, align: 'right' as const,
                    render: (v?: number) => v ? formatCurrency(v) : '-' },
                  { title: 'Status', dataIndex: 'status', width: 120,
                    render: (s: string) => (
                      <Tag color={BID_STATUS_COLORS[s] || 'default'}>{s.replace('_',' ').toUpperCase()}</Tag>
                    ),
                  },
                  { title: 'PA Sent', dataIndex: 'sent_to_pa_date', width: 100,
                    render: (d?: string) => d ? dayjs(d).format('MM/DD') : '-' },
                ]}
              />
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* Follow-ups */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>Follow-ups</Text>
              <Button size="small" icon={<PhoneOutlined />} onClick={() => setFollowupModalOpen(true)}>
                Log Follow-up
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Bid Item Modal */}
      <Modal title="Add Bid Item Estimate" open={bidItemModalOpen} width={450}
        onOk={() => bidItemForm.validateFields().then(v => {
          if (selectedSupplement) {
            createBidItemMutation.mutate({
              supplementId: selectedSupplement.id,
              data: { ...v, supplement_id: selectedSupplement.id },
            });
          }
        })}
        onCancel={() => { setBidItemModalOpen(false); bidItemForm.resetFields(); }}
        confirmLoading={createBidItemMutation.isPending}>
        <Form form={bidItemForm} layout="vertical" size="small">
          <Form.Item name="estimate_type" label="Type" rules={[{ required: true }]}>
            <Select options={Object.entries(BID_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Master Bathroom Rebuild" />
          </Form.Item>
          <Form.Item name="custom_amount" label="Amount">
            <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Log Follow-up Modal */}
      <Modal title="Log Follow-up" open={followupModalOpen} width={450}
        onOk={() => followupForm.validateFields().then(v => {
          if (selectedSupplement) {
            createFollowupMutation.mutate({
              supplementId: selectedSupplement.id,
              data: { ...v, supplement_id: selectedSupplement.id },
            });
          }
        })}
        onCancel={() => { setFollowupModalOpen(false); followupForm.resetFields(); }}
        confirmLoading={createFollowupMutation.isPending}>
        <Form form={followupForm} layout="vertical" size="small">
          <Form.Item name="contact_method" label="Contact Method" rules={[{ required: true }]}>
            <Select options={[
              { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' },
              { value: 'text', label: 'Text' }, { value: 'in_person', label: 'In Person' },
            ]} />
          </Form.Item>
          <Form.Item name="contact_name" label="Contact Name">
            <Input placeholder="PA or adjuster name" />
          </Form.Item>
          <Form.Item name="summary" label="Summary">
            <TextArea rows={3} placeholder="What was discussed?" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplementManagement;
