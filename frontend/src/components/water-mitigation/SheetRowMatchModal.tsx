/**
 * SheetRowMatchModal — asks about sheet rows that may already be here, one at a
 * time: the address of a job or client entered by hand, or the phone, email or
 * address of a Lead job already here. Nothing is made from a row until someone
 * says whether it is the same: same links them, different keeps them apart.
 * Styles: `srm-*` in sheetRowMatch.css.
 */

import React, { useEffect, useState } from 'react';
import { Button, Modal, Radio, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { Pill, useSheetModal } from '../common/ui';
import { WMStatusPill } from './wmStatus';
import googleSheetsService, {
  type SheetRowCandidate,
  type SheetRowFacts,
  type SheetRowMatch,
} from '../../services/googleSheetsService';
import './sheetRowMatch.css';

interface SheetRowMatchModalProps {
  open: boolean;
  matches: SheetRowMatch[];
  onClose: () => void;
  /** A row was decided, or turned out to be decided already: reload the jobs and the list */
  onChanged: () => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');

const normalize = (value: string) => value.trim().toLowerCase();

/** Calendar days, so no Date in between that could shift one across time zones */
const showDate = (value?: string | null) => {
  const day = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return day ? `${day[2]}/${day[3]}/${day[1]}` : value;
};

const FACTS: Array<{
  key: keyof SheetRowFacts;
  label: string;
  show?: (value?: string | null) => string | null | undefined;
  compare?: (value: string) => string;
}> = [
  { key: 'homeowner_name', label: 'Homeowner' },
  { key: 'homeowner_phone', label: 'Phone', compare: digitsOnly },
  { key: 'homeowner_email', label: 'Email' },
  { key: 'insurance_company', label: 'Insurance' },
  { key: 'claim_number', label: 'Claim #' },
  { key: 'date_of_loss', label: 'Date of loss', show: showDate },
];

const KIND_LABEL: Record<SheetRowCandidate['type'], string> = { job: 'WM job', client: 'Client' };

const REASON_WORD = { address: 'address', phone: 'phone', email: 'email' } as const;

/** "the same phone and email", from what a candidate shares with the row */
const sharedPhrase = (reasons: NonNullable<SheetRowCandidate['reasons']>) => {
  const words = reasons.map(reason => REASON_WORD[reason]);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
};

/** On a row of the sheet now, rather than entered by hand or off the sheet */
const onRow = (candidate: SheetRowCandidate) => candidate.type === 'job' && !!candidate.row_number;

const candidateHref = (candidate: SheetRowCandidate) =>
  candidate.type === 'job' ? `/water-mitigation/${candidate.id}` : `/clients/${candidate.id}`;

const Value: React.FC<{ value?: string | null; differs?: boolean }> = ({ value, differs }) =>
  value ? (
    <span className={differs ? 'srm-differs' : undefined}>{value}</span>
  ) : (
    <span className="srm-empty">Empty</span>
  );

const SheetRowMatchModal: React.FC<SheetRowMatchModalProps> = ({ open, matches, onClose, onChanged }) => {
  const { sheetProps } = useSheetModal('tall');
  // Later moves on without deciding, so the row to show is kept by id
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [pickedId, setPickedId] = useState<string | undefined>();
  const [saving, setSaving] = useState<'same' | 'different' | undefined>();

  const index = Math.max(0, matches.findIndex(match => match.id === currentId));
  const match = matches[index];
  const candidate = match?.candidates.find(c => c.id === pickedId) ?? match?.candidates[0];

  useEffect(() => {
    if (!open) setCurrentId(undefined);
  }, [open]);

  useEffect(() => {
    if (open && matches.length === 0) onClose();
  }, [open, matches.length]);

  useEffect(() => {
    setPickedId(undefined);
  }, [match?.id]);

  if (!match || !candidate) return null;

  const showNext = () => {
    if (matches.length <= 1) {
      onClose();
      return;
    }
    setCurrentId(matches[(index + 1) % matches.length].id);
  };

  const decide = async (decision: 'same' | 'different') => {
    setSaving(decision);
    try {
      if (decision === 'same') {
        await googleSheetsService.resolveRowMatch(match.id, {
          decision,
          candidate_type: candidate.type,
          candidate_id: candidate.id,
        });
        message.success(
          candidate.type === 'job'
            ? onRow(candidate) ? 'Job moved to this row' : 'Row linked to the job'
            : 'Row added as a job under the client'
        );
      } else {
        await googleSheetsService.resolveRowMatch(match.id, { decision });
        message.success('Row kept separate, with its own job and client');
      }
      setCurrentId(matches[index + 1]?.id);
      onChanged();
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to save the decision');
      // Someone else decided it, or what it matched has gone
      if (error.response?.status === 404 || error.response?.status === 409) onChanged();
    } finally {
      setSaving(undefined);
    }
  };

  const addressDiffers = !!candidate.reasons && !candidate.reasons.includes('address');

  const differs = (key: keyof SheetRowFacts, compare: (value: string) => string = normalize) => {
    const ours = candidate[key];
    const theirs = match.row[key];
    return !!ours && !!theirs && compare(ours) !== compare(theirs);
  };

  return (
    <Modal
      {...sheetProps}
      className="srm-modal"
      open={open}
      onCancel={onClose}
      width={720}
      title={
        <div className="srm-head">
          <span>This row may already be here</span>
          {matches.length > 1 && <span className="srm-count">{index + 1} of {matches.length}</span>}
        </div>
      }
      footer={[
        <Button key="later" onClick={showNext} disabled={!!saving}>Later</Button>,
        <Button key="different" onClick={() => decide('different')} loading={saving === 'different'} disabled={!!saving}>
          Keep separate
        </Button>,
        <Button key="same" type="primary" onClick={() => decide('same')} loading={saving === 'same'} disabled={!!saving}>
          Same, link them
        </Button>,
      ]}
    >
      <p className="srm-lead">
        Row {match.row_number} of the {match.sheet_name} tab has the same{' '}
        {candidate.reasons?.length ? sharedPhrase(candidate.reasons) : 'address'} as{' '}
        {candidate.type === 'job' && candidate.status === 'Lead' ? 'a Lead job already here' : 'something entered by hand'}.
        No job has been made from the row yet.
      </p>

      {match.candidates.length > 1 && (
        <Radio.Group
          className="srm-picks"
          value={candidate.id}
          onChange={event => setPickedId(event.target.value)}
        >
          {match.candidates.map(c => (
            <Radio key={c.id} value={c.id}>
              <span className="srm-pick-kind">{KIND_LABEL[c.type]}</span>
              {c.homeowner_name || c.address}
            </Radio>
          ))}
        </Radio.Group>
      )}

      <div className="srm-compare" role="table" aria-label="Sheet row compared with what was entered by hand">
        <div className="srm-row srm-row-head" role="row">
          <span role="columnheader" aria-label="Field" />
          <span role="columnheader">Sheet row</span>
          <span role="columnheader" className="srm-ours">
            {KIND_LABEL[candidate.type]}
            {candidate.type === 'job' && candidate.status && <WMStatusPill status={candidate.status} />}
            {candidate.source === 'acculynx' && <Pill tone="gray">AccuLynx</Pill>}
            {candidate.sheet_name && (
              <Pill tone="gray">
                {onRow(candidate) ? `${candidate.sheet_name} row ${candidate.row_number}` : `Was on ${candidate.sheet_name}`}
              </Pill>
            )}
            <a
              href={candidateHref(candidate)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open this ${KIND_LABEL[candidate.type]} in a new tab`}
              className="srm-open"
            >
              <ExportOutlined aria-hidden="true" />
            </a>
          </span>
        </div>
        <div className="srm-row" role="row">
          <span role="rowheader" className="srm-label">Address</span>
          {/* Found by phone or email: the addresses may disagree, as in a house number typed one off */}
          <span role="cell"><Value value={match.address} differs={addressDiffers} /></span>
          <span role="cell"><Value value={candidate.address} differs={addressDiffers} /></span>
        </div>
        {FACTS.map(({ key, label, show, compare }) => (
          <div className="srm-row" role="row" key={key}>
            <span role="rowheader" className="srm-label">{label}</span>
            <span role="cell">
              <Value value={show ? show(match.row[key]) : match.row[key]} differs={differs(key, compare)} />
            </span>
            <span role="cell">
              <Value value={show ? show(candidate[key]) : candidate[key]} differs={differs(key, compare)} />
            </span>
          </div>
        ))}
      </div>

      <dl className="srm-outcomes">
        <dt>Same, link them</dt>
        <dd>
          {candidate.type === 'job'
            ? onRow(candidate)
              ? `The job moves from ${candidate.sheet_name} row ${candidate.row_number} to this row, and follows it from now on. That row stays on the sheet as the same job and isn't made into another one. What this row has replaces the job's values, empty cells leave them alone, and the client stays as it is.`
              : 'The row joins this job. What the sheet has replaces the job\'s values, empty cells leave them alone, and the client stays as it is.'
            : 'The row becomes a new job under this client. The client\'s details stay as they are.'}
        </dd>
        <dt>Keep separate</dt>
        <dd>
          The row becomes its own job and client, and this {candidate.type === 'job' ? 'job' : 'client'} isn't changed.
        </dd>
      </dl>
    </Modal>
  );
};

export default SheetRowMatchModal;
