/**
 * Rebuild project detail: facts and the completion-document checklist on the
 * left, the claim's latest insurance estimate PDF open on the right so the
 * scope can be checked without leaving the project. Phones get one column and
 * open PDFs in a new tab, since mobile browsers do not render PDFs in frames.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Button, Select, Dropdown, Grid, Skeleton, Form, Input, Upload, message, Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  FilePdfOutlined, CameraOutlined, UploadOutlined, PlusOutlined, MoreOutlined,
  CheckCircleFilled, ExportOutlined, ArrowLeftOutlined, SwapOutlined, InboxOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Pill, PropertyList, humanize, toneFromKey } from '../common/ui';
import { tagTones } from '../../styles/tokens';
import { rebuildService } from '../../services/rebuildService';
import { supplementService } from '../../services/supplementService';
import { fileService } from '../../services/fileService';
import RebuildDocGenerator from './RebuildDocGenerator';
import RebuildPhotoToPdf from './RebuildPhotoToPdf';
import {
  REBUILD_STATUSES, REQUIRED_DOCS, DOC_TYPE_LABELS, RebuildStatusPill, rebuildStatusLabel,
  formatCurrency, completionDocPdfUrl, fileInlineUrl,
} from './rebuildUi';
import type { RebuildProject, RebuildCompletionDoc } from '../../types/rebuild';
import type { ClaimNegotiation } from '../../types/client';
import './rebuild.css';

type EstimateVersion = ClaimNegotiation & { file_download_id?: string | null };
type Viewing = { kind: 'estimate'; id: string } | { kind: 'doc'; id: string };

interface Props {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit: (project: RebuildProject) => void;
  onChanged: () => void;
}

const REQUIRED_TYPES: string[] = REQUIRED_DOCS.map(d => d.type);

const fmtDate = (v?: string | null) => (v ? dayjs(v).format('MMM D, YYYY') : '');
const money = (v?: number | null) => (v ? formatCurrency(v) : '');
const receivedAt = (v: EstimateVersion) => dayjs(v.date_received || v.created_at || 0).valueOf();

/** The estimate a rebuild works from: newest reconstruction/combined PDF, else the newest PDF at all */
const pickLatestEstimate = (versions: EstimateVersion[]) => {
  const withPdf = versions.filter(v => v.file_download_id);
  return withPdf.find(v => v.estimate_category !== 'water_mitigation') || withPdf[0] || null;
};

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

