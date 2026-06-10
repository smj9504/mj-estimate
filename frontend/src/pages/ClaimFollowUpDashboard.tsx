import React, { useState, useMemo, useEffect } from 'react';
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
  Drawer,
  Descriptions,
  Divider,
  Tabs,
  Popconfirm,
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
  FilePdfOutlined,
  HistoryOutlined,
  UserOutlined,
  PhoneOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { supplementService } from '../services/supplementService';
import { fileService } from '../services/fileService';
import { EmailComposer, CommunicationTimeline } from '../components/claim-followup';
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
];

const TASK_TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  wm_docs_sent: <SendOutlined />,
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

// Ordered stages for the pipeline view
const STAGE_ORDER: TaskType[] = [
  'wm_docs_sent',
  'estimate_request',
  'dispute',
  'appraisal',
  'attorney_referral',
  'supplement_sent',
  'payment_check',
  'wm_payment_check',
  'depreciation_recovery',
  'docs_sent',
  'general',
];

const STAGE_LABELS: Record<TaskType, string> = {
  wm_docs_sent: 'WM Docs',
  estimate_request: 'Est. Request',
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
  resolved: 4,
  cancelled: 5,
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

  return STAGE_ORDER
    .filter(stage => stageMap.has(stage))
    .map(stage => {
      const stageTasks = stageMap.get(stage)!;

      // Worst (most urgent) status across all tasks in this stage
      let worstStatus = 'cancelled';
      let worstPri = 5;
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
  currentStage: TaskType | null;
  hasOverdue: boolean;
  hasUrgent: boolean;
  wmCostStatus: string;
  nextFollowupDate: string | null;
  supplementStatuses: Record<string, number>;
  pendingInfoRequests: number;
  pa_name: string;
  pa_company: string;
  pa_email: string;
  pa_phone: string;
}

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const ClaimEstimatesPanel: React.FC<{ claimId: string }> = ({ claimId }) => {
  const [estimates, setEstimates] = useState<any[]>([]);
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
      acv_amount: Math.round((totalRcv - totalDep - ded) * 100) / 100,
      depreciation_amount: Math.round(totalDep * 100) / 100,
    });
  };

  const updateEditSection = (idx: number, field: string, value: any) => {
    const sections = [...(editValues.sections_data || [])];
    sections[idx] = { ...sections[idx], [field]: value };
    if (field === 'rcv' || field === 'depreciation') {
      const rcv = field === 'rcv' ? (value || 0) : (sections[idx].rcv || 0);
      const dep = field === 'depreciation' ? (value || 0) : (sections[idx].depreciation || 0);
      sections[idx].net_acv = rcv - dep;
    }
    // Recalc totals: ACV = RCV - DEP - DED
    const totalRcv = sections.reduce((s: number, sec: any) => s + (sec.rcv || 0), 0);
    const totalDep = sections.reduce((s: number, sec: any) => s + (sec.depreciation || 0), 0);
    const ded = editValues.deductible || 0;
    setEditValues({
      ...editValues,
      sections_data: sections,
      rcv_amount: Math.round(totalRcv * 100) / 100,
      acv_amount: Math.round((totalRcv - totalDep - ded) * 100) / 100,
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
  const hasBidItems = bidItems.filter((b: any) => b.custom_document_file_id).length > 0;

  // Check for WM data on claim but no WM negotiation record
  const hasWmNegotiation = estimates.some((e: any) => e.estimate_category === 'water_mitigation');
  const claimWmStatus = hasEstimates ? (estimates[0] as any).claim_wm_cost_status : null;
  const claimWmAmount = hasEstimates ? (estimates[0] as any).claim_wm_estimate_amount : 0;
  const showWmFallback = !hasWmNegotiation && claimWmStatus === 'separate_estimate' && claimWmAmount > 0;

  if (!hasEstimates && !hasBidItems && !showWmFallback) {
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
        color: cfg.tagColor === 'cyan' ? '#0958d9' : cfg.tagColor === 'purple' ? '#531dab' : cfg.tagColor === 'volcano' ? '#d4380d' : '#595959',
        bg: cfg.tagColor === 'cyan' ? '#e6f4ff' : cfg.tagColor === 'purple' ? '#f9f0ff' : cfg.tagColor === 'volcano' ? '#fff2e8' : '#fafafa',
        border: cfg.tagColor === 'cyan' ? '#91caff' : cfg.tagColor === 'purple' ? '#d3adf7' : cfg.tagColor === 'volcano' ? '#ffbb96' : '#d9d9d9',
      }])
    ),
    other: { label: 'Other', color: '#595959', bg: '#fafafa', border: '#d9d9d9' },
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
                  border: isEditing ? '1px solid #faad14' : isLatestInCategory ? '1px solid #1890ff' : '1px solid #f0f0f0',
                  background: isEditing ? '#fffbe6' : isLatestInCategory ? '#f6fbff' : '#fff',
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
                          <FilePdfOutlined style={{ color: '#ff4d4f' }} />
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
                              setEditValues({ ...editValues, deductible: ded, acv_amount: Math.round((rcv - dep - ded) * 100) / 100 });
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
                                        acv_amount: Math.round((totalRcv - totalDep - ded) * 100) / 100,
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
                        <Button size="small" type="text" icon={<FilePdfOutlined style={{ color: '#ff4d4f' }} />} style={{ fontSize: 11 }}>
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
                  <div style={{ marginTop: 6, borderTop: '1px dashed #e8e8e8', paddingTop: 6 }}>
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

      {/* Bid Item Estimate PDFs */}
      {hasBidItems && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Bid Item Estimates</Text>
          {bidItems.filter((b: any) => b.custom_document_file_id).map((item: any) => (
            <div
              key={item.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 8px', marginBottom: 2, background: '#fafafa', borderRadius: 4,
              }}
            >
              <Space size={6}>
                <Tag style={{ margin: 0, fontSize: 10 }}>{item.estimate_type?.toUpperCase()}</Tag>
                <Text style={{ fontSize: 12 }}>{item.title || item.estimate_type}</Text>
                {item.custom_amount != null && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{formatCurrency(item.custom_amount)}</Text>
                )}
              </Space>
              <a
                href={`${fileService.getDownloadUrl(item.custom_document_file_id)}?inline=true`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button type="text" size="small" icon={<FilePdfOutlined style={{ color: '#ff4d4f' }} />} style={{ fontSize: 11 }}>
                  PDF
                </Button>
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ClaimFollowUpDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
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
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editEstimateForm] = Form.useForm();
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
          hasUrgent: false,
          wmCostStatus: '',
          nextFollowupDate: null,
          supplementStatuses: {},
          pendingInfoRequests: 0,
          pa_name: task.pa_name || '',
          pa_company: task.pa_company || '',
          pa_email: task.pa_email || '',
          pa_phone: task.pa_phone || '',
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

      // Track pending info requests
      if (task.pending_info_requests && task.pending_info_requests > group.pendingInfoRequests) {
        group.pendingInfoRequests = task.pending_info_requests;
      }

      // Track active (non-resolved) stages
      if (!['resolved', 'cancelled'].includes(task.status)) {
        group.activeStages.add(task.task_type);
      }

      // Track WM cost status from claim
      if ((task as any).wm_cost_status && !group.wmCostStatus) {
        group.wmCostStatus = (task as any).wm_cost_status;
      }

      // Check urgent priority on active tasks
      if (task.priority === 'urgent' && !['resolved', 'cancelled'].includes(task.status)) {
        group.hasUrgent = true;
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
    const totalAcv = totalRcv - totalDep - ded;
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
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>
          {status.replace('_', ' ').toUpperCase()}
        </Tag>
      ),
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
                {
                  key: 'resolve',
                  icon: <CheckCircleOutlined />,
                  label: 'Resolve',
                  disabled: record.status === 'resolved',
                  onClick: async () => {
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
                    if (task.claim_id) {
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
                  },
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

    // Virtual resolved stages based on claim data (no task needed)
    const virtualResolved = new Set<TaskType>();
    if (group.wmCostStatus === 'included_in_rebuild'
        && !resolvedTypes.has('wm_payment_check')
        && !activeTypes.has('wm_payment_check')) {
      virtualResolved.add('wm_payment_check');
    }

    // Virtual pending: WM payment needs tracking but no task created yet
    const virtualPending = new Set<TaskType>();
    if (group.wmCostStatus === 'separate_estimate'
        && !resolvedTypes.has('wm_payment_check')
        && !activeTypes.has('wm_payment_check')) {
      virtualPending.add('wm_payment_check');
    }
    // Ensure rebuild payment shows when estimate exists but no task yet
    if ((resolvedTypes.has('wm_docs_sent') || activeTypes.has('wm_docs_sent'))
        && !resolvedTypes.has('payment_check')
        && !activeTypes.has('payment_check')
        && group.wmCostStatus) {
      virtualPending.add('payment_check');
    }

    // Only show stages that this claim actually has tasks for (or virtual)
    const relevantStages = STAGE_ORDER.filter(
      stage => resolvedTypes.has(stage) || activeTypes.has(stage)
        || virtualResolved.has(stage) || virtualPending.has(stage)
    );

    if (relevantStages.length === 0) return null;

    // Payment status labels for display
    const PAYMENT_STATUS_LABELS: Record<string, string> = {
      received: 'Received',
      issued: 'Issued',
      homeowner_holding: 'HO Holding',
      lost: 'Lost',
      reissued: 'Reissued',
      partial: 'Partial',
      pending: 'Pending',
    };

    // Determine overall claim progress summary
    // Count what's done vs what's still active/pending
    const hasActiveOrPending = relevantStages.some(
      s => activeTypes.has(s) || virtualPending.has(s)
    );
    const allResolved = !hasActiveOrPending;

    // Summary tag for WM Docs only claims that are waiting for estimate
    const onlyWmDocs = relevantStages.length === 1 && relevantStages[0] === 'wm_docs_sent';
    const wmDocsResolved = resolvedTypes.has('wm_docs_sent') && !activeTypes.has('wm_docs_sent');

    if (onlyWmDocs && wmDocsResolved) {
      // WM Docs sent & resolved, but no estimate/payment stage yet → Waiting for Estimate
      return (
        <Space size={4}>
          <Tag style={{ backgroundColor: 'transparent', color: '#b7b7b7', border: '1px solid #e8e8e8', fontSize: 10, margin: 0, lineHeight: '20px', opacity: 0.7 }}>
            <CheckCircleOutlined style={{ marginRight: 3, fontSize: 9 }} />Docs Sent
          </Tag>
          <RightOutlined style={{ fontSize: 10, color: '#d9d9d9' }} />
          <Tag style={{ backgroundColor: '#fff7e6', color: '#d48806', border: '1px dashed #ffc069', fontSize: 11, margin: 0, lineHeight: '20px' }}>
            <ClockCircleOutlined style={{ marginRight: 3, fontSize: 10 }} />Waiting for Estimate
          </Tag>
        </Space>
      );
    }

    if (onlyWmDocs && activeTypes.has('wm_docs_sent')) {
      // WM Docs still active (not resolved)
      return (
        <Tag style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', fontSize: 11, margin: 0, lineHeight: '20px' }}>
          Docs Sent - Awaiting Response
        </Tag>
      );
    }

    return (
      <Space size={4} wrap>
        {relevantStages.map((stage, idx) => {
          const isResolved = resolvedTypes.has(stage);
          const isActive = activeTypes.has(stage);
          const stageTask = group.tasks.find(t => t.task_type === stage && !['resolved', 'cancelled'].includes(t.status));
          const resolvedTask = group.tasks.find(t => t.task_type === stage && t.status === 'resolved');
          const anyTask = stageTask || resolvedTask;
          const isStageOverdue = stageTask ? isOverdue(stageTask) : false;

          const isVirtualResolved = virtualResolved.has(stage);
          const isVirtualPending = virtualPending.has(stage);
          const resolved = (isResolved && !isActive) || isVirtualResolved;

          // Is this a past completed stage (has active/pending stages after it)?
          const laterStagesExist = relevantStages.slice(idx + 1).some(
            s => activeTypes.has(s) || virtualPending.has(s) || resolvedTypes.has(s) || virtualResolved.has(s)
          );
          const isPastStage = resolved && laterStagesExist;

          // Payment-specific
          const isPaymentStage = stage === 'payment_check' || stage === 'wm_payment_check';
          const paymentStatus = anyTask?.payment_status;
          const paymentNeedsAttention = isPaymentStage && paymentStatus
            && ['homeowner_holding', 'lost', 'partial'].includes(paymentStatus);

          let color: string;
          let textColor: string;
          let borderStyle: string;

          if (paymentNeedsAttention) {
            color = '#fff7e6';
            textColor = '#d48806';
            borderStyle = '1px solid #ffc069';
          } else if (isPastStage) {
            // Past completed stage - subtle
            color = 'transparent';
            textColor = '#b7b7b7';
            borderStyle = '1px solid #e8e8e8';
          } else if (resolved && allResolved) {
            // All done - final green
            color = '#f6ffed';
            textColor = '#52c41a';
            borderStyle = '1px solid #b7eb8f';
          } else if (resolved) {
            color = '#f6ffed';
            textColor = '#52c41a';
            borderStyle = '1px solid #b7eb8f';
          } else if (isStageOverdue) {
            color = '#ff4d4f';
            textColor = '#fff';
            borderStyle = 'none';
          } else if (isActive) {
            color = '#1890ff';
            textColor = '#fff';
            borderStyle = 'none';
          } else if (isVirtualPending) {
            color = '#fff7e6';
            textColor = '#fa8c16';
            borderStyle = '1px dashed #ffc069';
          } else {
            color = '#d9d9d9';
            textColor = '#999';
            borderStyle = 'none';
          }

          // Build label
          let label = STAGE_LABELS[stage];
          // For past stages, use shorter labels
          if (isPastStage) {
            const SHORT_LABELS: Record<string, string> = {
              wm_docs_sent: 'Docs',
              payment_check: 'Rebuild $',
              wm_payment_check: 'WM $',
            };
            label = SHORT_LABELS[stage] || label;
          }
          if (isPaymentStage && paymentStatus && paymentStatus !== 'pending') {
            const statusLabel = PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus;
            if (isPastStage) {
              label = `${label}: ${statusLabel}`;
            } else {
              label = `${STAGE_LABELS[stage]}: ${statusLabel}`;
            }
          }

          // Tooltip
          const paymentNote = anyTask?.payment_note;
          const tooltipText = paymentNote
            || (isPastStage ? `${STAGE_LABELS[stage]} - Done` : '');

          const tagElement = (
            <Tag
              style={{
                backgroundColor: color,
                color: textColor,
                border: borderStyle,
                fontSize: isPastStage ? 10 : 11,
                margin: 0,
                whiteSpace: 'nowrap',
                lineHeight: '20px',
                opacity: isPastStage ? 0.7 : 1,
              }}
            >
              {isPastStage && <CheckCircleOutlined style={{ marginRight: 3, fontSize: 9 }} />}
              {resolved && !isPastStage && !paymentNeedsAttention && <CheckCircleOutlined style={{ marginRight: 3, fontSize: 10 }} />}
              {paymentNeedsAttention && <ExclamationCircleOutlined style={{ marginRight: 3, fontSize: 10 }} />}
              {isVirtualPending && <ClockCircleOutlined style={{ marginRight: 3, fontSize: 10 }} />}
              {label}
            </Tag>
          );

          return (
            <React.Fragment key={stage}>
              {idx > 0 && <RightOutlined style={{ fontSize: 10, color: '#d9d9d9' }} />}
              {tooltipText ? (
                <Tooltip title={tooltipText}>{tagElement}</Tooltip>
              ) : tagElement}
            </React.Fragment>
          );
        })}
      </Space>
    );
  };

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
          <Col xs={24} sm={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {claimGroups.length} claims, {tasks.length} tasks
            </Text>
          </Col>
        </Row>
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
              <div style={{ width: '100%' }}>
                {/* Row 1: Address + meta + badges */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 0', minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', minWidth: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClaimGroup(group);
                        setDrawerEmailTaskId(
                          group.tasks.find(t => !['resolved', 'cancelled'].includes(t.status))?.id
                        );
                        setClaimDrawerOpen(true);
                      }}
                    >
                      <EnvironmentOutlined style={{ color: group.hasOverdue ? '#ff4d4f' : '#1890ff', fontSize: 14, flexShrink: 0 }} />
                      <Text
                        strong
                        style={{
                          fontSize: isMobile ? 13 : 14,
                          color: group.hasOverdue ? '#cf1322' : '#1890ff',
                          textDecoration: 'underline',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {group.property_address || 'No Address'}
                      </Text>
                    </div>
                    {!isMobile && (
                      <>
                        <Tag style={{ fontSize: 11, margin: 0, flexShrink: 0 }}>
                          {group.insurance_company || 'N/A'}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                          #{group.claim_number}
                        </Text>
                        {group.pa_name && (
                          <Tooltip title={`PA: ${group.pa_name}${group.pa_company ? ` (${group.pa_company})` : ''}${group.pa_email ? ` · ${group.pa_email}` : ''}${group.pa_phone ? ` · ${group.pa_phone}` : ''}`}>
                            <Tag color="geekblue" style={{ fontSize: 10, margin: 0, flexShrink: 0 }}>
                              PA: {group.pa_name}
                            </Tag>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
                        style={{ width: 50, margin: 0 }}
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
                {/* Row 2: Mobile meta info */}
                {isMobile && (
                  <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Tag style={{ fontSize: 10, margin: 0 }}>
                      {group.insurance_company || 'N/A'}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      #{group.claim_number}
                    </Text>
                    {group.pa_name && (
                      <Tag color="geekblue" style={{ fontSize: 9, margin: 0 }}>PA: {group.pa_name}</Tag>
                    )}
                  </div>
                )}
                {/* Row 3: Stage pipeline + Supplement status */}
                <div style={{ marginTop: 4, overflow: 'hidden' }}>
                  <Space size={4} wrap>
                    {renderStagePipeline(group)}
                    {(() => {
                      const ss = group.supplementStatuses;
                      const hasSupp = Object.keys(ss).length > 0;
                      const hasResolved = group.tasks.some(t => t.status === 'resolved' && t.task_type === 'estimate_request');

                      // Determine supplement display status
                      let suppLabel = '';
                      let suppColor = 'default';
                      let suppTooltip = '';

                      if (hasSupp) {
                        if (ss['identified']) {
                          suppLabel = 'Supplement: Review Needed';
                          suppColor = 'orange';
                          suppTooltip = 'Insurance estimate received. Supplement review needed.';
                        } else if (ss['in_progress']) {
                          suppLabel = 'Supplement: In Progress';
                          suppColor = 'processing';
                          suppTooltip = 'Supplement estimate is being prepared.';
                        } else if (ss['submitted']) {
                          suppLabel = 'Supplement: Submitted';
                          suppColor = 'blue';
                          suppTooltip = 'Supplement sent to PA/Insurance.';
                        } else if (ss['under_review']) {
                          suppLabel = 'Supplement: Under Review';
                          suppColor = 'geekblue';
                          suppTooltip = 'Supplement is under review by insurance.';
                        } else if (ss['approved']) {
                          suppLabel = 'Supplement: Approved';
                          suppColor = 'green';
                        } else if (ss['denied']) {
                          suppLabel = 'Supplement: Denied';
                          suppColor = 'red';
                        }
                      } else if (hasResolved) {
                        suppLabel = 'Supplement: Pending';
                        suppColor = 'warning';
                        suppTooltip = 'Insurance estimate received. Supplement needs to be created.';
                      }

                      return (
                        <>
                          {suppLabel && (
                            <Tooltip title={suppTooltip}>
                              <Tag
                                color={suppColor}
                                style={{ fontSize: 10, margin: 0, cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); navigate('/supplements'); }}
                              >
                                {suppLabel}
                              </Tag>
                            </Tooltip>
                          )}
                          {group.pendingInfoRequests > 0 && (
                            <Tooltip title={`${group.pendingInfoRequests} pending info request(s) - waiting for response from PA or contractor`}>
                              <Tag
                                color="volcano"
                                style={{ fontSize: 10, margin: 0, cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Navigate to first in_progress supplement
                                  const suppId = group.tasks.find(t => t.supplement_statuses)?.claim_id;
                                  navigate('/supplements');
                                }}
                              >
                                Info Waiting ({group.pendingInfoRequests})
                              </Tag>
                            </Tooltip>
                          )}
                        </>
                      );
                    })()}
                  </Space>
                </div>
              </div>
            ),
            children: (
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
        width={isMobile ? '95vw' : 600}
        style={isMobile ? { top: 10 } : undefined}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="claim_id" label="Claim ID" rules={[{ required: true }]}>
            <Input placeholder="Enter claim ID" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="task_type" label="Task Type" rules={[{ required: true }]}>
                <Select options={TASK_TYPE_OPTIONS} placeholder="Select type" />
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
          <Form.Item name="outcome" label="Outcome" rules={[{ required: true, message: 'Select an outcome' }]}>
            <Select placeholder="What was the result?" onChange={(v) => { setResolveOutcome(v); setResolveDeniedAction(undefined); resolveForm.setFieldsValue({ denied_action: undefined }); }}>
              <Select.Option value="estimate_received">Insurance Estimate Received</Select.Option>
              <Select.Option value="wm_estimate_only">WM Estimate Only (Rebuild Unknown)</Select.Option>
              <Select.Option value="estimate_requested">Insurance Requested Our Estimate</Select.Option>
              <Select.Option value="denied">Claim Denied</Select.Option>
              <Select.Option value="other">Other</Select.Option>
            </Select>
          </Form.Item>

          {resolveOutcome === 'denied' && (
            <Form.Item
              name="denied_action"
              label="Next Action"
              rules={[{ required: true, message: 'Select next action' }]}
            >
              <Select placeholder="What would you like to do?" onChange={(v) => setResolveDeniedAction(v)}>
                <Select.Option value="complete">
                  <span>Complete</span>
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>Close the claim</span>
                </Select.Option>
                <Select.Option value="dispute">
                  <span>Dispute</span>
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>Create estimate & dispute with insurance</span>
                </Select.Option>
                <Select.Option value="appraisal">
                  <span>Appraisal</span>
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>Proceed to appraisal process</span>
                </Select.Option>
                <Select.Option value="attorney">
                  <span>Attorney</span>
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>Refer to attorney</span>
                </Select.Option>
              </Select>
            </Form.Item>
          )}

          {resolveOutcome === 'estimate_received' && (
            <>
              <Form.Item label="Insurance Estimate PDF">
                <Space direction="vertical" style={{ width: '100%' }}>
                  {existingPdfName && !resolveFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#f6ffed', borderRadius: 4, border: '1px solid #b7eb8f' }}>
                      <FilePdfOutlined style={{ color: '#ff4d4f' }} />
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
                        <div style={{ marginTop: 8 }}>
                          <Form.Item label="WM Estimate PDF (Optional)" style={{ marginBottom: 8 }}>
                            {existingWmPdfName && !resolveWmFile && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', marginBottom: 6, background: '#f6ffed', borderRadius: 4, border: '1px solid #b7eb8f' }}>
                                <FilePdfOutlined style={{ color: '#ff4d4f' }} />
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
                        <div style={{ marginTop: 8, padding: '6px 8px', background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
                          <Text style={{ fontSize: 12, color: '#d48806' }}>
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
            <div style={{ background: '#f6ffed', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #b7eb8f' }}>
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
              <div style={{ marginTop: 8, padding: '6px 8px', background: '#e6f7ff', borderRadius: 4, border: '1px solid #91d5ff' }}>
                <Text style={{ fontSize: 12, color: '#1890ff' }}>
                  Amount and PDF are both optional. Rebuild estimate can be added later.
                </Text>
              </div>
            </div>
          )}

          {/* Payment Status for payment tasks */}
          {selectedTask && ['payment_check', 'wm_payment_check'].includes(selectedTask.task_type) && (
            <div style={{ background: '#e6f7ff', borderRadius: 6, padding: '10px 12px', marginBottom: 12, border: '1px solid #91d5ff' }}>
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
            <div style={{ background: '#e6f7ff', borderRadius: 6, padding: '10px 12px', marginTop: 8, border: '1px solid #91d5ff' }}>
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
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '10px 12px' }}>
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
                      ? <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                      : <FileTextOutlined style={{ color: '#999', fontSize: 14 }} />
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
                          acv_amount: Math.round((totalRcv - totalDep - ded) * 100) / 100,
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
            </Text>
          </Space>
        }
        open={claimDrawerOpen}
        onClose={() => { setClaimDrawerOpen(false); setSelectedClaimGroup(null); }}
        width={isMobile ? '100%' : 680}
        destroyOnClose
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
                    {renderStagePipeline(group)}
                  </Space>
                </div>

                {/* PA Info */}
                {group.pa_name && (
                  <div style={{ marginBottom: 12, padding: '6px 8px', background: '#f0f5ff', borderRadius: 6, borderLeft: '3px solid #597ef7' }}>
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
                    <div style={{ marginBottom: 12, padding: '6px 8px', background: '#fafafa', borderRadius: 6 }}>
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
                    <Statistic title="Active Tasks" value={activeTasks.length} valueStyle={{ fontSize: 18, color: '#1890ff' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Resolved" value={resolvedTasks.length} valueStyle={{ fontSize: 18, color: '#52c41a' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="Next Follow-up"
                      value={group.nextFollowupDate ? dayjs(group.nextFollowupDate).format('MM/DD') : '-'}
                      valueStyle={{
                        fontSize: 18,
                        color: group.hasOverdue ? '#cf1322' : undefined,
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
                      render: (t: TaskType) => STAGE_LABELS[t] || t,
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
        destroyOnClose
      >
        {detailTask && (
          <>
            {/* Status & Priority row */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <Tag color="blue">{STAGE_LABELS[detailTask.task_type] || detailTask.task_type}</Tag>
              <Tag color={STATUS_COLORS[isOverdue(detailTask) ? 'overdue' : detailTask.status] || 'default'}>
                {(isOverdue(detailTask) ? 'OVERDUE' : detailTask.status).replace('_', ' ').toUpperCase()}
              </Tag>
              <Tag color={PRIORITY_TAG_COLORS[detailTask.priority] || 'default'}>
                {detailTask.priority.toUpperCase()}
              </Tag>
            </div>

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
                  <div style={{ padding: '4px 8px', background: '#fafafa', borderRadius: 4, marginTop: 2 }}>
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
                    setSelectedTask(detailTask);
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
          background-color: #fff2f0 !important;
        }
        .ant-table-row-overdue:hover > td {
          background-color: #ffece8 !important;
        }
        .ant-collapse > .ant-collapse-item > .ant-collapse-header {
          padding: 8px 12px !important;
          align-items: flex-start !important;
        }
        .ant-collapse-content-box {
          padding: 0 !important;
        }
        @media (max-width: 576px) {
          .ant-collapse > .ant-collapse-item > .ant-collapse-header {
            padding: 6px 8px !important;
          }
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
