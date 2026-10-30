/**
 * Someone at the company signs a contract the customer has already signed, on
 * the lines the customer left open. The customer's signature is already on the
 * document shown, so only the company's lines can be tapped. It goes on under the
 * name of whoever is signed in.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Modal, Skeleton, message } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import WMSignaturePad from '../water-mitigation/pdf-annotator/WMSignaturePad';
import { useSheetModal } from '../common/ui';
import { useAuth } from '../../contexts/AuthContext';
import { contractInstanceService } from '../../services/contractService';
import { CLIENT_TODOS_KEY, TODO_BOARD_KEY } from '../../services/todoService';
import type { ContractInstance, SignatureFieldPlacement } from '../../types/contract';
import ContractSignatureOverlay from './ContractSignatureOverlay';
import { CONSENT_TEXT, initialsOf, lineLabel, slotOf } from './signatureLines';
import { usePdfRenderer } from './usePdfRenderer';
import '../onsite-signing/onsite.css';

interface Mark {
  image: string;
  type: 'drawn' | 'typed';
}

const CompanySignSheet: React.FC<{ contract: ContractInstance; onClose: () => void }> = ({ contract, onClose }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { sheetProps } = useSheetModal('tall');
  const { pages, loading: rendering, render } = usePdfRenderer();
  const [loaded, setLoaded] = useState(false);
  const [widths, setWidths] = useState<number[]>([]);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [padLine, setPadLine] = useState<SignatureFieldPlacement | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => dayjs().format('MM/DD/YYYY'), []);
  const signerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '';
  const lines = useMemo(() => contract.open_company_lines ?? [], [contract.open_company_lines]);

  // One to sign per kind; a repeated line takes the same mark. Dates fill themselves.
  const slots = useMemo(() => {
    const seen = new Map<string, SignatureFieldPlacement>();
    lines.filter(line => line.fieldType !== 'date_signed').forEach(line => seen.set(slotOf(line), line));
    return [...seen.values()];
  }, [lines]);

  const loadDocument = async () => {
    setLoaded(false);
    await render(`/api/contracts/contracts/${contract.id}/pdf`);
    setLoaded(true);
  };

  useEffect(() => {
    loadDocument();
    // Once for the contract this sheet was opened on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id]);

  // The lines sit on the page image at its displayed size
  useEffect(() => {
    if (pages.length === 0) return undefined;
    const measure = () => setWidths(pageRefs.current.map(el => el?.clientWidth || 0));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pages]);

  const unsigned = slots.filter(slot => !marks[slotOf(slot)]);
  const ready = pages.length > 0 && unsigned.length === 0 && consent;
  const stillNeeded = [
    ...unsigned.map(lineLabel),
    ...(consent ? [] : ['agreement to sign electronically']),
  ];

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const signatureFields: Record<string, string> = {};
    lines.forEach(line => {
      signatureFields[line.id] = line.fieldType === 'date_signed' ? today : marks[slotOf(line)].image;
    });
    const primary = slots.find(slot => slot.fieldType === 'signature') ?? slots[0];
    try {
      await contractInstanceService.addCompanySignature(contract.id, {
        signature_fields: signatureFields,
        signature_type: marks[slotOf(primary)].type,
        today,
        consent_agreed: true,
        consent_text: CONSENT_TEXT,
      });
      message.success('Company signature added');
      if (contract.claim_id) {
        queryClient.invalidateQueries({ queryKey: ['contract-dashboard', contract.claim_id] });
      }
      queryClient.invalidateQueries({ queryKey: ['contracts-unassigned', contract.client_id] });
      queryClient.invalidateQueries({ queryKey: TODO_BOARD_KEY });
      queryClient.invalidateQueries({ queryKey: [CLIENT_TODOS_KEY] });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Couldn't save the signature. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      {...sheetProps}
      open
      title={`Sign for ${contract.company_name || 'the company'}`}
      width={760}
      onCancel={onClose}
      maskClosable={false}
      footer={[
        <Button key="cancel" disabled={submitting} onClick={onClose}>Cancel</Button>,
        <Button key="sign" type="primary" disabled={!ready} loading={submitting} onClick={submit}>
          Add company signature
        </Button>,
      ]}
    >
      <p className="os-lead">
        You&apos;re signing {contract.title || contract.template_name || 'this contract'} as {signerName}.
        The customer has already signed.
      </p>

      {(rendering || !loaded) && <Skeleton active paragraph={{ rows: 8 }} />}
      {loaded && !rendering && pages.length === 0 && (
        <div className="os-error" role="alert">
          Couldn&apos;t load the document.
          <Button size="small" onClick={loadDocument}>Try again</Button>
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
            <img src={page.dataUrl} alt={`Page ${pageIndex + 1} of ${pages.length}`} />
            {lines.filter(line => line.pageIndex === pageIndex).map(line => (
              <ContractSignatureOverlay
                key={line.id}
                field={line}
                containerWidth={width}
                containerHeight={height}
                capturedImage={line.fieldType === 'date_signed' ? today : marks[slotOf(line)]?.image}
                onClick={() => {
                  if (line.fieldType !== 'date_signed') setPadLine(line);
                }}
                disabled={submitting}
              />
            ))}
          </div>
        );
      })}

      {pages.length > 0 && (
        <div className="os-sign">
          {slots.map(slot => {
            const mark = marks[slotOf(slot)];
            return (
              <div key={slotOf(slot)} className="os-sign-row">
                <span className="os-sign-label">{lineLabel(slot)}</span>
                {mark && <img className="os-sign-image" src={mark.image} alt={`${lineLabel(slot)} as signed`} />}
                <Button
                  type={mark ? 'text' : 'default'}
                  icon={mark ? <CheckOutlined /> : undefined}
                  disabled={submitting}
                  onClick={() => setPadLine(slot)}
                >
                  {mark ? 'Redo' : 'Sign'}
                </Button>
              </div>
            );
          })}
          <Checkbox
            className="os-consent"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            disabled={submitting}
          >
            {CONSENT_TEXT}
          </Checkbox>
          {error && <div className="os-error" role="alert">{error}</div>}
          {stillNeeded.length > 0 && <p className="os-note">Still needed: {stillNeeded.join(', ')}.</p>}
        </div>
      )}

      <WMSignaturePad
        open={!!padLine}
        title={padLine ? lineLabel(padLine) : undefined}
        defaultName={padLine?.fieldType === 'initial' ? initialsOf(signerName) : signerName}
        onClose={() => setPadLine(null)}
        onSave={(image, type) => {
          if (padLine) {
            setMarks(prev => ({ ...prev, [slotOf(padLine)]: { image, type: type ?? 'drawn' } }));
          }
          setPadLine(null);
        }}
      />
    </Modal>
  );
};

export default CompanySignSheet;
