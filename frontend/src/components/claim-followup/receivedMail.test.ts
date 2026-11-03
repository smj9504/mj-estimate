import { describe, expect, it } from 'vitest';
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';
import type { ReceivedEmail } from '../../types/emailIngestion';
import { receivedMailToShow, withoutLoggedCopies } from './receivedMail';

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
