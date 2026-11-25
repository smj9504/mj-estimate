/**
 * Rebuild project page: facts, what the claim's supplement asked for, the scope
 * of work and the completion-document checklist on the left, the claim's latest
 * insurance estimate PDF open on the right so the scope can be checked without
 * leaving the project. A supplement bid item's PDF opens in the same viewer.
 * Phones get one column and open PDFs in a new tab, since mobile browsers do
 * not render PDFs in frames.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Button, Select, Dropdown, Skeleton, Form, Input, Upload, message, Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  FilePdfOutlined, CameraOutlined, UploadOutlined, PlusOutlined, MoreOutlined, FileTextOutlined,
  DownloadOutlined, MailOutlined,
  CheckCircleFilled, ExportOutlined, ArrowLeftOutlined, SwapOutlined, InboxOutlined, EditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { PageHeader, Pill, PropertyList, humanize, toneFromKey, useSheetModal } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import api from '../services/api';
import { rebuildService } from '../services/rebuildService';
import { supplementService } from '../services/supplementService';
import { fileService } from '../services/fileService';
import { BID_TYPE_LABELS, SupplementStatusPill } from '../components/supplement/supplementUi';
import RebuildDocGenerator from '../components/rebuild/RebuildDocGenerator';
import RebuildPhotoToPdf from '../components/rebuild/RebuildPhotoToPdf';
import RebuildProjectEditModal from '../components/rebuild/RebuildProjectEditModal';
import RebuildScopeSection from '../components/rebuild/RebuildScopeSection';
import RebuildInvoiceFromEstimate from '../components/rebuild/RebuildInvoiceFromEstimate';
import RebuildSendDocsModal from '../components/rebuild/RebuildSendDocsModal';
import {
  REBUILD_STATUSES, REQUIRED_DOCS, DOC_TYPE_LABELS, RebuildStatusPill, rebuildStatusLabel,
  formatCurrency, completionDocPdfUrl, fileInlineUrl,
} from '../components/rebuild/rebuildUi';
import type { RebuildProject, RebuildCompletionDoc } from '../types/rebuild';
import type { ClaimNegotiation } from '../types/client';
import type { BidItemEstimate, SupplementRequest } from '../types/supplement';
import '../components/rebuild/rebuild.css';

type EstimateVersion = ClaimNegotiation & { file_download_id?: string | null };
type Viewing = { kind: 'estimate'; id: string } | { kind: 'doc'; id: string } | { kind: 'bid'; id: string };

const REQUIRED_TYPES: string[] = REQUIRED_DOCS.map(d => d.type);

const fmtDate = (v?: string | null) => (v ? dayjs(v).format('MMM D, YYYY') : '');
/** An amount for a property row; 0 means it was never entered, so the row reads "Empty" */
const amount = (v?: number | null) => (v ? <span className="rb-num">{formatCurrency(v)}</span> : null);
const receivedAt = (v: EstimateVersion) => dayjs(v.date_received || v.created_at || 0).valueOf();

/** The estimate a rebuild works from: newest reconstruction/combined PDF, else the newest PDF at all */
const pickLatestEstimate = (versions: EstimateVersion[]) => {
  const withPdf = versions.filter(v => v.file_download_id);
  return withPdf.find(v => v.estimate_category !== 'water_mitigation') || withPdf[0] || null;
};

/** A bid item made from one of our estimates, with no PDF uploaded, prints that estimate,
 * as the supplement email to the PA did */
const linkedEstimatePdfPath = (item: BidItemEstimate): string | null => {
  if (item.bathroom_estimate_id) return `/api/bathroom-estimates/${item.bathroom_estimate_id}/export/pdf`;
  if (item.cabinet_estimate_id) return `/api/cabinet-estimates/${item.cabinet_estimate_id}/export/pdf`;
  if (item.pack_calculation_id) return `/api/packing-estimates/${item.pack_calculation_id}/export/pdf`;
  return null;
};
const bidHasPdf = (item: BidItemEstimate) => !!item.custom_document_file_id || !!linkedEstimatePdfPath(item);
const bidTypeLabel = (item: BidItemEstimate) => BID_TYPE_LABELS[item.estimate_type] || humanize(item.estimate_type);
/** "Bathroom · Hall bath", or just the type when the title only repeats it */
const bidName = (item: BidItemEstimate) => {
  const type = bidTypeLabel(item);
  const title = (item.title || '').trim();
  return title && title.toLowerCase() !== type.toLowerCase() ? `${type} · ${title}` : type;
};
const supplementTotal = (s: SupplementRequest) =>
  (s.request_type === 'estimate_request' ? s.our_estimate_amount : s.supplement_amount) || 0;

