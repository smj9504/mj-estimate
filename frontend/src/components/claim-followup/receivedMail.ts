import dayjs from 'dayjs';
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';
import type { IngestionLog, ReceivedAttachment, ReceivedEmail } from '../../types/emailIngestion';
import { ESTIMATE_DOCUMENT_TYPE, guessClaimDocumentType } from '../../constants/claimDocumentTypes';

/**
 * An attachment known only from its review log - mail from before every
 * message was stored - in the shape a stored email's attachments come in.
 */
export function attachmentFromLog(log: IngestionLog): ReceivedAttachment {
  const fileId = log.file_id || null;
  return {
    kind: 'pdf',
    name: log.file_name || log.attachment_name || 'attachment.pdf',
    log_id: log.id,
    file_id: fileId,
    size: log.file_size ?? null,
    content_type: log.file_content_type ?? 'application/pdf',
    status: log.status,
    document_type: log.status === 'uploaded' ? log.document_type ?? null : null,
    is_insurance_estimate: log.is_insurance_estimate ?? null,
    note: null,
    can_file: log.status === 'pending' && !!fileId,
  };
}

/** A PDF waiting for review that its name or the classifier says is the carrier's estimate */
export const looksLikeEstimate = (att: ReceivedAttachment): boolean =>
  att.can_file
  && guessClaimDocumentType(att.name, att.is_insurance_estimate ?? undefined) === ESTIMATE_DOCUMENT_TYPE;

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
