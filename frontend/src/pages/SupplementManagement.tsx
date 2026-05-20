import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Statistic, Tooltip, Badge,
  Dropdown, Collapse, Descriptions, DatePicker, Divider, Empty, Checkbox, Alert, Upload,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  EditOutlined, DeleteOutlined, EllipsisOutlined, FileTextOutlined,
  DollarOutlined, SendOutlined, PhoneOutlined, ClockCircleOutlined,
  AuditOutlined, FilePdfOutlined, SaveOutlined, UploadOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../services/api';
import { supplementService } from '../services/supplementService';
import { emailIngestionService } from '../services/emailIngestionService';
import { fileService } from '../services/fileService';
import RichTextEditor from '../components/editor/RichTextEditor';
import { bathroomEstimateService } from '../services/bathroomEstimateService';
import { cabinetEstimateService } from '../services/cabinetEstimateService';
import { listEstimates as listPackingEstimates } from '../services/packingEstimateService';
import type {
  SupplementRequest, SupplementRequestCreate, BidItemEstimate,
  BidItemEstimateCreate, SupplementFollowUp, SupplementStatus,
  SUPPLEMENT_STATUS_COLORS, BID_ITEM_TYPE_LABELS, BID_ITEM_STATUS_COLORS,
} from '../types/supplement';
import type { ClaimNegotiation, NegotiationSection } from '../types/client';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

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
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedSupplement, setSelectedSupplement] = useState<SupplementRequest | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [bidItemModalOpen, setBidItemModalOpen] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [insuranceEstimate, setInsuranceEstimate] = useState<(ClaimNegotiation & { file_download_id?: string | null }) | null>(null);
  const [insuranceEstimateLoading, setInsuranceEstimateLoading] = useState(false);
  const [estimateVersions, setEstimateVersions] = useState<(ClaimNegotiation & { file_download_id?: string | null })[]>([]);
  const [estimateVersionsLoading, setEstimateVersionsLoading] = useState(false);
  const [uploadEstimateModalOpen, setUploadEstimateModalOpen] = useState(false);
  const [uploadEstimateLoading, setUploadEstimateLoading] = useState(false);
  const [uploadEstimateFileId, setUploadEstimateFileId] = useState<string | null>(null);
  const [uploadEstimateFileName, setUploadEstimateFileName] = useState<string | null>(null);
  const [uploadEstimateForm] = Form.useForm();
  const [editedRequiredEstimates, setEditedRequiredEstimates] = useState<string[]>([]);
  const [requiredEstimatesDirty, setRequiredEstimatesDirty] = useState(false);
  const [bidItemFile, setBidItemFile] = useState<{ id: string; name: string } | null>(null);
  const [bidItemFileUploading, setBidItemFileUploading] = useState(false);
  const [bidItemType, setBidItemType] = useState<string>('');
  const [linkedEstimateId, setLinkedEstimateId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sendPaModalOpen, setSendPaModalOpen] = useState(false);
  const [sendPaLoading, setSendPaLoading] = useState(false);
  const [paInfo, setPaInfo] = useState<any>(null);
  const [paEmailContent, setPaEmailContent] = useState<{ subject: string; body_html: string }>({ subject: '', body_html: '' });
  const [paCustomNotes, setPaCustomNotes] = useState('');
  const [paCcEmails, setPaCcEmails] = useState<string[]>([]);
  const [paSelectedAccountId, setPaSelectedAccountId] = useState<string | undefined>();
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

  const { data: emailAccounts = [] } = useQuery({
    queryKey: ['email-accounts-for-supplement'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

  const { data: pendingReview = [] } = useQuery({
    queryKey: ['supplements-pending-review'],
    queryFn: () => supplementService.getPendingReview(),
  });

  // Estimate pickers for bid item form
  const { data: bathroomEstimatesForBid = [] } = useQuery({
    queryKey: ['bathroom-estimates-for-bid'],
    queryFn: () => bathroomEstimateService.list({ page_size: 50 }).then(r => r.items),
    enabled: bidItemModalOpen && bidItemType === 'bathroom',
  });
  const { data: cabinetEstimatesForBid = [] } = useQuery({
    queryKey: ['cabinet-estimates-for-bid'],
    queryFn: () => cabinetEstimateService.list({ page_size: 50 }).then(r => r.items),
    enabled: bidItemModalOpen && bidItemType === 'cabinet',
  });
  const { data: packingEstimatesForBid = [] } = useQuery({
    queryKey: ['packing-estimates-for-bid'],
    queryFn: () => listPackingEstimates({ limit: 50 }).then(r => r.items),
    enabled: bidItemModalOpen && bidItemType === 'packing',
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

  const ESTIMATE_ID_FIELD_MAP: Record<string, string> = {
    bathroom: 'bathroom_estimate_id',
    cabinet: 'cabinet_estimate_id',
    packing: 'pack_calculation_id',
    roofing: 'roofing_estimate_id',
  };

  const closeBidItemModal = () => {
    setBidItemModalOpen(false);
    bidItemForm.resetFields();
    setBidItemFile(null);
    setBidItemType('');
    setLinkedEstimateId(null);
  };

  const createBidItemMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: BidItemEstimateCreate }) =>
      supplementService.createBidItem(supplementId, data),
    onSuccess: () => {
      message.success('Bid item added');
      closeBidItemModal();
      if (selectedSupplement) {
        supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      }
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
      queryClient.invalidateQueries({ queryKey: ['supplements-pending-review'] });
    },
  });

  const updateBidItemMutation = useMutation({
    mutationFn: ({ supplementId, itemId, data }: { supplementId: string; itemId: string; data: Partial<BidItemEstimate> }) =>
      supplementService.updateBidItem(supplementId, itemId, data),
    onSuccess: () => {
      if (selectedSupplement) {
        supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      }
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
      queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
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

  const openDetail = (r: SupplementRequest) => {
    supplementService.get(r.id).then(data => {
      setSelectedSupplement(data);
      setDetailModalOpen(true);
      // Init required estimates local state
      const re = data.required_estimates || {};
      setEditedRequiredEstimates(Object.entries(re).filter(([, v]) => v).map(([k]) => k));
      setRequiredEstimatesDirty(false);
      // Fetch all insurance estimate versions for this claim
      if (data.claim_id) {
        setInsuranceEstimateLoading(true);
        setEstimateVersionsLoading(true);
        supplementService.listInsuranceEstimates(data.claim_id)
          .then(versions => {
            setEstimateVersions(versions);
            setInsuranceEstimate(versions.length > 0 ? versions[0] : null);
          })
          .catch(() => { setEstimateVersions([]); setInsuranceEstimate(null); })
          .finally(() => { setInsuranceEstimateLoading(false); setEstimateVersionsLoading(false); });
      }
    });
  };

  const openSendPaModal = async () => {
    if (!selectedSupplement) return;
    try {
      const [info, content] = await Promise.all([
        supplementService.getPaInfo(selectedSupplement.id),
        supplementService.generatePaEmail(selectedSupplement.id),
      ]);
      setPaInfo(info);
      setPaEmailContent(content);
      setPaCustomNotes('');
      // Pre-select CC emails from same company
      setPaCcEmails((info.cc_emails || []).map((c: any) => c.email));
      // Auto-select first email account
      if (emailAccounts.length > 0 && !paSelectedAccountId) {
        setPaSelectedAccountId(emailAccounts[0].id);
      }
      setSendPaModalOpen(true);
    } catch {
      message.error('Failed to load PA info');
    }
  };

  const handleRegenerateEmail = async () => {
    if (!selectedSupplement) return;
    try {
      const content = await supplementService.generatePaEmail(
        selectedSupplement.id,
        paCustomNotes,
      );
      setPaEmailContent(content);
      message.success('Email regenerated with notes');
    } catch {
      message.error('Failed to regenerate');
    }
  };

  const handleSendToPa = async () => {
    if (!selectedSupplement || !paInfo?.pa_email) {
      message.error('No PA email address');
      return;
    }
    setSendPaLoading(true);
    try {
      const result = await supplementService.sendToPa(selectedSupplement.id, {
        to_addresses: [paInfo.pa_email],
        cc_addresses: paCcEmails,
        subject: paEmailContent.subject,
        body_html: paEmailContent.body_html,
        pa_name: paInfo.pa_name,
        email_account_id: paSelectedAccountId,
      });
      message.success(
        `Sent to PA with ${result.attachments_count} PDF attachment(s)`,
      );
      setSendPaModalOpen(false);
      // Refresh supplement data
      supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
      queryClient.invalidateQueries({ queryKey: ['supplements'] });
    } catch (err: any) {
      message.error(
        err?.response?.data?.detail || 'Failed to send email',
      );
    } finally {
      setSendPaLoading(false);
    }
  };

  const PDF_URL_MAP: Record<string, string> = {
    bathroom: '/api/bathroom-estimates',
    cabinet: '/api/cabinet-estimates',
    packing: '/api/packing-estimates',
  };

  const openEstimatePdf = async (type: string, id: string) => {
    const base = PDF_URL_MAP[type];
    if (!base) return;
    try {
      setPdfLoading(true);
      const response = await api.get(`${base}/${id}/export/pdf`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(blobUrl, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
    } catch {
      message.error('Failed to load PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const columns: ColumnsType<SupplementRequest> = [
    {
      title: 'Claim #',
      key: 'claim',
      width: 160,
      render: (_, r) => {
        const fileId = estimateFileMap[r.claim_id];
        return (
          <div style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
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
            {r.property_address && (
              <div><Text type="secondary" style={{ fontSize: 11 }}>{r.property_address}</Text></div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Title', dataIndex: 'title', key: 'title', ellipsis: true,
      responsive: ['lg'],
      render: (title: string, r) => (
        <Text style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => openDetail(r)}>
          {title}
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
                  onClick={() => {
                    supplementService.get(s.id).then(data => {
                      setSelectedSupplement(data);
                      setDetailModalOpen(true);
                    });
                  }}
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

      {/* Detail Modal */}
      <Modal title={selectedSupplement?.title} open={detailModalOpen} width={700} footer={null}
        onCancel={() => { setDetailModalOpen(false); setSelectedSupplement(null); setInsuranceEstimate(null); setEstimateVersions([]); }}>
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

            {/* Insurance Company Estimates - Version Management */}
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[{
                key: 'insurance-estimates',
                label: (
                  <Space>
                    <FileTextOutlined />
                    <Text strong>Insurance Company Estimates</Text>
                    {estimateVersions.length > 0 && (
                      <Tag color="blue">{estimateVersions.length} version{estimateVersions.length > 1 ? 's' : ''}</Tag>
                    )}
                  </Space>
                ),
                children: estimateVersionsLoading ? (
                  <div style={{ textAlign: 'center', padding: 16 }}>
                    <LoadingOutlined style={{ marginRight: 8 }} />
                    <Text type="secondary">Loading...</Text>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<UploadOutlined />}
                        onClick={() => {
                          uploadEstimateForm.resetFields();
                          setUploadEstimateFileId(null);
                          setUploadEstimateFileName(null);
                          setUploadEstimateModalOpen(true);
                        }}
                      >
                        Upload New Estimate
                      </Button>
                    </div>

                    {estimateVersions.length === 0 ? (
                      <Empty description="No insurance estimates uploaded yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <div>
                        {estimateVersions.map((ver, idx) => (
                          <Card
                            key={ver.id}
                            size="small"
                            style={{
                              marginBottom: 8,
                              border: idx === 0 ? '1px solid #1890ff' : '1px solid #f0f0f0',
                              background: idx === 0 ? '#f6fbff' : '#fff',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <Space size={8} style={{ marginBottom: 6 }}>
                                  <Tag color={idx === 0 ? 'blue' : 'default'}>
                                    Rev #{ver.revision_number}
                                  </Tag>
                                  <Tag color={
                                    ver.revision_type === 'initial' ? 'green' :
                                    ver.revision_type === 'supplement' ? 'orange' :
                                    ver.revision_type === 're_inspection' ? 'purple' :
                                    ver.revision_type === 'appraisal' ? 'cyan' :
                                    ver.revision_type === 'final' ? 'gold' : 'default'
                                  }>
                                    {ver.revision_type?.replace('_', ' ').toUpperCase()}
                                  </Tag>
                                  {idx === 0 && <Tag color="processing">LATEST</Tag>}
                                </Space>

                                <Row gutter={16} style={{ fontSize: 12 }}>
                                  <Col span={6}>
                                    <Text type="secondary">RCV:</Text>{' '}
                                    <Text strong>{formatCurrency(ver.rcv_amount)}</Text>
                                  </Col>
                                  <Col span={6}>
                                    <Text type="secondary">ACV:</Text>{' '}
                                    <Text strong>{formatCurrency(ver.acv_amount)}</Text>
                                  </Col>
                                  <Col span={6}>
                                    <Text type="secondary">Depreciation:</Text>{' '}
                                    <Text>{formatCurrency(ver.depreciation_amount)}</Text>
                                  </Col>
                                  <Col span={6}>
                                    <Text type="secondary">Deductible:</Text>{' '}
                                    <Text>{formatCurrency(ver.deductible)}</Text>
                                  </Col>
                                </Row>

                                <div style={{ fontSize: 11, marginTop: 4, color: '#888' }}>
                                  {ver.date_received && (
                                    <span>Received: {dayjs(ver.date_received).format('MM/DD/YYYY')}</span>
                                  )}
                                  {ver.received_from && (
                                    <span>{ver.date_received ? ' · ' : ''}From: {ver.received_from}</span>
                                  )}
                                  {ver.notes && (
                                    <span>{(ver.date_received || ver.received_from) ? ' · ' : ''}{ver.notes}</span>
                                  )}
                                </div>
                              </div>

                              <div style={{ marginLeft: 12 }}>
                                {ver.file_download_id ? (
                                  <a
                                    href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Button size="small" icon={<FilePdfOutlined style={{ color: '#ff4d4f' }} />}>
                                      {ver.document_name || 'View PDF'}
                                    </Button>
                                  </a>
                                ) : (
                                  <Text type="secondary" style={{ fontSize: 11 }}>No PDF</Text>
                                )}
                              </div>
                            </div>

                            {ver.sections_data && ver.sections_data.length > 0 && (
                              <Collapse size="small" style={{ marginTop: 8 }} items={[{
                                key: 'sections',
                                label: <Text style={{ fontSize: 11 }}>Section Breakdown ({ver.sections_data.length} sections)</Text>,
                                children: (
                                  <Table
                                    size="small"
                                    dataSource={ver.sections_data}
                                    rowKey={(r: NegotiationSection, i?: number) => `${r.section_name}-${i}`}
                                    pagination={false}
                                    scroll={{ x: 500 }}
                                    columns={[
                                      { title: 'Section', dataIndex: 'section_name', key: 'section', width: 180, ellipsis: true },
                                      { title: 'RCV', dataIndex: 'rcv', key: 'rcv', width: 100, align: 'right' as const,
                                        render: (v?: number) => v != null ? formatCurrency(v) : '-' },
                                      { title: 'Depreciation', dataIndex: 'depreciation', key: 'dep', width: 100, align: 'right' as const,
                                        render: (v?: number) => v != null ? formatCurrency(v) : '-' },
                                      { title: 'Net ACV', dataIndex: 'net_acv', key: 'acv', width: 100, align: 'right' as const,
                                        render: (v?: number) => v != null ? formatCurrency(v) : '-' },
                                    ]}
                                  />
                                ),
                              }]} />
                            )}
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              }]}
            />

            {/* Required Estimates Checklist */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong>Required Estimates</Text>
                {requiredEstimatesDirty && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={updateMutation.isPending}
                    onClick={() => {
                      const required_estimates: Record<string, boolean> = {};
                      REQUIRED_ESTIMATE_OPTIONS.forEach(opt => {
                        required_estimates[opt.key] = editedRequiredEstimates.includes(opt.key);
                      });
                      const hasAnyChecked = editedRequiredEstimates.length > 0;
                      const updateData: Partial<SupplementRequest> = { required_estimates };
                      // Auto-advance from 'identified' to 'in_progress' when review is done
                      if (hasAnyChecked && selectedSupplement.status === 'identified') {
                        updateData.status = 'in_progress';
                      }
                      updateMutation.mutate(
                        { id: selectedSupplement.id, data: updateData },
                        {
                          onSuccess: () => {
                            setRequiredEstimatesDirty(false);
                            queryClient.invalidateQueries({ queryKey: ['supplements-pending-review'] });
                          },
                        },
                      );
                    }}
                  >
                    Save
                  </Button>
                )}
              </div>
              <Checkbox.Group
                value={editedRequiredEstimates}
                onChange={(checkedValues) => {
                  setEditedRequiredEstimates(checkedValues as string[]);
                  setRequiredEstimatesDirty(true);
                }}
              >
                <Row>
                  {REQUIRED_ESTIMATE_OPTIONS.map(opt => (
                    <Col span={12} key={opt.key}>
                      <Checkbox value={opt.key}>{opt.label}</Checkbox>
                    </Col>
                  ))}
                </Row>
              </Checkbox.Group>
            </div>

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
            ) : (() => {
              const hasXactimate = selectedSupplement.bid_items.some(i => i.estimate_type === 'xactimate');
              const inXactItems = selectedSupplement.bid_items.filter(i => i.included_in_xactimate && i.estimate_type !== 'xactimate');
              const inXactTotal = inXactItems.reduce((s, i) => s + (i.custom_amount || 0), 0);
              const xactItem = selectedSupplement.bid_items.find(i => i.estimate_type === 'xactimate');
              const xactOriginal = xactItem?.custom_amount || 0;
              const xactNet = xactOriginal - inXactTotal;
              const separateItems = selectedSupplement.bid_items.filter(i => i.estimate_type !== 'xactimate' && !i.included_in_xactimate);
              const separateTotal = separateItems.reduce((s, i) => s + (i.custom_amount || 0), 0);
              // Total = Xact net + in-xact items (standalone) + separate items
              const supplementTotal = (hasXactimate ? xactNet : 0) + inXactTotal + separateTotal;

              return (
                <>
                  {hasXactimate && (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 8 }}
                      message="Xactimate가 다른 bid item 금액을 포함하고 있으면 'In Xact' 체크하세요. 체크된 항목은 Xactimate 금액에서 차감됩니다."
                    />
                  )}
                  <Table size="small" dataSource={selectedSupplement.bid_items} rowKey="id" pagination={false}
                    columns={[
                      { title: 'Type', dataIndex: 'estimate_type', width: 100,
                        render: (t: string) => <Tag>{BID_TYPE_LABELS[t] || t}</Tag> },
                      { title: 'Title', dataIndex: 'title', ellipsis: true,
                        render: (v: string, item: BidItemEstimate) => (
                          <Text
                            editable={{
                              onChange: (val) => {
                                if (val && val !== v) {
                                  updateBidItemMutation.mutate({
                                    supplementId: selectedSupplement.id,
                                    itemId: item.id,
                                    data: { title: val },
                                  });
                                }
                              },
                            }}
                          >
                            {v}
                          </Text>
                        ),
                      },
                      { title: 'Amount', dataIndex: 'custom_amount', width: 140, align: 'right' as const,
                        render: (v: number | undefined, item: BidItemEstimate) => (
                          <div>
                            <InputNumber
                              size="small"
                              min={0}
                              step={0.01}
                              prefix="$"
                              value={v || 0}
                              style={{
                                width: '100%',
                                ...(item.included_in_xactimate ? { textDecoration: 'line-through', color: '#999' } : {}),
                              }}
                              formatter={val => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                              parser={val => val?.replace(/[,$]/g, '') as any}
                              onBlur={(e) => {
                                const raw = e.target.value?.replace(/[,$]/g, '');
                                const num = parseFloat(raw || '0');
                                if (num !== (v || 0)) {
                                  updateBidItemMutation.mutate({
                                    supplementId: selectedSupplement.id,
                                    itemId: item.id,
                                    data: { custom_amount: num },
                                  });
                                }
                              }}
                              onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                            />
                            {item.estimate_type === 'xactimate' && inXactTotal > 0 && (
                              <div style={{ marginTop: 2 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  − {formatCurrency(inXactTotal)}
                                </Text>
                                <br />
                                <Text strong style={{ fontSize: 12, color: '#1890ff' }}>
                                  = {formatCurrency(xactNet)}
                                </Text>
                              </div>
                            )}
                          </div>
                        ) },
                      ...(hasXactimate ? [{
                        title: 'In Xact', key: 'in_xact', width: 70, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => item.estimate_type === 'xactimate' ? (
                          <Text type="secondary">-</Text>
                        ) : (
                          <Tooltip title="Xactimate에 이 항목 금액이 포함되어 있으면 체크">
                            <Checkbox
                              checked={item.included_in_xactimate}
                              onChange={e => {
                                updateBidItemMutation.mutate({
                                  supplementId: selectedSupplement.id,
                                  itemId: item.id,
                                  data: { included_in_xactimate: e.target.checked },
                                });
                              }}
                            />
                          </Tooltip>
                        ),
                      }] : []),
                      { title: 'PDF', key: 'pdf', width: 80, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => item.custom_document_file_id ? (
                          <Space size={4}>
                            <Tooltip title={item.custom_document_file_name || 'View PDF'}>
                              <a href={`${fileService.getDownloadUrl(item.custom_document_file_id)}?inline=true`}
                                target="_blank" rel="noopener noreferrer">
                                <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                              </a>
                            </Tooltip>
                            <Upload
                              accept=".pdf"
                              maxCount={1}
                              showUploadList={false}
                              beforeUpload={async (file) => {
                                if (file.type !== 'application/pdf') { message.error('PDF only'); return Upload.LIST_IGNORE; }
                                try {
                                  const uploaded = await fileService.uploadFiles([file], 'supplement_bid_item', item.id, 'estimate_pdf');
                                  if (uploaded.length > 0) {
                                    updateBidItemMutation.mutate({
                                      supplementId: selectedSupplement.id,
                                      itemId: item.id,
                                      data: { custom_document_file_id: uploaded[0].id, custom_document_file_name: file.name },
                                    });
                                  }
                                } catch { message.error('Upload failed'); }
                                return false;
                              }}
                            >
                              <Tooltip title="Replace PDF">
                                <Button type="text" size="small" icon={<UploadOutlined />} style={{ padding: 0, width: 22, height: 22 }} />
                              </Tooltip>
                            </Upload>
                          </Space>
                        ) : (
                          <Upload
                            accept=".pdf"
                            maxCount={1}
                            showUploadList={false}
                            beforeUpload={async (file) => {
                              if (file.type !== 'application/pdf') { message.error('PDF only'); return Upload.LIST_IGNORE; }
                              try {
                                const uploaded = await fileService.uploadFiles([file], 'supplement_bid_item', item.id, 'estimate_pdf');
                                if (uploaded.length > 0) {
                                  updateBidItemMutation.mutate({
                                    supplementId: selectedSupplement.id,
                                    itemId: item.id,
                                    data: { custom_document_file_id: uploaded[0].id, custom_document_file_name: file.name },
                                  });
                                }
                              } catch { message.error('Upload failed'); }
                              return false;
                            }}
                          >
                            <Tooltip title="Upload PDF">
                              <Button type="text" size="small" icon={<UploadOutlined />} style={{ color: '#1890ff' }} />
                            </Tooltip>
                          </Upload>
                        ) },
                      { title: '', key: 'actions', width: 40, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => (
                          <Tooltip title="Delete">
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => Modal.confirm({
                                title: 'Delete this bid item?',
                                onOk: () => {
                                  supplementService.deleteBidItem(selectedSupplement.id, item.id).then(() => {
                                    message.success('Deleted');
                                    supplementService.get(selectedSupplement.id).then(setSelectedSupplement);
                                    queryClient.invalidateQueries({ queryKey: ['supplements'] });
                                  });
                                },
                              })}
                            />
                          </Tooltip>
                        ) },
                    ]}
                  />

                  {/* Summary */}
                  <div style={{
                    marginTop: 8, padding: '8px 12px',
                    background: '#fafafa', borderRadius: 6, fontSize: 13,
                  }}>
                    {hasXactimate && inXactTotal > 0 && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary">Xactimate</Text>
                          <Text>{formatCurrency(xactOriginal)}</Text>
                        </div>
                        {inXactItems.map(i => (
                          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}>
                            <Text type="secondary" style={{ fontSize: 12, paddingLeft: 12 }}>
                              − {BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>−{formatCurrency(i.custom_amount)}</Text>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary">Xactimate (net)</Text>
                          <Text strong>{formatCurrency(xactNet)}</Text>
                        </div>
                        {inXactItems.map(i => (
                          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text type="secondary">{BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}</Text>
                            <Text>{formatCurrency(i.custom_amount)}</Text>
                          </div>
                        ))}
                        {separateItems.map(i => (
                          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text type="secondary">{BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}</Text>
                            <Text>{formatCurrency(i.custom_amount)}</Text>
                          </div>
                        ))}
                        <Divider style={{ margin: '4px 0' }} />
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text strong>Supplement Total</Text>
                      <Text strong style={{ color: '#1890ff', fontSize: 14 }}>
                        {formatCurrency(hasXactimate && inXactTotal > 0 ? supplementTotal : selectedSupplement.supplement_amount)}
                      </Text>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Send to PA */}
            {(selectedSupplement.bid_items || []).length > 0 && (
              <div style={{ margin: '16px 0', textAlign: 'center' }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<SendOutlined />}
                  onClick={openSendPaModal}
                  disabled={!selectedSupplement.bid_items?.some(i => i.custom_document_file_id)}
                >
                  Send to PA
                </Button>
                {!selectedSupplement.bid_items?.some(i => i.custom_document_file_id) && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Upload bid item PDFs first</Text>
                  </div>
                )}
                {selectedSupplement.submitted_date && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Last sent: {dayjs(selectedSupplement.submitted_date).format('MM/DD/YYYY')}
                      {selectedSupplement.submitted_to && ` to ${selectedSupplement.submitted_to}`}
                    </Text>
                  </div>
                )}
              </div>
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

      {/* Send to PA Modal */}
      <Modal
        title={
          <Space>
            <SendOutlined />
            <span>Send Supplement to PA</span>
          </Space>
        }
        open={sendPaModalOpen}
        width={700}
        onCancel={() => setSendPaModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setSendPaModalOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="send"
            type="primary"
            icon={<SendOutlined />}
            loading={sendPaLoading}
            onClick={handleSendToPa}
            disabled={!paInfo?.pa_email}
          >
            Send Email
          </Button>,
        ]}
      >
        {paInfo && (
          <div>
            {/* From Account */}
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ marginRight: 8 }}>From:</Text>
              {emailAccounts.length > 0 ? (
                <Select
                  value={paSelectedAccountId}
                  onChange={setPaSelectedAccountId}
                  style={{ width: 320 }}
                  options={emailAccounts.filter((a: any) => a.is_active).map((a: any) => ({
                    value: a.id,
                    label: `${a.display_name} (${a.email_address})`,
                  }))}
                />
              ) : (
                <Text type="warning">No email accounts configured</Text>
              )}
            </div>

            {/* To */}
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ marginRight: 8 }}>To:</Text>
              <Text strong>{paInfo.pa_name}</Text>
              <Text> ({paInfo.pa_email})</Text>
              {paInfo.pa_company && (
                <Tag style={{ marginLeft: 8 }}>{paInfo.pa_company}</Tag>
              )}
              {!paInfo.pa_email && (
                <Alert type="warning" message="No PA email on file for this claim. Update Claim PA info first." showIcon style={{ marginTop: 8 }} />
              )}
            </div>

            {/* CC */}
            {paInfo.cc_emails?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ marginRight: 8 }}>CC (same company):</Text>
                <Checkbox.Group
                  value={paCcEmails}
                  onChange={(vals) => setPaCcEmails(vals as string[])}
                >
                  <Space direction="vertical" size={2}>
                    {paInfo.cc_emails.map((cc: any) => (
                      <Checkbox key={cc.email} value={cc.email}>
                        {cc.name ? `${cc.name} (${cc.email})` : cc.email}
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* Custom Notes */}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                Additional Notes (added to email)
              </Text>
              <Input.TextArea
                rows={3}
                placeholder="e.g., Added bathroom rebuild scope that was missing from original estimate..."
                value={paCustomNotes}
                onChange={e => setPaCustomNotes(e.target.value)}
              />
              <Button
                size="small"
                type="link"
                style={{ padding: '4px 0' }}
                onClick={handleRegenerateEmail}
              >
                Apply notes to email
              </Button>
            </div>

            {/* Subject */}
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Subject:</Text>
              <Input
                value={paEmailContent.subject}
                onChange={e => setPaEmailContent(prev => ({ ...prev, subject: e.target.value }))}
              />
            </div>

            {/* Body */}
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Email Body:</Text>
              <RichTextEditor
                value={paEmailContent.body_html}
                onChange={val => setPaEmailContent(prev => ({ ...prev, body_html: val }))}
                placeholder="Email content..."
                minHeight={300}
                maxHeight={500}
              />
            </div>

            {/* Attachments preview */}
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                Attachments (bid item PDFs):
              </Text>
              <Space direction="vertical" size={2}>
                {(selectedSupplement?.bid_items || [])
                  .filter(i => i.custom_document_file_id)
                  .map(i => (
                    <Space key={i.id} size={4}>
                      <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                      <Text style={{ fontSize: 12 }}>{i.custom_document_file_name || i.title}</Text>
                      <Tag style={{ fontSize: 11 }}>{formatCurrency(i.custom_amount)}</Tag>
                    </Space>
                  ))}
                {!(selectedSupplement?.bid_items || []).some(i => i.custom_document_file_id) && (
                  <Text type="secondary">No PDFs attached</Text>
                )}
              </Space>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Bid Item Modal */}
      <Modal title="Add Bid Item Estimate" open={bidItemModalOpen} width={500}
        onOk={() => bidItemForm.validateFields().then(v => {
          if (selectedSupplement) {
            const idField = ESTIMATE_ID_FIELD_MAP[bidItemType];
            createBidItemMutation.mutate({
              supplementId: selectedSupplement.id,
              data: {
                ...v,
                supplement_id: selectedSupplement.id,
                custom_document_file_id: bidItemFile?.id,
                custom_document_file_name: bidItemFile?.name,
                ...(linkedEstimateId && idField ? { [idField]: linkedEstimateId } : {}),
              },
            });
          }
        })}
        onCancel={closeBidItemModal}
        confirmLoading={createBidItemMutation.isPending}>
        <Form form={bidItemForm} layout="vertical" size="small">
          <Form.Item name="estimate_type" label="Type" rules={[{ required: true }]}>
            <Select
              options={Object.entries(BID_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              onChange={v => { setBidItemType(v as string); setLinkedEstimateId(null); }}
            />
          </Form.Item>
          {/* Estimate picker for bathroom / cabinet / packing */}
          {['bathroom', 'cabinet', 'packing'].includes(bidItemType) && (
            <Form.Item label="Link to Existing Estimate (optional)">
              <Select
                allowClear
                showSearch
                placeholder="Select estimate to auto-fill title & amount..."
                optionFilterProp="label"
                value={linkedEstimateId ?? undefined}
                onChange={(val) => {
                  setLinkedEstimateId(val ?? null);
                  if (!val) return;
                  if (bidItemType === 'bathroom') {
                    const est = bathroomEstimatesForBid.find(e => e.id === val);
                    if (est) {
                      bidItemForm.setFieldsValue({
                        title: est.designation
                          ? `${est.designation} Bathroom${est.property_address ? ` — ${est.property_address}` : ''}`
                          : est.property_address || 'Bathroom Estimate',
                        custom_amount: est.total ?? undefined,
                      });
                    }
                  } else if (bidItemType === 'cabinet') {
                    const est = cabinetEstimatesForBid.find(e => e.id === val);
                    if (est) {
                      bidItemForm.setFieldsValue({
                        title: est.property_address || 'Cabinet Estimate',
                        custom_amount: est.total ?? undefined,
                      });
                    }
                  } else if (bidItemType === 'packing') {
                    const est = packingEstimatesForBid.find(e => e.id === val);
                    if (est) {
                      bidItemForm.setFieldsValue({
                        title: est.calculation_name || est.project_address || 'Packing Estimate',
                        custom_amount: est.grand_total ?? undefined,
                      });
                    }
                  }
                }}
                options={
                  bidItemType === 'bathroom'
                    ? bathroomEstimatesForBid.map(e => ({
                        value: e.id,
                        label: `${e.designation ? e.designation + ' — ' : ''}${e.property_address || e.id.slice(0, 8)} ($${(e.total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
                      }))
                    : bidItemType === 'cabinet'
                    ? cabinetEstimatesForBid.map(e => ({
                        value: e.id,
                        label: `${e.property_address || e.id.slice(0, 8)} ($${(e.total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
                      }))
                    : packingEstimatesForBid.map(e => ({
                        value: e.id,
                        label: `${e.calculation_name || e.project_address || e.id.slice(0, 8)} ($${((e.grand_total ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
                      }))
                }
              />
              {linkedEstimateId && (
                <Button
                  size="small"
                  type="link"
                  icon={<FilePdfOutlined style={{ color: '#ff4d4f' }} />}
                  loading={pdfLoading}
                  style={{ padding: '2px 0', marginTop: 4 }}
                  onClick={() => openEstimatePdf(bidItemType, linkedEstimateId)}
                >
                  View PDF
                </Button>
              )}
            </Form.Item>
          )}
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., Master Bathroom Rebuild" />
          </Form.Item>
          <Form.Item name="custom_amount" label="Amount">
            <InputNumber
              min={0}
              step={0.01}
              prefix="$"
              style={{ width: '100%' }}
              formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => v?.replace(/[,$]/g, '') as any}
            />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item label="Estimate PDF">
            {bidItemFile ? (
              <Space>
                <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                <Text ellipsis style={{ maxWidth: 250 }}>{bidItemFile.name}</Text>
                <Button type="link" size="small" danger onClick={() => setBidItemFile(null)}>Remove</Button>
              </Space>
            ) : (
              <Upload
                accept=".pdf"
                maxCount={1}
                showUploadList={false}
                beforeUpload={async (file) => {
                  if (file.type !== 'application/pdf') {
                    message.error('Only PDF files are allowed');
                    return Upload.LIST_IGNORE;
                  }
                  if (file.size > 20 * 1024 * 1024) {
                    message.error('File must be smaller than 20MB');
                    return Upload.LIST_IGNORE;
                  }
                  try {
                    setBidItemFileUploading(true);
                    const uploaded = await fileService.uploadFiles(
                      [file],
                      'supplement_bid_item',
                      selectedSupplement?.id || 'temp',
                      'estimate_pdf',
                    );
                    if (uploaded.length > 0) {
                      setBidItemFile({ id: uploaded[0].id, name: file.name });
                      message.success('PDF uploaded');
                    }
                  } catch {
                    message.error('Failed to upload PDF');
                  } finally {
                    setBidItemFileUploading(false);
                  }
                  return false;
                }}
              >
                <Button icon={bidItemFileUploading ? <LoadingOutlined /> : <UploadOutlined />}
                  disabled={bidItemFileUploading}>
                  {bidItemFileUploading ? 'Uploading...' : 'Upload PDF'}
                </Button>
              </Upload>
            )}
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

      {/* Upload Insurance Estimate Modal */}
      <Modal
        title="Upload Insurance Estimate"
        open={uploadEstimateModalOpen}
        width={500}
        confirmLoading={uploadEstimateLoading}
        onOk={() => {
          uploadEstimateForm.validateFields().then(async (values) => {
            if (!selectedSupplement) return;
            setUploadEstimateLoading(true);
            try {
              const payload: any = {
                revision_type: values.revision_type,
                acv_amount: values.acv_amount || 0,
                rcv_amount: values.rcv_amount || 0,
                depreciation_amount: values.depreciation_amount || 0,
                deductible: values.deductible || 0,
                received_from: values.received_from || undefined,
                notes: values.notes || undefined,
              };
              if (values.date_received) {
                payload.date_received = values.date_received.toISOString();
              }
              if (uploadEstimateFileId) {
                payload.file_id = uploadEstimateFileId;
              }
              await supplementService.uploadInsuranceEstimate(selectedSupplement.claim_id, payload);
              message.success('Insurance estimate uploaded');
              setUploadEstimateModalOpen(false);
              uploadEstimateForm.resetFields();
              setUploadEstimateFileId(null);
              setUploadEstimateFileName(null);
              // Reload versions
              supplementService.listInsuranceEstimates(selectedSupplement.claim_id)
                .then(versions => {
                  setEstimateVersions(versions);
                  setInsuranceEstimate(versions.length > 0 ? versions[0] : null);
                });
              queryClient.invalidateQueries({ queryKey: ['supplements'] });
            } catch (err: any) {
              message.error(err?.response?.data?.detail || 'Failed to upload estimate');
            } finally {
              setUploadEstimateLoading(false);
            }
          });
        }}
        onCancel={() => {
          setUploadEstimateModalOpen(false);
          uploadEstimateForm.resetFields();
          setUploadEstimateFileId(null);
          setUploadEstimateFileName(null);
        }}
      >
        <Form form={uploadEstimateForm} layout="vertical" size="small">
          <Form.Item name="revision_type" label="Estimate Type" rules={[{ required: true }]} initialValue="supplement">
            <Select options={[
              { value: 'initial', label: 'Initial Estimate' },
              { value: 'supplement', label: 'Supplement / Updated Estimate' },
              { value: 're_inspection', label: 'Re-inspection' },
              { value: 'appraisal', label: 'Appraisal' },
              { value: 'final', label: 'Final Estimate' },
            ]} />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="rcv_amount" label="RCV Amount">
                <InputNumber
                  style={{ width: '100%' }}
                  prefix="$"
                  precision={2}
                  min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => Number(v!.replace(/\$\s?|(,*)/g, '')) || 0}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="acv_amount" label="ACV Amount">
                <InputNumber
                  style={{ width: '100%' }}
                  prefix="$"
                  precision={2}
                  min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => Number(v!.replace(/\$\s?|(,*)/g, '')) || 0}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="depreciation_amount" label="Depreciation">
                <InputNumber
                  style={{ width: '100%' }}
                  prefix="$"
                  precision={2}
                  min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => Number(v!.replace(/\$\s?|(,*)/g, '')) || 0}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deductible" label="Deductible">
                <InputNumber
                  style={{ width: '100%' }}
                  prefix="$"
                  precision={2}
                  min={0}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => Number(v!.replace(/\$\s?|(,*)/g, '')) || 0}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="date_received" label="Date Received">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="received_from" label="Received From">
                <Input placeholder="Adjuster name or source" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="notes" label="Notes">
            <TextArea rows={2} placeholder="Optional notes about this estimate version" />
          </Form.Item>

          <Form.Item label="Estimate PDF">
            {uploadEstimateFileId ? (
              <Space>
                <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                <Text>{uploadEstimateFileName}</Text>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => { setUploadEstimateFileId(null); setUploadEstimateFileName(null); }}
                >
                  Remove
                </Button>
              </Space>
            ) : (
              <Upload
                accept=".pdf"
                maxCount={1}
                showUploadList={false}
                beforeUpload={async (file) => {
                  if (file.type !== 'application/pdf') {
                    message.error('PDF files only');
                    return Upload.LIST_IGNORE;
                  }
                  try {
                    const uploaded = await fileService.uploadFiles(
                      [file],
                      'negotiation',
                      selectedSupplement?.claim_id || 'unknown',
                      'insurance_estimate'
                    );
                    if (uploaded.length > 0) {
                      setUploadEstimateFileId(uploaded[0].id);
                      setUploadEstimateFileName(file.name);
                      message.success('PDF uploaded');
                    }
                  } catch {
                    message.error('Upload failed');
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>Select PDF File</Button>
              </Upload>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplementManagement;