const estimateLabel = (v: EstimateVersion) =>
  [`Rev #${v.revision_number}`, humanize(v.revision_type || 'initial'), v.estimate_category && humanize(v.estimate_category)]
    .filter(Boolean)
    .join(' · ');

const CompanyMonogram: React.FC<{ id: string; name: string }> = ({ id, name }) => {
  const tone = tagTones[toneFromKey(id)];
  const code = name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span className="ui-monogram" title={name} style={{ background: tone.bg, color: tone.text }}>
      {code || name.slice(0, 2)}
    </span>
  );
};

const RebuildProjectDetail: React.FC = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { canAccessPath } = useAuth();
  const { isPhone } = useSheetModal();
  const { sheetProps: uploadSheetProps } = useSheetModal();
  // Touch gets 32px controls; desktop keeps the compact 24px ones
  const ctlSize = isPhone ? 'middle' : 'small';

  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [docGeneratorOpen, setDocGeneratorOpen] = useState(false);
  const [photoToPdfOpen, setPhotoToPdfOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState<RebuildProject | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm] = Form.useForm();

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['rebuild-project', projectId],
    queryFn: () => rebuildService.getProject(projectId as string),
    enabled: !!projectId,
    retry: false,
  });

  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['rebuild-estimates', project?.claim_id],
    queryFn: async () => {
      const list = await supplementService.listInsuranceEstimates(project!.claim_id);
      return [...list].sort((a, b) => receivedAt(b) - receivedAt(a));
    },
    enabled: !!project?.claim_id,
  });

  // What the claim's supplement asked for, read before the scope of work
  const { data: supplements = [], isLoading: supplementsLoading } = useQuery({
    queryKey: ['rebuild-supplements', project?.claim_id],
    queryFn: () => supplementService.getByClaim(project!.claim_id),
    enabled: !!project?.claim_id,
  });

  useBreadcrumbTitle(project ? project.property_address || project.title : null);

  const latestEstimate = useMemo(() => pickLatestEstimate(versions), [versions]);

  // Each project opens on its latest estimate
  useEffect(() => { setViewing(null); }, [projectId]);
  useEffect(() => {
    if (!viewing && latestEstimate) setViewing({ kind: 'estimate', id: latestEstimate.id });
  }, [viewing, latestEstimate]);

  const docs = useMemo(() => project?.completion_docs || [], [project?.completion_docs]);
  const viewedEstimate = viewing?.kind === 'estimate' ? versions.find(v => v.id === viewing.id) || null : null;
  const viewedDoc = viewing?.kind === 'doc' ? docs.find(d => d.id === viewing.id) || null : null;
  const viewedBid = viewing?.kind === 'bid'
    ? supplements.flatMap(s => s.bid_items || []).find(i => i.id === viewing.id) || null
    : null;
  const viewedBidSupplement = viewedBid ? supplements.find(s => s.id === viewedBid.supplement_id) || null : null;

  // A bid item printed from our own estimate needs the login, so it loads as a blob, not a URL in the frame
  const viewedBidPdfPath = viewedBid && !viewedBid.custom_document_file_id ? linkedEstimatePdfPath(viewedBid) : null;
  const [bidBlob, setBidBlob] = useState<{ path: string; url: string | null; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!viewedBidPdfPath) {
      setBidBlob(null);
      return undefined;
    }
    let cancelled = false;
    let url: string | null = null;
    setBidBlob({ path: viewedBidPdfPath, url: null });
    api.get(viewedBidPdfPath, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        setBidBlob({ path: viewedBidPdfPath, url });
      })
      .catch(() => { if (!cancelled) setBidBlob({ path: viewedBidPdfPath, url: null, failed: true }); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [viewedBidPdfPath]);

  // Back to the list as it was left (its filters live in the address); opened
  // from elsewhere, to the list itself
  const backToList = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate('/rebuild-projects');
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['rebuild-project', projectId] });
    queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
    queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
  };

  const updateProject = async (data: Partial<RebuildProject>) => {
    if (!project) return;
    try {
      await rebuildService.updateProject(project.id, data);
      refresh();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not update the project');
    }
  };

  const openPdf = (url: string | null) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const viewDoc = (doc: RebuildCompletionDoc) => {
    if (isPhone) openPdf(completionDocPdfUrl(doc));
    else setViewing({ kind: 'doc', id: doc.id });
  };

  /** Phones: our own estimate's PDF needs the login, so the tab opens first and gets the PDF once it's in */
  const openLinkedPdfInTab = async (path: string) => {
    const tab = window.open('', '_blank');
    try {
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      tab?.close();
      message.error('Could not load the estimate PDF');
    }
  };

  const viewBid = (item: BidItemEstimate) => {
    if (!isPhone) {
      setViewing({ kind: 'bid', id: item.id });
      return;
    }
    if (item.custom_document_file_id) openPdf(fileInlineUrl(item.custom_document_file_id));
    else {
      const path = linkedEstimatePdfPath(item);
      if (path) openLinkedPdfInTab(path);
    }
  };

  const setDocSent = async (doc: RebuildCompletionDoc, sent: boolean) => {
    if (!project) return;
    try {
      await rebuildService.updateDoc(project.id, doc.id, { status: sent ? 'sent' : 'final' });
      const required = REQUIRED_DOCS.find(r => r.type === doc.doc_type);
      if (required) {
        // The project flag follows its documents: sent while any of that type is sent
        const othersSent = docs.some(d => d.id !== doc.id && d.doc_type === doc.doc_type && d.status === 'sent');
        await rebuildService.updateProject(project.id, { [required.sentKey]: sent || othersSent } as Partial<RebuildProject>);
      }
      refresh();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not update the document');
    }
  };

  const deleteDoc = (doc: RebuildCompletionDoc) => {
    if (!project) return;
    Modal.confirm({
      title: `Delete "${doc.title}"?`,
      content: 'The document is removed from this project. This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await rebuildService.deleteDoc(project.id, doc.id);
          if (viewing?.kind === 'doc' && viewing.id === doc.id) setViewing(null);
          refresh();
        } catch (err: any) {
          message.error(err?.response?.data?.detail || 'Could not delete the document');
        }
      },
    });
  };

  const openUpload = (docType: string) => {
    uploadForm.setFieldsValue({ doc_type: docType, title: DOC_TYPE_LABELS[docType] || '' });
    setUploadFile(null);
    setUploadOpen(true);
  };

  const submitUpload = async () => {
    if (!project) return;
    const values = await uploadForm.validateFields();
    setUploading(true);
    try {
      let fileFields: Partial<RebuildCompletionDoc> = {};
      if (uploadFile) {
        const [uploaded] = await fileService.uploadFiles([uploadFile], 'rebuild', project.id, values.doc_type);
        fileFields = { file_id: uploaded.id, file_name: uploaded.originalName || uploadFile.name };
      }
      const doc = await rebuildService.createDoc(project.id, {
        project_id: project.id,
        doc_type: values.doc_type,
        title: values.title,
        description: values.description,
        ...fileFields,
      });
      message.success('Document added');
      setUploadOpen(false);
      refresh();
      if (uploadFile && !isPhone) setViewing({ kind: 'doc', id: doc.id });
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not add the document');
    } finally {
      setUploading(false);
    }
  };

  const onDocCreated = (doc: RebuildCompletionDoc) => {
    refresh();
    if (!isPhone) setViewing({ kind: 'doc', id: doc.id });
  };

  // ------------------------------------------------------------------
  // Completion documents
  // ------------------------------------------------------------------

  // An invoice made from the estimate: print it again as edited on the Invoices page
  const refreshInvoice = async (doc: RebuildCompletionDoc) => {
    if (!project) return;
    try {
      await rebuildService.refreshInvoicePdf(project.id, doc.id);
      message.success('Invoice PDF printed again');
      refresh();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not print the invoice again');
    }
  };

  const docMenu = (doc: RebuildCompletionDoc): MenuProps['items'] => {
    const url = completionDocPdfUrl(doc);
    const invoiceItems: MenuProps['items'] = doc.invoice_id ? [
      ...(canAccessPath('/invoices') ? [{
        key: 'invoice', label: 'Open invoice',
        onClick: () => navigate(`/invoices/${doc.invoice_id}/edit`),
      }] : []),
      { key: 'reprint', label: 'Print again from invoice', onClick: () => refreshInvoice(doc) },
    ] : [];
    return [
      ...invoiceItems,
      doc.status === 'sent'
        ? { key: 'unsent', label: 'Mark as not sent', onClick: () => setDocSent(doc, false) }
        : { key: 'sent', label: 'Mark as sent', onClick: () => setDocSent(doc, true) },
      ...(url ? [{ key: 'tab', label: 'Open in new tab', onClick: () => openPdf(url) }] : []),
      { type: 'divider' as const },
      { key: 'delete', label: 'Delete', danger: true, onClick: () => deleteDoc(doc) },
    ];
  };

  const renderDocLine = (doc: RebuildCompletionDoc, showSent = true) => {
    const url = completionDocPdfUrl(doc);
    const active = viewing?.kind === 'doc' && viewing.id === doc.id;
    const meta = [doc.file_name, fmtDate(doc.created_at)].filter(Boolean).join(' · ');
    return (
      <div key={doc.id} className={`rb-doc${active ? ' is-active' : ''}`}>
        {url ? (
          <button type="button" className="rb-doc-open" onClick={() => viewDoc(doc)} title={`View ${doc.title}`}>
            <FilePdfOutlined className="sup-pdf-icon" aria-hidden="true" />
            <span className="rb-doc-text">
              <span className="rb-doc-name">{doc.title}</span>
              {meta && <span className="rb-doc-meta">{meta}</span>}
            </span>
          </button>
        ) : (
          <span className="rb-doc-open rb-doc-open--static">
            <FilePdfOutlined className="rb-doc-nofile" aria-hidden="true" />
            <span className="rb-doc-text">
              <span className="rb-doc-name">{doc.title}</span>
              <span className="rb-doc-meta">No file attached</span>
            </span>
          </span>
        )}
        {showSent && doc.status === 'sent' && <Pill tone="green">Sent</Pill>}
        <Dropdown menu={{ items: docMenu(doc) }} trigger={['click']} placement="bottomRight">
          <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<MoreOutlined />} aria-label={`Actions for ${doc.title}`} />
        </Dropdown>
      </div>
    );
  };

  const requiredAction = (type: string, hasDocs: boolean) => {
    const again = hasDocs ? ' again' : '';
    if (type === 'coc') {
      return (
        <Button size={ctlSize} type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
          icon={<FilePdfOutlined />} onClick={() => setDocGeneratorOpen(true)}>
          {hasDocs ? 'Regenerate' : 'Generate'}
        </Button>
      );
    }
    if (type === 'invoice') {
      // Made from the insurance estimate; one from elsewhere can still be uploaded
      return (
        <span className="rb-check-actions">
          <Button size={ctlSize} type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
            icon={<FileTextOutlined />} onClick={() => setInvoiceOpen(true)} disabled={!latestEstimate}
            title={latestEstimate ? undefined : 'No insurance estimate PDF on this claim yet'}>
            {hasDocs ? 'Again from estimate' : 'From estimate'}
          </Button>
          <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<UploadOutlined />}
            onClick={() => openUpload(type)} aria-label="Upload an invoice">
            {isPhone ? null : 'Upload'}
          </Button>
        </span>
      );
    }
    if (type === 'completion_photo') {
      return (
        <Button size={ctlSize} type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
          icon={<CameraOutlined />} onClick={() => setPhotoToPdfOpen(true)}>
          {hasDocs ? 'Add photos' : 'Photos to PDF'}
        </Button>
      );
    }
    return (
      <Button size={ctlSize} type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
        icon={<UploadOutlined />} onClick={() => openUpload(type)}>
        {`Upload${again}`}
      </Button>
    );
  };

  // The documents with a file, in the checklist's order: what downloads and emails together
  const docsWithFile = useMemo(() => {
    const rank = (t: string) => (REQUIRED_TYPES.includes(t) ? REQUIRED_TYPES.indexOf(t) : REQUIRED_TYPES.length);
    return docs.filter(d => d.file_url || d.file_id).sort((a, b) => rank(a.doc_type) - rank(b.doc_type));
  }, [docs]);

  const downloadAll = async (format: 'zip' | 'pdf') => {
    if (!project) return;
    setDownloading(true);
    try {
      await rebuildService.downloadDocs(project.id, format);
    } catch (err: any) {
      let detail = 'Could not download the documents';
      // The error comes back as a blob, since a file was asked for
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try { detail = JSON.parse(await data.text()).detail || detail; } catch { /* keep the default */ }
      }
      message.error(detail);
    } finally {
      setDownloading(false);
    }
  };

  const renderChecklist = (p: RebuildProject) => {
    const otherDocs = docs.filter(d => !REQUIRED_TYPES.includes(d.doc_type));
    const sentCount = REQUIRED_DOCS.filter(r =>
      (p as any)[r.sentKey] || docs.some(d => d.doc_type === r.type && d.status === 'sent')).length;

    return (
      <section className="ui-section">
        <div className="ui-section-head">
          <h2 className="ui-section-title">
            Completion documents
            <span className="sup-section-count">{sentCount} of {REQUIRED_DOCS.length} sent</span>
          </h2>
          <span className="rb-check-actions">
            <Dropdown
              disabled={!docsWithFile.length || downloading}
              trigger={['click']}
              menu={{ items: [
                { key: 'zip', label: 'Download all (ZIP, a file each)', onClick: () => downloadAll('zip') },
                { key: 'pdf', label: 'Download all as one PDF', onClick: () => downloadAll('pdf') },
              ] }}
            >
              <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<DownloadOutlined />}
                loading={downloading} aria-label="Download all completion documents">
                {isPhone ? null : 'Download'}
              </Button>
            </Dropdown>
            <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<MailOutlined />}
              disabled={!docsWithFile.length} onClick={() => setEmailOpen(true)} aria-label="Email completion documents">
              {isPhone ? null : 'Email'}
            </Button>
            <Tooltip title="Add another document">
              <Button size={ctlSize} type="text" className="ui-icon-btn" icon={<PlusOutlined />} onClick={() => openUpload('other')}
                aria-label="Add another document" />
            </Tooltip>
          </span>
        </div>

        <div className="rb-checklist">
          {REQUIRED_DOCS.map(r => {
            const typeDocs = docs.filter(d => d.doc_type === r.type);
            const sent = (p as any)[r.sentKey] || typeDocs.some(d => d.status === 'sent');
            const state = sent ? 'sent' : typeDocs.length ? 'ready' : 'missing';
            return (
              <div key={r.type} className={`rb-check rb-check--${state}`}>
                <div className="rb-check-head">
                  <span className="rb-check-mark" aria-hidden="true">
                    {state === 'sent' ? <CheckCircleFilled /> : <span className="rb-check-ring" />}
                  </span>
                  <span className="rb-check-label">{r.label}</span>
                  {state === 'sent' && <Pill tone="green">Sent</Pill>}
                  {state === 'ready' && <Pill tone="blue">Ready</Pill>}
                  <span className="rb-check-action">{requiredAction(r.type, typeDocs.length > 0)}</span>
                </div>
                {/* The row already says Sent; a doc repeats it only when the row holds several */}
                {typeDocs.length > 0 && (
                  <div className="rb-check-docs">{typeDocs.map(d => renderDocLine(d, typeDocs.length > 1))}</div>
                )}
              </div>
            );
          })}
        </div>

        {otherDocs.length > 0 && (
          <div className="rb-other">
            <div className="rb-other-title">Other documents</div>
            {otherDocs.map(d => renderDocLine(d))}
          </div>
        )}
      </section>
    );
  };

  // ------------------------------------------------------------------
  // Supplement
  // ------------------------------------------------------------------

  const canOpenSupplements = canAccessPath('/supplements');

  const renderBidLine = (item: BidItemEstimate) => {
    const name = bidName(item);
    const hasPdf = bidHasPdf(item);
    const active = viewing?.kind === 'bid' && viewing.id === item.id;
    const meta = [
      item.custom_amount ? formatCurrency(item.custom_amount) : null,
      // Its amount is already inside the Xactimate total
      item.included_in_xactimate && item.estimate_type !== 'xactimate' ? 'In Xactimate' : null,
      hasPdf ? null : 'No PDF',
    ].filter(Boolean).join(' · ');
    const text = (
      <span className="rb-doc-text">
        <span className="rb-doc-name">{name}</span>
        {meta && <span className="rb-doc-meta rb-num">{meta}</span>}
        {item.description?.trim() && <span className="rb-bid-notes">{item.description.trim()}</span>}
      </span>
    );
    return (
      <div key={item.id} className={`rb-doc rb-bid${active ? ' is-active' : ''}`}>
        {hasPdf ? (
          <button type="button" className="rb-doc-open" onClick={() => viewBid(item)} title={`View ${name}`}>
            <FilePdfOutlined className="sup-pdf-icon" aria-hidden="true" />
            {text}
          </button>
        ) : (
          <span className="rb-doc-open rb-doc-open--static">
            <FilePdfOutlined className="rb-doc-nofile" aria-hidden="true" />
            {text}
          </span>
        )}
      </div>
    );
  };

  const renderSupplement = () => (
    <section className="ui-section">
      <div className="ui-section-head">
        <h2 className="ui-section-title">
          Supplement
          {supplements.length > 1 && <span className="sup-section-count">{supplements.length}</span>}
        </h2>
      </div>
      {supplementsLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : supplements.length === 0 ? (
        <p className="sup-empty">No supplement on this claim.</p>
      ) : supplements.map(sup => {
        const items = sup.bid_items || [];
        const sent = sup.submitted_date
          ? `Sent ${fmtDate(sup.submitted_date)}${sup.submitted_to ? ` to ${sup.submitted_to}` : ''}`
          : 'Not sent yet';
        return (
          <div key={sup.id} className="rb-sup">
            <div className="rb-sup-head">
              <SupplementStatusPill status={sup.status} />
              {sup.request_type === 'estimate_request' && <Pill tone="gray">Estimate request</Pill>}
              {/* Several on one claim: the title tells them apart */}
              {supplements.length > 1 && <span className="rb-sup-title">{sup.title}</span>}
              {canOpenSupplements && (
                <Link className="rb-sup-link" to={`/supplements/${sup.id}`}>
                  Open <ExportOutlined aria-hidden="true" />
                </Link>
              )}
            </div>
            <div className="rb-sup-meta">
              {supplementTotal(sup) > 0 && (
                <span className="rb-num">
                  {sup.request_type === 'estimate_request' ? 'Our estimate' : 'Total'}{' '}
                  <strong>{formatCurrency(supplementTotal(sup))}</strong>
                </span>
              )}
              <span>{sent}</span>
            </div>
            {items.length > 0 ? (
              <div className="rb-sup-items">{items.map(renderBidLine)}</div>
            ) : (
              <p className="sup-empty">No bid items.</p>
            )}
          </div>
        );
      })}
    </section>
  );

  // ------------------------------------------------------------------
  // Estimate / document viewer
  // ------------------------------------------------------------------

  const estimateOptions = versions.map(v => ({
    value: v.id,
    label: `${estimateLabel(v)}${v.id === latestEstimate?.id ? ' (latest)' : ''}`,
    disabled: !v.file_download_id,
  }));

  const estimateMeta = (v: EstimateVersion) => [
    v.rcv_amount ? `RCV ${formatCurrency(v.rcv_amount)}` : null,
    v.date_received ? `Received ${fmtDate(v.date_received)}` : null,
  ].filter(Boolean).join(' · ');

  const renderEstimateEmpty = () => (
    <div className="rb-viewer-empty">
      <InboxOutlined aria-hidden="true" />
      <p className="rb-viewer-empty-title">No insurance estimate PDF on this claim yet</p>
      <p>Upload the carrier's estimate on the claim (Supplements or the client's claim page) and it shows here.</p>
    </div>
  );

  const bidPdfUrl = (item: BidItemEstimate) => {
    if (item.custom_document_file_id) return fileInlineUrl(item.custom_document_file_id);
    return bidBlob && bidBlob.path === linkedEstimatePdfPath(item) ? bidBlob.url : null;
  };

  const renderViewer = () => {
    const url = viewedDoc
      ? completionDocPdfUrl(viewedDoc)
      : viewedBid ? bidPdfUrl(viewedBid)
      : viewedEstimate?.file_download_id ? fileInlineUrl(viewedEstimate.file_download_id) : null;
    const title = viewedDoc ? viewedDoc.title : viewedBid ? bidName(viewedBid) : 'Insurance estimate';
    const meta = viewedDoc
      ? [DOC_TYPE_LABELS[viewedDoc.doc_type] || humanize(viewedDoc.doc_type), fmtDate(viewedDoc.created_at)].filter(Boolean).join(' · ')
      : viewedBid ? [
        'Supplement',
        viewedBid.custom_amount ? formatCurrency(viewedBid.custom_amount) : null,
        viewedBidSupplement?.submitted_date ? `Sent ${fmtDate(viewedBidSupplement.submitted_date)}` : null,
      ].filter(Boolean).join(' · ')
      : viewedEstimate ? [estimateLabel(viewedEstimate), estimateMeta(viewedEstimate)].filter(Boolean).join(' · ') : '';
    const bidLoading = !!viewedBid && !viewedBid.custom_document_file_id && !bidBlob?.url && !bidBlob?.failed;
    // Away from the estimate: a completion document or a supplement bid item
    const away = !!viewedDoc || !!viewedBid;

    return (
      <div className="rb-viewer">
        <div className="rb-viewer-head">
          {away && latestEstimate && (
            <Tooltip title="Back to the estimate">
              <Button type="text" size="small" className="ui-icon-btn" icon={<ArrowLeftOutlined />}
                aria-label="Back to the estimate" onClick={() => setViewing({ kind: 'estimate', id: latestEstimate.id })} />
            </Tooltip>
          )}
          <div className="rb-viewer-titles">
            <span className="rb-viewer-title">
              {title}
              {viewedEstimate && viewedEstimate.id === latestEstimate?.id && <Pill tone="blue">Latest</Pill>}
            </span>
            {meta && <span className="rb-viewer-meta">{meta}</span>}
          </div>
          <div className="rb-viewer-actions">
            {!away && versions.length > 1 && (
              <Select size="small" value={viewedEstimate?.id} options={estimateOptions} popupMatchSelectWidth={false}
                onChange={id => setViewing({ kind: 'estimate', id })} aria-label="Estimate revision"
                className="rb-rev-select" suffixIcon={<SwapOutlined />} />
            )}
            {url && (
              <Button size="small" type="text" className="ui-icon-btn" icon={<ExportOutlined />} onClick={() => openPdf(url)}>
                Open
              </Button>
            )}
          </div>
        </div>
        <div className="rb-viewer-frame">
          {(versionsLoading && !away) || bidLoading ? (
            <div className="rb-viewer-loading"><Skeleton active paragraph={{ rows: 10 }} /></div>
          ) : url ? (
            <>
              <span className="rb-viewer-wait" aria-hidden="true">Loading PDF…</span>
              <iframe key={url} src={url} title={title} />
            </>
          ) : viewedDoc ? (
            <div className="rb-viewer-empty"><p>This document has no file attached.</p></div>
          ) : viewedBid ? (
            <div className="rb-viewer-empty"><p>The estimate PDF could not be loaded.</p></div>
          ) : renderEstimateEmpty()}
        </div>
      </div>
    );
  };

  /** Phones: the estimate as a single row that opens the PDF in a new tab */
  const renderEstimateRow = () => (
    <section className="ui-section">
      <div className="ui-section-head">
        <h2 className="ui-section-title">Insurance estimate</h2>
      </div>
      {versionsLoading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : latestEstimate?.file_download_id ? (
        <button type="button" className="rb-doc-open rb-estimate-row" onClick={() => openPdf(fileInlineUrl(latestEstimate.file_download_id!))}>
          <FilePdfOutlined className="sup-pdf-icon" aria-hidden="true" />
          <span className="rb-doc-text">
            <span className="rb-doc-name">{latestEstimate.document_name || estimateLabel(latestEstimate)}</span>
            <span className="rb-doc-meta">{[estimateLabel(latestEstimate), estimateMeta(latestEstimate)].filter(Boolean).join(' · ')}</span>
          </span>
          <ExportOutlined className="rb-estimate-row-go" aria-hidden="true" />
        </button>
      ) : (
        <p className="sup-empty">No insurance estimate PDF on this claim yet.</p>
      )}
    </section>
  );

  // ------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------

  const renderFacts = (p: RebuildProject) => (
    <section className="ui-section">
      <PropertyList
        labelWidth={isPhone ? 136 : 132}
        items={[
          {
            key: 'contractor', label: 'Contractor',
            value: p.contractor_name || <span className="ui-props-empty">Unassigned</span>,
          },
          {
            key: 'recon', label: 'Recon company', hideEmpty: true,
            value: p.rebuild_company_name && p.rebuild_company_name !== p.contractor_name ? (
              <span className="rb-company">
                <CompanyMonogram id={p.rebuild_company_id || p.rebuild_company_name} name={p.rebuild_company_name} />
                {p.rebuild_company_name}
              </span>
            ) : null,
          },
          {
            // From the claim's WM jobs, not the project, so the Edit form never changes it
            key: 'wm', label: 'Water mitigation', hideEmpty: true,
            value: p.wm_companies?.length ? (
              <span className="rb-companies">
                {p.wm_companies.map(c => (
                  <span key={c.id} className="rb-company">
                    <CompanyMonogram id={c.id} name={c.name} />
                    {c.name}
                  </span>
                ))}
              </span>
            ) : null,
          },
          { key: 'insurance', label: 'Insurance $', value: amount(p.insurance_estimate_amount) },
          { key: 'contract', label: 'Contract $', value: amount(p.contract_amount) },
          { key: 'final', label: 'Final invoice $', hideEmpty: true, value: amount(p.final_invoice_amount) },
          { key: 'start', label: 'Start', value: fmtDate(p.start_date) },
          { key: 'eta', label: 'Est. completion', value: fmtDate(p.estimated_completion) },
          // The invoice made from the estimate is dated this day
          { key: 'done', label: 'Completed', hideEmpty: true, value: fmtDate(p.actual_completion) || null },
          { key: 'priority', label: 'Priority', hideEmpty: true, value: p.priority && p.priority !== 'normal' ? humanize(p.priority) : null },
          { key: 'notes', label: 'Notes', hideEmpty: true, value: p.notes ? <span className="rb-prewrap">{p.notes}</span> : null },
        ]}
      />
    </section>
  );

  // Drafted from the estimate on the right, then edited; the COC reads it
  const renderScope = (p: RebuildProject) => (
    <RebuildScopeSection project={p} versions={versions} latestEstimate={latestEstimate} onSaved={refresh} />
  );

  const back = (
    <Tooltip title="Back to rebuild projects">
      <Button type="text" className="ui-icon-btn" icon={<ArrowLeftOutlined />}
        aria-label="Back to rebuild projects" onClick={backToList} />
    </Tooltip>
  );

  if (isError) {
    return (
      <div className="rb-page">
        <PageHeader leading={back} title="Project not found" />
        <div className="rb-viewer-empty rb-page-missing">
          <p className="rb-viewer-empty-title">This project could not be loaded</p>
          <p>It may have been deleted, or it is on a claim you can't see.</p>
          <Button onClick={() => navigate('/rebuild-projects')}>Go to Rebuild Projects</Button>
        </div>
      </div>
    );
  }

  if (isLoading || !project) {
    return (
      <div className="rb-page">
        <PageHeader leading={back} title={<Skeleton.Input active size="small" style={{ width: 280 }} />} />
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const clientLink = project.client_name && (project.client_id && canAccessPath('/clients')
    ? <Link to={`/clients/${project.client_id}`}>{project.client_name}</Link>
    : <span>{project.client_name}</span>);

  return (
    <div className="rb-page">
      <PageHeader
        leading={back}
        title={project.property_address || project.title}
        meta={
          <>
            {project.customer_managed && <Pill tone="gray">Customer's own contractor</Pill>}
            {clientLink}
            {project.claim_number && <span>Claim {project.claim_number}</span>}
            {project.insurance_company && <span>{project.insurance_company}</span>}
          </>
        }
        actions={
          <>
            <Select
              className="sup-status-select"
              value={project.status}
              onChange={v => updateProject({ status: v })}
              options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))}
              labelRender={({ value }) => <RebuildStatusPill status={value as string} />}
              optionRender={option => <RebuildStatusPill status={option.value as string} />}
              suffixIcon={<SwapOutlined />}
              popupMatchSelectWidth={false}
              style={{ minWidth: 150 }}
              aria-label="Project status"
            />
            <Button icon={<EditOutlined />} onClick={() => setEditing(project)}>Edit</Button>
          </>
        }
      />

      {isPhone ? (
        <div className="rb-stack">
          {renderEstimateRow()}
          {renderFacts(project)}
          {renderSupplement()}
          {renderScope(project)}
          {renderChecklist(project)}
        </div>
      ) : (
        <div className="rb-page-split">
          <div className="rb-page-main">
            {renderFacts(project)}
            {renderSupplement()}
            {renderScope(project)}
            {renderChecklist(project)}
          </div>
          <div className="rb-page-viewer">{renderViewer()}</div>
        </div>
      )}

      <RebuildDocGenerator
        open={docGeneratorOpen}
        project={project}
        onClose={() => setDocGeneratorOpen(false)}
        onSuccess={onDocCreated}
      />
      <RebuildSendDocsModal
        open={emailOpen}
        project={project}
        docs={docsWithFile}
        onClose={() => setEmailOpen(false)}
        onSent={refresh}
      />
      <RebuildInvoiceFromEstimate
        open={invoiceOpen}
        project={project}
        versions={versions}
        latestEstimate={latestEstimate}
        onClose={() => setInvoiceOpen(false)}
        onSuccess={onDocCreated}
      />
      <RebuildPhotoToPdf
        open={photoToPdfOpen}
        project={project}
        onClose={() => setPhotoToPdfOpen(false)}
        onSuccess={onDocCreated}
      />
      <RebuildProjectEditModal project={editing} onClose={() => setEditing(null)} />

      <Modal
        title="Add completion document"
        open={uploadOpen}
        width={460}
        onOk={submitUpload}
        okText="Add document"
        confirmLoading={uploading}
        onCancel={() => setUploadOpen(false)}
        destroyOnClose
        {...uploadSheetProps}
      >
        <Form form={uploadForm} layout="vertical" preserve={false} size={isPhone ? 'large' : undefined}>
          <Form.Item name="doc_type" label="Document type" rules={[{ required: true }]}>
            <Select options={Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Give the document a title' }]}>
            <Input placeholder="e.g. Final invoice" />
          </Form.Item>
          <Form.Item label="PDF" extra="Optional. Leave empty to record a document sent outside the app.">
            <Upload.Dragger
              accept=".pdf,application/pdf"
              maxCount={1}
              beforeUpload={file => {
                if (file.type !== 'application/pdf') {
                  message.error('Choose a PDF file');
                  return Upload.LIST_IGNORE;
                }
                setUploadFile(file);
                return false;
              }}
              onRemove={() => setUploadFile(null)}
            >
              <p className="ant-upload-drag-icon"><UploadOutlined /></p>
              <p className="ant-upload-text">{isPhone ? 'Tap to choose a PDF' : 'Click or drop a PDF here'}</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item name="description" label="Note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RebuildProjectDetail;
