/**
 * What an emailed attachment is to its claim, chosen when a reviewer
 * confirms it in Email Ingestion. Mirrors ClaimDocumentType in
 * backend/app/domains/email_ingestion/schemas.py. Only the insurance
 * estimate becomes a negotiation revision; the rest are filed on the claim.
 */
import type { TagTone } from '../styles/tokens';

export interface ClaimDocumentTypeOption {
  value: string;
  label: string;
  tone: TagTone;
}

export const ESTIMATE_DOCUMENT_TYPE = 'insurance-estimate';

export const CLAIM_DOCUMENT_TYPES: ClaimDocumentTypeOption[] = [
  { value: ESTIMATE_DOCUMENT_TYPE, label: 'Insurance estimate', tone: 'red' },
  { value: 'scope-of-loss', label: 'Scope / summary of loss', tone: 'orange' },
  { value: 'carrier-letter', label: 'Carrier letter (coverage, denial, payment)', tone: 'yellow' },
  { value: 'proof-of-loss', label: 'Proof of loss / appraisal', tone: 'brown' },
  { value: 'photo-report', label: 'Photo report', tone: 'pink' },
  { value: 'sketch', label: 'Sketch / measurements', tone: 'blue' },
  { value: 'report', label: 'Inspection / engineer report', tone: 'purple' },
  { value: 'contract', label: 'Contract / authorization', tone: 'green' },
  { value: 'invoice', label: 'Invoice / bid', tone: 'green' },
  { value: 'other', label: 'Other', tone: 'gray' },
];

const BY_VALUE = new Map(CLAIM_DOCUMENT_TYPES.map((t) => [t.value, t]));

export const getClaimDocumentType = (value?: string | null) =>
  (value ? BY_VALUE.get(value) : undefined);

// Checked in order: the first hit wins, so "Photo Report" is a photo report
// before it is a report, and "Xactimate sketch" a sketch before an estimate.
const FILENAME_GUESSES: [RegExp, string][] = [
  [/summary of loss|\bscope\b/, 'scope-of-loss'],
  [/proof of loss|\bappraisal\b/, 'proof-of-loss'],
  [/\bphotos?\b/, 'photo-report'],
  [/\bsketch\b|eagle ?view|\bmeasurements?\b/, 'sketch'],
  [/\bletter\b|\bdenial\b|\bcoverage\b|reservation of rights|\bror\b|\bpayment\b/, 'carrier-letter'],
  [/\bcontract\b|\bagreement\b|\bewa\b|\bcos\b|\bcoc\b|certificate|authori[sz]ation/, 'contract'],
  [/\binvoice\b|\bproposal\b|\bbid\b|\bcomparative\b/, 'invoice'],
  [/\bestimate\b|\bsupplement\b|xactimate|\besx\b/, ESTIMATE_DOCUMENT_TYPE],
  [/\breport\b/, 'report'],
];

/**
 * A starting point for the reviewer, from what the file is called. Falls
 * back to an estimate only when the classifier scored the PDF as one;
 * otherwise leaves the choice empty rather than guess a revision.
 */
export const guessClaimDocumentType = (
  attachmentName?: string,
  isInsuranceEstimate?: boolean,
): string | undefined => {
  const name = (attachmentName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  const hit = FILENAME_GUESSES.find(([pattern]) => pattern.test(name));
  if (hit) return hit[1];
  return isInsuranceEstimate ? ESTIMATE_DOCUMENT_TYPE : undefined;
};
