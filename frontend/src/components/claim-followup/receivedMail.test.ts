import { describe, expect, it } from 'vitest';
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';
import type { IngestionLog, ReceivedAttachment, ReceivedEmail } from '../../types/emailIngestion';
import {
  attachmentFromLog, looksLikeEstimate, receivedMailToShow, withoutLoggedCopies,
} from './receivedMail';

const mail = (over: Partial<ReceivedEmail>): ReceivedEmail => ({
  id: 'r1',
  email_account_id: 'a1',
  message_id: '<r1@carrier>',
  sender: 'Pat Adjuster <pat@carrier.com>',
  received_at: '2026-11-02T14:00:00+00:00',
  attachment_names: [],
  ...over,
});

const sent = (over: Partial<SentEmail>): SentEmail => ({
  id: 's1',
  claim_id: 'c1',
  from_address: 'us@company.com',
  to_addresses: ['pat@carrier.com'],
  cc_addresses: [],
  subject: 'Follow up',
  body_html: '',
  attachments: [],
  is_ai_generated: false,
  status: 'sent',
  reply_received: false,
  open_count: 0,
  smtp_message_id: '<ours@company>',
  ...over,
});

const log = (over: Partial<CommunicationLog>): CommunicationLog => ({
  id: 'l1',
  claim_id: 'c1',
  communication_type: 'email',
  direction: 'inbound',
  response_received: true,
  contact_email: 'Pat Adjuster <pat@carrier.com>',
  response_date: '2026-11-02T14:00:00Z',
  ...over,
});

describe('receivedMailToShow', () => {
  it('lists every message on the claim when no task is chosen', () => {
    const unrelated = mail({ id: 'r2', message_id: '<r2@carrier>' });
    expect(receivedMailToShow([unrelated], [sent({})])).toEqual([unrelated]);
  });

  it('leaves out a copy of our own email that reached another inbox', () => {
    const copy = mail({ message_id: '<ours@company>' });
    expect(receivedMailToShow([copy], [sent({})])).toEqual([]);
  });

  it('keeps a task to replies in its own thread, however far down', () => {
    const reply = mail({ id: 'r1', message_id: '<r1@carrier>', in_reply_to: '<ours@company>' });
    const later = mail({
      id: 'r2',
      message_id: '<r2@carrier>',
      in_reply_to: '<r1@carrier>',
      received_at: '2026-11-02T16:00:00+00:00',
    });
    const other = mail({ id: 'r3', message_id: '<r3@carrier>', in_reply_to: '<elsewhere@x>' });
    const noParent = mail({ id: 'r4', message_id: '<r4@carrier>' });

    const shown = receivedMailToShow([later, other, reply, noParent], [sent({})], 'task-1');

    expect(shown.map(r => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('withoutLoggedCopies', () => {
  it('drops the tracker line for a message already listed, whatever the date format', () => {
    expect(withoutLoggedCopies([log({})], [mail({})])).toEqual([]);
  });

  it('keeps log lines with no stored message behind them', () => {
    const another = log({ response_date: '2026-11-01T14:00:00Z' });
    const someoneElse = log({ contact_email: 'other@carrier.com' });
    const outbound = log({ direction: 'outbound' });
    const call = log({ communication_type: 'phone' });

    const all = [another, someoneElse, outbound, call];
    expect(withoutLoggedCopies(all, [mail({})])).toEqual(all);
  });
});

const reviewLog = (over: Partial<IngestionLog>): IngestionLog => ({
  id: 'l1',
  email_account_id: 'a1',
  message_id: '<r1@carrier>',
  attachment_name: 'Estimate.pdf',
  status: 'pending',
  claim_created: false,
  file_id: 'f1',
  ...over,
});

describe('attachmentFromLog', () => {
  it('can file a stored PDF still waiting for review', () => {
    const att = attachmentFromLog(reviewLog({ file_name: 'Final Estimate.pdf', file_size: 2048 }));
    expect(att).toMatchObject({
      kind: 'pdf', name: 'Final Estimate.pdf', log_id: 'l1', file_id: 'f1', size: 2048, can_file: true,
    });
  });

  it('shows what a filed one was filed as, and offers no filing', () => {
    const att = attachmentFromLog(reviewLog({ status: 'uploaded', document_type: 'carrier-letter' }));
    expect(att).toMatchObject({ document_type: 'carrier-letter', can_file: false });
  });

  it('has nothing to open without a stored file', () => {
    expect(attachmentFromLog(reviewLog({ file_id: undefined }))).toMatchObject({ file_id: null, can_file: false });
  });
});

describe('looksLikeEstimate', () => {
  const att = (over: Partial<ReceivedAttachment>): ReceivedAttachment => ({
    kind: 'pdf', name: 'file.pdf', can_file: true, ...over,
  });

  it('goes by the name first', () => {
    expect(looksLikeEstimate(att({ name: 'Xactimate Estimate - Rev 2.pdf' }))).toBe(true);
    // A photo report is not the estimate, whatever the classifier scored
    expect(looksLikeEstimate(att({ name: 'Photo Report.pdf', is_insurance_estimate: true }))).toBe(false);
  });

  it('falls back to the classifier for a name that says nothing', () => {
    expect(looksLikeEstimate(att({ name: '6315 Cardinal Hill.pdf', is_insurance_estimate: true }))).toBe(true);
    expect(looksLikeEstimate(att({ name: '6315 Cardinal Hill.pdf', is_insurance_estimate: false }))).toBe(false);
  });

  it('is only said of a PDF that can still be filed', () => {
    expect(looksLikeEstimate(att({ name: 'Estimate.pdf', can_file: false }))).toBe(false);
  });
});
