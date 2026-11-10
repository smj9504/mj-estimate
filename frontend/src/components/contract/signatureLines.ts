/**
 * What the signing screens share about signature lines. A line belongs to one
 * signer, so a mark may only be reused on that signer's own lines.
 */

import { humanize } from '../common/ui';
import type { SignatureFieldPlacement } from '../../types/contract';

type Line = Pick<SignatureFieldPlacement, 'fieldType' | 'signerRole'>;

export const CONSENT_TEXT =
  'I have reviewed the document and agree to sign it electronically. '
  + 'My electronic signature has the same legal effect as a handwritten signature.';

/** Consent when some of the customer's lines take their signature on file */
export const ON_FILE_CONSENT_TEXT =
  'I have reviewed the document and agree to sign it electronically, using my signature on file '
  + 'where it is shown. My electronic signature has the same legal effect as a handwritten signature.';

/** What the customer agrees to by keeping the signature they drew on file */
export const KEEP_ON_FILE_TEXT =
  'Keep my signature on file, so it can be used to sign my future documents for this property.';

/** Sent for a line the client's signature on file is to fill (backend contract/signature_on_file.py) */
export const ON_FILE = 'on_file';

/** What staff confirm before signing a client's lines with their signature on file, the client not there */
export const onFileAuthorization = (name: string) =>
  `${name || 'The client'} allowed us to sign this document with their signature on file.`;

/** The same signer's line of the same kind takes the same mark */
export const slotOf = (line: Line) => `${line.fieldType}.${line.signerRole}`;

export const lineLabel = (line: Line) =>
  `${humanize(line.signerRole)} ${line.fieldType === 'initial' ? 'initials' : 'signature'}`;

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(word => word[0]).join('').toUpperCase();

/**
 * What a customer signing from a link has to finish. They may well be alone, so
 * someone else's line can't hold them up. A document with no line marked as the
 * customer's needs all of them, or it could be submitted with no signature at all.
 */
export const requiredCustomerLines = <T extends Line>(lines: T[]): T[] => {
  const marks = lines.filter(line => line.fieldType !== 'date_signed');
  const own = marks.filter(line => line.signerRole === 'homeowner');
  return own.length > 0 ? own : marks;
};

/** Only someone at the company that issued a contract can sign for it */
export const canSignForCompany = (
  user: { role: string; all_companies?: boolean; company_ids?: string[] } | null | undefined,
  companyId: string,
) => !!user && (
  user.role === 'admin' || user.role === 'super_admin' || !!user.all_companies
  || !!user.company_ids?.includes(companyId)
);
