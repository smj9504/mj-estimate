import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Skeleton, Timeline } from 'antd';
import {
  MailOutlined,
  PhoneOutlined,
  MessageOutlined,
  UserOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SendOutlined,
  PaperClipOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import { emailIngestionService } from '../../services/emailIngestionService';
import { Pill, humanize, type TagTone } from '../common/ui';
import { tagTones } from '../../styles/tokens';
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';
import type { ReceivedEmail } from '../../types/emailIngestion';
import ReceivedEmailBody from './ReceivedEmailBody';
import { receivedMailToShow, withoutLoggedCopies } from './receivedMail';
import { sanitizeHtml } from '../../utils/safeHtml';

interface CommunicationTimelineProps {
  claimId: string;
  taskId?: string;
}

const COMM_ICONS: Record<string, React.ReactNode> = {
  email: <MailOutlined />,
  phone: <PhoneOutlined />,
  text: <MessageOutlined />,
  in_person: <UserOutlined />,
  other: <ClockCircleOutlined />,
};

const EMAIL_STATUS_TONES: Record<string, TagTone> = {
  sent: 'blue',
  queued: 'gray',
  sending: 'gray',
  draft: 'gray',
  failed: 'red',
  bounced: 'red',
};

/** Timeline dots take the tone's text colour so they match the pills */
const dotColor = (tone: TagTone) => tagTones[tone].text;

const ToggleContent: React.FC<{
  html?: string;
  text?: string;
  label?: string;
  children?: React.ReactNode;
}> = ({ html, text, label = 'View content', children }) => {
  const [open, setOpen] = useState(false);
  const content = html || text;
  if (!content && !children) return null;
  return (
    <div className="fu-comm-toggle">
      <Button
        type="text"
        size="small"
        className="ui-icon-btn fu-comm-toggle-btn"
        icon={open ? <DownOutlined /> : <RightOutlined />}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {open && (children || (
        <div
          className="fu-comm-content"
          dangerouslySetInnerHTML={html ? { __html: sanitizeHtml(html) } : undefined}
        >
          {!html ? text : undefined}
        </div>
      ))}
    </div>
  );
};

const CommunicationTimeline: React.FC<CommunicationTimelineProps> = ({ claimId, taskId }) => {
  const { data: communications = [], isLoading: commLoading } = useQuery({
    queryKey: ['communications', taskId || claimId],
    queryFn: () =>
      taskId
        ? claimFollowUpService.getCommunicationsByTaskId(taskId)
        : claimFollowUpService.getCommunicationsByClaimId(claimId),
  });

  const { data: sentEmails = [], isLoading: emailsLoading } = useQuery({
    queryKey: ['sent-emails', taskId || claimId],
    queryFn: () =>
      taskId
        ? claimFollowUpService.getSentEmailsByTaskId(taskId)
        : claimFollowUpService.getSentEmailsByClaimId(claimId),
  });

  // Mail the inbox poll filed on this claim. The reply tracker only logs the
  // first reply to each email, and only from the inbox that sent it, so later
  // replies and mail that came in another way exist nowhere else.
  const { data: received, isLoading: receivedLoading } = useQuery({
    queryKey: ['received-emails-claim', claimId],
    queryFn: () => emailIngestionService.listReceived({ claim_id: claimId, limit: 200 }),
  });

  if (commLoading || emailsLoading || receivedLoading) {
    return <Skeleton active title={false} paragraph={{ rows: 4 }} style={{ padding: '8px 0' }} />;
  }

  // Merge and sort by date
  type TimelineItem = {
    type: 'communication' | 'email' | 'received';
    date: string;
    data: CommunicationLog | SentEmail | ReceivedEmail;
  };

  const receivedMail = receivedMailToShow(received?.items || [], sentEmails, taskId);

  const items: TimelineItem[] = [
    ...withoutLoggedCopies(communications, receivedMail).map((c): TimelineItem => ({
      type: 'communication',
      date: c.created_at || '',
      data: c,
    })),
    ...sentEmails.map((e): TimelineItem => ({
      type: 'email',
      date: e.sent_at || e.created_at || '',
      data: e,
    })),
    ...receivedMail.map((r): TimelineItem => ({
      type: 'received',
      date: r.received_at || r.created_at || '',
      data: r,
    })),
  ].sort((a, b) => dayjs(b.date).unix() - dayjs(a.date).unix());

  if (items.length === 0) {
    return <p className="fu-empty">No communications yet</p>;
  }

  return (
    <Timeline
      className="fu-comm"
      items={items.map((item) => {
        if (item.type === 'received') {
          const mail = item.data as ReceivedEmail;
          return {
            dot: <MailOutlined />,
            color: dotColor('green'),
            children: (
              <div className="fu-comm-item">
                <div className="fu-comm-head">
                  <Pill tone="green">Received</Pill>
                  <span className="fu-comm-kind">Email</span>
                  <time className="fu-comm-time">{dayjs(item.date).format('MM/DD/YYYY h:mm A')}</time>
                </div>
                <div className="fu-comm-line fu-comm-subject">{mail.subject || '(no subject)'}</div>
                <div className="fu-comm-meta">From {mail.sender || 'unknown sender'}</div>
                {mail.attachment_names?.length > 0 && (
                  <div className="fu-comm-meta">
                    <PaperClipOutlined aria-hidden="true" /> {mail.attachment_names.length} attachment(s)
                  </div>
                )}
                <ToggleContent label="View email">
                  <ReceivedEmailBody emailId={mail.id} />
                </ToggleContent>
              </div>
            ),
          };
        }
        if (item.type === 'communication') {
          const comm = item.data as CommunicationLog;
          const outbound = comm.direction === 'outbound';
          return {
            dot: COMM_ICONS[comm.communication_type] || <ClockCircleOutlined />,
            color: dotColor(comm.response_received ? 'green' : outbound ? 'blue' : 'gray'),
            children: (
              <div className="fu-comm-item">
                <div className="fu-comm-head">
                  <Pill tone={outbound ? 'blue' : 'green'}>{outbound ? 'Sent' : 'Received'}</Pill>
                  <span className="fu-comm-kind">{humanize(comm.communication_type)}</span>
                  <time className="fu-comm-time">{dayjs(comm.created_at).format('MM/DD/YYYY h:mm A')}</time>
                </div>
                {(comm.contact_name || comm.subject) && (
                  <div className="fu-comm-line">
                    {comm.contact_name && <strong>{comm.contact_name}</strong>}
                    {comm.contact_name && comm.subject && ' — '}
                    {comm.subject}
                  </div>
                )}
                {comm.summary && <ToggleContent text={comm.summary} label="View details" />}
                {comm.response_received && (
                  <div className="fu-comm-reply">
                    <Pill tone="green" icon={<CheckCircleOutlined />}>
                      Response received {comm.response_date ? dayjs(comm.response_date).format('MM/DD') : ''}
                    </Pill>
                    {comm.response_summary && <ToggleContent text={comm.response_summary} label="View reply" />}
                  </div>
                )}
              </div>
            ),
          };
        }
        const email = item.data as SentEmail;
        const tone = EMAIL_STATUS_TONES[email.status] || 'gray';
        return {
          dot: <SendOutlined />,
          color: dotColor(tone),
          children: (
            <div className="fu-comm-item">
              <div className="fu-comm-head">
                <Pill tone={tone}>{humanize(email.status)}</Pill>
                {email.is_ai_generated && <Pill tone="purple">AI</Pill>}
                <time className="fu-comm-time">{dayjs(email.sent_at || email.created_at).format('MM/DD/YYYY h:mm A')}</time>
              </div>
              <div className="fu-comm-line fu-comm-subject">{email.subject}</div>
              <div className="fu-comm-meta">To {email.to_addresses.join(', ')}</div>
              {email.attachments?.length > 0 && (
                <div className="fu-comm-meta">
                  <PaperClipOutlined aria-hidden="true" /> {email.attachments.length} attachment(s)
                </div>
              )}
              <ToggleContent html={email.body_html} label="View email" />
              {email.reply_received && (
                <div className="fu-comm-reply">
                  <Pill tone="green" icon={<CheckCircleOutlined />}>
                    Reply received {email.reply_received_at ? dayjs(email.reply_received_at).format('MM/DD') : ''}
                  </Pill>
                  {email.reply_summary && <ToggleContent text={email.reply_summary} label="View reply" />}
                </div>
              )}
              {email.error_message && (
                <p className="fu-comm-error">Error: {email.error_message}</p>
              )}
            </div>
          ),
        };
      })}
    />
  );
};

export default CommunicationTimeline;