const RebuildProjectDetailModal: React.FC<Props> = ({ projectId, open, onClose, onEdit, onChanged }) => {
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;

  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [docGeneratorOpen, setDocGeneratorOpen] = useState(false);
  const [photoToPdfOpen, setPhotoToPdfOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm] = Form.useForm();

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['rebuild-project', projectId],
    queryFn: () => rebuildService.getProject(projectId as string),
    enabled: open && !!projectId,
    retry: false,
  });

  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['rebuild-estimates', project?.claim_id],
    queryFn: async () => {
      const list = await supplementService.listInsuranceEstimates(project!.claim_id);
      return [...list].sort((a, b) => receivedAt(b) - receivedAt(a));
    },
    enabled: open && !!project?.claim_id,
  });

  const latestEstimate = useMemo(() => pickLatestEstimate(versions), [versions]);

  // Each project opens on its latest estimate
  useEffect(() => { setViewing(null); }, [projectId]);
  useEffect(() => {
    if (!viewing && latestEstimate) setViewing({ kind: 'estimate', id: latestEstimate.id });
  }, [viewing, latestEstimate]);

  const docs = project?.completion_docs || [];
  const viewedEstimate = viewing?.kind === 'estimate' ? versions.find(v => v.id === viewing.id) || null : null;
  const viewedDoc = viewing?.kind === 'doc' ? docs.find(d => d.id === viewing.id) || null : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['rebuild-project', projectId] });
    onChanged();
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

  const docMenu = (doc: RebuildCompletionDoc): MenuProps['items'] => {
    const url = completionDocPdfUrl(doc);
    return [
      doc.status === 'sent'
        ? { key: 'unsent', label: 'Mark as not sent', onClick: () => setDocSent(doc, false) }
        : { key: 'sent', label: 'Mark as sent', onClick: () => setDocSent(doc, true) },
      ...(url ? [{ key: 'tab', label: 'Open in new tab', onClick: () => openPdf(url) }] : []),
      { type: 'divider' as const },
      { key: 'delete', label: 'Delete', danger: true, onClick: () => deleteDoc(doc) },
    ];
  };

  const renderDocLine = (doc: RebuildCompletionDoc) => {
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
        {doc.status === 'sent' && <Pill tone="green">Sent</Pill>}
        <Dropdown menu={{ items: docMenu(doc) }} trigger={['click']} placement="bottomRight">
          <Button type="text" size="small" className="ui-icon-btn" icon={<MoreOutlined />} aria-label={`Actions for ${doc.title}`} />
        </Dropdown>
      </div>
    );
  };

  const requiredAction = (type: string, hasDocs: boolean) => {
    const again = hasDocs ? ' again' : '';
    if (type === 'coc') {
      return (
        <Button size="small" type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
          icon={<FilePdfOutlined />} onClick={() => setDocGeneratorOpen(true)}>
          {hasDocs ? 'Generate again' : 'Generate'}
        </Button>
      );
    }
    if (type === 'completion_photo') {
      return (
        <Button size="small" type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
          icon={<CameraOutlined />} onClick={() => setPhotoToPdfOpen(true)}>
          {hasDocs ? 'Add photos' : 'Photos to PDF'}
        </Button>
      );
    }
    return (
      <Button size="small" type={hasDocs ? 'text' : 'default'} className={hasDocs ? 'ui-icon-btn' : undefined}
        icon={<UploadOutlined />} onClick={() => openUpload(type)}>
        {`Upload${again}`}
      </Button>
    );
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
          <Button size="small" type="text" className="ui-icon-btn" icon={<PlusOutlined />} onClick={() => openUpload('other')}>
            Other document
          </Button>
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
                  {state === 'ready' && <Pill tone="blue">Ready to send</Pill>}
                  <span className="rb-check-action">{requiredAction(r.type, typeDocs.length > 0)}</span>
                </div>
                {typeDocs.length > 0 && <div className="rb-check-docs">{typeDocs.map(renderDocLine)}</div>}
              </div>
            );
          })}
        </div>

        {otherDocs.length > 0 && (
          <div className="rb-other">
            <div className="rb-other-title">Other documents</div>
            {otherDocs.map(renderDocLine)}
          </div>
        )}
      </section>
    );
  };

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

  const renderViewer = () => {
    const url = viewedDoc
      ? completionDocPdfUrl(viewedDoc)
      : viewedEstimate?.file_download_id ? fileInlineUrl(viewedEstimate.file_download_id) : null;
    const title = viewedDoc ? viewedDoc.title : 'Insurance estimate';
    const meta = viewedDoc
      ? [DOC_TYPE_LABELS[viewedDoc.doc_type] || humanize(viewedDoc.doc_type), fmtDate(viewedDoc.created_at)].filter(Boolean).join(' · ')
      : viewedEstimate ? [estimateLabel(viewedEstimate), estimateMeta(viewedEstimate)].filter(Boolean).join(' · ') : '';

    return (
      <div className="rb-viewer">
        <div className="rb-viewer-head">
          {viewedDoc && latestEstimate && (
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
            {!viewedDoc && versions.length > 1 && (
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
          {versionsLoading && !viewedDoc ? (
            <div className="rb-viewer-loading"><Skeleton active paragraph={{ rows: 10 }} /></div>
          ) : url ? (
            <>
              <span className="rb-viewer-wait" aria-hidden="true">Loading PDF…</span>
              <iframe key={url} src={url} title={title} />
            </>
          ) : viewedDoc ? (
            <div className="rb-viewer-empty"><p>This document has no file attached.</p></div>
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
          { key: 'insurance', label: 'Insurance $', value: <span className="rb-num">{money(p.insurance_estimate_amount)}</span> },
          { key: 'contract', label: 'Contract $', value: <span className="rb-num">{money(p.contract_amount)}</span> },
          { key: 'final', label: 'Final invoice $', hideEmpty: true, value: money(p.final_invoice_amount) ? <span className="rb-num">{money(p.final_invoice_amount)}</span> : null },
          { key: 'start', label: 'Start', value: fmtDate(p.start_date) },
          { key: 'eta', label: 'Est. completion', value: fmtDate(p.estimated_completion) },
          { key: 'priority', label: 'Priority', hideEmpty: true, value: p.priority && p.priority !== 'normal' ? humanize(p.priority) : null },
          { key: 'scope', label: 'Scope of work', hideEmpty: true, value: p.scope_of_work ? <span className="rb-prewrap">{p.scope_of_work}</span> : null },
          { key: 'notes', label: 'Notes', hideEmpty: true, value: p.notes ? <span className="rb-prewrap">{p.notes}</span> : null },
        ]}
      />
    </section>
  );

  const header = project ? (
    <div className="rb-head">
      <div className="rb-head-title">{project.property_address || project.title}</div>
      <div className="rb-head-meta">
        <Select
          size="small"
          className="sup-status-select rb-status-select"
          value={project.status}
          onChange={v => updateProject({ status: v })}
          options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))}
          labelRender={({ value }) => <RebuildStatusPill status={value as string} />}
          optionRender={option => <RebuildStatusPill status={option.value as string} />}
          suffixIcon={<SwapOutlined />}
          popupMatchSelectWidth={false}
          aria-label="Project status"
        />
        {project.claim_number && <span>Claim {project.claim_number}</span>}
        {project.insurance_company && <span>{project.insurance_company}</span>}
      </div>
    </div>
  ) : null;

  return (
    <>
      <Modal
        open={open}
        title={header}
        onCancel={onClose}
        width={isPhone ? '100%' : 1180}
        style={{ top: isPhone ? 8 : 24, maxWidth: isPhone ? 'calc(100vw - 16px)' : '96vw' }}
        className="rb-modal"
        destroyOnClose
        footer={[
          <Button key="close" onClick={onClose}>Close</Button>,
          <Button key="edit" type="primary" disabled={!project} onClick={() => project && onEdit(project)}>Edit</Button>,
        ]}
      >
        {isError ? (
          <div className="rb-viewer-empty">
            <p className="rb-viewer-empty-title">This project could not be loaded</p>
            <p>It may have been deleted. Close this and pick it again from the list.</p>
          </div>
        ) : isLoading || !project ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : isPhone ? (
          <div className="rb-stack">
            {renderEstimateRow()}
            {renderFacts(project)}
            {renderChecklist(project)}
          </div>
        ) : (
          <div className="rb-split">
            <div className="rb-split-main">
              {renderFacts(project)}
              {renderChecklist(project)}
            </div>
            {renderViewer()}
          </div>
        )}
      </Modal>

      {project && (
        <>
          <RebuildDocGenerator
            open={docGeneratorOpen}
            project={project}
            onClose={() => setDocGeneratorOpen(false)}
            onSuccess={onDocCreated}
          />
          <RebuildPhotoToPdf
            open={photoToPdfOpen}
            project={project}
            onClose={() => setPhotoToPdfOpen(false)}
            onSuccess={onDocCreated}
          />
        </>
      )}

      <Modal
        title="Add completion document"
        open={uploadOpen}
        width={460}
        onOk={submitUpload}
        okText="Add document"
        confirmLoading={uploading}
        onCancel={() => setUploadOpen(false)}
        destroyOnClose
      >
        <Form form={uploadForm} layout="vertical" preserve={false}>
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
              <p className="ant-upload-text">Click or drop a PDF here</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item name="description" label="Note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default RebuildProjectDetailModal;
