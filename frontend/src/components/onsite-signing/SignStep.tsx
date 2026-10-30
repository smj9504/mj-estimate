/**
 * The customer reads the filled-in document and signs. Nothing is saved until
 * they submit; that one step makes the client, the contract and the signed PDF.
 * Each signature line can be tapped on the document, or from the list under it,
 * which is easier on a phone where the lines are small. Lines are grouped by who
 * signs them, since the device is in the customer's hands at this point.
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
import type { OnsiteAddress, OnsiteForm, OnsiteSignedContract } from '../../types/contract';
import type { Answers } from './FieldsStep';

const isDate = (fieldType: string) => fieldType === 'date_signed';

interface Slot {
  key: string;
  role: string;
  isInitials: boolean;
  label: string;
}

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
  const { pages, loading: rendering, render, reset } = usePdfRenderer();
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [widths, setWidths] = useState<number[]>([]);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [signerName, setSignerName] = useState(answers['client.display_name'] ?? '');
  const [consent, setConsent] = useState(false);
  const [captured, setCaptured] = useState<Record<string, string>>({});
  const [padSlot, setPadSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // One line to sign per signer and kind; a repeated line takes the same mark
  const slots = useMemo(() => {
    const seen = new Map<string, Slot>();
    form.signature_fields.filter(f => !isDate(f.fieldType)).forEach(f => {
      const isInitials = f.fieldType === 'initial';
      seen.set(slotOf(f), {
        key: slotOf(f),
        role: f.signerRole,
        isInitials,
        label: lineLabel(f),
      });
    });
    return [...seen.values()];
  }, [form.signature_fields]);

  // The customer's lines first, then anyone else's
  const groups = useMemo(() => {
    const roles = [...new Set(slots.map(slot => slot.role))]
      .sort((a, b) => Number(b === 'homeowner') - Number(a === 'homeowner'));
    return roles.map(role => ({ role, slots: slots.filter(slot => slot.role === role) }));
  }, [slots]);

  const loadPreview = useCallback(async () => {
    setPreviewState('loading');
    reset();
    try {
      const blob = await onsiteSigningService.preview({
        template_id: form.template_id, company_id: companyId, answers, today,
      });
      const url = URL.createObjectURL(blob);
      await render(url);
      URL.revokeObjectURL(url);
      setPreviewState('ready');
    } catch {
      setPreviewState('failed');
    }
  }, [form.template_id, companyId, answers, today, render, reset]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // The signature lines sit on the page image at its displayed size
  useEffect(() => {
    if (pages.length === 0) return undefined;
    const measure = () => setWidths(pageRefs.current.map(el => el?.clientWidth || 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pages]);

  const renderFailed = previewState === 'ready' && !rendering && pages.length === 0;
  const unsigned = slots.filter(slot => !captured[slot.key]);
  const ready = unsigned.length === 0 && !!signerName.trim() && consent;
  const stillNeeded = [
    ...unsigned.map(slot => slot.label),
    ...(signerName.trim() ? [] : ['the full name']),
    ...(consent ? [] : ['agreement to sign electronically']),
  ];

  // The Type tab starts from the name, but only on the person's own lines
  const padName = (() => {
    if (padSlot?.role !== 'homeowner') return '';
    return padSlot.isInitials ? initialsOf(signerName) : signerName;
  })();

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const signatureFields: Record<string, string> = {};
      form.signature_fields.forEach(field => {
        signatureFields[field.id] = isDate(field.fieldType) ? today : captured[slotOf(field)];
      });
      const signed = await onsiteSigningService.sign({
        template_id: form.template_id,
        company_id: companyId,
        client_id: clientId,
        address: clientId ? undefined : address,
        answers,
        today,
        signer_name: signerName.trim(),
        signature_fields: signatureFields,
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
      <PageHeader leading={leading} title="Read and sign" meta={form.template_name} />

      {(previewState === 'loading' || rendering) && <Skeleton active paragraph={{ rows: 10 }} />}
      {(previewState === 'failed' || renderFailed) && (
        <div className="os-error" role="alert">
          Couldn&apos;t load the document.
          <Button size="small" onClick={loadPreview}>Try again</Button>
        </div>
      )}
      {pages.length > 0 && <p className="os-lead">Tap each marked line, or scroll to the end to sign.</p>}

      {pages.map((page, pageIndex) => {
        const width = widths[pageIndex] || page.width;
        const height = page.height * (width / page.width);
        return (
          <div
            key={pageIndex}
            className="os-pdf-page"
            ref={el => { pageRefs.current[pageIndex] = el; }}
          >
            <img src={page.dataUrl} alt={`Page ${pageIndex + 1} of ${pages.length}`} />
            {form.signature_fields.filter(f => f.pageIndex === pageIndex).map(field => (
              <ContractSignatureOverlay
                key={field.id}
                field={field}
                containerWidth={width}
                containerHeight={height}
                capturedImage={isDate(field.fieldType) ? today : captured[slotOf(field)]}
                onClick={() => {
                  const slot = slots.find(s => s.key === slotOf(field));
                  if (slot) setPadSlot(slot);
                }}
                disabled={submitting}
              />
            ))}
          </div>
        );
      })}

      {pages.length > 0 && (
        <div className="os-sign">
          {groups.map((group, groupIndex) => (
            <section key={group.role} className="ui-section">
              <div className="ui-section-head">
                <h2 className="ui-section-title">{humanize(group.role)} signs</h2>
              </div>
              {group.slots.map(slot => (
                <div key={slot.key} className="os-sign-row">
                  <span className="os-sign-label">{slot.isInitials ? 'Initials' : 'Signature'}</span>
                  {captured[slot.key] && (
                    <img className="os-sign-image" src={captured[slot.key]} alt={`${slot.label} as signed`} />
                  )}
                  <Button
                    type={captured[slot.key] ? 'text' : 'default'}
                    icon={captured[slot.key] ? <CheckOutlined /> : undefined}
                    disabled={submitting}
                    onClick={() => setPadSlot(slot)}
                  >
                    {captured[slot.key] ? 'Redo' : 'Sign'}
                  </Button>
                </div>
              ))}
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
        {pages.length > 0 && (
          <div className="os-actions-end">
            <Button type="primary" disabled={!ready} loading={submitting} onClick={submit}>
              Sign and create contract
            </Button>
          </div>
        )}
      </div>

      <WMSignaturePad
        open={!!padSlot}
        title={padSlot?.label}
        defaultName={padName}
        onClose={() => setPadSlot(null)}
        onSave={image => {
          if (padSlot) setCaptured(prev => ({ ...prev, [padSlot.key]: image }));
          setPadSlot(null);
        }}
      />
    </>
  );
};

export default SignStep;
