/**
 * The customer reads the filled-in documents and signs them. Nothing is saved
 * until they submit; that one step makes the client and a contract and signed
 * PDF per document. A visit can carry several documents (water mitigation signs
 * the authorization and the sign-off together), shown one after the other.
 *
 * A signature is drawn once per signer and kind: the first line tapped opens
 * the pad, and every other line of that signer's then takes the same mark with
 * a tap. The list under the documents shows how many lines are left and goes to
 * the next one, which is easier on a phone where the lines are small. Lines are
 * grouped by who signs them, since the device is in the customer's hands.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Skeleton } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import ContractSignatureOverlay from '../contract/ContractSignatureOverlay';
import { CONSENT_TEXT, initialsOf, lineLabel, slotOf } from '../contract/signatureLines';
import { usePdfRenderer } from '../contract/usePdfRenderer';
import { PageHeader, humanize, useSheetModal } from '../common/ui';
import WMSignaturePad from '../water-mitigation/pdf-annotator/WMSignaturePad';
import { onsiteSigningService } from '../../services/contractService';
import type {
  OnsiteAddress, OnsiteDocument, OnsiteForm, OnsiteSignedContract, SignatureFieldPlacement,
} from '../../types/contract';
import type { Answers } from './FieldsStep';

const isDate = (fieldType: string) => fieldType === 'date_signed';

/** A line on one of the visit's documents; ids are only unique within a template */
const lineKey = (document: OnsiteDocument, field: SignatureFieldPlacement) => `${document.template_id}:${field.id}`;
const lineDomId = (key: string) => `os-line-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

interface Slot {
  key: string;
  role: string;
  isInitials: boolean;
  label: string;
  /** Every line that takes this mark, in document order */
  lines: string[];
}

type PreviewState = 'loading' | 'ready' | 'failed';

// ── One document ────────────────────────────────────

const DocumentPages: React.FC<{
  document: OnsiteDocument;
  heading?: string;
  companyId: string;
  answers: Answers;
  today: string;
  markOf: (field: SignatureFieldPlacement) => string | undefined;
  flash: string | null;
  disabled: boolean;
  onLine: (field: SignatureFieldPlacement) => void;
  onState: (state: PreviewState) => void;
}> = ({ document, heading, companyId, answers, today, markOf, flash, disabled, onLine, onState }) => {
  const { pages, loading: rendering, render, reset } = usePdfRenderer();
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [widths, setWidths] = useState<number[]>([]);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const report = useRef(onState);
  report.current = onState;

  const loadPreview = useCallback(async () => {
    setPreviewState('loading');
    reset();
    try {
      const blob = await onsiteSigningService.preview({
        template_id: document.template_id, company_id: companyId, answers, today,
      });
      const url = URL.createObjectURL(blob);
      await render(url);
      URL.revokeObjectURL(url);
      setPreviewState('ready');
    } catch {
      setPreviewState('failed');
    }
  }, [document.template_id, companyId, answers, today, render, reset]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const renderFailed = previewState === 'ready' && !rendering && pages.length === 0;
  const shown = pages.length > 0 && !rendering;
  useEffect(() => {
    report.current(renderFailed ? 'failed' : shown ? 'ready' : previewState === 'failed' ? 'failed' : 'loading');
  }, [previewState, renderFailed, shown]);

  // The signature lines sit on the page image at its displayed size
  useEffect(() => {
    if (pages.length === 0) return undefined;
    const measure = () => setWidths(pageRefs.current.map(el => el?.clientWidth || 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pages]);

  return (
    <section className="os-doc">
      {heading && <h2 className="os-doc-title">{heading}</h2>}
      {(previewState === 'loading' || rendering) && <Skeleton active paragraph={{ rows: 10 }} />}
      {(previewState === 'failed' || renderFailed) && (
        <div className="os-error" role="alert">
          Couldn&apos;t load {heading ? document.template_name : 'the document'}.
          <Button size="small" onClick={loadPreview}>Try again</Button>
        </div>
      )}
      {pages.map((page, pageIndex) => {
        const width = widths[pageIndex] || page.width;
        const height = page.height * (width / page.width);
        return (
          <div
            key={pageIndex}
            className="os-pdf-page"
            ref={el => { pageRefs.current[pageIndex] = el; }}
          >
            <img src={page.dataUrl} alt={`${document.template_name}, page ${pageIndex + 1} of ${pages.length}`} />
            {document.signature_fields.filter(f => f.pageIndex === pageIndex).map(field => {
              const key = lineKey(document, field);
              return (
                <ContractSignatureOverlay
                  key={field.id}
                  id={lineDomId(key)}
                  className={flash === key ? 'os-line-flash' : undefined}
                  field={field}
                  containerWidth={width}
                  containerHeight={height}
                  capturedImage={isDate(field.fieldType) ? today : markOf(field)}
                  onClick={() => onLine(field)}
                  disabled={disabled}
                />
              );
            })}
          </div>
        );
      })}
    </section>
  );
};

// ── The visit's documents, and signing them ─────────

interface SignStepProps {
  leading: React.ReactNode;
  form: OnsiteForm;
  companyId: string;
  clientId?: string;
  address?: OnsiteAddress;
  answers: Answers;
  today: string;
  onBack: () => void;
  onSigned: (result: OnsiteSignedContract, signerName: string) => void;
}

const SignStep: React.FC<SignStepProps> = ({
  leading, form, companyId, clientId, address, answers, today, onBack, onSigned,
}) => {
  const { isPhone } = useSheetModal();
  const documents = form.documents;
  const several = documents.length > 1;

  const [states, setStates] = useState<Record<string, PreviewState>>({});
  const [signerName, setSignerName] = useState(answers['client.display_name'] ?? '');
  const [consent, setConsent] = useState(false);
  // Each signer's mark, drawn once, and the lines it has been placed on
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<Record<string, boolean>>({});
  const [pad, setPad] = useState<{ slot: Slot; line?: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // One mark per signer and kind, across every document
  const slots = useMemo(() => {
    const seen = new Map<string, Slot>();
    documents.forEach(document => {
      document.signature_fields.filter(f => !isDate(f.fieldType)).forEach(field => {
        const key = slotOf(field);
        if (!seen.has(key)) {
          seen.set(key, {
            key,
            role: field.signerRole,
            isInitials: field.fieldType === 'initial',
            label: lineLabel(field),
            lines: [],
          });
        }
        seen.get(key)?.lines.push(lineKey(document, field));
      });
    });
    return [...seen.values()];
  }, [documents]);
  const slotByKey = useMemo(() => new Map(slots.map(slot => [slot.key, slot])), [slots]);

  // The customer's lines first, then anyone else's
  const groups = useMemo(() => {
    const roles = [...new Set(slots.map(slot => slot.role))]
      .sort((a, b) => Number(b === 'homeowner') - Number(a === 'homeowner'));
    return roles.map(role => ({ role, slots: slots.filter(slot => slot.role === role) }));
  }, [slots]);

  const allShown = documents.every(document => states[document.template_id] === 'ready');
  const left = (slot: Slot) => slot.lines.filter(line => !placed[line]);
  const unsigned = slots.filter(slot => left(slot).length > 0);
  const ready = allShown && unsigned.length === 0 && !!signerName.trim() && consent;
  const stillNeeded = [
    ...unsigned.map(slot => {
      const count = left(slot).length;
      return `${slot.label} (${count} ${count === 1 ? 'line' : 'lines'})`;
    }),
    ...(signerName.trim() ? [] : ['the full name']),
    ...(consent ? [] : ['agreement to sign electronically']),
  ];

  // The Type tab starts from the name, but only on the person's own lines
  const padName = (() => {
    if (pad?.slot.role !== 'homeowner') return '';
    return pad.slot.isInitials ? initialsOf(signerName) : signerName;
  })();

  const tapLine = (document: OnsiteDocument, field: SignatureFieldPlacement) => {
    if (isDate(field.fieldType)) return;
    const slot = slotByKey.get(slotOf(field));
    if (!slot) return;
    const key = lineKey(document, field);
    if (placed[key]) {
      // A signed line redraws the mark, wherever it has been placed
      setPad({ slot });
    } else if (marks[slot.key]) {
      setPlaced(prev => ({ ...prev, [key]: true }));
    } else {
      setPad({ slot, line: key });
    }
  };

  const flashTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const goToNext = (slot: Slot) => {
    const next = left(slot)[0];
    if (!next) return;
    window.document.getElementById(lineDomId(next))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(next);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const signed = await onsiteSigningService.sign({
        company_id: companyId,
        client_id: clientId,
        address: clientId ? undefined : address,
        documents: documents.map(document => ({
          template_id: document.template_id,
          signature_fields: Object.fromEntries(document.signature_fields.map(field => [
            field.id,
            isDate(field.fieldType) ? today : marks[slotOf(field)],
          ])),
        })),
        answers,
        today,
        signer_name: signerName.trim(),
        consent_agreed: true,
        consent_text: CONSENT_TEXT,
      });
      onSigned(signed, signerName.trim());
    } catch (err: any) {
      setSubmitError(err.response?.data?.detail || "Couldn't save the signature. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        leading={leading}
        title={several ? 'Read and sign each document' : 'Read and sign'}
        meta={several ? `${documents.length} documents` : documents[0]?.template_name}
      />
      {allShown && (
        <p className="os-lead">
          Tap a marked line to sign. After the first one, tapping a line puts the same signature on it.
        </p>
      )}

      {documents.map((document, index) => (
        <DocumentPages
          key={document.template_id}
          document={document}
          heading={several ? `${index + 1} of ${documents.length} · ${document.template_name}` : undefined}
          companyId={companyId}
          answers={answers}
          today={today}
          markOf={field => (placed[lineKey(document, field)] ? marks[slotOf(field)] : undefined)}
          flash={flash}
          disabled={submitting}
          onLine={field => tapLine(document, field)}
          onState={state => setStates(prev => (
            prev[document.template_id] === state ? prev : { ...prev, [document.template_id]: state }
          ))}
        />
      ))}

      {allShown && (
        <div className="os-sign">
          {groups.map((group, groupIndex) => (
            <section key={group.role} className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">{humanize(group.role)} signs</h2>
              </div>
              {group.slots.map(slot => {
                const mark = marks[slot.key];
                const remaining = left(slot).length;
                const done = slot.lines.length - remaining;
                return (
                  <div key={slot.key} className="os-sign-row">
                    <span className="os-sign-label">
                      {slot.isInitials ? 'Initials' : 'Signature'}
                      <span className="os-sign-meta">
                        {done} of {slot.lines.length} {slot.lines.length === 1 ? 'line' : 'lines'} signed
                      </span>
                    </span>
                    {mark && <img className="os-sign-image" src={mark} alt={`${slot.label} as signed`} />}
                    <span className="os-sign-actions">
                      {!mark && (
                        <Button disabled={submitting} onClick={() => setPad({ slot, line: slot.lines[0] })}>
                          Sign
                        </Button>
                      )}
                      {mark && remaining > 0 && (
                        <Button disabled={submitting} onClick={() => goToNext(slot)}>Next line</Button>
                      )}
                      {mark && (
                        <Button
                          type="text"
                          icon={remaining === 0 ? <CheckOutlined /> : undefined}
                          disabled={submitting}
                          onClick={() => setPad({ slot })}
                        >
                          Redo
                        </Button>
                      )}
                    </span>
                  </div>
                );
              })}
              {groupIndex === 0 && (
                <>
                  <div className="os-field os-signer">
                    <label className="os-field-label" htmlFor="os-signer-name">
                      {humanize(group.role)}&apos;s full name
                    </label>
                    <Input
                      id="os-signer-name"
                      value={signerName}
                      onChange={e => setSignerName(e.target.value)}
                      autoComplete="off"
                      disabled={submitting}
                    />
                  </div>
                  <Checkbox
                    className="os-consent"
                    checked={consent}
                    onChange={e => setConsent(e.target.checked)}
                    disabled={submitting}
                  >
                    {CONSENT_TEXT}
                  </Checkbox>
                </>
              )}
            </section>
          ))}

          {submitError && <div className="os-error" role="alert">{submitError}</div>}
          {stillNeeded.length > 0 && <p className="os-note">Still needed: {stillNeeded.join(', ')}.</p>}
        </div>
      )}

      <div className="os-actions">
        {isPhone && <Button disabled={submitting} onClick={onBack}>Back</Button>}
        {allShown && (
          <div className="os-actions-end">
            <Button type="primary" disabled={!ready} loading={submitting} onClick={submit}>
              {several ? `Sign and create ${documents.length} contracts` : 'Sign and create contract'}
            </Button>
          </div>
        )}
      </div>

      <WMSignaturePad
        open={!!pad}
        title={pad?.slot.label}
        defaultName={padName}
        onClose={() => setPad(null)}
        onSave={image => {
          if (pad) {
            setMarks(prev => ({ ...prev, [pad.slot.key]: image }));
            const { line } = pad;
            if (line) setPlaced(prev => ({ ...prev, [line]: true }));
          }
          setPad(null);
        }}
      />
    </>
  );
};

export default SignStep;
