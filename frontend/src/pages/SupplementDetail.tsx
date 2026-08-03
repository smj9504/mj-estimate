import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Tooltip,
  Collapse, Descriptions, DatePicker, Divider, Empty, Checkbox, Alert, Upload,
  Spin, Badge, Table,
} from 'antd';
import {
  ArrowLeftOutlined, FileTextOutlined,
  SendOutlined, PhoneOutlined,
  FilePdfOutlined, SaveOutlined, UploadOutlined,
  LoadingOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../services/api';
import { supplementService } from '../services/supplementService';
import { emailIngestionService } from '../services/emailIngestionService';
import { fileService } from '../services/fileService';
import { claimFollowUpService } from '../services/claimFollowUpService';
import RichTextEditor from '../components/editor/RichTextEditor';
import { bathroomEstimateService } from '../services/bathroomEstimateService';
import { cabinetEstimateService } from '../services/cabinetEstimateService';
import { listEstimates as listPackingEstimates } from '../services/packingEstimateService';
import { companyService } from '../services/companyService';
import type {
  SupplementRequest, BidItemEstimate, BidItemEstimateCreate,
  SupplementFollowUp,
} from '../types/supplement';
import type { ClaimNegotiation, NegotiationSection } from '../types/client';

// Section category config — matches ClaimFollowUpDashboard
const SECTION_CATEGORIES: Record<string, {
  label: string;
  keywords: string[];
  color: string;
  bg: string;
  border: string;
}> = {
  reconstruction: {
    label: 'Reconstruction',
    keywords: ['dwelling', 'water damage', 'rebuild', 'reconstruction', 'drywall', 'flooring', 'paint', 'cabinet', 'plumb', 'electrical', 'code', 'upgrade', 'coverage a'],
    color: '#531dab', bg: '#f9f0ff', border: '#d3adf7',
  },
  water_mitigation: {
    label: 'Water Mitigation',
    keywords: ['water mitigation', 'emergency service', 'dry out', 'drying', 'dehumidifier', 'extraction'],
    color: '#0958d9', bg: '#e6f4ff', border: '#91caff',
  },
  mold_remediation: {
    label: 'Mold Remediation',
    keywords: ['mold', 'remediation', 'fungi', 'microbial'],
    color: '#d4380d', bg: '#fff2e8', border: '#ffbb96',
  },
  roofing: {
    label: 'Roofing',
    keywords: ['roof', 'shingle', 'flashing', 'gutter'],
    color: '#08979c', bg: '#e6fffb', border: '#87e8de',
  },
  other: {
    label: 'Other',
    keywords: [],
    color: '#595959', bg: '#fafafa', border: '#d9d9d9',
  },
};

const categorizeSection = (name: string): string => {
  const lower = name.toLowerCase();
  for (const [key, cfg] of Object.entries(SECTION_CATEGORIES)) {
    if (key === 'other') continue;
    if (cfg.keywords.some(kw => lower.includes(kw))) return key;
  }
  return 'other';
};

const groupSectionsByCategory = (sections: NegotiationSection[]) => {
  const grouped: Record<string, NegotiationSection[]> = {};
  sections.forEach(s => {
    const cat = categorizeSection(s.section_name || '');
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  });
  return grouped;
};

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = {
  identified: 'blue', in_progress: 'processing', submitted: 'orange',
  under_review: 'geekblue', approved: 'green', denied: 'red', withdrawn: 'default',
};

const BID_TYPE_LABELS: Record<string, string> = {
  xactimate: 'Xactimate', bathroom: 'Bathroom', cabinet: 'Cabinet', packing: 'Packing',
  roofing: 'Roofing', kitchen: 'Kitchen', flooring: 'Flooring', other: 'Other',
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

const ESTIMATE_ID_FIELD_MAP: Record<string, string> = {
  bathroom: 'bathroom_estimate_id',
  cabinet: 'cabinet_estimate_id',
  packing: 'pack_calculation_id',
  roofing: 'roofing_estimate_id',
};

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const SupplementDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [bidItemModalOpen, setBidItemModalOpen] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [uploadEstimateModalOpen, setUploadEstimateModalOpen] = useState(false);
  const [uploadEstimateLoading, setUploadEstimateLoading] = useState(false);
  const [uploadEstimateFileId, setUploadEstimateFileId] = useState<string | null>(null);
  const [uploadEstimateFileName, setUploadEstimateFileName] = useState<string | null>(null);
  const [uploadEstimateParsing, setUploadEstimateParsing] = useState(false);
  const [uploadEstimateSections, setUploadEstimateSections] = useState<any[]>([]);
  const [uploadEstimateForm] = Form.useForm();

  const [estimateVersions, setEstimateVersions] = useState<(ClaimNegotiation & { file_download_id?: string | null })[]>([]);
  const [estimateVersionsLoading, setEstimateVersionsLoading] = useState(false);

  // Editing sections for a saved estimate version
  const [editingSectionsVerId, setEditingSectionsVerId] = useState<string | null>(null);
  const [editingSections, setEditingSections] = useState<any[]>([]);
  const [editingTotals, setEditingTotals] = useState<{ rcv: number; acv: number; dep: number; ded: number }>({ rcv: 0, acv: 0, dep: 0, ded: 0 });
  const [savingSections, setSavingSections] = useState(false);

  const [editedRequiredEstimates, setEditedRequiredEstimates] = useState<string[]>([]);
  const [requiredEstimatesDirty, setRequiredEstimatesDirty] = useState(false);

  const [bidItemFile, setBidItemFile] = useState<{ id: string; name: string } | null>(null);
  const [bidItemFileUploading, setBidItemFileUploading] = useState(false);
  const [bidItemType, setBidItemType] = useState<string>('');
  const [bidItemParsedAmounts, setBidItemParsedAmounts] = useState<{
    rcv_amount?: number; acv_amount?: number; depreciation_amount?: number; deductible?: number;
  } | null>(null);
  const [linkedEstimateId, setLinkedEstimateId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [followups, setFollowups] = useState<SupplementFollowUp[]>([]);
  const [replacingEstimateId, setReplacingEstimateId] = useState<string | null>(null);
  const [polishingItemId, setPolishingItemId] = useState<string | null>(null);

  const [sendPaModalOpen, setSendPaModalOpen] = useState(false);
  const [sendPaLoading, setSendPaLoading] = useState(false);
  const [paInfo, setPaInfo] = useState<any>(null);
  const [paEmailContent, setPaEmailContent] = useState<{ subject: string; body_html: string }>({ subject: '', body_html: '' });
  const [paCustomNotes, setPaCustomNotes] = useState('');
  const [paToEmails, setPaToEmails] = useState<string[]>([]);
  const [paCcEmails, setPaCcEmails] = useState<string[]>([]);
  const [paSelectedAccountId, setPaSelectedAccountId] = useState<string | undefined>();
  const [paManualFromEmail, setPaManualFromEmail] = useState('');
  const [paDescriptionDraft, setPaDescriptionDraft] = useState('');
  const [polishingDescription, setPolishingDescription] = useState(false);
  const [paExtraFiles, setPaExtraFiles] = useState<File[]>([]);

  const [bidItemForm] = Form.useForm();
  const [followupForm] = Form.useForm();

  // Info request state
  const [infoRequestModalOpen, setInfoRequestModalOpen] = useState(false);
  const [infoRequestLoading, setInfoRequestLoading] = useState(false);
  const [infoItems, setInfoItems] = useState<string[]>(['']);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [infoRequestForm] = Form.useForm();

  // Response modal state
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [responseTargetFu, setResponseTargetFu] = useState<SupplementFollowUp | null>(null);
  const [responseSummary, setResponseSummary] = useState('');
  const [responseBodyHtml, setResponseBodyHtml] = useState('');
  const [responseFiles, setResponseFiles] = useState<File[]>([]);
  const [responseSubmitting, setResponseSubmitting] = useState(false);

  // Main supplement query
  const { data: supplement, isLoading, error } = useQuery({
    queryKey: ['supplement', id],
    queryFn: () => supplementService.get(id!),
    enabled: !!id,
  });

  const { data: allCompanies = [] } = useQuery({
    queryKey: ['companies-for-supplement'],
    queryFn: () => companyService.getCompanies(),
  });

  const { data: paDisplayInfo } = useQuery({
    queryKey: ['supplement-pa-info-display', id],
    queryFn: () => supplementService.getPaInfo(id!),
    enabled: !!id,
    staleTime: 60000,
  });

  const { data: emailAccounts = [] } = useQuery({
    queryKey: ['email-accounts-for-supplement'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

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

  const loadFollowups = useCallback((supplementId: string) => {
    supplementService.listFollowups(supplementId)
      .then(setFollowups)
      .catch(() => setFollowups([]));
  }, []);

  useEffect(() => {
    if (!supplement?.claim_id) return;
    setEstimateVersionsLoading(true);
    supplementService.listInsuranceEstimates(supplement.claim_id)
      .then(versions => setEstimateVersions(versions))
      .catch(() => setEstimateVersions([]))
      .finally(() => setEstimateVersionsLoading(false));
  }, [supplement?.claim_id]);

  useEffect(() => {
    if (!supplement) return;
    const re = supplement.required_estimates || {};
    setEditedRequiredEstimates(Object.entries(re).filter(([, v]) => v).map(([k]) => k));
    setRequiredEstimatesDirty(false);
  }, [supplement?.id]);

  useEffect(() => {
    if (supplement?.id) loadFollowups(supplement.id);
  }, [supplement?.id, loadFollowups]);

  // Manual IMAP reply check (button only — heavy operation)
  const [checkingReplies, setCheckingReplies] = useState(false);
  const triggerReplyCheck = useCallback(async () => {
    if (!supplement?.id) return;
    setCheckingReplies(true);
    try {
      const result = await claimFollowUpService.checkReplies();
      if (result.replies_found > 0) {
        message.success(`${result.replies_found} new reply(s) detected`);
      }
    } catch { /* silent */ }
    finally { setCheckingReplies(false); }
    loadFollowups(supplement.id);
  }, [supplement?.id, loadFollowups]);

  // Lightweight DB poll: re-read followups when pending info requests exist
  // Background scheduler (10min) handles IMAP → DB; this just picks up DB changes
  const hasPendingRef = React.useRef(false);
  hasPendingRef.current = followups.some(f =>
    f.info_status === 'pending' || f.info_status === 'sent' || f.info_status === 'awaiting_response'
  );
  useEffect(() => {
    if (!supplement?.id) return;
    const interval = setInterval(() => {
      if (hasPendingRef.current) loadFollowups(supplement.id);
    }, 120_000); // 2분마다 — 스케줄러 10분 주기 대비 충분
    return () => clearInterval(interval);
  }, [supplement?.id, loadFollowups]);

  const refreshSupplement = () => {
    queryClient.invalidateQueries({ queryKey: ['supplement', id] });
    queryClient.invalidateQueries({ queryKey: ['supplements'] });
    queryClient.invalidateQueries({ queryKey: ['supplement-stats'] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Partial<SupplementRequest>) => supplementService.update(id!, data),
    onSuccess: () => {
      message.success('Updated');
      refreshSupplement();
    },
  });

  const assignRebuildCompanyMutation = useMutation({
    mutationFn: ({ claimId, companyId }: { claimId: string; companyId: string }) =>
      supplementService.assignRebuildCompany(claimId, companyId),
    onSuccess: (result) => {
      message.success(`Rebuild company set: ${result.company_name}`);
      refreshSupplement();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to assign company'),
  });

  const closeBidItemModal = () => {
    setBidItemModalOpen(false);
    bidItemForm.resetFields();
    setBidItemFile(null);
    setBidItemType('');
    setLinkedEstimateId(null);
    setBidItemParsedAmounts(null);
  };

  const createBidItemMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: BidItemEstimateCreate }) =>
      supplementService.createBidItem(supplementId, data),
    onSuccess: () => {
      message.success('Bid item added');
      closeBidItemModal();
      refreshSupplement();
      queryClient.invalidateQueries({ queryKey: ['supplements-pending-review'] });
    },
  });

  const updateBidItemMutation = useMutation({
    mutationFn: ({ supplementId, itemId, data }: { supplementId: string; itemId: string; data: Partial<BidItemEstimate> }) =>
      supplementService.updateBidItem(supplementId, itemId, data),
    onSuccess: () => {
      refreshSupplement();
    },
  });

  const createFollowupMutation = useMutation({
    mutationFn: ({ supplementId, data }: { supplementId: string; data: Partial<SupplementFollowUp> }) =>
      supplementService.createFollowup(supplementId, data),
    onSuccess: () => {
      message.success('Follow-up logged');
      setFollowupModalOpen(false);
      followupForm.resetFields();
      refreshSupplement();
      if (supplement) loadFollowups(supplement.id);
    },
  });

  const openSendPaModal = async () => {
    if (!supplement) return;
    try {
      const [info, content] = await Promise.all([
        supplementService.getPaInfo(supplement.id),
        supplementService.generatePaEmail(supplement.id),
      ]);
      setPaInfo(info);
      setPaEmailContent(content);
      setPaCustomNotes('');
      setPaToEmails(info.pa_email ? [info.pa_email] : []);
      setPaCcEmails((info.cc_emails || []).map((c: any) => c.email));
      setPaManualFromEmail('');
      // Pre-populate description draft from bid item descriptions
      const descLines = (supplement.bid_items || [])
        .map(item => {
          const parts: string[] = [];
          if (item.title) parts.push(item.title);
          if (item.description) parts.push(item.description);
          return parts.join(': ');
        })
        .filter(Boolean);
      setPaDescriptionDraft(descLines.join('\n'));
      setPaExtraFiles([]);
      if (emailAccounts.length > 0 && !paSelectedAccountId) {
        setPaSelectedAccountId(emailAccounts[0].id);
      }
      setSendPaModalOpen(true);
    } catch {
      message.error('Failed to load PA info');
    }
  };

  const handleRegenerateEmail = async () => {
    if (!supplement) return;
    try {
      const content = await supplementService.generatePaEmail(supplement.id, paCustomNotes);
      setPaEmailContent(content);
      message.success('Email regenerated with notes');
    } catch {
      message.error('Failed to regenerate');
    }
  };

  const handleSendToPa = async () => {
    if (!supplement || paToEmails.length === 0) {
      message.error('No recipient email address');
      return;
    }
    setSendPaLoading(true);
    try {
      // Upload extra files first if any
      let extraFileIds: string[] = [];
      if (paExtraFiles.length > 0) {
        const uploaded = await fileService.uploadFiles(paExtraFiles, 'supplement', supplement.id, 'pa_attachment');
        extraFileIds = uploaded.map(f => f.id);
      }

      const result = await supplementService.sendToPa(supplement.id, {
        to_addresses: paToEmails,
        cc_addresses: paCcEmails,
        subject: paEmailContent.subject,
        body_html: paEmailContent.body_html,
        pa_name: paInfo.pa_name,
        email_account_id: paSelectedAccountId,
        from_address: paManualFromEmail.trim() || undefined,
        extra_file_ids: extraFileIds,
      });
      message.success(`Sent to PA with ${result.attachments_count} PDF attachment(s)`);
      setSendPaModalOpen(false);
      refreshSupplement();
      if (supplement) loadFollowups(supplement.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to send email');
    } finally {
      setSendPaLoading(false);
    }
  };

  const PDF_URL_MAP: Record<string, string> = {
    bathroom: '/api/bathroom-estimates',
    cabinet: '/api/cabinet-estimates',
    packing: '/api/packing-estimates',
  };

  const openEstimatePdf = async (type: string, estId: string) => {
    const base = PDF_URL_MAP[type];
    if (!base) return;
    try {
      setPdfLoading(true);
      const response = await api.get(`${base}/${estId}/export/pdf`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(blobUrl, '_blank');
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
    } catch {
      message.error('Failed to load PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !supplement) {
    const is404 = (error as any)?.response?.status === 404;
    if (is404) {
      message.warning('Supplement not found. It may have been deleted.');
      navigate('/supplements', { replace: true });
      return null;
    }
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplements')}>
          Back to Supplements
        </Button>
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Text type="danger">Failed to load supplement.</Text>
        </div>
      </div>
    );
  }

  // Bid item calculations
  const hasXactimate = supplement.bid_items?.some(i => i.estimate_type === 'xactimate');
  const inXactItems = supplement.bid_items?.filter(i => i.included_in_xactimate && i.estimate_type !== 'xactimate') || [];
  const inXactTotal = inXactItems.reduce((s, i) => s + (i.custom_amount || 0), 0);
  const xactItem = supplement.bid_items?.find(i => i.estimate_type === 'xactimate');
  const xactOriginal = xactItem?.custom_amount || 0;
  const xactNet = xactOriginal - inXactTotal;
  const separateItems = supplement.bid_items?.filter(i => i.estimate_type !== 'xactimate' && !i.included_in_xactimate) || [];
  const separateTotal = separateItems.reduce((s, i) => s + (i.custom_amount || 0), 0);
  const supplementTotal = (hasXactimate ? xactNet : 0) + inXactTotal + separateTotal;

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplements')}>
          Back
        </Button>
        <Title level={4} style={{ margin: 0, flex: 1 }}>
          {supplement.title}
        </Title>
        <Tag color={STATUS_COLORS[supplement.status] || 'default'} style={{ fontSize: 13, padding: '2px 10px' }}>
          {supplement.status?.replace('_', ' ').toUpperCase()}
        </Tag>
      </div>

      {/* Info + Status */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="top">
          <Col xs={24} md={15}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Claim #">{supplement.claim_number}</Descriptions.Item>
              <Descriptions.Item label="Insurance">{supplement.insurance_company}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Select size="small" value={supplement.status} style={{ width: 140 }}
                  onChange={v => updateMutation.mutate({ status: v })}
                  options={['identified','in_progress','submitted','under_review','approved','denied','withdrawn']
                    .map(s => ({ value: s, label: s.replace('_',' ').toUpperCase() }))} />
              </Descriptions.Item>
              <Descriptions.Item label="Priority">{supplement.priority}</Descriptions.Item>
              {supplement.request_type === 'estimate_request' ? (
                <Descriptions.Item label="Our Estimate">
                  <Text strong>{formatCurrency(supplement.our_estimate_amount)}</Text>
                </Descriptions.Item>
              ) : (
                <>
                  <Descriptions.Item label="Original">{formatCurrency(supplement.original_amount)}</Descriptions.Item>
                  <Descriptions.Item label="Supplement">{formatCurrency(supplement.supplement_amount)}</Descriptions.Item>
                  <Descriptions.Item label="Difference">
                    <Text type={supplement.difference > 0 ? 'success' : 'danger'}>
                      {formatCurrency(supplement.difference)}
                    </Text>
                  </Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="Submitted To">{supplement.submitted_to || '-'}</Descriptions.Item>
            </Descriptions>
            {supplement.reason && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">Reason:</Text>
                <div>{supplement.reason}</div>
              </div>
            )}
          </Col>
          <Col xs={24} md={9}>
            <div style={{ padding: '10px 12px', background: '#fafafa', borderRadius: 6, height: '100%' }}>
              <Text strong style={{ display: 'block', marginBottom: 10 }}>Assigned Companies</Text>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>Water Mitigation</Text>
                  <div style={{ marginTop: 2 }}>
                    {supplement.wm_company_name ? (
                      <Tag color="cyan">{supplement.wm_company_name}</Tag>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>Not assigned</Text>
                    )}
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>Rebuild (Supplement)</Text>
                  <div style={{ marginTop: 2 }}>
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      placeholder="Select rebuild company..."
                      value={supplement.rebuild_company_id || undefined}
                      loading={assignRebuildCompanyMutation.isPending}
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      onChange={(companyId) => {
                        if (companyId) {
                          assignRebuildCompanyMutation.mutate({
                            claimId: supplement.claim_id,
                            companyId,
                          });
                        }
                      }}
                      options={allCompanies
                        .filter((c: any) => c.is_active && c.id !== supplement.wm_company_id)
                        .map((c: any) => ({ value: c.id, label: c.name }))}
                    />
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>Public Adjuster (PA)</Text>
                  <div style={{ marginTop: 2 }}>
                    {paDisplayInfo?.pa_name ? (
                      <Space direction="vertical" size={0}>
                        <Text strong style={{ fontSize: 13 }}>{paDisplayInfo.pa_name}</Text>
                        {paDisplayInfo.pa_email && (
                          <Text type="secondary" style={{ fontSize: 11 }}>{paDisplayInfo.pa_email}</Text>
                        )}
                        {paDisplayInfo.pa_phone && (
                          <Text type="secondary" style={{ fontSize: 11 }}>{paDisplayInfo.pa_phone}</Text>
                        )}
                        {paDisplayInfo.pa_company && (
                          <Tag color="purple" style={{ marginTop: 2, fontSize: 11 }}>{paDisplayInfo.pa_company}</Tag>
                        )}
                      </Space>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>Not assigned</Text>
                    )}
                  </div>
                </div>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Insurance Company Estimates + Required Estimates + Bid Items */}
      <Row gutter={16} align="top" style={{ marginBottom: 16 }}>
      <Col xs={24} lg={10}>
      <Card style={{ marginBottom: 12 }}>
        <Collapse
          size="small"
          defaultActiveKey={['insurance-estimates']}
          items={[{
            key: 'insurance-estimates',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
                <Space>
                  <FileTextOutlined />
                  <Text strong>Insurance Company Estimates</Text>
                  {estimateVersions.length > 0 && (
                    <Tag color="blue">{estimateVersions.length} version{estimateVersions.length > 1 ? 's' : ''}</Tag>
                  )}
                </Space>
                <Button
                  type="primary"
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    uploadEstimateForm.resetFields();
                    setUploadEstimateFileId(null);
                    setUploadEstimateFileName(null);
                    setUploadEstimateModalOpen(true);
                  }}
                >
                  Upload New Estimate
                </Button>
              </div>
            ),
            children: estimateVersionsLoading ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <LoadingOutlined style={{ marginRight: 8 }} />
                <Text type="secondary">Loading...</Text>
              </div>
            ) : (
              <div>
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
                        <div>
                          {/* Header row: tags + PDF + replace */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                            <Space size={6} wrap>
                              <Tag color={idx === 0 ? 'blue' : 'default'}>Rev #{ver.revision_number}</Tag>
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
                            <Space size={4}>
                              {ver.file_download_id ? (
                                <a href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`} target="_blank" rel="noopener noreferrer">
                                  <Button size="small" icon={<FilePdfOutlined style={{ color: '#ff4d4f' }} />}>
                                    <span style={{ display: 'inline-block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                                      {ver.document_name || 'View PDF'}
                                    </span>
                                  </Button>
                                </a>
                              ) : null}
                              <Upload accept=".pdf" maxCount={1} showUploadList={false}
                                disabled={replacingEstimateId === ver.id}
                                beforeUpload={async (file) => {
                                  if (file.type !== 'application/pdf') { message.error('PDF only'); return Upload.LIST_IGNORE; }
                                  setReplacingEstimateId(ver.id);
                                  try {
                                    const uploaded = await fileService.uploadFiles([file], 'negotiation', supplement.claim_id, 'insurance_estimate');
                                    if (uploaded.length > 0) {
                                      await supplementService.replaceInsuranceEstimatePdf(supplement.claim_id, ver.id, uploaded[0].id);
                                      message.success('PDF replaced');
                                      supplementService.listInsuranceEstimates(supplement.claim_id).then(setEstimateVersions);
                                    }
                                  } catch { message.error('Failed to replace PDF'); }
                                  finally { setReplacingEstimateId(null); }
                                  return false;
                                }}>
                                <Button type="text" size="small"
                                  icon={replacingEstimateId === ver.id ? <LoadingOutlined /> : <UploadOutlined />}
                                  disabled={replacingEstimateId === ver.id} style={{ fontSize: 11 }}>
                                  {replacingEstimateId === ver.id ? '...' : 'Replace'}
                                </Button>
                              </Upload>
                            </Space>
                          </div>

                          {/* Date / Notes */}
                          {(ver.date_received || ver.received_from || ver.notes) && (
                            <div style={{ fontSize: 11, marginBottom: 4, color: '#8c8c8c' }}>
                              {ver.date_received && <span>Received: {dayjs(ver.date_received).format('MM/DD/YYYY')}</span>}
                              {ver.received_from && <span>{ver.date_received ? ' · ' : ''}From: {ver.received_from}</span>}
                              {ver.notes && <span style={{ display: 'block', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ver.notes}</span>}
                            </div>
                          )}

                          {/* Totals */}
                          {editingSectionsVerId === ver.id ? (
                            <Row gutter={[8, 4]} style={{ marginTop: 4 }}>
                              <Col span={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>RCV</Text>
                                <InputNumber size="small" prefix="$" style={{ width: '100%' }}
                                  value={editingTotals.rcv}
                                  onChange={v => setEditingTotals(t => ({ ...t, rcv: v || 0, acv: (v || 0) - t.dep }))}
                                />
                              </Col>
                              <Col span={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>ACV</Text>
                                <InputNumber size="small" prefix="$" style={{ width: '100%' }}
                                  value={editingTotals.acv}
                                  onChange={v => setEditingTotals(t => ({ ...t, acv: v || 0 }))}
                                />
                              </Col>
                              <Col span={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>Depreciation</Text>
                                <InputNumber size="small" prefix="$" style={{ width: '100%' }}
                                  value={editingTotals.dep}
                                  onChange={v => setEditingTotals(t => ({ ...t, dep: v || 0, acv: t.rcv - (v || 0) }))}
                                />
                              </Col>
                              <Col span={12}>
                                <Text type="secondary" style={{ fontSize: 10 }}>Deductible</Text>
                                <InputNumber size="small" prefix="$" style={{ width: '100%' }}
                                  value={editingTotals.ded}
                                  onChange={v => setEditingTotals(t => ({ ...t, ded: v || 0 }))}
                                />
                              </Col>
                            </Row>
                          ) : (
                            <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span><Text type="secondary">RCV: </Text><Text strong>{formatCurrency(ver.rcv_amount)}</Text></span>
                              <span><Text type="secondary">ACV: </Text><Text strong>{formatCurrency(ver.acv_amount)}</Text></span>
                              <span><Text type="secondary">Dep: </Text><Text>{formatCurrency(ver.depreciation_amount)}</Text></span>
                              <span><Text type="secondary">Ded: </Text><Text>{formatCurrency(ver.deductible)}</Text></span>
                              <Button type="text" size="small" style={{ fontSize: 11, padding: '0 4px' }}
                                onClick={() => {
                                  setEditingSectionsVerId(ver.id);
                                  setEditingSections((ver.sections_data || []).map((s: any) => ({ ...s })));
                                  setEditingTotals({ rcv: ver.rcv_amount || 0, acv: ver.acv_amount || 0, dep: ver.depreciation_amount || 0, ded: ver.deductible || 0 });
                                }}>Edit</Button>
                            </div>
                          )}
                        </div>

                        {ver.sections_data && ver.sections_data.length > 0 && (() => {
                          const isEditing = editingSectionsVerId === ver.id;
                          return (
                            <Collapse size="small" style={{ marginTop: 8 }} items={[{
                              key: 'sections',
                              label: (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                  <Text style={{ fontSize: 11 }}>Section Breakdown ({(isEditing ? editingSections : ver.sections_data).length} sections)</Text>
                                </div>
                              ),
                              children: isEditing ? (
                                <div>
                                  {editingSections.map((sec: any, idx: number) => (
                                    <div key={idx} style={{ background: '#fafafa', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                                      <Row gutter={8} align="middle">
                                        <Col flex="auto">
                                          <Input size="small" placeholder="Section name" value={sec.section_name}
                                            onChange={e => {
                                              const u = [...editingSections]; u[idx] = { ...u[idx], section_name: e.target.value }; setEditingSections(u);
                                            }} />
                                        </Col>
                                        <Col flex="none">
                                          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                                            const u = editingSections.filter((_: any, i: number) => i !== idx);
                                            setEditingSections(u);
                                            const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                            const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                            setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                          }} />
                                        </Col>
                                      </Row>
                                      <Row gutter={8} style={{ marginTop: 4 }}>
                                        <Col span={8}>
                                          <Text type="secondary" style={{ fontSize: 11 }}>RCV</Text>
                                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                                            value={sec.rcv} onChange={v => {
                                              const u = [...editingSections]; const rcv = v || 0; const dep = u[idx].depreciation || 0;
                                              u[idx] = { ...u[idx], rcv, net_acv: rcv - dep }; setEditingSections(u);
                                              const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                              const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                              setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                            }} />
                                        </Col>
                                        <Col span={8}>
                                          <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                                          <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                                            value={sec.depreciation} onChange={v => {
                                              const u = [...editingSections]; const dep = v || 0; const rcv = u[idx].rcv || 0;
                                              u[idx] = { ...u[idx], depreciation: dep, net_acv: rcv - dep }; setEditingSections(u);
                                              const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                              const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                              setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                            }} />
                                        </Col>
                                        <Col span={8}>
                                          <Text type="secondary" style={{ fontSize: 11 }}>Net ACV</Text>
                                          <InputNumber size="small" prefix="$" style={{ width: '100%' }} value={sec.net_acv} disabled />
                                        </Col>
                                      </Row>
                                    </div>
                                  ))}
                                  <Space style={{ marginTop: 4 }}>
                                    <Button size="small" icon={<PlusOutlined />} onClick={() => {
                                      setEditingSections([...editingSections, { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }]);
                                    }}>Add Section</Button>
                                    <Button size="small" type="primary" loading={savingSections} onClick={async () => {
                                      setSavingSections(true);
                                      try {
                                        await supplementService.updateInsuranceEstimate(supplement.claim_id, ver.id, {
                                          sections_data: editingSections.length > 0 ? editingSections : undefined,
                                          rcv_amount: editingTotals.rcv,
                                          depreciation_amount: editingTotals.dep,
                                          acv_amount: editingTotals.acv,
                                          deductible: editingTotals.ded,
                                        });
                                        message.success('Sections saved');
                                        setEditingSectionsVerId(null);
                                        supplementService.listInsuranceEstimates(supplement.claim_id).then(setEstimateVersions);
                                        queryClient.invalidateQueries({ queryKey: ['supplement', id] });
                                      } catch { message.error('Failed to save'); } finally { setSavingSections(false); }
                                    }}>Save</Button>
                                    <Button size="small" onClick={() => setEditingSectionsVerId(null)}>Cancel</Button>
                                  </Space>
                                </div>
                              ) : (
                                <div>
                                  {ver.sections_data.map((s: any, sIdx: number) => (
                                    <div key={sIdx} style={{
                                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                      padding: '4px 8px', borderRadius: 4, marginBottom: 2,
                                      background: '#fafafa',
                                    }}>
                                      <Text style={{ fontSize: 12 }}>{s.section_name}</Text>
                                      <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                                        RCV {formatCurrency(s.rcv || 0)}
                                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>Dep {formatCurrency(s.depreciation || 0)}</Text>
                                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>ACV {formatCurrency(s.net_acv || 0)}</Text>
                                      </Text>
                                    </div>
                                  ))}
                                  {/* Edit via the Edit button next to totals */}
                                </div>
                              ),
                            }]} />
                          );
                        })()}
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            ),
          }]}
        />
      </Card>

      <Card>
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
                if (hasAnyChecked && supplement.status === 'identified') {
                  updateData.status = 'in_progress';
                }
                updateMutation.mutate(updateData, {
                  onSuccess: () => {
                    setRequiredEstimatesDirty(false);
                    queryClient.invalidateQueries({ queryKey: ['supplements-pending-review'] });
                  },
                });
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
              <Col span={24} key={opt.key}>
                <Checkbox value={opt.key}>{opt.label}</Checkbox>
              </Col>
            ))}
          </Row>
        </Checkbox.Group>
      </Card>
      </Col>
      <Col xs={24} lg={14}>
      {/* Bid Items */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong>Bid Item Estimates</Text>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setBidItemModalOpen(true)}>
            Add Bid Item
          </Button>
        </div>

        {(supplement.bid_items || []).length === 0 ? (
          <Empty description="No bid items yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            {hasXactimate && inXactTotal > 0 && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 8 }}
                message={
                  <Text style={{ fontSize: 12 }}>
                    Some items are included in Xactimate. Net Xactimate = {formatCurrency(xactNet)}.
                  </Text>
                }
              />
            )}
            <Table
              size="small"
              dataSource={supplement.bid_items || []}
              rowKey="id"
              pagination={false}
              scroll={{ x: 600 }}
              style={{ fontSize: 12 }}
              rowClassName={() => 'bid-item-row'}
              columns={[
                { title: 'Type', dataIndex: 'estimate_type', key: 'type', width: 100,
                  render: (v: string) => <Tag>{BID_TYPE_LABELS[v] || v}</Tag> },
                { title: 'Title / Notes', key: 'title', render: (_: any, item: BidItemEstimate) => (
                  <div>
                    <Text
                      style={{ fontSize: 13 }}
                      editable={{
                        tooltip: 'Edit title',
                        onChange: (val) => {
                          updateBidItemMutation.mutate({
                            supplementId: supplement.id,
                            itemId: item.id,
                            data: { title: val },
                          });
                        },
                      }}
                    >
                      {item.title}
                    </Text>
                    <div style={{ marginTop: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                        <div style={{ flex: 1 }}>
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}
                            editable={{
                              tooltip: 'Edit scope notes (included in PA email)',
                              onChange: (val) => {
                                updateBidItemMutation.mutate({
                                  supplementId: supplement.id,
                                  itemId: item.id,
                                  data: { description: val || '' },
                                });
                              },
                            }}
                          >
                            {item.description || ''}
                          </Text>
                          {!item.description && (
                            <Text
                              type="secondary"
                              style={{ fontSize: 11, fontStyle: 'italic', cursor: 'pointer', color: '#bbb' }}
                              onClick={(e) => {
                                const editBtn = (e.currentTarget.previousElementSibling as HTMLElement)?.querySelector('.ant-typography-edit');
                                if (editBtn) (editBtn as HTMLElement).click();
                              }}
                            >
                              + Add scope notes
                            </Text>
                          )}
                        </div>
                        {item.description && item.description.trim() && (
                          <Tooltip title="AI polish">
                            <Button
                              type="text"
                              size="small"
                              icon={polishingItemId === item.id ? <LoadingOutlined /> : <ThunderboltOutlined />}
                              disabled={polishingItemId === item.id}
                              style={{ padding: '0 4px', height: 20, fontSize: 11, color: '#722ed1' }}
                              onClick={async () => {
                                setPolishingItemId(item.id);
                                try {
                                  const result = await supplementService.polishScopeNotes(
                                    item.description || '', item.estimate_type,
                                  );
                                  if (result.polished) {
                                    updateBidItemMutation.mutate({
                                      supplementId: supplement.id,
                                      itemId: item.id,
                                      data: { description: result.polished },
                                    });
                                    message.success('Scope notes polished');
                                  }
                                } catch {
                                  message.error('Failed to polish notes');
                                } finally {
                                  setPolishingItemId(null);
                                }
                              }}
                            />
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                ) },
                { title: 'Amount', dataIndex: 'custom_amount', width: 140, align: 'right' as const,
                  render: (v: number | undefined, item: BidItemEstimate) => (
                    <div>
                      <InputNumber
                        key={`${item.id}-${v}`}
                        size="small"
                        min={0}
                        step={0.01}
                        prefix="$"
                        defaultValue={v || 0}
                        style={{
                          width: '100%',
                          ...(item.included_in_xactimate ? { textDecoration: 'line-through', color: '#8c8c8c' } : {}),
                        }}
                        formatter={val => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={val => val?.replace(/[,$]/g, '') as any}
                        onBlur={(e) => {
                          const raw = e.target.value?.replace(/[,$]/g, '');
                          const num = parseFloat(raw || '0');
                          if (num !== (v || 0)) {
                            updateBidItemMutation.mutate({
                              supplementId: supplement.id,
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
                            supplementId: supplement.id,
                            itemId: item.id,
                            data: { included_in_xactimate: e.target.checked },
                          });
                        }}
                      />
                    </Tooltip>
                  ),
                }] : []),
                { title: 'PDF', key: 'pdf', width: 90, align: 'center' as const,
                  render: (_: any, item: BidItemEstimate) => {
                    const linkedType = item.bathroom_estimate_id ? 'bathroom'
                      : item.cabinet_estimate_id ? 'cabinet'
                      : item.pack_calculation_id ? 'packing'
                      : null;
                    const linkedId = item.bathroom_estimate_id || item.cabinet_estimate_id || item.pack_calculation_id || null;
                    return (
                      <Space size={2} direction="vertical" align="center">
                        {linkedType && linkedId && (
                          <Tooltip title={`View ${BID_TYPE_LABELS[linkedType]} Estimate PDF`}>
                            <Button
                              type="link"
                              size="small"
                              icon={<FilePdfOutlined style={{ color: '#1890ff' }} />}
                              loading={pdfLoading}
                              onClick={() => openEstimatePdf(linkedType, linkedId)}
                              style={{ padding: 0, fontSize: 11 }}
                            >
                              Estimate
                            </Button>
                          </Tooltip>
                        )}
                        {item.custom_document_file_id ? (
                          <Space size={4}>
                            <Tooltip title={item.custom_document_file_name || 'View uploaded PDF'}>
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
                                    const mutData: any = { custom_document_file_id: uploaded[0].id, custom_document_file_name: file.name };
                                    // Auto-extract total amount from PDF
                                    try {
                                      const result = await supplementService.extractBidItemTotal(file as unknown as File);
                                      if (result?.total_amount && result.total_amount > 0) {
                                        mutData.custom_amount = result.total_amount;
                                        message.success(`Extracted total: ${formatCurrency(result.total_amount)}`);
                                      }
                                    } catch { /* silent */ }
                                    updateBidItemMutation.mutate({
                                      supplementId: supplement.id,
                                      itemId: item.id,
                                      data: mutData,
                                    });
                                  }
                                } catch { message.error('Upload failed'); }
                                return false;
                              }}
                            >
                              <Tooltip title="Replace uploaded PDF">
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
                                  const mutData: any = { custom_document_file_id: uploaded[0].id, custom_document_file_name: file.name };
                                  // Auto-extract total amount from PDF
                                  try {
                                    const result = await supplementService.extractBidItemTotal(file as unknown as File);
                                    if (result?.total_amount && result.total_amount > 0) {
                                      mutData.custom_amount = result.total_amount;
                                      message.success(`Extracted total: ${formatCurrency(result.total_amount)}`);
                                    } else {
                                      message.success('PDF uploaded');
                                    }
                                  } catch {
                                    message.success('PDF uploaded');
                                  }
                                  updateBidItemMutation.mutate({
                                    supplementId: supplement.id,
                                    itemId: item.id,
                                    data: mutData,
                                  });
                                }
                              } catch { message.error('Upload failed'); }
                              return false;
                            }}
                          >
                            <Button type="link" size="small" icon={<UploadOutlined />} style={{ padding: 0, fontSize: 11 }}>
                              Upload
                            </Button>
                          </Upload>
                        )}
                      </Space>
                    );
                  } },
                { title: '', key: 'del', width: 36, align: 'center' as const,
                  render: (_: any, item: BidItemEstimate) => (
                    <Tooltip title="Delete">
                      <Button
                        type="text" size="small" danger
                        icon={<DeleteOutlined />}
                        onClick={() => Modal.confirm({
                          title: 'Delete this bid item?',
                          onOk: () => {
                            supplementService.deleteBidItem(supplement.id, item.id).then(() => {
                              message.success('Deleted');
                              refreshSupplement();
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
                    <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', color: '#8c8c8c' }}>
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
                  {formatCurrency(hasXactimate && inXactTotal > 0 ? supplementTotal : supplement.supplement_amount)}
                </Text>
              </div>
            </div>
          </>
        )}

        {/* Send to PA */}
        {(supplement.bid_items || []).length > 0 && (
          <div style={{ margin: '16px 0', textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={openSendPaModal}
              disabled={!supplement.bid_items?.some(i => i.custom_document_file_id)}
            >
              Send to PA
            </Button>
            {!supplement.bid_items?.some(i => i.custom_document_file_id) && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Upload bid item PDFs first</Text>
              </div>
            )}
            {supplement.submitted_date && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Last sent: {dayjs(supplement.submitted_date).format('MM/DD/YYYY')}
                  {supplement.submitted_to && ` to ${supplement.submitted_to}`}
                </Text>
              </div>
            )}
          </div>
        )}
      </Card>
      </Col>
      </Row>

      {/* Pending Info Requests */}
      {(() => {
        const infoRequests = followups.filter(fu => fu.followup_type === 'info_request');
        const generalFollowups = followups.filter(fu => fu.followup_type !== 'info_request');
        const pendingInfoRequests = infoRequests.filter(fu => fu.info_status !== 'resolved');

        const handleSendInfoRequest = async () => {
          try {
            const values = await infoRequestForm.validateFields();
            const validItems = infoItems.filter(i => i.trim());
            if (validItems.length === 0) {
              message.warning('Add at least one info item');
              return;
            }
            setInfoRequestLoading(true);
            await supplementService.sendInfoRequest(supplement.id, {
              to_email: values.to_email,
              to_name: values.to_name || '',
              request_to_type: values.request_to_type,
              items_needed: validItems.map(d => ({ description: d })),
              email_account_id: values.email_account_id,
            });
            message.success('Info request sent');
            setInfoRequestModalOpen(false);
            infoRequestForm.resetFields();
            setInfoItems(['']);
            loadFollowups(supplement.id);
          } catch (err: any) {
            message.error(err?.response?.data?.detail || 'Failed to send');
          } finally {
            setInfoRequestLoading(false);
          }
        };

        const handleResend = async (fu: SupplementFollowUp) => {
          setResendingId(fu.id);
          try {
            await supplementService.resendInfoRequest(supplement.id, fu.id);
            message.success(`Follow-up #${(fu.follow_up_count || 0) + 1} sent`);
            loadFollowups(supplement.id);
          } catch (err: any) {
            message.error(err?.response?.data?.detail || 'Failed to resend');
          } finally {
            setResendingId(null);
          }
        };

        const handleToggleItem = async (fu: SupplementFollowUp, itemIdx: number) => {
          const updated = (fu.items_needed || []).map((item, i) =>
            i === itemIdx ? { ...item, resolved: !item.resolved } : item
          );
          const allResolved = updated.every(item => item.resolved);
          try {
            await supplementService.updateFollowup(supplement.id, fu.id, {
              items_needed: updated,
              info_status: allResolved ? 'resolved' : 'partially_resolved',
            } as any);
            loadFollowups(supplement.id);
          } catch {
            message.error('Failed to update');
          }
        };

        const handleMarkResponse = async (fu: SupplementFollowUp) => {
          setResponseTargetFu(fu);
          setResponseSummary('');
          setResponseBodyHtml('');
          setResponseFiles([]);
          setResponseModalOpen(true);
        };

        const handleSubmitResponse = async () => {
          if (!responseTargetFu) return;
          setResponseSubmitting(true);
          try {
            // Upload attachment files if any
            let attachmentIds: string[] = [];
            if (responseFiles.length > 0) {
              const uploaded = await fileService.uploadFiles(
                responseFiles,
                'supplement_followup',
                responseTargetFu.id,
                'reply_attachment',
              );
              attachmentIds = uploaded.map((f: any) => f.id);
            }

            await supplementService.updateFollowup(supplement.id, responseTargetFu.id, {
              response_received: true,
              response_date: new Date().toISOString(),
              response_summary: responseSummary || 'Response received',
              reply_body_html: responseBodyHtml || undefined,
              reply_attachment_ids: attachmentIds.length > 0 ? attachmentIds : (responseTargetFu.reply_attachment_ids || undefined),
              info_status: 'resolved',
            } as any);
            message.success('Marked as responded');
            setResponseModalOpen(false);
            loadFollowups(supplement.id);
          } catch {
            message.error('Failed to update');
          } finally {
            setResponseSubmitting(false);
          }
        };

        return (
          <>
            {/* Pending Info Requests Card */}
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Space>
                  <Text strong>Pending Info</Text>
                  {pendingInfoRequests.length > 0 && (
                    <Badge count={pendingInfoRequests.length} style={{ backgroundColor: '#fa8c16' }} />
                  )}
                </Space>
                <Space size={4}>
                  {pendingInfoRequests.length > 0 && (
                    <Button size="small" icon={checkingReplies ? <LoadingOutlined /> : <ThunderboltOutlined />}
                      disabled={checkingReplies}
                      onClick={triggerReplyCheck}>
                      {checkingReplies ? 'Checking...' : 'Check Replies'}
                    </Button>
                  )}
                  <Button size="small" type="primary" ghost icon={<SendOutlined />}
                    onClick={() => {
                      setInfoRequestModalOpen(true);
                      if (paDisplayInfo?.pa_email) {
                        infoRequestForm.setFieldsValue({
                          to_name: paDisplayInfo.pa_name || '',
                          to_email: paDisplayInfo.pa_email || '',
                          request_to_type: 'public_adjuster',
                        });
                      }
                    }}>
                    Request Info
                  </Button>
                </Space>
              </div>

              {infoRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 12, color: '#8c8c8c' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>No info requests yet. Click "Request Info" when you need information from PA or contractor.</Text>
                </div>
              ) : (
                <div>
                  {infoRequests.map((fu) => {
                    const isPending = fu.info_status !== 'resolved';
                    const unresolvedCount = (fu.items_needed || []).filter(i => !i.resolved).length;
                    const totalCount = (fu.items_needed || []).length;
                    const hasReply = fu.response_summary || fu.reply_body_html || (fu.reply_attachment_ids || []).length > 0;

                    return (
                      <div
                        key={fu.id}
                        style={{
                          marginBottom: 6, padding: '8px 10px', borderRadius: 6,
                          border: '1px solid #f0f0f0',
                          background: '#fafafa',
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <div>
                            <Space size={4} wrap>
                              <Tag style={{ margin: 0, fontSize: 11 }}>
                                {fu.request_to_type === 'public_adjuster' ? 'PA' : 'Contractor'}
                              </Tag>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {(fu.info_status || 'pending').replace(/_/g, ' ')}
                              </Text>
                              {(fu.follow_up_count || 0) > 0 && (
                                <Text type="secondary" style={{ fontSize: 10 }}>
                                  (follow-up x{fu.follow_up_count})
                                </Text>
                              )}
                            </Space>
                            <div style={{ fontSize: 11, marginTop: 2 }}>
                              <Text type="secondary">To: </Text>
                              <Text style={{ fontSize: 11 }}>{fu.contact_name || fu.contact_email}</Text>
                              {fu.contact_name && fu.contact_email && (
                                <Text type="secondary" style={{ fontSize: 11 }}> ({fu.contact_email})</Text>
                              )}
                            </div>
                          </div>
                          <Space size={4}>
                            {isPending && (
                              <Button size="small" type="text"
                                icon={<SendOutlined />}
                                loading={resendingId === fu.id}
                                onClick={() => handleResend(fu)}
                                style={{ fontSize: 11, padding: '0 4px' }}>
                                Follow up
                              </Button>
                            )}
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {fu.created_at ? dayjs(fu.created_at).format('MM/DD HH:mm') : ''}
                            </Text>
                          </Space>
                        </div>

                        {/* Checklist items */}
                        {(fu.items_needed || []).length > 0 && (
                          <div style={{ marginTop: 2 }}>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {unresolvedCount === 0 ? 'All items resolved' : `${unresolvedCount}/${totalCount} pending`}
                            </Text>
                            {(fu.items_needed || []).map((item, idx) => (
                              <div key={idx} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '2px 0', fontSize: 12,
                              }}>
                                <Checkbox
                                  checked={item.resolved}
                                  onChange={() => handleToggleItem(fu, idx)}
                                  style={{ fontSize: 12 }}
                                />
                                <Text
                                  style={{ fontSize: 12 }}
                                  delete={item.resolved}
                                  type={item.resolved ? 'secondary' : undefined}
                                >
                                  {item.description}
                                </Text>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Conversation thread */}
                        {(() => {
                          const conv: Array<{type: string; date: string; sender: string; body_html: string; summary?: string}> = fu.conversation || [];
                          const showThread = conv.length > 0 || hasReply;
                          return showThread ? (
                            <div style={{ marginTop: 6 }}>
                              {conv.length > 0 ? conv.map((msg, mIdx) => (
                                <div key={mIdx} style={{
                                  marginBottom: 4, padding: '6px 8px', borderRadius: 4,
                                  background: msg.type === 'sent' ? '#e6f7ff' : '#fff',
                                  border: msg.type === 'sent' ? '1px solid #91d5ff' : '1px solid #e8e8e8',
                                  marginLeft: msg.type === 'sent' ? 20 : 0,
                                  marginRight: msg.type === 'received' ? 20 : 0,
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                    <Text strong style={{ fontSize: 10, color: msg.type === 'sent' ? '#1677ff' : '#52c41a' }}>
                                      {msg.type === 'sent' ? 'Sent' : 'Reply'}
                                      {msg.sender ? ` · ${msg.sender.split('@')[0]}` : ''}
                                    </Text>
                                    <Text type="secondary" style={{ fontSize: 10 }}>
                                      {msg.date ? dayjs(msg.date).format('MM/DD HH:mm') : ''}
                                    </Text>
                                  </div>
                                  {msg.body_html && (
                                    <div
                                      style={{ fontSize: 12, maxHeight: 150, overflow: 'auto' }}
                                      dangerouslySetInnerHTML={{ __html: msg.body_html }}
                                    />
                                  )}
                                  {!msg.body_html && msg.summary && (
                                    <div style={{ fontSize: 12 }}>{msg.summary}</div>
                                  )}
                                </div>
                              )) : hasReply ? (
                                /* Fallback for older followups without conversation array */
                                <div style={{ padding: '6px 8px', background: '#fff', borderRadius: 4, border: '1px solid #e8e8e8' }}>
                                  <Text type="secondary" style={{ fontSize: 10 }}>
                                    Reply {fu.response_date ? `- ${dayjs(fu.response_date).format('MM/DD HH:mm')}` : ''}
                                  </Text>
                                  {fu.reply_body_html && (
                                    <div
                                      style={{ fontSize: 12, padding: '4px 6px', background: '#fafafa', borderRadius: 3, marginTop: 4, maxHeight: 150, overflow: 'auto' }}
                                      dangerouslySetInnerHTML={{ __html: fu.reply_body_html }}
                                    />
                                  )}
                                </div>
                              ) : null}

                              {/* Reply input */}
                              {isPending && (
                                <div style={{ marginTop: 4 }}>
                                  {replyingToId === fu.id ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <Input.TextArea
                                        rows={2}
                                        placeholder="Type your reply..."
                                        value={replyText}
                                        onChange={e => setReplyText(e.target.value)}
                                        style={{ fontSize: 12 }}
                                      />
                                      <Space size={4}>
                                        <Button size="small" type="primary"
                                          icon={<SendOutlined />}
                                          loading={sendingReply}
                                          disabled={!replyText.trim()}
                                          onClick={async () => {
                                            setSendingReply(true);
                                            try {
                                              await supplementService.replyToInfoRequest(
                                                supplement.id, fu.id,
                                                { body_html: `<p>${replyText.replace(/\n/g, '<br/>')}</p>` }
                                              );
                                              message.success('Reply sent');
                                              setReplyingToId(null);
                                              setReplyText('');
                                              loadFollowups(supplement.id);
                                            } catch { message.error('Failed to send reply'); }
                                            finally { setSendingReply(false); }
                                          }}>
                                          Send
                                        </Button>
                                        <Button size="small" onClick={() => { setReplyingToId(null); setReplyText(''); }}>
                                          Cancel
                                        </Button>
                                      </Space>
                                    </div>
                                  ) : (
                                    <Space size={4}>
                                      <Button size="small" type="text" icon={<SendOutlined />}
                                        style={{ fontSize: 11, padding: '0 4px' }}
                                        onClick={() => setReplyingToId(fu.id)}>
                                        Reply
                                      </Button>
                                      {!hasReply && (
                                        <Button size="small" type="text" style={{ fontSize: 11, padding: '0 4px' }}
                                          onClick={() => handleMarkResponse(fu)}>
                                          Mark as responded
                                        </Button>
                                      )}
                                    </Space>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : isPending ? (
                            <div style={{ marginTop: 4 }}>
                              <Space size={4}>
                                <Button size="small" type="text" icon={<SendOutlined />}
                                  style={{ fontSize: 11, padding: '0 4px' }}
                                  onClick={() => setReplyingToId(fu.id)}>
                                  Reply
                                </Button>
                                <Button size="small" type="text" style={{ fontSize: 11, padding: '0 4px' }}
                                  onClick={() => handleMarkResponse(fu)}>
                                  Mark as responded
                                </Button>
                              </Space>
                            </div>
                          ) : null;
                        })()}

                        {fu.last_follow_up_date && (
                          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                            Last follow-up: {dayjs(fu.last_follow_up_date).format('MM/DD HH:mm')}
                          </Text>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Info Request Modal */}
            <Modal
              title="Request Information"
              open={infoRequestModalOpen}
              width={500}
              onOk={handleSendInfoRequest}
              onCancel={() => { setInfoRequestModalOpen(false); infoRequestForm.resetFields(); setInfoItems(['']); }}
              confirmLoading={infoRequestLoading}
              okText="Send Request"
            >
              <Form form={infoRequestForm} layout="vertical" size="small">
                <Form.Item name="request_to_type" label="Request To" rules={[{ required: true }]} initialValue="public_adjuster">
                  <Select options={[
                    { value: 'public_adjuster', label: 'Public Adjuster' },
                    { value: 'contractor', label: 'Contractor' },
                  ]} onChange={(v) => {
                    if (v === 'public_adjuster' && paDisplayInfo?.pa_email) {
                      infoRequestForm.setFieldsValue({
                        to_name: paDisplayInfo.pa_name || '',
                        to_email: paDisplayInfo.pa_email || '',
                      });
                    } else {
                      infoRequestForm.setFieldsValue({ to_name: '', to_email: '' });
                    }
                  }} />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="to_name" label="Name">
                      <Input placeholder="Contact name" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="to_email" label="Email" rules={[{ required: true, type: 'email' }]}>
                      <Input placeholder="email@example.com" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="email_account_id" label="Send From">
                  <Select
                    placeholder="Default email account"
                    allowClear
                    options={emailAccounts.map((acc: any) => ({
                      value: acc.id, label: acc.email_address || acc.name,
                    }))}
                  />
                </Form.Item>
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Information Needed</Text>
                  {infoItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <Input
                        size="small"
                        placeholder={`e.g., Photos of ${idx === 0 ? 'affected area' : 'damage'}, measurements, etc.`}
                        value={item}
                        onChange={e => {
                          const updated = [...infoItems];
                          updated[idx] = e.target.value;
                          setInfoItems(updated);
                        }}
                      />
                      {infoItems.length > 1 && (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}
                          onClick={() => setInfoItems(infoItems.filter((_, i) => i !== idx))} />
                      )}
                    </div>
                  ))}
                  <Button size="small" type="dashed" icon={<PlusOutlined />}
                    onClick={() => setInfoItems([...infoItems, ''])}
                    style={{ width: '100%', marginTop: 2 }}>
                    Add Item
                  </Button>
                </div>
              </Form>
            </Modal>

            {/* Mark Response Modal */}
            <Modal
              title="Record Response"
              open={responseModalOpen}
              width={560}
              onOk={handleSubmitResponse}
              onCancel={() => setResponseModalOpen(false)}
              confirmLoading={responseSubmitting}
              okText="Save Response"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Summary</Text>
                  <Input.TextArea
                    rows={2}
                    placeholder="Brief summary of the response..."
                    value={responseSummary}
                    onChange={(e) => setResponseSummary(e.target.value)}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Reply Content (optional)</Text>
                  <Input.TextArea
                    rows={4}
                    placeholder="Paste or type the full reply content here..."
                    value={responseBodyHtml}
                    onChange={(e) => setResponseBodyHtml(e.target.value)}
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>Attachments (optional)</Text>
                  <Upload.Dragger
                    multiple
                    beforeUpload={(file) => {
                      setResponseFiles((prev) => [...prev, file]);
                      return false;
                    }}
                    onRemove={(file) => {
                      setResponseFiles((prev) => prev.filter((f) => f.name !== file.name));
                    }}
                    fileList={responseFiles.map((f, i) => ({
                      uid: `${i}`,
                      name: f.name,
                      status: 'done' as const,
                    }))}
                    style={{ padding: '8px 0' }}
                  >
                    <p style={{ fontSize: 12, margin: 0 }}>
                      <UploadOutlined /> Click or drag files to attach
                    </p>
                  </Upload.Dragger>
                </div>
              </div>
            </Modal>

            {/* Follow-ups (general only) */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong>Follow-ups ({generalFollowups.length})</Text>
                <Button size="small" icon={<PhoneOutlined />} onClick={() => setFollowupModalOpen(true)}>
                  Log Follow-up
                </Button>
              </div>

              {generalFollowups.length === 0 ? (
                <Empty description="No follow-ups yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div>
                  {generalFollowups.map((fu) => (
                    <Card
                      key={fu.id}
                      size="small"
                      style={{
                        marginBottom: 6,
                        border: fu.response_received ? '1px solid #b7eb8f' : '1px solid #f0f0f0',
                        background: fu.response_received ? '#f6ffed' : '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <Space size={6} style={{ marginBottom: 4 }}>
                            <Tag color={
                              fu.contact_method === 'email' ? 'blue' :
                              fu.contact_method === 'phone' ? 'green' :
                              fu.contact_method === 'text' ? 'purple' : 'default'
                            }>
                              {fu.contact_method?.toUpperCase()}
                            </Tag>
                            {fu.response_received && <Tag color="success">Response Received</Tag>}
                          </Space>
                          {fu.contact_name && (
                            <div style={{ fontSize: 12 }}>
                              <Text type="secondary">To: </Text>
                              <Text>{fu.contact_name}</Text>
                              {fu.contact_email && <Text type="secondary"> ({fu.contact_email})</Text>}
                            </div>
                          )}
                          {fu.summary && (
                            <div style={{ fontSize: 12, marginTop: 2 }}>{fu.summary}</div>
                          )}
                          {fu.response_summary && (
                            <div style={{ fontSize: 12, marginTop: 4, padding: '4px 8px', background: '#e6fffb', borderRadius: 4 }}>
                              <Text type="secondary" style={{ fontSize: 11 }}>Response: </Text>
                              {fu.response_summary}
                            </div>
                          )}
                        </div>
                        <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap', marginLeft: 8 }}>
                          {fu.created_at ? dayjs(fu.created_at).format('MM/DD/YY HH:mm') : ''}
                        </Text>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          </>
        );
      })()}

      {/* ─── Send to PA Modal ─── */}
      <Modal
        title={<Space><SendOutlined /><span>Send Supplement to PA</span></Space>}
        open={sendPaModalOpen}
        width={700}
        onCancel={() => setSendPaModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setSendPaModalOpen(false)}>Cancel</Button>,
          <Button
            key="send"
            type="primary"
            icon={<SendOutlined />}
            loading={sendPaLoading}
            onClick={handleSendToPa}
            disabled={paToEmails.length === 0}
          >
            Send Email
          </Button>,
        ]}
      >
        {paInfo && (
          <div>
            {(paInfo.pa_name || paInfo.pa_email) && (
              <div style={{
                background: '#f0f5ff', border: '1px solid #adc6ff',
                borderRadius: 6, padding: '8px 12px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <Text style={{ fontSize: 12, color: '#555' }}>Assigned PA:</Text>
                {paInfo.pa_name && <Text strong style={{ fontSize: 13 }}>{paInfo.pa_name}</Text>}
                {paInfo.pa_company && <Text type="secondary" style={{ fontSize: 12 }}>{paInfo.pa_company}</Text>}
                {paInfo.pa_email && <Text style={{ fontSize: 12, color: '#1890ff' }}>{paInfo.pa_email}</Text>}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>From:</Text>
              {emailAccounts.length > 0 && (
                <Select
                  value={paManualFromEmail ? undefined : paSelectedAccountId}
                  onChange={(val) => { setPaSelectedAccountId(val); setPaManualFromEmail(''); }}
                  style={{ width: '100%', marginBottom: 6 }}
                  placeholder="Select email account..."
                  allowClear
                  disabled={!!paManualFromEmail}
                  options={emailAccounts.filter((a: any) => a.is_active).map((a: any) => ({
                    value: a.id,
                    label: `${a.display_name} (${a.email_address})`,
                  }))}
                />
              )}
              <Input
                placeholder="Or type sender email manually..."
                value={paManualFromEmail}
                onChange={e => {
                  setPaManualFromEmail(e.target.value);
                  if (e.target.value.trim()) setPaSelectedAccountId(undefined);
                }}
                allowClear
                style={{ width: '100%' }}
              />
              {!paSelectedAccountId && !paManualFromEmail && (
                <Text type="warning" style={{ fontSize: 12 }}>Select an account or enter email address</Text>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>To:</Text>
              <Select
                mode="tags"
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                placeholder="Search by name or email..."
                value={paToEmails}
                onChange={(vals) => setPaToEmails(vals)}
                tokenSeparators={[',', ';']}
                options={[
                  ...(paInfo.pa_email ? [{
                    value: paInfo.pa_email,
                    label: paInfo.pa_name ? `${paInfo.pa_name} (${paInfo.pa_email})` : paInfo.pa_email,
                  }] : []),
                  ...(paInfo.cc_emails || []).map((cc: any) => ({
                    value: cc.email,
                    label: cc.name ? `${cc.name} (${cc.email})` : cc.email,
                  })),
                ]}
              />
              {paToEmails.length === 0 && (
                <Alert type="warning" message="At least one recipient email is required." showIcon style={{ marginTop: 8 }} />
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>CC:</Text>
              <Select
                mode="tags"
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                placeholder="Search by name or email..."
                value={paCcEmails}
                onChange={(vals) => setPaCcEmails(vals)}
                tokenSeparators={[',', ';']}
                options={[
                  ...(paInfo.pa_email ? [{
                    value: paInfo.pa_email,
                    label: paInfo.pa_name ? `${paInfo.pa_name} (${paInfo.pa_email})` : paInfo.pa_email,
                  }] : []),
                  ...(paInfo.cc_emails || []).map((cc: any) => ({
                    value: cc.email,
                    label: cc.name ? `${cc.name} (${cc.email})` : cc.email,
                  })),
                ]}
              />
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Additional Notes (added to email)</Text>
              <Input.TextArea
                rows={3}
                placeholder="e.g., Added bathroom rebuild scope that was missing from original estimate..."
                value={paCustomNotes}
                onChange={e => setPaCustomNotes(e.target.value)}
              />
              <Button size="small" type="link" style={{ padding: '4px 0' }} onClick={handleRegenerateEmail}>
                Apply notes to email
              </Button>
            </div>

            {/* AI Description Polish */}
            <div style={{ marginBottom: 12, background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 6, padding: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                <ThunderboltOutlined style={{ color: '#722ed1', marginRight: 4 }} />
                AI Scope Description (Xactimate 수정사항 정리)
              </Text>
              <Input.TextArea
                rows={4}
                placeholder={"e.g.,\n- 1st floor baseboard replacement added (wood floor)\n- Carpet waste added\n- Bathroom Bid item\n- Pack-in/out Bid item"}
                value={paDescriptionDraft}
                onChange={e => setPaDescriptionDraft(e.target.value)}
              />
              <Button
                size="small"
                type="primary"
                ghost
                icon={<ThunderboltOutlined />}
                loading={polishingDescription}
                disabled={!paDescriptionDraft.trim()}
                style={{ marginTop: 6 }}
                onClick={async () => {
                  setPolishingDescription(true);
                  try {
                    const result = await supplementService.polishDescriptionForEmail(paDescriptionDraft);
                    // Find the Xactimate card (border-left: #1890ff) and replace its description
                    setPaEmailContent(prev => {
                      let html = prev.body_html;
                      // Xactimate card uses border-left:4px solid #1890ff
                      const xactCardMarker = 'border-left:4px solid #1890ff';
                      const cardStart = html.indexOf(xactCardMarker);
                      if (cardStart >= 0) {
                        // Find the <div> that contains this card
                        const divStart = html.lastIndexOf('<div', cardStart);
                        // Find the closing </div> of this card
                        const afterCard = html.slice(divStart);
                        // The card ends at the last </div> before the next card or section
                        const nextCardOrSection = afterCard.indexOf('<div', afterCard.indexOf('</div>'));
                        const cardEnd = nextCardOrSection > 0
                          ? divStart + nextCardOrSection
                          : divStart + afterCard.lastIndexOf('</div>') + 6;
                        // Extract current card HTML
                        const cardHtml = html.slice(divStart, cardEnd);
                        // Find the description area: after </table> inside the card
                        const tableEnd = cardHtml.indexOf('</table>');
                        if (tableEnd > 0) {
                          const beforeDesc = cardHtml.slice(0, tableEnd + 8); // include </table>
                          const polishedDesc = `<div style="margin:8px 0 0;color:#444;font-size:13px;line-height:1.6;">${result.polished_html}</div>`;
                          const newCard = beforeDesc + polishedDesc + '</div>';
                          html = html.slice(0, divStart) + newCard + html.slice(cardEnd);
                        }
                      } else {
                        // No Xactimate card — insert before "Please review..."
                        const reviewIdx = html.indexOf('<p>Please review');
                        if (reviewIdx > 0) {
                          html = html.slice(0, reviewIdx) + result.polished_html + '\n\n' + html.slice(reviewIdx);
                        } else {
                          html += '\n\n' + result.polished_html;
                        }
                      }
                      return { ...prev, body_html: html };
                    });
                    message.success('Xactimate description polished');
                  } catch {
                    message.error('Failed to polish description');
                  } finally {
                    setPolishingDescription(false);
                  }
                }}
              >
                AI로 정리해서 이메일에 추가
              </Button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Subject:</Text>
              <Input
                value={paEmailContent.subject}
                onChange={e => setPaEmailContent(prev => ({ ...prev, subject: e.target.value }))}
              />
            </div>

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

            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Attachments (bid item PDFs):</Text>
              <Space direction="vertical" size={2}>
                {(supplement.bid_items || [])
                  .filter(i => i.custom_document_file_id)
                  .map(i => (
                    <Space key={i.id} size={4}>
                      <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                      <Text style={{ fontSize: 12 }}>{i.custom_document_file_name || i.title}</Text>
                      <Tag style={{ fontSize: 11 }}>{formatCurrency(i.custom_amount)}</Tag>
                    </Space>
                  ))}
                {!(supplement.bid_items || []).some(i => i.custom_document_file_id) && (
                  <Text type="secondary">No PDFs attached</Text>
                )}
              </Space>
            </div>

            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Additional Attachments (optional):</Text>
              <Upload
                multiple
                beforeUpload={(file) => {
                  setPaExtraFiles(prev => [...prev, file]);
                  return false;
                }}
                onRemove={(file) => {
                  setPaExtraFiles(prev => prev.filter(f => f.name !== file.name || f.size !== file.size));
                }}
                fileList={paExtraFiles.map((f, i) => ({
                  uid: `extra-${i}`,
                  name: f.name,
                  size: f.size,
                  type: f.type,
                  status: 'done' as const,
                  originFileObj: f as any,
                }))}
                showUploadList={{ showRemoveIcon: true }}
              >
                <Button size="small" icon={<UploadOutlined />}>Add Files</Button>
              </Upload>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Add Bid Item Modal ─── */}
      <Modal title="Add Bid Item Estimate" open={bidItemModalOpen} width={500}
        onOk={() => bidItemForm.validateFields().then(v => {
          if (supplement) {
            const idField = ESTIMATE_ID_FIELD_MAP[bidItemType];
            createBidItemMutation.mutate({
              supplementId: supplement.id,
              data: {
                ...v,
                title: v.title || BID_TYPE_LABELS[v.estimate_type] || v.estimate_type,
                supplement_id: supplement.id,
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
              <div>
                <Space>
                  <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                  <Text ellipsis style={{ maxWidth: 250 }}>{bidItemFile.name}</Text>
                  <Button type="link" size="small" danger onClick={() => { setBidItemFile(null); setBidItemParsedAmounts(null); }}>Remove</Button>
                </Space>
                {bidItemParsedAmounts && (
                  <div style={{
                    marginTop: 8, padding: '8px 12px', background: '#f6ffed',
                    borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <span><Text type="secondary">RCV: </Text><Text strong>{formatCurrency(bidItemParsedAmounts.rcv_amount)}</Text></span>
                      <span><Text type="secondary">ACV: </Text><Text strong>{formatCurrency(bidItemParsedAmounts.acv_amount)}</Text></span>
                      <span><Text type="secondary">Depreciation: </Text><Text>{formatCurrency(bidItemParsedAmounts.depreciation_amount)}</Text></span>
                      <span><Text type="secondary">Deductible: </Text><Text>{formatCurrency(bidItemParsedAmounts.deductible)}</Text></span>
                    </div>
                  </div>
                )}
              </div>
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
                      [file], 'supplement_bid_item', supplement.id, 'estimate_pdf',
                    );
                    if (uploaded.length > 0) {
                      setBidItemFile({ id: uploaded[0].id, name: file.name });
                      message.success('PDF uploaded');
                      if (bidItemType === 'xactimate') {
                        try {
                          const parsed = await claimFollowUpService.parseEstimatePdf(file as unknown as File);
                          if (parsed?.totals) {
                            setBidItemParsedAmounts(parsed.totals);
                            if (parsed.totals.rcv_amount && parsed.totals.rcv_amount > 0) {
                              bidItemForm.setFieldsValue({ custom_amount: parsed.totals.rcv_amount });
                              message.success(`Parsed RCV: ${formatCurrency(parsed.totals.rcv_amount)}`);
                            }
                          }
                        } catch {
                          message.warning('Could not auto-parse amounts from PDF');
                        }
                      } else {
                        // Generic PDF: extract total amount using AI
                        try {
                          const result = await supplementService.extractBidItemTotal(file as unknown as File);
                          if (result?.total_amount && result.total_amount > 0) {
                            bidItemForm.setFieldsValue({ custom_amount: result.total_amount });
                            message.success(`Extracted total: ${formatCurrency(result.total_amount)}`);
                          }
                        } catch {
                          // Silent fail - user can manually enter amount
                        }
                      }
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

      {/* ─── Log Follow-up Modal ─── */}
      <Modal title="Log Follow-up" open={followupModalOpen} width={450}
        onOk={() => followupForm.validateFields().then(v => {
          if (supplement) {
            createFollowupMutation.mutate({
              supplementId: supplement.id,
              data: { ...v, supplement_id: supplement.id },
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

      {/* ─── Upload Insurance Estimate Modal ─── */}
      <Modal
        title="Upload Insurance Estimate"
        open={uploadEstimateModalOpen}
        width={560}
        confirmLoading={uploadEstimateLoading}
        onOk={() => {
          uploadEstimateForm.validateFields().then(async (values) => {
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
                sections_data: uploadEstimateSections.length > 0 ? uploadEstimateSections : undefined,
              };
              if (values.date_received) {
                payload.date_received = values.date_received.toISOString();
              }
              if (uploadEstimateFileId) {
                payload.file_id = uploadEstimateFileId;
              }
              await supplementService.uploadInsuranceEstimate(supplement.claim_id, payload);
              message.success('Insurance estimate uploaded');
              setUploadEstimateModalOpen(false);
              uploadEstimateForm.resetFields();
              setUploadEstimateFileId(null);
              setUploadEstimateFileName(null);
              setUploadEstimateSections([]);
              supplementService.listInsuranceEstimates(supplement.claim_id)
                .then(versions => setEstimateVersions(versions));
              loadFollowups(supplement.id);
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
          setUploadEstimateSections([]);
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

          {/* PDF Upload */}
          <Form.Item label="Insurance Estimate PDF">
            <Space>
              {uploadEstimateFileId && (
                <>
                  <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                  <Text style={{ fontSize: 12 }}>{uploadEstimateFileName}</Text>
                  <Button type="text" size="small" danger
                    onClick={() => { setUploadEstimateFileId(null); setUploadEstimateFileName(null); setUploadEstimateSections([]); }}>
                    Remove
                  </Button>
                </>
              )}
              <Upload
                accept=".pdf"
                maxCount={1}
                showUploadList={false}
                beforeUpload={async (file) => {
                  if (file.type !== 'application/pdf') { message.error('PDF files only'); return Upload.LIST_IGNORE; }
                  try {
                    const uploaded = await fileService.uploadFiles([file], 'negotiation', supplement.claim_id, 'insurance_estimate');
                    if (uploaded.length > 0) {
                      const fid = uploaded[0].id;
                      setUploadEstimateFileId(fid);
                      setUploadEstimateFileName(file.name);
                      setUploadEstimateParsing(true);
                      try {
                        const result = await supplementService.extractInsuranceEstimatePdf(fid);
                        if (result.success && result.totals) {
                          const t = result.totals;
                          uploadEstimateForm.setFieldsValue({
                            rcv_amount: t.rcv_amount || 0,
                            acv_amount: t.acv_amount || 0,
                            depreciation_amount: t.depreciation_amount || 0,
                            deductible: t.deductible || 0,
                          });
                          if (result.sections && result.sections.length > 0) {
                            setUploadEstimateSections(result.sections);
                          }
                          message.success(`Parsed ${result.sections?.length || 0} sections`);
                        } else {
                          message.info('Could not auto-parse. Please fill in manually.');
                        }
                      } catch { /* non-critical */ } finally { setUploadEstimateParsing(false); }
                    }
                  } catch { message.error('Upload failed'); }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploadEstimateParsing}>
                  {uploadEstimateParsing ? 'Parsing...' : uploadEstimateFileId ? 'Replace PDF' : 'Upload & Parse Estimate PDF'}
                </Button>
              </Upload>
            </Space>
          </Form.Item>

          {/* Editable Sections */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text strong style={{ fontSize: 13 }}>Estimate Sections</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={() => {
                setUploadEstimateSections([...uploadEstimateSections, { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }]);
              }}>Add Section</Button>
            </div>

            {uploadEstimateSections.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 12, background: '#fafafa', borderRadius: 6 }}>
                <Text type="secondary">No sections. Upload PDF to auto-parse or add manually.</Text>
              </div>
            ) : (
              <>
                {uploadEstimateSections.map((section: any, idx: number) => (
                  <div key={idx} style={{ background: '#fafafa', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                    <Row gutter={8} align="middle">
                      <Col flex="auto">
                        <Input size="small" placeholder="Section name" value={section.section_name}
                          onChange={e => {
                            const updated = [...uploadEstimateSections];
                            updated[idx] = { ...updated[idx], section_name: e.target.value };
                            setUploadEstimateSections(updated);
                          }} />
                      </Col>
                      <Col flex="none">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                          const updated = uploadEstimateSections.filter((_: any, i: number) => i !== idx);
                          setUploadEstimateSections(updated);
                          // Recalc totals
                          const totRcv = updated.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                          const totDep = updated.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                          uploadEstimateForm.setFieldsValue({ rcv_amount: totRcv, acv_amount: totRcv - totDep, depreciation_amount: totDep });
                        }} />
                      </Col>
                    </Row>
                    <Row gutter={8} style={{ marginTop: 4 }}>
                      <Col span={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>RCV</Text>
                        <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                          value={section.rcv} onChange={v => {
                            const updated = [...uploadEstimateSections];
                            const rcv = v || 0;
                            const dep = updated[idx].depreciation || 0;
                            updated[idx] = { ...updated[idx], rcv, net_acv: rcv - dep };
                            setUploadEstimateSections(updated);
                            const totRcv = updated.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                            const totDep = updated.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                            uploadEstimateForm.setFieldsValue({ rcv_amount: totRcv, acv_amount: totRcv - totDep, depreciation_amount: totDep });
                          }} />
                      </Col>
                      <Col span={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                        <InputNumber size="small" min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                          value={section.depreciation} onChange={v => {
                            const updated = [...uploadEstimateSections];
                            const dep = v || 0;
                            const rcv = updated[idx].rcv || 0;
                            updated[idx] = { ...updated[idx], depreciation: dep, net_acv: rcv - dep };
                            setUploadEstimateSections(updated);
                            const totRcv = updated.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                            const totDep = updated.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                            uploadEstimateForm.setFieldsValue({ rcv_amount: totRcv, acv_amount: totRcv - totDep, depreciation_amount: totDep });
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

          {/* Totals */}
          <div style={{ background: '#fafafa', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
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
        </Form>
      </Modal>
    </div>
  );
};

export default SupplementDetail;
