import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Statistic, Tooltip, Badge,
  Dropdown, Alert, Checkbox,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined,
  DeleteOutlined, EllipsisOutlined,
  FilePdfOutlined, LoadingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { supplementService } from '../services/supplementService';
import { fileService } from '../services/fileService';
import type {
  SupplementRequest, SupplementRequestCreate,
} from '../types/supplement';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  identified: 'blue', in_progress: 'processing', submitted: 'orange',
  under_review: 'geekblue', approved: 'green', denied: 'red', withdrawn: 'default',
};

const BID_TYPE_LABELS: Record<string, string> = {
  xactimate: 'Xactimate', bathroom: 'Bathroom', cabinet: 'Cabinet', packing: 'Packing',
  roofing: 'Roofing', kitchen: 'Kitchen', flooring: 'Flooring', other: 'Other',
};

const BID_STATUS_COLORS: Record<string, string> = {
  draft: 'default', sent: 'blue', approved: 'green', revision_needed: 'orange', denied: 'red',
};

const REQUIRED_ESTIMATE_OPTIONS = [
  { key: 'xactimate', label: 'Xactimate' },
  { key: 'pack_in_out', label: 'Pack-in / Pack-out' },
  { key: 'cabinet', label: 'Cabinet' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'flooring', label: 'Flooring' },
];

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const SupplementManagement: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [claimPaInfo, setClaimPaInfo] = useState<{ pa_name: string; pa_email: string } | null>(null);
  const [claimPaLoading, setClaimPaLoading] = useState(false);

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['supplement-stats'],
    queryFn: () => supplementService.getStats(),
  });

  const { data: supplements = [], isLoading, refetch } = useQuery({
    queryKey: ['supplements', statusFilter],
    queryFn: () => supplementService.list({ status: statusFilter, page_size: 100 }),
  });

  const { data: pendingReview = [] } = useQuery({
    queryKey: ['supplements-pending-review'],
    queryFn: () => supplementService.getPendingReview(),
  });

  // Pre-load insurance estimate file IDs for all supplements in the list
  const [estimateFileMap, setEstimateFileMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!supplements.length) return;
    const claimIds = Array.from(new Set(supplements.map(s => s.claim_id).filter(Boolean)));
    const newIds = claimIds.filter(id => !(id in estimateFileMap));
    if (!newIds.length) return;

    newIds.forEach(claimId => {
      supplementService.getInsuranceEstimate(claimId).then(est => {
        if (est && (est as any).file_download_id) {
          setEstimateFileMap(prev => ({ ...prev, [claimId]: (est as any).file_download_id }));
        } else {
          setEstimateFileMap(prev => ({ ...prev, [claimId]: '' }));
        }
      }).catch(() => {
        setEstimateFileMap(prev => ({ ...prev, [claimId]: '' }));
      });
    });
  }, [supplements]);

  // Auto-fetch PA info when claim_id is entered in create form
  const handleClaimIdChange = useCallback(async (claimId: string) => {
    const trimmed = claimId.trim();
    if (trimmed.length < 36) {
      setClaimPaInfo(null);
      return;
    }
    setClaimPaLoading(true);
    try {
      const info = await supplementService.getClaimPaInfo(trimmed);
      if (info.pa_name || info.pa_email) {
        setClaimPaInfo(info);
        createForm.setFieldsValue({
          submitted_to: info.pa_name || undefined,
          submitted_to_email: info.pa_email || undefined,
        });
      } else {
        setClaimPaInfo(null);
      }
    } catch {
      setClaimPaInfo(null);
    } finally {
      setClaimPaLoading(false);
    }
  }, [createForm]);

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => supplementService.delete(id),
    onSuccess: () => {
      message.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
    },
  });

  const columns: ColumnsType<SupplementRequest> = [
    {
      title: 'Claim #',
      key: 'claim',
      width: 140,
      render: (_, r) => {
        const fileId = estimateFileMap[r.claim_id];
        return (
          <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/supplements/${r.id}`)}>
            <div>
              <Text strong style={{ color: '#1890ff' }}>{r.claim_number || '-'}</Text>
              {fileId && (
                <a
                  href={`${fileService.getDownloadUrl(fileId)}?inline=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ marginLeft: 6 }}
                >
                  <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 13 }} />
                </a>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>{r.insurance_company}</Text>
          </div>
        );
      },
    },
    {
      title: 'Address', dataIndex: 'property_address', key: 'address', ellipsis: true,
      render: (addr: string, r) => (
        <Text style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => navigate(`/supplements/${r.id}`)}>
          {addr || '-'}
        </Text>
      ),
    },
    {
      title: 'Original', dataIndex: 'original_amount', key: 'original', width: 100,
      align: 'right', render: formatCurrency,
    },
    {
      title: 'Supplement', dataIndex: 'supplement_amount', key: 'supplement', width: 100,
      align: 'right', render: (v: number) => <Text strong>{formatCurrency(v)}</Text>,
    },
    {
      title: 'Diff', dataIndex: 'difference', key: 'diff', width: 95, align: 'right',
      render: (v: number) => (
        <Text type={v > 0 ? 'success' : v < 0 ? 'danger' : undefined}>{formatCurrency(v)}</Text>
      ),
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: (s: string) => <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ').toUpperCase()}</Tag>,
    },
    {
      title: 'Required', key: 'required_estimates', width: 200,
      responsive: ['xl'],
      render: (_, r) => {
        const re = r.required_estimates || {};
        const active = Object.entries(re).filter(([, v]) => v);
        if (active.length === 0) return <Text type="secondary">-</Text>;
        return (
          <Space size={[0, 4]} wrap>
            {active.map(([k]) => {
              const opt = REQUIRED_ESTIMATE_OPTIONS.find(o => o.key === k);
              return <Tag key={k} color="blue">{opt?.label || k}</Tag>;
            })}
          </Space>
        );
      },
    },
    {
      title: 'Bids', dataIndex: 'bid_item_count', key: 'bid_items', width: 55, align: 'center',
      responsive: ['lg'],
      render: (c: number) => <Badge count={c} showZero style={{ backgroundColor: c > 0 ? '#1890ff' : '#d9d9d9' }} />,
    },
    {
      title: '', key: 'actions', width: 44, align: 'center',
      render: (_, r) => (
        <Dropdown menu={{
          items: [
            { key: 'delete', label: 'Delete', danger: true, icon: <DeleteOutlined />,
              onClick: () => Modal.confirm({ title: 'Delete?', onOk: () => deleteMutation.mutate(r.id) }) },
          ],
        }}>
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
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

      {/* Pending Review Alert */}
      {pendingReview.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              <strong>{pendingReview.length} estimate{pendingReview.length > 1 ? 's' : ''} pending review</strong>
              {' — '}Insurance estimates received but not yet reviewed for supplement needs.
            </span>
          }
          description={
            <Space direction="vertical" size={4} style={{ marginTop: 4 }}>
              {pendingReview.map(s => (
                <Button
                  key={s.id}
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left', wordBreak: 'break-word' }}
                  onClick={() => navigate(`/supplements/${s.id}`)}
                >
                  {s.title} — {s.claim_number || 'No claim #'} ({s.insurance_company || 'N/A'})
                </Button>
              ))}
            </Space>
          }
        />
      )}

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
          size="small" scroll={{ x: 700 }}
          pagination={{ pageSize: 20, showTotal: t => `${t} supplements` }} />
      </Card>

      {/* Create Modal */}
      <Modal title="Create Supplement Request" open={createModalOpen} width={550}
        onOk={() => createForm.validateFields().then(v => {
          const { required_estimate_keys, ...rest } = v;
          const required_estimates: Record<string, boolean> = {};
          REQUIRED_ESTIMATE_OPTIONS.forEach(opt => {
            required_estimates[opt.key] = (required_estimate_keys || []).includes(opt.key);
          });
          createMutation.mutate({ ...rest, required_estimates });
        })}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
          setClaimPaInfo(null);
        }}
        confirmLoading={createMutation.isPending}>
        <Form form={createForm} layout="vertical" size="small">
          <Form.Item name="claim_id" label="Claim ID" rules={[{ required: true }]}>
            <Input
              placeholder="Claim UUID"
              onChange={e => handleClaimIdChange(e.target.value)}
              suffix={claimPaLoading ? <LoadingOutlined /> : undefined}
            />
          </Form.Item>
          {claimPaInfo && (
            <Alert
              type="info"
              message={`PA auto-assigned: ${claimPaInfo.pa_name}${claimPaInfo.pa_email ? ` (${claimPaInfo.pa_email})` : ''}`}
              style={{ marginBottom: 12 }}
              showIcon
            />
          )}
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Supplement for bathroom rebuild" />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} placeholder="Why is re-estimation needed?" />
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
                <Input placeholder="Auto-filled from claim PA" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="submitted_to_email" label="PA Email">
                <Input placeholder="Auto-filled from claim PA" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="priority" label="Priority" initialValue="normal">
            <Select options={[
              { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
            ]} />
          </Form.Item>
          <Form.Item name="required_estimate_keys" label="Required Estimates">
            <Checkbox.Group>
              <Row>
                {REQUIRED_ESTIMATE_OPTIONS.map(opt => (
                  <Col span={12} key={opt.key}>
                    <Checkbox value={opt.key}>{opt.label}</Checkbox>
                  </Col>
                ))}
              </Row>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default SupplementManagement;
