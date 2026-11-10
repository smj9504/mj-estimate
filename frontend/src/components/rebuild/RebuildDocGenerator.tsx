/**
 * Generate a completion document (the certificate of completion, a lien
 * waiver...) from the company's contract template: pick the template, check
 * the values it prints, sign in place, generate. One dialog, no steps: the
 * signature is drawn or typed right here instead of in a second dialog.
 *
 * Or, when the client has a signature on file, the office signs the client's
 * box with it (the user's choice, as on contracts): the person confirms the
 * client allowed it, the server takes the stored image, and the claim's
 * activity log names who did it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Select, Input, Button, Checkbox, Skeleton, message } from 'antd';
import { CheckCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { rebuildService } from '../../services/rebuildService';
import { humanize, useSheetModal } from '../common/ui';
import SignatureField, { type SignatureValue } from '../common/SignatureField';
import { keptLine, useSignaturesOnFile } from '../client/ClientSignatureOnFile';
import { onFileAuthorization } from '../contract/signatureLines';
import type { RebuildProject, RebuildCompletionDoc } from '../../types/rebuild';

interface Props {
  open: boolean;
  project: RebuildProject;
  onClose: () => void;
  onSuccess: (doc: RebuildCompletionDoc) => void;
}

interface FieldMapping {
  fieldKey?: string;
  label?: string;
}

interface TemplateInfo {
  id: string;
  name: string;
  document_type: string;
  /** Completion doc type this template produces (certificate_of_completion -> coc) */
  doc_type: string;
  requires_signature: boolean;
  field_mappings: FieldMapping[];
}

// Boxes filled from the signature, not typed values
const SIGNATURE_PREFIXES = ['signature.', 'initial.', 'date_signed.'];
const isSignatureKey = (key: string) => SIGNATURE_PREFIXES.some(p => key.startsWith(p));

// The client's boxes, the ones their signature on file goes in
const CLIENT_SIGNATURE_KEY = 'signature.homeowner';
const CLIENT_INITIAL_KEY = 'initial.homeowner';

const DOC_TYPE_OPTIONS = [
  { value: 'coc', label: 'Certificate of Completion' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'permit', label: 'Permit' },
  { value: 'lien_waiver', label: 'Lien Waiver' },
  { value: 'other', label: 'Other' },
];

/** One entry per mapped field (a box repeated on several pages counts once) */
const uniqueBy = (mappings: FieldMapping[], keep: (key: string) => boolean) =>
  mappings.reduce((acc: { key: string; label: string }[], m) => {
    const key = m.fieldKey || '';
    if (key && keep(key) && !acc.some(a => a.key === key)) acc.push({ key, label: m.label || key });
    return acc;
  }, []);

