/**
 * The customer reads the filled-in documents and signs them. Nothing is saved
 * until they submit; that one step makes the client and a contract and signed
 * PDF per document.
 *
 * A visit can carry several contracts (water mitigation signs the authorization
 * and the sign-off together). They are taken one per screen, with a step list
 * on top showing what each still needs, and a bar that stays in view and always
 * offers the next thing to do: the next line to sign, then the next contract,
 * then signing. Nothing can be submitted until every line of every contract is
 * signed, so none is left behind.
 *
 * A signature is drawn once per signer and kind: the first line tapped opens
 * the pad, and every other line of that signer's, on any contract, then takes
 * the same mark with a tap. Lines are grouped by who signs them, since the
 * device is in the customer's hands.
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
/** The lines someone has to sign on a document, in page order */
const signLines = (document: OnsiteDocument) => document.signature_fields
  .filter(field => !isDate(field.fieldType))
  .sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);

interface Slot {
  key: string;
  role: string;
  isInitials: boolean;
  label: string;
}

type PreviewState = 'loading' | 'ready' | 'failed';

// ── One document ────────────────────────────────────

const DocumentPages: React.FC<{
  document: OnsiteDocument;
  active: boolean;
  companyId: string;
  answers: Answers;
  today: string;
  markOf: (field: SignatureFieldPlacement) => string | undefined;
  flash: string | null;
  disabled: boolean;
  onLine: (field: SignatureFieldPlacement) => void;
  onState: (state: PreviewState) => void;
}> = ({ document, active, companyId, answers, today, markOf, flash, disabled, onLine, onState }) => {
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
    report.current(renderFailed || previewState === 'failed' ? 'failed' : shown ? 'ready' : 'loading');
  }, [previewState, renderFailed, shown]);

  // The signature lines sit on the page image at its displayed size, which a
  // hidden document doesn't have until it's shown
  useEffect(() => {
    if (pages.length === 0 || !active) return undefined;
    const measure = () => setWidths(pageRefs.current.map(el => el?.clientWidth || 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pages, active]);

  return (
    <section className="os-doc" hidden={!active}>
      {(previewState === 'loading' || rendering) && <Skeleton active paragraph={{ rows: 10 }} />}
      {(previewState === 'failed' || renderFailed) && (
        <div className="os-error" role="alert">
          Couldn&apos;t load {document.template_name}.
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
  /** Which of several contracts is on screen; it lives in the URL so Back steps through them */
  docIndex: number;
  onDoc: (index: number) => void;
  companyId: string;
  clientId?: string;
  address?: OnsiteAddress;
  answers: Answers;
  today: string;
  onBack: () => void;
  onSigned: (result: OnsiteSignedContract, signerName: string) => void;
}

const SignStep: React.FC<SignStepProps> = ({
  leading, form, docIndex, onDoc, companyId, clientId, address, answers, today, onBack, onSigned,
}) => {
  const { isPhone } = useSheetModal();
  const documents = form.documents;
  const several = documents.length > 1;
  const current = Math.min(Math.max(docIndex, 0), documents.length - 1);
  const currentDoc = documents[current];
  const isLast = current === documents.length - 1;
  // What the signer agrees to is stored as shown
  const consentText = several ? `${CONSENT_TEXT} This covers all ${documents.length} contracts.` : CONSENT_TEXT;

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
    documents.forEach(document => signLines(document).forEach(field => {
      const key = slotOf(field);
      if (!seen.has(key)) {
        seen.set(key, {
          key, role: field.signerRole, isInitials: field.fieldType === 'initial', label: lineLabel(field),
        });
      }
    }));
    return [...seen.values()];
  }, [documents]);
  const slotByKey = useMemo(() => new Map(slots.map(slot => [slot.key, slot])), [slots]);

  // What each document still needs, in page order
  const left = (document: OnsiteDocument) => signLines(document).filter(f => !placed[lineKey(document, f)]);
  const leftHere = left(currentDoc);
  const firstUnfinished = documents.findIndex(document => left(document).length > 0);
  const allSigned = firstUnfinished === -1;
  const currentShown = states[currentDoc.template_id] === 'ready';
  const allShown = documents.every(document => states[document.template_id] === 'ready');
  const ready = allShown && allSigned && !!signerName.trim() && consent;

  // The customer's lines first, then anyone else's; only those on this document
  const groups = useMemo(() => {
    const here = new Set(signLines(currentDoc).map(slotOf));
    const shown = slots.filter(slot => here.has(slot.key));
    const roles = [...new Set(shown.map(slot => slot.role))]
      .sort((a, b) => Number(b === 'homeowner') - Number(a === 'homeowner'));
    return roles.map(role => ({ role, slots: shown.filter(slot => slot.role === role) }));
  }, [slots, currentDoc]);
  const signerRole = slots.find(slot => slot.role === 'homeowner')?.role ?? slots[0]?.role ?? 'homeowner';

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
  const showLine = (key: string) => {
    window.document.getElementById(lineDomId(key))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(key);
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
        consent_text: consentText,
      });
      onSigned(signed, signerName.trim());
    } catch (err: any) {
      setSubmitError(err.response?.data?.detail || "Couldn't save the signature. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  const toSign = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'} to sign`;
  const which = several ? 'this contract' : 'this document';

  // The one thing to do next, kept in view under the thumb
  const guide = (() => {
    if (!currentShown) return null;
    if (leftHere.length > 0) {
      const next = lineKey(currentDoc, leftHere[0]);
      return {
        text: `${toSign(leftHere.length)} on ${which}`,
        button: <Button type="primary" disabled={submitting} onClick={() => showLine(next)}>Next line</Button>,
      };
    }
    if (!isLast) {
      return {
        text: `Signed. Next: ${documents[current + 1].template_name}`,
        button: <Button type="primary" onClick={() => onDoc(current + 1)}>Next contract</Button>,
      };
    }
    if (!allSigned) {
      const behind = documents[firstUnfinished];
      return {
        text: `${behind.template_name} still has ${toSign(left(behind).length)}`,
        button: <Button type="primary" onClick={() => onDoc(firstUnfinished)}>Go to contract {firstUnfinished + 1}</Button>,
      };
    }
    const missing = [
      ...(signerName.trim() ? [] : ['the full name']),
      ...(consent ? [] : ['agreement to sign electronically']),
    ];
    return {
      text: missing.length > 0 ? `Still needed: ${missing.join(' and ')}` : (several ? 'Every contract is signed' : ''),
      button: (
        <Button type="primary" disabled={!ready} loading={submitting} onClick={submit}>
          {several ? `Sign and create ${documents.length} contracts` : 'Sign and create contract'}
        </Button>
      ),
    };
  })();

  return (
    <>
      <PageHeader
        leading={leading}
        title={several ? `Contract ${current + 1} of ${documents.length}` : 'Read and sign'}
        meta={currentDoc.template_name}
      />

      {several && (
        <ol className="os-steps" aria-label="Contracts to sign">
          {documents.map((document, index) => {
            const count = left(document).length;
            const done = count === 0;
            return (
              <li key={document.template_id}>
                <button
                  type="button"
                  className={`os-step${index === current ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                  aria-current={index === current ? 'step' : undefined}
                  onClick={() => onDoc(index)}
                >
                  <span className="os-step-mark" aria-hidden="true">{done ? <CheckOutlined /> : index + 1}</span>
                  <span className="os-step-body">
                    <span className="os-step-name">{document.template_name}</span>
                    <span className="os-step-meta">{done ? 'Signed' : toSign(count)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {currentShown && (
        <p className="os-lead">
          {several
            ? 'Tap a marked line to sign. After the first one, tapping any line on any of the contracts puts the same signature on it.'
            : 'Tap a marked line to sign. After the first one, tapping a line puts the same signature on it.'}
        </p>
      )}

      {documents.map((document, index) => (
        <DocumentPages
          key={document.template_id}
          document={document}
          active={index === current}
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

      {currentShown && (
        <div className="os-sign">
          {groups.map(group => (
            <section key={group.role} className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">{humanize(group.role)} signs</h2>
              </div>
              {group.slots.map(slot => {
                const mark = marks[slot.key];
                const lines = signLines(currentDoc).filter(f => slotOf(f) === slot.key);
                const done = lines.filter(f => placed[lineKey(currentDoc, f)]).length;
                const firstOpen = lines.find(f => !placed[lineKey(currentDoc, f)]);
                return (
                  <div key={slot.key} className="os-sign-row">
                    <span className="os-sign-label">
                      {slot.isInitials ? 'Initials' : 'Signature'}
                      <span className="os-sign-meta">
                        {done} of {lines.length} {lines.length === 1 ? 'line' : 'lines'} signed
                      </span>
                    </span>
                    {mark && <img className="os-sign-image" src={mark} alt={`${slot.label} as signed`} />}
                    <span className="os-sign-actions">
                      {!mark && (
                        <Button
                          disabled={submitting}
                          onClick={() => setPad({ slot, line: firstOpen && lineKey(currentDoc, firstOpen) })}
                        >
                          Sign
                        </Button>
                      )}
                      {mark && (
                        <Button
                          type="text"
                          icon={done === lines.length ? <CheckOutlined /> : undefined}
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
            </section>
          ))}

          {isLast && (
            <section className="os-signer">
              <div className="os-field">
                <label className="os-field-label" htmlFor="os-signer-name">
                  {humanize(signerRole)}&apos;s full name
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
                {consentText}
              </Checkbox>
            </section>
          )}

          {submitError && <div className="os-error" role="alert">{submitError}</div>}
        </div>
      )}

      {/* Stays in view at the bottom with the next thing to do */}
      <div className="os-guide">
        <p className="os-guide-text" aria-live="polite">{guide?.text}</p>
        <div className="os-actions">
          {isPhone && <Button disabled={submitting} onClick={onBack}>Back</Button>}
          {guide && <div className="os-actions-end">{guide.button}</div>}
        </div>
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
