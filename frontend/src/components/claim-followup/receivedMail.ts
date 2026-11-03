import dayjs from 'dayjs';
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';
import type { ReceivedEmail } from '../../types/emailIngestion';

/**
 * The stored inbound mail a communication history lists. A copy of our own
 * email delivered to another connected inbox isn't inbound. With a task chosen,
 * only mail following that task's emails stays: the rest is about the claim.
 */
export function receivedMailToShow(
  received: ReceivedEmail[],
  sentEmails: SentEmail[],
  taskId?: string,
): ReceivedEmail[] {
  const sentIds = new Set(sentEmails.flatMap(e => (e.smtp_message_id ? [e.smtp_message_id] : [])));
  const inbound = received.filter(r => !sentIds.has(r.message_id));
  if (!taskId) return inbound;

  // Oldest first, so a reply to a reply finds its parent already in the thread
  const thread = new Set(sentIds);
  return [...inbound]
    .sort((a, b) => dayjs(a.received_at).valueOf() - dayjs(b.received_at).valueOf())
    .filter((r) => {
      if (!r.in_reply_to || !thread.has(r.in_reply_to)) return false;
      thread.add(r.message_id);
      return true;
    });
}

const messageKey = (sender?: string, date?: string) =>
  `${sender ?? ''}|${date ? dayjs(date).valueOf() : ''}`;

/**
 * Takes out the log lines the reply tracker wrote for messages already listed
 * as received mail. The tracker and the inbox poll read the same From and Date
 * headers, and the stored message has the whole body where the log has a summary.
 */
export function withoutLoggedCopies(
  communications: CommunicationLog[],
  shownMail: ReceivedEmail[],
): CommunicationLog[] {
  const shown = new Set(shownMail.map(r => messageKey(r.sender, r.received_at)));
  return communications.filter(c => !(
    c.communication_type === 'email'
    && c.direction === 'inbound'
    && shown.has(messageKey(c.contact_email, c.response_date))
  ));
}
