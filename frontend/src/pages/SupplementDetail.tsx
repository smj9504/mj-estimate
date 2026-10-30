import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Space, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Tooltip,
  Collapse, DatePicker, Divider, Checkbox, Alert, Upload,
  Spin, Table, Grid,
} from 'antd';
import {
  ArrowLeftOutlined, FileTextOutlined,
  SendOutlined, PhoneOutlined,
  FilePdfOutlined, SaveOutlined, UploadOutlined,
  LoadingOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined,
  SwapOutlined, InfoCircleOutlined, CheckOutlined, ReloadOutlined,
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
import { useBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import { PageHeader, Pill, PropertyList, humanize, useSheetModal, type TagTone } from '../components/common/ui';
import { CompanyTag } from '../components/water-mitigation/paymentBoardShared';
import {
  SupplementStatusPill, SUPPLEMENT_STATUSES, supplementStatusLabel,
  BID_TYPE_LABELS, REQUIRED_ESTIMATE_OPTIONS, formatCurrency, formatSignedCurrency,
} from '../components/supplement/supplementUi';
import type {
  SupplementRequest, BidItemEstimate, BidItemEstimateCreate,
  SupplementFollowUp, BidItemType,
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

const { Text } = Typography;
const { TextArea } = Input;

const { useBreakpoint } = Grid;

/** Info requests waiting on someone read warm; a partial answer is yellow; done is green */
const INFO_STATUS_TONES: Record<string, TagTone> = {
  pending: 'orange',
  sent: 'orange',
  awaiting_response: 'orange',
  partially_resolved: 'yellow',
  resolved: 'green',
};

// Maps a Required Estimates checkbox key to the Bid Item Estimate `estimate_type`
// it corresponds to, so checking a box can auto-create the matching bid item.
// Only 'pack_in_out' differs in name from its bid item type ('packing').
const REQUIRED_ESTIMATE_TO_BID_TYPE: Record<string, BidItemType> = {
  xactimate: 'xactimate',
  pack_in_out: 'packing',
  cabinet: 'cabinet',
  bathroom: 'bathroom',
  roofing: 'roofing',
  kitchen: 'kitchen',
  flooring: 'flooring',
};

// A bid item is considered "auto-created and still empty" (safe to silently
// remove when its checkbox is unchecked) if it has no amount, no PDF, no
// description, and no link to another domain's estimate.
const isEmptyBidItem = (item: BidItemEstimate): boolean =>
  !item.custom_amount
  && !item.custom_document_file_id
  && !item.description
  && !item.bathroom_estimate_id
  && !item.cabinet_estimate_id
  && !item.pack_calculation_id
  && !item.roofing_estimate_id;

const ESTIMATE_ID_FIELD_MAP: Record<string, string> = {
  bathroom: 'bathroom_estimate_id',
  cabinet: 'cabinet_estimate_id',
  packing: 'pack_calculation_id',
  roofing: 'roofing_estimate_id',
};

const SupplementDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  // Compact controls on desktop; full-size ones on phones so they can be tapped
  const controlSize = isMobile ? 'middle' : 'small';
  const { sheetProps } = useSheetModal();

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
  const [editingDeductible, setEditingDeductible] = useState(false);
  const [deductibleDraft, setDeductibleDraft] = useState({ deductible: 0, discount: 0 });

  const [editedRequiredEstimates, setEditedRequiredEstimates] = useState<string[]>([]);
  const [requiredEstimatesDirty, setRequiredEstimatesDirty] = useState(false);

  const [bidItemFile, setBidItemFile] = useState<{ id: string; name: string } | null>(null);
  const [bidItemFileUploading, setBidItemFileUploading] = useState(false);
  const [uploadingBidPdfItemId, setUploadingBidPdfItemId] = useState<string | null>(null);
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
  useBreadcrumbTitle(supplement?.title || null);

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
  // Only these can appear in the From dropdowns, so a default picked from
  // anything wider has no matching option and the Select shows its raw id.
  const sendableEmailAccounts = emailAccounts.filter(
    (a: any) => a.is_active && a.can_send !== false
  );

  const { data: bathroomEstimatesForBid = [] } = useQuery({
    queryKey: ['bathroom-estimates-for-bid'],
    // A bid item goes to the carrier, so only restorations — never an upgrade option
    queryFn: () => bathroomEstimateService.list({ page_size: 50, kind: 'restore' }).then(r => r.items),
    enabled: bidItemModalOpen && bidItemType === 'bathroom',
  });
  const { data: cabinetEstimatesForBid = [] } = useQuery({
    queryKey: ['cabinet-estimates-for-bid'],
    // A bid item goes to the carrier, so only restorations — never an upgrade option
    queryFn: () => cabinetEstimateService.list({ page_size: 50, kind: 'restore' }).then(r => r.items),
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

  // Backfill bid items for required estimates that were checked before this
  // auto-create behavior existed (or checked outside this page). Runs once
  // per supplement load; guarded by a ref so the create → refetch it causes
  // doesn't loop.
  const backfilledSupplementRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!supplement?.id) return;
    if (backfilledSupplementRef.current === supplement.id) return;
    backfilledSupplementRef.current = supplement.id;

    const checkedKeys = Object.entries(supplement.required_estimates || {})
      .filter(([, v]) => v).map(([k]) => k);
    const bidItems = supplement.bid_items || [];
    const missingTypes = checkedKeys
      .map(key => REQUIRED_ESTIMATE_TO_BID_TYPE[key])
      .filter((type): type is BidItemType => !!type)
      .filter(type => !bidItems.some(i => i.estimate_type === type));

    if (missingTypes.length === 0) return;

    Promise.all(missingTypes.map(type => supplementService.createBidItem(supplement.id, {
      supplement_id: supplement.id,
      estimate_type: type,
      title: BID_TYPE_LABELS[type] || type,
    }))).then(refreshSupplement);
  }, [supplement]);

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
      if (!sendableEmailAccounts.some((a: any) => a.id === paSelectedAccountId)) {
        setPaSelectedAccountId(sendableEmailAccounts[0]?.id);
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
      <div className="sup-error">
        <h1 className="ui-section-title">Failed to load supplement.</h1>
        <p>Check your connection, then try again.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button type="primary" icon={<ReloadOutlined />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['supplement', id] })}>
            Try again
          </Button>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplements')}>
            Back to Supplements
          </Button>
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

  const saveDeductible = () => updateMutation.mutate(
    {
      deductible: deductibleDraft.deductible,
      // A discount can't exceed the deductible it comes out of
      deductible_discount: Math.min(deductibleDraft.discount, deductibleDraft.deductible),
    },
    { onSuccess: () => setEditingDeductible(false) },
  );

  const saveEstimateTotals = async (negotiationId: string) => {
    setSavingSections(true);
    try {
      await supplementService.updateInsuranceEstimate(supplement.claim_id, negotiationId, {
        sections_data: editingSections.length > 0 ? editingSections : undefined,
        rcv_amount: editingTotals.rcv,
        depreciation_amount: editingTotals.dep,
        acv_amount: editingTotals.acv,
        deductible: editingTotals.ded,
      });
      message.success('Estimate saved');
      setEditingSectionsVerId(null);
      supplementService.listInsuranceEstimates(supplement.claim_id).then(setEstimateVersions);
      // The claim's deductible follows the estimate's, so the header needs a refetch
      queryClient.invalidateQueries({ queryKey: ['supplement', id] });
    } catch { message.error('Failed to save'); } finally { setSavingSections(false); }
  };

  const hasBidPdf = !!supplement.bid_items?.some(i => i.custom_document_file_id);
  const bidItems = supplement.bid_items || [];
  const wmCompany = supplement.wm_company_id
    ? (allCompanies as any[]).find(c => c.id === supplement.wm_company_id)
      || { id: supplement.wm_company_id, name: supplement.wm_company_name || 'Company' }
    : null;
  const isHighPriority = supplement.priority === 'high' || supplement.priority === 'urgent';

  const openEstimateUpload = () => {
    uploadEstimateForm.resetFields();
    setUploadEstimateFileId(null);
    setUploadEstimateFileName(null);
    setUploadEstimateModalOpen(true);
  };

  const saveRequiredEstimates = () => {
    const required_estimates: Record<string, boolean> = {};
    REQUIRED_ESTIMATE_OPTIONS.forEach(opt => {
      required_estimates[opt.key] = editedRequiredEstimates.includes(opt.key);
    });
    const hasAnyChecked = editedRequiredEstimates.length > 0;
    const updateData: Partial<SupplementRequest> = { required_estimates };
    if (hasAnyChecked && supplement.status === 'identified') {
      updateData.status = 'in_progress';
    }
    const previouslyChecked = Object.entries(supplement.required_estimates || {})
      .filter(([, v]) => v).map(([k]) => k);
    const newlyChecked = editedRequiredEstimates.filter(k => !previouslyChecked.includes(k));
    const newlyUnchecked = previouslyChecked.filter(k => !editedRequiredEstimates.includes(k));

    updateMutation.mutate(updateData, {
      onSuccess: async () => {
        setRequiredEstimatesDirty(false);
        queryClient.invalidateQueries({ queryKey: ['supplements-pending-review'] });

        // Auto-create a blank bid item for each newly checked
        // required estimate that doesn't already have one.
        const currentBidItems = supplement.bid_items || [];
        const toCreate = newlyChecked
          .map(key => REQUIRED_ESTIMATE_TO_BID_TYPE[key])
          .filter((type): type is BidItemType => !!type)
          .filter(type => !currentBidItems.some(i => i.estimate_type === type));

        // Auto-remove bid items for unchecked estimates, but only
        // if they're still empty (untouched since auto-creation).
        const toRemove = newlyUnchecked
          .map(key => REQUIRED_ESTIMATE_TO_BID_TYPE[key])
          .filter((type): type is BidItemType => !!type)
          .map(type => currentBidItems.find(i => i.estimate_type === type))
          .filter((item): item is BidItemEstimate => !!item && isEmptyBidItem(item));

        if (toCreate.length === 0 && toRemove.length === 0) return;

        try {
          await Promise.all([
            ...toCreate.map(type => supplementService.createBidItem(supplement.id, {
              supplement_id: supplement.id,
              estimate_type: type,
              title: BID_TYPE_LABELS[type] || type,
            })),
            ...toRemove.map(item => supplementService.deleteBidItem(supplement.id, item.id)),
          ]);
          refreshSupplement();
        } catch {
          message.error('Failed to sync bid items with required estimates');
        }
      },
    });
  };

  // Uploading a bid item PDF also tries to read its total so the amount fills itself.
  // Replacing swaps the file in place, so a wrong upload doesn't mean re-creating the item.
  const uploadBidItemPdf = async (item: BidItemEstimate, file: File, isReplace: boolean) => {
    if (file.type !== 'application/pdf') { message.error('PDF only'); return Upload.LIST_IGNORE; }
    setUploadingBidPdfItemId(item.id);
    try {
      const uploaded = await fileService.uploadFiles([file], 'supplement_bid_item', item.id, 'estimate_pdf');
      if (uploaded.length > 0) {
        const mutData: any = { custom_document_file_id: uploaded[0].id, custom_document_file_name: file.name };
        // Auto-extract total amount from PDF
        try {
          const result = await supplementService.extractBidItemTotal(file);
          if (result?.total_amount && result.total_amount > 0) {
            mutData.custom_amount = result.total_amount;
          }
        } catch {
          // Silent fail - user can manually enter amount
        }
        await updateBidItemMutation.mutateAsync({
          supplementId: supplement.id,
          itemId: item.id,
          data: mutData,
        });
        const done = isReplace ? 'PDF replaced' : 'PDF uploaded';
        if (mutData.custom_amount) {
          message.success(`${done}. Extracted total: ${formatCurrency(mutData.custom_amount)}`);
        } else if (isReplace) {
          message.success(`${done}. No total found in it, so check the amount.`);
        } else {
          message.success(done);
        }
      }
    } catch { message.error(isReplace ? 'Failed to replace PDF' : 'Upload failed'); }
    finally { setUploadingBidPdfItemId(null); }
    return false;
  };

  const deleteBidItem = (item: BidItemEstimate) => Modal.confirm({
    title: 'Delete this bid item?',
    content: item.title,
    okText: 'Delete',
    okButtonProps: { danger: true },
    onOk: () => {
      supplementService.deleteBidItem(supplement.id, item.id).then(() => {
        message.success('Deleted');
        refreshSupplement();
      });
    },
  });

  const renderBidTitle = (item: BidItemEstimate) => (
    <div style={{ minWidth: 0 }}>
      <Text
        className="sup-bid-title"
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 2 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text
            type="secondary"
            className={`sup-bid-notes${item.description ? '' : ' sup-bid-notes--empty'}`}
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
            <button
              type="button"
              className="sup-add-notes"
              onClick={(e) => {
                const editBtn = (e.currentTarget.previousElementSibling as HTMLElement)?.querySelector('.ant-typography-edit');
                if (editBtn) (editBtn as HTMLElement).click();
              }}
            >
              + Add scope notes
            </button>
          )}
        </div>
        {item.description && item.description.trim() && (
          <Tooltip title="AI polish">
            <Button
              type="text"
              size="small"
              className="ui-icon-btn"
              aria-label="Polish scope notes with AI"
              icon={polishingItemId === item.id ? <LoadingOutlined /> : <ThunderboltOutlined />}
              disabled={polishingItemId === item.id}
              style={{ height: 22, width: 22 }}
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
  );

  const renderBidAmount = (item: BidItemEstimate) => {
    const v = item.custom_amount;
    return (
      <div>
        <InputNumber
          key={`${item.id}-${v}`}
          min={0}
          step={0.01}
          prefix="$"
          defaultValue={v || 0}
          aria-label={`Amount for ${item.title}`}
          className={item.included_in_xactimate ? 'sup-amount-struck' : undefined}
          style={{ width: '100%' }}
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
          <div className="sup-net-line">
            <span>− {formatCurrency(inXactTotal)}</span>
            <strong>= {formatCurrency(xactNet)}</strong>
          </div>
        )}
      </div>
    );
  };

  const renderInXact = (item: BidItemEstimate, withLabel = false) => item.estimate_type === 'xactimate' ? (
    withLabel ? null : <span className="ui-props-empty">—</span>
  ) : (
    <Tooltip title="Xactimate에 이 항목 금액이 포함되어 있으면 체크">
      <Checkbox
        checked={item.included_in_xactimate}
        aria-label="Included in Xactimate"
        onChange={e => {
          updateBidItemMutation.mutate({
            supplementId: supplement.id,
            itemId: item.id,
            data: { included_in_xactimate: e.target.checked },
          });
        }}
      >
        {withLabel ? 'In Xactimate' : null}
      </Checkbox>
    </Tooltip>
  );

  const renderBidPdf = (item: BidItemEstimate) => {
    const linkedType = item.bathroom_estimate_id ? 'bathroom'
      : item.cabinet_estimate_id ? 'cabinet'
      : item.pack_calculation_id ? 'packing'
      : null;
    const linkedId = item.bathroom_estimate_id || item.cabinet_estimate_id || item.pack_calculation_id || null;
    const uploading = uploadingBidPdfItemId === item.id;
    return (
      <div className="sup-pdf-cell">
        {linkedType && linkedId && (
          <Tooltip title={`View ${BID_TYPE_LABELS[linkedType]} Estimate PDF`}>
            <Button
              type="text"
              size="small"
              className="ui-icon-btn"
              icon={<FileTextOutlined />}
              loading={pdfLoading}
              onClick={() => openEstimatePdf(linkedType, linkedId)}
            >
              Estimate
            </Button>
          </Tooltip>
        )}
        {item.custom_document_file_id ? (
          <>
            <Tooltip title={item.custom_document_file_name || 'View uploaded PDF'}>
              <a
                className="sup-pdf-link"
                href={`${fileService.getDownloadUrl(item.custom_document_file_id)}?inline=true`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${item.custom_document_file_name || 'uploaded PDF'}`}
              >
                <FilePdfOutlined />
              </a>
            </Tooltip>
            <Upload
              accept=".pdf"
              maxCount={1}
              showUploadList={false}
              disabled={uploading}
              beforeUpload={(file) => uploadBidItemPdf(item, file as unknown as File, true)}
            >
              <Button type="text" size="small" className="ui-icon-btn"
                icon={uploading ? <LoadingOutlined /> : <UploadOutlined />}
                disabled={uploading}
                aria-label={`Replace ${item.custom_document_file_name || 'uploaded PDF'}`}>
                {uploading ? 'Replacing...' : 'Replace'}
              </Button>
            </Upload>
          </>
        ) : (
          <Upload
            accept=".pdf"
            maxCount={1}
            showUploadList={false}
            disabled={uploading}
            beforeUpload={(file) => uploadBidItemPdf(item, file as unknown as File, false)}
          >
            <Button size="small" icon={uploading ? <LoadingOutlined /> : <UploadOutlined />} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </Upload>
        )}
      </div>
    );
  };

  const renderBidDelete = (item: BidItemEstimate) => (
    <Tooltip title="Delete">
      <Button
        type="text" size="small"
        className="ui-icon-btn ui-icon-btn--danger"
        aria-label={`Delete ${item.title}`}
        icon={<DeleteOutlined />}
        onClick={() => deleteBidItem(item)}
      />
    </Tooltip>
  );

  return (
    <div className="sup-page">
      <PageHeader
        title={supplement.title}
        meta={
          <>
            {supplement.request_type === 'estimate_request' && <Pill tone="gray">Estimate request</Pill>}
            {supplement.claim_number && <span>{supplement.claim_number}</span>}
            {supplement.insurance_company && <span>{supplement.insurance_company}</span>}
            {supplement.homeowner_name && <span>{supplement.homeowner_name}</span>}
            {supplement.submitted_date && (
              <span>
                Last sent {dayjs(supplement.submitted_date).format('MM/DD/YYYY')}
                {supplement.submitted_to && ` to ${supplement.submitted_to}`}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Select
              className="sup-status-select"
              value={supplement.status}
              onChange={v => updateMutation.mutate({ status: v })}
              style={{ width: 170 }}
              options={SUPPLEMENT_STATUSES.map(s => ({ value: s, label: supplementStatusLabel(s) }))}
              labelRender={({ value }) => <SupplementStatusPill status={value as string} />}
              optionRender={(option) => <SupplementStatusPill status={option.value as string} />}
              suffixIcon={<SwapOutlined />}
              aria-label="Supplement status"
            />
            <Tooltip title={hasBidPdf ? undefined : 'Upload bid item PDFs first'}>
              <span>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={openSendPaModal}
                  disabled={!hasBidPdf}
                >
                  Send to PA
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      <Row gutter={isMobile ? [0, 36] : [48, 36]}>
        <Col xs={24} lg={16}>
          {/* Details */}
          <section className="ui-section">
            <div className="ui-section-head">
              <h2 className="ui-section-title">Details</h2>
            </div>
            <Row gutter={[32, 0]}>
              <Col xs={24} md={12}>
                <PropertyList
                  labelWidth={112}
                  items={[
                    { key: 'claim', label: 'Claim #', value: supplement.claim_number },
                    { key: 'insurance', label: 'Insurance', value: supplement.insurance_company },
                    { key: 'homeowner', label: 'Homeowner', value: supplement.homeowner_name },
                    { key: 'address', label: 'Address', value: supplement.property_address },
                    {
                      key: 'deductible',
                      label: 'Deductible',
                      value: editingDeductible ? (
                        <div className="sup-inline-edit">
                          <InputNumber size={controlSize} min={0} step={100} prefix="$" style={{ width: 130 }} autoFocus
                            aria-label="Deductible"
                            value={deductibleDraft.deductible}
                            onChange={v => setDeductibleDraft(d => ({ ...d, deductible: v || 0 }))}
                            onPressEnter={saveDeductible} />
                          <span className="sup-field-label">Discount</span>
                          <InputNumber size={controlSize} min={0} max={deductibleDraft.deductible} step={100} prefix="$" style={{ width: 130 }}
                            aria-label="Deductible discount"
                            value={deductibleDraft.discount}
                            onChange={v => setDeductibleDraft(d => ({ ...d, discount: v || 0 }))}
                            onPressEnter={saveDeductible} />
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <Button size="small" type="primary" loading={updateMutation.isPending}
                              onClick={saveDeductible}>Save</Button>
                            <Button size="small" onClick={() => setEditingDeductible(false)}>Cancel</Button>
                          </span>
                        </div>
                      ) : (
                        <div className="sup-inline-value">
                          <span>
                            <span className="sup-money">{formatCurrency(supplement.deductible)}</span>
                            {(supplement.deductible_discount || 0) > 0 && (
                              <span className="sup-cell-meta">
                                − {formatCurrency(supplement.deductible_discount)} discount ={' '}
                                <strong>
                                  {formatCurrency((supplement.deductible || 0) - (supplement.deductible_discount || 0))}
                                </strong>{' '}homeowner owes
                              </span>
                            )}
                          </span>
                          <Button type="text" size="small" className="ui-icon-btn sup-edit-btn"
                            onClick={() => {
                              setDeductibleDraft({
                                deductible: supplement.deductible || 0,
                                discount: supplement.deductible_discount || 0,
                              });
                              setEditingDeductible(true);
                            }}>
                            Edit
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              </Col>
              <Col xs={24} md={12}>
                <PropertyList
                  labelWidth={112}
                  items={[
                    {
                      key: 'priority',
                      label: 'Priority',
                      value: supplement.priority
                        ? (isHighPriority
                          ? <Pill tone={supplement.priority === 'urgent' ? 'red' : 'orange'}>{humanize(supplement.priority)}</Pill>
                          : humanize(supplement.priority))
                        : null,
                    },
                    ...(supplement.request_type === 'estimate_request' ? [
                      { key: 'ours', label: 'Our Estimate', value: <span className="sup-money sup-money-strong">{formatCurrency(supplement.our_estimate_amount)}</span> },
                    ] : [
                      { key: 'original', label: 'Original', value: <span className="sup-money">{formatCurrency(supplement.original_amount)}</span> },
                      { key: 'supplement', label: 'Supplement', value: <span className="sup-money sup-money-strong">{formatCurrency(supplement.supplement_amount)}</span> },
                      {
                        key: 'difference',
                        label: 'Difference',
                        value: (
                          <span className={supplement.difference > 0 ? 'sup-diff-up' : supplement.difference < 0 ? 'sup-diff-down' : 'sup-money'}>
                            {formatSignedCurrency(supplement.difference)}
                          </span>
                        ),
                      },
                    ]),
                    { key: 'submitted_to', label: 'Submitted To', value: supplement.submitted_to },
                  ]}
                />
              </Col>
            </Row>
            {supplement.reason && (
              <PropertyList
                labelWidth={112}
                items={[{ key: 'reason', label: 'Reason', value: <span style={{ whiteSpace: 'pre-wrap' }}>{supplement.reason}</span> }]}
              />
            )}
          </section>

          {/* Insurance company estimates */}
          <section className="ui-section">
            <div className="ui-section-head">
              <h2 className="ui-section-title">
                Insurance Company Estimates
                {estimateVersions.length > 0 && (
                  <span className="sup-section-count">
                    {estimateVersions.length} version{estimateVersions.length > 1 ? 's' : ''}
                  </span>
                )}
              </h2>
              <Button size="small" icon={<UploadOutlined />} onClick={openEstimateUpload}>
                Upload New Estimate
              </Button>
            </div>

            {estimateVersionsLoading ? (
              <div className="sup-empty">
                <LoadingOutlined style={{ marginRight: 8 }} />
                Loading...
              </div>
            ) : estimateVersions.length === 0 ? (
              <div className="sup-empty">
                No insurance estimates uploaded yet.{' '}
                <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={openEstimateUpload}>
                  Upload the carrier's estimate
                </Button>
              </div>
            ) : (
              <div>
                {estimateVersions.map((ver, idx) => {
                  const isEditing = editingSectionsVerId === ver.id;
                  const sections = isEditing ? editingSections : (ver.sections_data || []);
                  return (
                    <div key={ver.id} className="sup-version">
                      {/* Header row: revision + PDF + replace */}
                      <div className="sup-version-head">
                        <div className="sup-version-title">
                          <span className="sup-version-rev">Rev #{ver.revision_number}</span>
                          {ver.revision_type && <span>{humanize(ver.revision_type)}</span>}
                          {idx === 0 && <Pill tone="blue">Latest</Pill>}
                        </div>
                        <div className="sup-version-actions">
                          {ver.file_download_id ? (
                            <a
                              className="sup-file-chip"
                              href={`${fileService.getDownloadUrl(ver.file_download_id)}?inline=true`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={ver.document_name || 'View PDF'}
                            >
                              <FilePdfOutlined className="sup-pdf-icon" />
                              <span>{ver.document_name || 'View PDF'}</span>
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
                            <Button type="text" size="small" className="ui-icon-btn"
                              icon={replacingEstimateId === ver.id ? <LoadingOutlined /> : <UploadOutlined />}
                              disabled={replacingEstimateId === ver.id}>
                              {replacingEstimateId === ver.id ? 'Replacing...' : 'Replace'}
                            </Button>
                          </Upload>
                        </div>
                      </div>

                      {/* Date / Notes */}
                      {(ver.date_received || ver.received_from || ver.notes) && (
                        <div className="sup-version-meta">
                          {ver.date_received && <span>Received {dayjs(ver.date_received).format('MM/DD/YYYY')}</span>}
                          {ver.received_from && <span>From {ver.received_from}</span>}
                          {ver.notes && <span className="sup-version-notes">{ver.notes}</span>}
                        </div>
                      )}

                      {/* Totals */}
                      {isEditing ? (
                        <div className="sup-figures">
                          <label className="sup-figure">
                            <span className="sup-figure-label">RCV</span>
                            <InputNumber size={controlSize} prefix="$" style={{ width: '100%' }}
                              value={editingTotals.rcv}
                              onChange={v => setEditingTotals(t => ({ ...t, rcv: v || 0, acv: (v || 0) - t.dep }))}
                            />
                          </label>
                          <label className="sup-figure">
                            <span className="sup-figure-label">ACV</span>
                            <InputNumber size={controlSize} prefix="$" style={{ width: '100%' }}
                              value={editingTotals.acv}
                              onChange={v => setEditingTotals(t => ({ ...t, acv: v || 0 }))}
                            />
                          </label>
                          <label className="sup-figure">
                            <span className="sup-figure-label">Depreciation</span>
                            <InputNumber size={controlSize} prefix="$" style={{ width: '100%' }}
                              value={editingTotals.dep}
                              onChange={v => setEditingTotals(t => ({ ...t, dep: v || 0, acv: t.rcv - (v || 0) }))}
                            />
                          </label>
                          <label className="sup-figure">
                            <span className="sup-figure-label">Deductible</span>
                            <InputNumber size={controlSize} prefix="$" style={{ width: '100%' }}
                              value={editingTotals.ded}
                              onChange={v => setEditingTotals(t => ({ ...t, ded: v || 0 }))}
                            />
                          </label>
                          {/* With sections, Save lives under the section breakdown */}
                          {!ver.sections_data?.length && (
                            <div className="sup-figures-actions">
                              <Button size="small" type="primary" loading={savingSections}
                                onClick={() => saveEstimateTotals(ver.id)}>Save</Button>
                              <Button size="small" onClick={() => setEditingSectionsVerId(null)}>Cancel</Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="sup-figures">
                          <div className="sup-figure">
                            <span className="sup-figure-label">RCV</span>
                            <span className="sup-figure-value sup-money-strong">{formatCurrency(ver.rcv_amount)}</span>
                          </div>
                          <div className="sup-figure">
                            <span className="sup-figure-label">ACV</span>
                            <span className="sup-figure-value sup-money-strong">{formatCurrency(ver.acv_amount)}</span>
                          </div>
                          <div className="sup-figure">
                            <span className="sup-figure-label">Depreciation</span>
                            <span className="sup-figure-value">{formatCurrency(ver.depreciation_amount)}</span>
                          </div>
                          <div className="sup-figure">
                            <span className="sup-figure-label">Deductible</span>
                            <span className="sup-figure-value">{formatCurrency(ver.deductible)}</span>
                          </div>
                          <div className="sup-figures-actions">
                            <Button type="text" size="small" className="ui-icon-btn sup-edit-btn"
                              aria-label={`Edit totals for revision ${ver.revision_number}`}
                              onClick={() => {
                                setEditingSectionsVerId(ver.id);
                                setEditingSections((ver.sections_data || []).map((s: any) => ({ ...s })));
                                setEditingTotals({ rcv: ver.rcv_amount || 0, acv: ver.acv_amount || 0, dep: ver.depreciation_amount || 0, ded: ver.deductible || 0 });
                              }}>Edit</Button>
                          </div>
                        </div>
                      )}

                      {ver.sections_data && ver.sections_data.length > 0 && (
                        <Collapse
                          ghost
                          size="small"
                          className="sup-sections-collapse"
                          // Remount on edit so the breakdown (and its Save) opens
                          key={isEditing ? 'editing' : 'viewing'}
                          defaultActiveKey={isEditing ? ['sections'] : undefined}
                          items={[{
                            key: 'sections',
                            label: `Section breakdown · ${sections.length} section${sections.length === 1 ? '' : 's'}`,
                            children: isEditing ? (
                              <div>
                                {editingSections.map((sec: any, sIdx: number) => (
                                  <div key={sIdx} className="sup-edit-block">
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <Input size={controlSize} placeholder="Section name" value={sec.section_name}
                                        aria-label="Section name"
                                        onChange={e => {
                                          const u = [...editingSections]; u[sIdx] = { ...u[sIdx], section_name: e.target.value }; setEditingSections(u);
                                        }} />
                                      <Button size="small" type="text" className="ui-icon-btn ui-icon-btn--danger" icon={<DeleteOutlined />}
                                        aria-label="Remove section"
                                        onClick={() => {
                                          const u = editingSections.filter((_: any, i: number) => i !== sIdx);
                                          setEditingSections(u);
                                          const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                          const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                          setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                        }} />
                                    </div>
                                    <div className="sup-figures sup-figures--3">
                                      <label className="sup-figure">
                                        <span className="sup-figure-label">RCV</span>
                                        <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                                          value={sec.rcv} onChange={v => {
                                            const u = [...editingSections]; const rcv = v || 0; const dep = u[sIdx].depreciation || 0;
                                            u[sIdx] = { ...u[sIdx], rcv, net_acv: rcv - dep }; setEditingSections(u);
                                            const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                            const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                            setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                          }} />
                                      </label>
                                      <label className="sup-figure">
                                        <span className="sup-figure-label">Depreciation</span>
                                        <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                                          value={sec.depreciation} onChange={v => {
                                            const u = [...editingSections]; const dep = v || 0; const rcv = u[sIdx].rcv || 0;
                                            u[sIdx] = { ...u[sIdx], depreciation: dep, net_acv: rcv - dep }; setEditingSections(u);
                                            const totRcv = u.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                                            const totDep = u.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                                            setEditingTotals(t => ({ ...t, rcv: totRcv, dep: totDep, acv: totRcv - totDep }));
                                          }} />
                                      </label>
                                      <label className="sup-figure">
                                        <span className="sup-figure-label">Net ACV</span>
                                        <InputNumber size={controlSize} prefix="$" style={{ width: '100%' }} value={sec.net_acv} disabled />
                                      </label>
                                    </div>
                                  </div>
                                ))}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                  <Button size="small" icon={<PlusOutlined />} onClick={() => {
                                    setEditingSections([...editingSections, { section_name: '', rcv: 0, depreciation: 0, net_acv: 0 }]);
                                  }}>Add Section</Button>
                                  <Button size="small" type="primary" loading={savingSections}
                                    onClick={() => saveEstimateTotals(ver.id)}>Save</Button>
                                  <Button size="small" onClick={() => setEditingSectionsVerId(null)}>Cancel</Button>
                                </div>
                              </div>
                            ) : (
                              <div className="sup-breakdown">
                                {ver.sections_data.map((s: any, sIdx: number) => (
                                  <div key={sIdx} className="sup-breakdown-row">
                                    <span className="sup-breakdown-name">{s.section_name}</span>
                                    <span className="sup-breakdown-nums">
                                      <span>RCV {formatCurrency(s.rcv || 0)}</span>
                                      <span className="sup-muted">Dep {formatCurrency(s.depreciation || 0)}</span>
                                      <span className="sup-muted">ACV {formatCurrency(s.net_acv || 0)}</span>
                                    </span>
                                  </div>
                                ))}
                                {/* Edit via the Edit button next to totals */}
                              </div>
                            ),
                          }]}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Bid item estimates */}
          <section className="ui-section">
            <div className="ui-section-head">
              <h2 className="ui-section-title">
                Bid Item Estimates
                {bidItems.length > 0 && <span className="sup-section-count">{bidItems.length}</span>}
              </h2>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setBidItemModalOpen(true)}>
                Add Bid Item
              </Button>
            </div>

            {/* Required estimates: checking one creates its bid item on save */}
            <div className="sup-required">
              <span className="sup-required-label">Required estimates</span>
              <Checkbox.Group
                className="sup-required-options"
                value={editedRequiredEstimates}
                onChange={(checkedValues) => {
                  setEditedRequiredEstimates(checkedValues as string[]);
                  setRequiredEstimatesDirty(true);
                }}
                options={REQUIRED_ESTIMATE_OPTIONS.map(opt => ({ value: opt.key, label: opt.label }))}
              />
              {requiredEstimatesDirty && (
                <div className="sup-required-save">
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={updateMutation.isPending}
                    onClick={saveRequiredEstimates}
                  >
                    Save
                  </Button>
                  <span className="sup-field-label">Checked estimates get a bid item</span>
                </div>
              )}
            </div>

            {bidItems.length === 0 ? (
              <div className="sup-empty">
                No bid items yet. Check a required estimate above or{' '}
                <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setBidItemModalOpen(true)}>
                  add a bid item
                </Button>.
              </div>
            ) : (
              <>
                {hasXactimate && inXactTotal > 0 && (
                  <div className="sup-note">
                    <InfoCircleOutlined aria-hidden="true" />
                    <span>Some items are included in Xactimate. Net Xactimate = {formatCurrency(xactNet)}.</span>
                  </div>
                )}

                {isMobile ? (
                  <div className="sup-bid-list">
                    {bidItems.map(item => (
                      <div key={item.id} className="sup-bid-row">
                        <div className="sup-bid-row-top">
                          <Pill tone="gray">{BID_TYPE_LABELS[item.estimate_type] || item.estimate_type}</Pill>
                          <div style={{ flex: 1 }} />
                          {renderBidDelete(item)}
                        </div>
                        {renderBidTitle(item)}
                        <div className="sup-bid-row-controls">
                          <div style={{ flex: '1 1 160px' }}>{renderBidAmount(item)}</div>
                          {hasXactimate && renderInXact(item, true)}
                          {renderBidPdf(item)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Table
                    size="small"
                    className="sup-bid-table"
                    dataSource={bidItems}
                    rowKey="id"
                    pagination={false}
                    scroll={{ x: 640 }}
                    columns={[
                      { title: 'Type', dataIndex: 'estimate_type', key: 'type', width: 104,
                        render: (v: string) => <Pill tone="gray">{BID_TYPE_LABELS[v] || v}</Pill> },
                      { title: 'Title / Notes', key: 'title', render: (_: any, item: BidItemEstimate) => renderBidTitle(item) },
                      { title: 'Amount', dataIndex: 'custom_amount', key: 'amount', width: 150, align: 'right' as const,
                        render: (_: any, item: BidItemEstimate) => renderBidAmount(item) },
                      ...(hasXactimate ? [{
                        title: 'In Xact', key: 'in_xact', width: 72, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => renderInXact(item),
                      }] : []),
                      { title: 'PDF', key: 'pdf', width: 140, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => renderBidPdf(item) },
                      { title: <span className="ui-sr-only">Delete</span>, key: 'del', width: 40, align: 'center' as const,
                        render: (_: any, item: BidItemEstimate) => renderBidDelete(item) },
                    ]}
                  />
                )}

                {/* Summary */}
                <div className="sup-totals">
                  {hasXactimate && inXactTotal > 0 && (
                    <div className="sup-totals-breakdown">
                      <div className="sup-totals-row">
                        <span>Xactimate</span>
                        <span>{formatCurrency(xactOriginal)}</span>
                      </div>
                      {inXactItems.map(i => (
                        <div key={i.id} className="sup-totals-row sup-totals-row--sub">
                          <span>− {BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}</span>
                          <span>−{formatCurrency(i.custom_amount)}</span>
                        </div>
                      ))}
                      <div className="sup-totals-row">
                        <span>Xactimate (net)</span>
                        <strong>{formatCurrency(xactNet)}</strong>
                      </div>
                      {inXactItems.map(i => (
                        <div key={i.id} className="sup-totals-row">
                          <span>{BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}</span>
                          <span>{formatCurrency(i.custom_amount)}</span>
                        </div>
                      ))}
                      {separateItems.map(i => (
                        <div key={i.id} className="sup-totals-row">
                          <span>{BID_TYPE_LABELS[i.estimate_type] || i.estimate_type}: {i.title}</span>
                          <span>{formatCurrency(i.custom_amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sup-totals-grand">
                    <span>Supplement Total</span>
                    <span>{formatCurrency(hasXactimate && inXactTotal > 0 ? supplementTotal : supplement.supplement_amount)}</span>
                  </div>
                  {!hasBidPdf && (
                    <div className="sup-totals-hint">Upload bid item PDFs first, then send the supplement to the PA from the top of the page.</div>
                  )}
                </div>
              </>
            )}
          </section>
        </Col>

        <Col xs={24} lg={8}>
          {/* People on this claim */}
          <section className="ui-section">
            <div className="ui-section-head">
              <h2 className="ui-section-title">Assigned Companies</h2>
            </div>
            <PropertyList
              labelWidth={112}
              items={[
                {
                  key: 'wm',
                  label: 'Water Mitigation',
                  value: wmCompany ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {(wmCompany as any).company_code && <CompanyTag company={wmCompany as any} />}
                      {wmCompany.name}
                    </span>
                  ) : <span className="ui-props-empty">Not assigned</span>,
                },
                {
                  key: 'rebuild',
                  label: 'Rebuild',
                  value: (
                    <Select
                      size={controlSize}
                      style={{ width: '100%' }}
                      placeholder="Select rebuild company..."
                      aria-label="Rebuild company"
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
                  ),
                },
                {
                  key: 'pa',
                  label: 'Public Adjuster',
                  value: paDisplayInfo?.pa_name ? (
                    <div className="sup-contact">
                      <span className="sup-contact-name">{paDisplayInfo.pa_name}</span>
                      {paDisplayInfo.pa_company && <span>{paDisplayInfo.pa_company}</span>}
                      {paDisplayInfo.pa_email && <a href={`mailto:${paDisplayInfo.pa_email}`}>{paDisplayInfo.pa_email}</a>}
                      {paDisplayInfo.pa_phone && <a href={`tel:${paDisplayInfo.pa_phone}`}>{paDisplayInfo.pa_phone}</a>}
                    </div>
                  ) : <span className="ui-props-empty">Not assigned</span>,
                },
              ]}
            />
          </section>
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
            {/* Pending info requests */}
            <section className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">
                  Pending Info
                  {pendingInfoRequests.length > 0 && (
                    <Pill tone="orange" style={{ marginLeft: 8 }}>{pendingInfoRequests.length} open</Pill>
                  )}
                </h2>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {pendingInfoRequests.length > 0 && (
                    <Button size="small" type="text" className="ui-icon-btn"
                      icon={checkingReplies ? <LoadingOutlined /> : <ReloadOutlined />}
                      disabled={checkingReplies}
                      onClick={triggerReplyCheck}>
                      {checkingReplies ? 'Checking...' : 'Check Replies'}
                    </Button>
                  )}
                  <Button size="small" icon={<SendOutlined />}
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
                </div>
              </div>

              {infoRequests.length === 0 ? (
                <div className="sup-empty">
                  No info requests yet. Click "Request Info" when you need information from PA or contractor.
                </div>
              ) : (
                <div>
                  {infoRequests.map((fu) => {
                    const isPending = fu.info_status !== 'resolved';
                    const unresolvedCount = (fu.items_needed || []).filter(i => !i.resolved).length;
                    const totalCount = (fu.items_needed || []).length;
                    const hasReply = fu.response_summary || fu.reply_body_html || (fu.reply_attachment_ids || []).length > 0;
                    const conv: Array<{ type: string; date: string; sender: string; body_html: string; summary?: string }> = fu.conversation || [];
                    const showThread = conv.length > 0 || hasReply;
                    const infoStatus = fu.info_status || 'pending';

                    const replyControls = isPending && (
                      <div className="sup-thread-actions">
                        {replyingToId === fu.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                            <Input.TextArea
                              rows={2}
                              autoFocus
                              placeholder="Type your reply..."
                              aria-label="Reply"
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
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
                            </div>
                          </div>
                        ) : (
                          <>
                            <Button size="small" type="text" className="ui-icon-btn" icon={<SendOutlined />}
                              onClick={() => setReplyingToId(fu.id)}>
                              Reply
                            </Button>
                            <Button size="small" type="text" className="ui-icon-btn" icon={<SendOutlined />}
                              loading={resendingId === fu.id}
                              onClick={() => handleResend(fu)}>
                              Follow up
                            </Button>
                            {!hasReply && (
                              <Button size="small" type="text" className="ui-icon-btn" icon={<CheckOutlined />}
                                onClick={() => handleMarkResponse(fu)}>
                                Mark as responded
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    );

                    return (
                      <article key={fu.id} className="sup-thread">
                        {/* Header */}
                        <div className="sup-thread-head">
                          <div className="sup-thread-tags">
                            <Pill tone={INFO_STATUS_TONES[infoStatus] || 'gray'}>{humanize(infoStatus)}</Pill>
                            <span className="sup-thread-to">
                              {fu.request_to_type === 'public_adjuster' ? 'PA' : 'Contractor'}
                            </span>
                            {(fu.follow_up_count || 0) > 0 && (
                              <span className="sup-muted">Follow-up ×{fu.follow_up_count}</span>
                            )}
                          </div>
                          <time className="sup-muted">
                            {fu.created_at ? dayjs(fu.created_at).format('MM/DD HH:mm') : ''}
                          </time>
                        </div>
                        <div className="sup-thread-contact">
                          To {fu.contact_name || fu.contact_email}
                          {fu.contact_name && fu.contact_email && <span className="sup-muted"> · {fu.contact_email}</span>}
                        </div>

                        {/* Checklist items */}
                        {totalCount > 0 && (
                          <div className="sup-checklist">
                            <div className="sup-checklist-count">
                              {unresolvedCount === 0 ? 'All items resolved' : `${unresolvedCount}/${totalCount} pending`}
                            </div>
                            {(fu.items_needed || []).map((item, idx) => (
                              <Checkbox
                                key={idx}
                                checked={item.resolved}
                                onChange={() => handleToggleItem(fu, idx)}
                                className={item.resolved ? 'is-resolved' : undefined}
                              >
                                {item.description}
                              </Checkbox>
                            ))}
                          </div>
                        )}

                        {/* Conversation thread */}
                        {showThread && (
                          <div className="sup-messages">
                            {conv.length > 0 ? conv.map((msg, mIdx) => (
                              <div key={mIdx} className={`sup-msg ${msg.type === 'sent' ? 'is-sent' : 'is-received'}`}>
                                <div className="sup-msg-head">
                                  <span className="sup-msg-who">
                                    {msg.type === 'sent' ? 'Sent' : 'Reply'}
                                    {msg.sender ? ` · ${msg.sender.split('@')[0]}` : ''}
                                  </span>
                                  <span>{msg.date ? dayjs(msg.date).format('MM/DD HH:mm') : ''}</span>
                                </div>
                                {msg.body_html && (
                                  <div className="sup-msg-body" dangerouslySetInnerHTML={{ __html: msg.body_html }} />
                                )}
                                {!msg.body_html && msg.summary && (
                                  <div className="sup-msg-body">{msg.summary}</div>
                                )}
                              </div>
                            )) : (
                              /* Fallback for older followups without conversation array */
                              <div className="sup-msg is-received">
                                <div className="sup-msg-head">
                                  <span className="sup-msg-who">Reply</span>
                                  <span>{fu.response_date ? dayjs(fu.response_date).format('MM/DD HH:mm') : ''}</span>
                                </div>
                                {fu.reply_body_html && (
                                  <div className="sup-msg-body" dangerouslySetInnerHTML={{ __html: fu.reply_body_html }} />
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {replyControls}

                        {fu.last_follow_up_date && (
                          <div className="sup-muted" style={{ marginTop: 4 }}>
                            Last follow-up {dayjs(fu.last_follow_up_date).format('MM/DD HH:mm')}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Info Request Modal */}
            <Modal
              title="Request Information"
              open={infoRequestModalOpen}
              width={500}
              className="sup-modal" {...sheetProps}
              onOk={handleSendInfoRequest}
              onCancel={() => { setInfoRequestModalOpen(false); infoRequestForm.resetFields(); setInfoItems(['']); }}
              confirmLoading={infoRequestLoading}
              okText="Send Request"
            >
              <Form form={infoRequestForm} layout="vertical" size={controlSize}>
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
                  <Col xs={24} sm={12}>
                    <Form.Item name="to_name" label="Name">
                      <Input placeholder="Contact name" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="to_email" label="Email" rules={[{ required: true, type: 'email' }]}>
                      <Input placeholder="email@example.com" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="email_account_id" label="Send From">
                  <Select
                    placeholder="Default email account"
                    allowClear
                    options={sendableEmailAccounts.map((acc: any) => ({
                      value: acc.id, label: acc.email_address || acc.name,
                    }))}
                  />
                </Form.Item>
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Information Needed</Text>
                  {infoItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <Input
                        size={controlSize}
                        placeholder={`e.g., Photos of ${idx === 0 ? 'affected area' : 'damage'}, measurements, etc.`}
                        value={item}
                        onChange={e => {
                          const updated = [...infoItems];
                          updated[idx] = e.target.value;
                          setInfoItems(updated);
                        }}
                      />
                      {infoItems.length > 1 && (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove item"
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
              className="sup-modal" {...sheetProps}
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
            <section className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">
                  Follow-ups
                  {generalFollowups.length > 0 && <span className="sup-section-count">{generalFollowups.length}</span>}
                </h2>
                <Button size="small" icon={<PhoneOutlined />} onClick={() => setFollowupModalOpen(true)}>
                  Log Follow-up
                </Button>
              </div>

              {generalFollowups.length === 0 ? (
                <div className="sup-empty">No follow-ups yet. Log calls, texts and emails with the PA here.</div>
              ) : (
                <div>
                  {generalFollowups.map((fu) => (
                    <article key={fu.id} className="sup-thread">
                      <div className="sup-thread-head">
                        <div className="sup-thread-tags">
                          <span className="sup-thread-method">{fu.contact_method ? humanize(fu.contact_method) : 'Note'}</span>
                          {fu.response_received && <Pill tone="green" icon={<CheckOutlined />}>Response received</Pill>}
                        </div>
                        <time className="sup-muted">
                          {fu.created_at ? dayjs(fu.created_at).format('MM/DD/YY HH:mm') : ''}
                        </time>
                      </div>
                      {fu.contact_name && (
                        <div className="sup-thread-contact">
                          To {fu.contact_name}
                          {fu.contact_email && <span className="sup-muted"> · {fu.contact_email}</span>}
                        </div>
                      )}
                      {fu.summary && <div className="sup-thread-text">{fu.summary}</div>}
                      {fu.response_summary && (
                        <div className="sup-msg is-received" style={{ marginTop: 8 }}>
                          <div className="sup-msg-head"><span className="sup-msg-who">Response</span></div>
                          <div className="sup-msg-body">{fu.response_summary}</div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        );
      })()}
        </Col>
      </Row>

      {/* ─── Send to PA Modal ─── */}
      <Modal
        title={<Space><SendOutlined /><span>Send Supplement to PA</span></Space>}
        open={sendPaModalOpen}
        width={700}
        className="sup-modal" {...sheetProps}
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
              <div className="sup-quiet-box" style={{
                padding: '8px 12px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <Text type="secondary" style={{ fontSize: 13 }}>Assigned PA:</Text>
                {paInfo.pa_name && <Text strong style={{ fontSize: 13 }}>{paInfo.pa_name}</Text>}
                {paInfo.pa_company && <Text type="secondary" style={{ fontSize: 12 }}>{paInfo.pa_company}</Text>}
                {paInfo.pa_email && <Text style={{ fontSize: 13 }}>{paInfo.pa_email}</Text>}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>From:</Text>
              {sendableEmailAccounts.length > 0 && (
                <Select
                  value={paManualFromEmail ? undefined : paSelectedAccountId}
                  onChange={(val) => { setPaSelectedAccountId(val); setPaManualFromEmail(''); }}
                  style={{ width: '100%', marginBottom: 6 }}
                  placeholder="Select email account..."
                  allowClear
                  disabled={!!paManualFromEmail}
                  options={sendableEmailAccounts.map((a: any) => ({
                    value: a.id,
                    label: `${a.display_name} (${a.email_address})`,
                  }))}
                />
              )}
              <Input
                placeholder="Or type the email replies should go to..."
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
              {paManualFromEmail.trim() && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  Sent from our verified address so it doesn't land in spam;
                  replies go to this address.
                </Text>
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
            <div className="sup-quiet-box" style={{ marginBottom: 12, padding: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                <ThunderboltOutlined style={{ color: 'var(--tag-purple-text)', marginRight: 4 }} />
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
                      <FilePdfOutlined className="sup-pdf-icon" />
                      <Text style={{ fontSize: 13 }}>{i.custom_document_file_name || i.title}</Text>
                      <Text type="secondary" className="sup-money" style={{ fontSize: 13 }}>{formatCurrency(i.custom_amount)}</Text>
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
        className="sup-modal" {...sheetProps}
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
        <Form form={bidItemForm} layout="vertical" size={controlSize}>
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
                        title: est.project_address || est.calculation_name || 'Packing Estimate',
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
                        label: `${e.project_address || e.calculation_name || e.id.slice(0, 8)} ($${((e.grand_total ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
                      }))
                }
              />
              {linkedEstimateId && (
                <Button
                  size="small"
                  type="link"
                  icon={<FilePdfOutlined className="sup-pdf-icon" />}
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
                  <FilePdfOutlined className="sup-pdf-icon" />
                  <Text ellipsis style={{ maxWidth: 250 }}>{bidItemFile.name}</Text>
                  <Button type="link" size="small" danger onClick={() => { setBidItemFile(null); setBidItemParsedAmounts(null); }}>Remove</Button>
                </Space>
                {bidItemParsedAmounts && (
                  <div className="sup-quiet-box" style={{ marginTop: 8, padding: '8px 12px', fontSize: 13 }}>
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
        className="sup-modal" {...sheetProps}
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
        <Form form={followupForm} layout="vertical" size={controlSize}>
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
        className="sup-modal" {...sheetProps}
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
              // Original follows the new estimate, so the header needs a refetch
              queryClient.invalidateQueries({ queryKey: ['supplement', id] });
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
        <Form form={uploadEstimateForm} layout="vertical" size={controlSize}>
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
            <Space wrap>
              {uploadEstimateFileId && (
                <>
                  <FilePdfOutlined className="sup-pdf-icon" />
                  <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{uploadEstimateFileName}</Text>
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
                      } catch {
                        message.info('Could not auto-parse. Please fill in manually.');
                      } finally { setUploadEstimateParsing(false); }
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
              <div className="sup-quiet-box" style={{ textAlign: 'center', padding: 12 }}>
                <Text type="secondary">No sections. Upload PDF to auto-parse or add manually.</Text>
              </div>
            ) : (
              <>
                {uploadEstimateSections.map((section: any, idx: number) => (
                  <div key={idx} className="sup-edit-block">
                    <Row gutter={8} align="middle">
                      <Col flex="auto">
                        <Input size={controlSize} placeholder="Section name" value={section.section_name}
                          onChange={e => {
                            const updated = [...uploadEstimateSections];
                            updated[idx] = { ...updated[idx], section_name: e.target.value };
                            setUploadEstimateSections(updated);
                          }} />
                      </Col>
                      <Col flex="none">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove section" onClick={() => {
                          const updated = uploadEstimateSections.filter((_: any, i: number) => i !== idx);
                          setUploadEstimateSections(updated);
                          // Recalc totals
                          const totRcv = updated.reduce((s: number, x: any) => s + (x.rcv || 0), 0);
                          const totDep = updated.reduce((s: number, x: any) => s + (x.depreciation || 0), 0);
                          uploadEstimateForm.setFieldsValue({ rcv_amount: totRcv, acv_amount: totRcv - totDep, depreciation_amount: totDep });
                        }} />
                      </Col>
                    </Row>
                    <Row gutter={[8, 6]} style={{ marginTop: 4 }}>
                      <Col xs={12} sm={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>RCV</Text>
                        <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }}
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
                      <Col xs={12} sm={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                        <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }}
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
                      <Col xs={12} sm={8}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Net ACV</Text>
                        <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }}
                          value={section.net_acv} disabled />
                      </Col>
                    </Row>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Totals */}
          <div className="sup-quiet-box" style={{ padding: '10px 12px', marginBottom: 12 }}>
            <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Totals</Text>
            <Row gutter={[8, 8]}>
              <Col xs={12} sm={6}>
                <Text type="secondary" style={{ fontSize: 11 }}>Total RCV</Text>
                <Form.Item name="rcv_amount" style={{ marginBottom: 0 }}>
                  <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Text type="secondary" style={{ fontSize: 11 }}>Total ACV</Text>
                <Form.Item name="acv_amount" style={{ marginBottom: 0 }}>
                  <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Text type="secondary" style={{ fontSize: 11 }}>Depreciation</Text>
                <Form.Item name="depreciation_amount" style={{ marginBottom: 0 }}>
                  <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Text type="secondary" style={{ fontSize: 11 }}>Deductible</Text>
                <Form.Item name="deductible" style={{ marginBottom: 0 }}>
                  <InputNumber size={controlSize} min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </div>

          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="date_received" label="Date Received">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
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