const RebuildDocGenerator: React.FC<Props> = ({ open, project, onClose, onSuccess }) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  const size = isPhone ? 'large' : 'middle';
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [prefillData, setPrefillData] = useState<Record<string, any>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [docType, setDocType] = useState('coc');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [signatureFieldKey, setSignatureFieldKey] = useState<string | undefined>();
  const [withFile, setWithFile] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { data: onFile } = useSignaturesOnFile(project.client_id, open);

  const template = templates.find(t => t.id === templateId) || null;
  const fields = useMemo(() => uniqueBy(template?.field_mappings || [], k => !isSignatureKey(k)), [template]);
  const signatureBoxes = useMemo(
    () => uniqueBy(template?.field_mappings || [], k => k.startsWith('signature.')),
    [template],
  );

  const kept = onFile?.signature || null;
  const keptName = kept?.signer_name || project.client_name || 'The client';
  // Boxes for someone else only (the contractor's): the client's signature has nowhere to go
  const fileProblem = kept && signatureBoxes.length && !signatureBoxes.some(b => b.key === CLIENT_SIGNATURE_KEY)
    ? "This template has no box for the client's signature, so the one on file can't go on it."
    : null;
  const usingFile = withFile && !!kept && !fileProblem;
  const keptInitials = onFile?.initial && template?.field_mappings.some(m => m.fieldKey === CLIENT_INITIAL_KEY)
    ? onFile.initial
    : null;

  const pickTemplate = (id: string, list: TemplateInfo[] = templates) => {
    const tmpl = list.find(t => t.id === id);
    if (!tmpl) return;
    setTemplateId(tmpl.id);
    setTitle(tmpl.name);
    setDocType(tmpl.doc_type || 'coc');
    setOverrides({});
    setSignatureFieldKey(uniqueBy(tmpl.field_mappings || [], k => k.startsWith('signature.'))[0]?.key);
    // The client allowed it for a document, so another one asks again
    setAuthorized(false);
  };

  const signWithFile = (on: boolean) => {
    setWithFile(on);
    setAuthorized(false);
  };

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    Promise.all([
      rebuildService.getAvailableTemplates(project.id),
      rebuildService.getPrefillData(project.id),
    ]).then(([tmpl, prefill]) => {
      if (stale) return;
      setTemplates(tmpl);
      setPrefillData(prefill);
      // Certificates come first; start on the first so most people only check and sign
      if (tmpl.length) pickTemplate(tmpl[0].id, tmpl);
    }).catch(() => {
      if (!stale) message.error('Could not load the templates');
    }).finally(() => {
      if (!stale) setLoading(false);
    });
    return () => { stale = true; };
    // pickTemplate only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  const reset = () => {
    setTemplates([]);
    setTemplateId(undefined);
    setOverrides({});
    setDocType('coc');
    setTitle('');
    setNote('');
    setSignature(null);
    setSignatureFieldKey(undefined);
    setWithFile(false);
    setAuthorized(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const valueOf = (fieldKey: string): string => {
    if (overrides[fieldKey] !== undefined) return overrides[fieldKey];
    const [cat, key] = fieldKey.split('.');
    return prefillData?.[cat]?.[key] || '';
  };

  const generate = async () => {
    if (!template) return;
    setGenerating(true);
    // The server puts the stored signature on; nothing drawn here is sent with it
    const signing = usingFile
      ? { signature_on_file: true, authorized, authorization_text: onFileAuthorization(keptName) }
      : {
        signature_image: signature?.image || undefined,
        signature_name: signature?.name || undefined,
        signature_field_key: signature ? signatureFieldKey : undefined,
      };
    try {
      const result = await rebuildService.generateDocument(project.id, {
        template_id: template.id,
        doc_type: docType,
        title,
        overrides,
        additional_text: note,
        ...signing,
      });
      message.success('Document generated');
      onSuccess(result);
      handleClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Could not generate the document');
    } finally {
      setGenerating(false);
    }
  };

  // Templates come from the contractor's company, else the claim's reconstruction company
  const templateCompany = project.contractor_id ? project.contractor_name : project.rebuild_company_name;
  const noTemplates = !loading && templates.length === 0;

  const signatureWhere = !signatureBoxes.length
    ? 'This template has no signature box, so it goes at the bottom right of the last page.'
    : usingFile
      ? `It goes in the client's signature box, with today's date in its date box${keptInitials ? ', and the initials in their initials boxes' : ''}.`
      : "It goes in the template's signature box, with today's date in its date box.";

  const footNote = !template ? ''
    : usingFile ? (authorized ? 'Signed with the signature on file' : 'Confirm the client allowed it')
      : signature ? 'Signed' : 'Not signed';

  const renderBody = () => {
    if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (noTemplates) {
      return (
        <div className="rbg-empty">
          <InfoCircleOutlined aria-hidden="true" />
          <p className="rbg-empty-title">
            {templateCompany ? `${templateCompany} has no completion template yet` : 'No company to take templates from'}
          </p>
          <p>
            {templateCompany
              ? 'Add a "Certificate of Completion (Recon)" template for this company in Contract Templates, then map its fields.'
              : "Assign a contractor, or set the claim's reconstruction company, to use that company's templates."}
          </p>
        </div>
      );
    }
    return (
      <div className="rbg">
        <section className="rbg-section" aria-labelledby="rbg-template">
          <h3 className="rbg-head" id="rbg-template">
            Template
            {templateCompany && <span className="rbg-head-meta">{templateCompany}'s contract templates</span>}
          </h3>
          <div className="rbg-grid">
            <div className="rbg-field rbg-field--wide">
              <Select
                size={size}
                value={templateId}
                onChange={id => pickTemplate(id)}
                options={templates.map(t => ({ value: t.id, label: t.name }))}
                optionRender={o => {
                  const t = templates.find(x => x.id === o.value);
                  return (
                    <span className="rbg-option">
                      <span>{t?.name}</span>
                      <span className="rbg-option-meta">{humanize(t?.document_type || 'other')}</span>
                    </span>
                  );
                }}
                aria-label="Template"
              />
            </div>
            <div className="rbg-field">
              <span className="rbg-label">Saved as</span>
              <Select size={size} value={docType} onChange={setDocType} options={DOC_TYPE_OPTIONS} aria-label="Document type" />
            </div>
            <label className="rbg-field">
              <span className="rbg-label">Title</span>
              <Input size={size} value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" aria-label="Document title" />
            </label>
          </div>
        </section>

        <section className="rbg-section" aria-labelledby="rbg-fields">
          <h3 className="rbg-head" id="rbg-fields">
            Printed on it
            <span className="rbg-head-meta">Filled in from the claim. Change anything that's wrong.</span>
          </h3>
          {fields.length === 0 ? (
            <p className="rbg-muted">This template has no mapped fields, so it prints as it is.</p>
          ) : (
            <div className="rbg-values">
              {fields.map(f => (
                <label key={f.key} className="rbg-value">
                  <span className="rbg-value-label">{f.label}</span>
                  <Input
                    size={size}
                    value={valueOf(f.key)}
                    onChange={e => setOverrides(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder="Empty"
                    aria-label={f.label}
                  />
                </label>
              ))}
            </div>
          )}
          <label className="rbg-field rbg-note">
            <span className="rbg-label">Note printed on the document <span className="rbg-optional">optional</span></span>
            <Input.TextArea
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. All work completed per the insurance scope"
            />
          </label>
        </section>

        <section className="rbg-section" aria-labelledby="rbg-sign">
          <h3 className="rbg-head" id="rbg-sign">
            Signature <span className="rbg-optional">optional</span>
            <span className="rbg-head-meta">{signatureWhere}</span>
          </h3>
          {kept && usingFile ? (
            <div className="rbg-onfile">
              <div className="rbg-onfile-marks">
                <img className="rbg-onfile-sig" src={kept.image} alt={`${keptName}'s signature on file`} />
                {keptInitials && (
                  <img className="rbg-onfile-initials" src={keptInitials.image} alt={`${keptName}'s initials on file`} />
                )}
              </div>
              <p className="rbg-muted">{keptLine(kept)}</p>
              <Checkbox checked={authorized} onChange={e => setAuthorized(e.target.checked)}>
                {onFileAuthorization(keptName)}
              </Checkbox>
              <Button type="link" size="small" className="rbg-onfile-switch" onClick={() => signWithFile(false)}>
                Sign here instead
              </Button>
            </div>
          ) : (
            <>
              {kept && (
                <div className="rbg-onfile-offer">
                  <img src={kept.image} alt="" aria-hidden="true" />
                  <span className="rbg-onfile-offer-text">
                    {fileProblem || `${keptName}'s signature is on file.`}
                  </span>
                  <Button size={size} disabled={!!fileProblem} onClick={() => signWithFile(true)}>
                    Use signature on file
                  </Button>
                </div>
              )}
              {signatureBoxes.length > 1 && (
                <div className="rbg-field rbg-sign-as">
                  <span className="rbg-label">Sign as</span>
                  <Select size={size} value={signatureFieldKey} onChange={setSignatureFieldKey}
                    options={signatureBoxes.map(b => ({ value: b.key, label: b.label }))} aria-label="Sign as" />
                </div>
              )}
              <SignatureField
                value={signature}
                onChange={setSignature}
                defaultName={prefillData?.client?.name || project.client_name}
                large={isPhone}
              />
            </>
          )}
        </section>
      </div>
    );
  };

  return (
    <Modal
      title="Generate document"
      open={open}
      width={720}
      style={isPhone ? undefined : { top: 32 }}
      // Desktop: the body scrolls between a fixed title and footer, so Generate stays in reach
      styles={isPhone ? undefined : { body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', margin: '0 -24px', padding: '0 24px' } }}
      onCancel={handleClose}
      {...sheetProps}
      footer={
        <div className="rbg-foot">
          {!isPhone && <span className="rbg-foot-note">{footNote}</span>}
          <Button size={size} onClick={handleClose}>Cancel</Button>
          <Button
            size={size}
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={generating}
            disabled={!template || !title.trim() || (usingFile && !authorized)}
            onClick={generate}
          >
            Generate PDF
          </Button>
        </div>
      }
    >
      {renderBody()}
    </Modal>
  );
};

export default RebuildDocGenerator;
