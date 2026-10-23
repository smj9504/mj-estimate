/**
 * Mail received about a water mitigation job — adjuster replies, carrier
 * notices — for deciding whether a follow-up is needed at all. Stored mail
 * shows at once; the follow-up dialog also searches the inboxes again, since
 * the regular poll only runs in the morning.
 */

import React, { useEffect, useState } from 'react';
import { Button, Spin, Tooltip, Typography } from 'antd';
import { MailOutlined, PaperClipOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  adjusterEmailService,
  type WMAdjusterEmail,
  type WMAdjusterEmails,
  type WMAdjusterInboxCheck,
} from '../../services/waterMitigationService';
import ReceivedEmailBody from '../claim-followup/ReceivedEmailBody';
import { Pill } from '../common/ui';

dayjs.extend(relativeTime);

const { Text } = Typography;

const PREVIEW_COUNT = 3;

/** '"Pat Lee" <pat@carrier.com>' -> 'Pat Lee'; a bare address stays as is. */
export const senderName = (sender?: string): string => {
  if (!sender) return 'Unknown sender';
  const match = sender.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  return match ? match[1] : sender;
};

/**
 * The job's stored mail, and an inbox check that refreshes it. One query key
 * for both places it shows, so a check from the follow-up dialog also lands
 * in the job's history.
 */
export const useAdjusterEmails = (jobId: string, enabled = true) => {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['wm-adjuster-emails', jobId],
    queryFn: () => adjusterEmailService.getAdjusterEmails(jobId),
    enabled: enabled && !!jobId,
  });
  const check = useMutation({
    mutationFn: () => adjusterEmailService.checkAdjusterEmails(jobId),
    onSuccess: (result) => {
      queryClient.setQueryData<WMAdjusterEmails>(['wm-adjuster-emails', jobId], {
        items: result.items,
        adjuster_addresses: result.adjuster_addresses,
      });
    },
  });
  return { emails: query.data?.items || [], isLoading: query.isLoading, check };
};

interface EmailRowProps {
  email: WMAdjusterEmail;
  expanded: boolean;
  onToggle: () => void;
}

const EmailRow: React.FC<EmailRowProps> = ({ email, expanded, onToggle }) => (
  <div style={{ padding: '6px 0', borderTop: '1px solid #efeeec' }}>
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>{senderName(email.sender)}</Text>
        {email.from_adjuster && <Pill tone="blue">Adjuster</Pill>}
        {email.attachment_names.length > 0 && (
          <Tooltip title={email.attachment_names.join(', ')}>
            <PaperClipOutlined style={{ color: '#73726e' }} />
          </Tooltip>
        )}
        {email.received_at && (
          <Tooltip title={dayjs(email.received_at).format('YYYY-MM-DD h:mm A')}>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {dayjs(email.received_at).format('MMM D')} · {dayjs(email.received_at).fromNow()}
            </Text>
          </Tooltip>
        )}
      </div>
      <div style={{ fontSize: 13 }}>{email.subject || '(no subject)'}</div>
      {!expanded && email.snippet && (
        <div
          style={{
            fontSize: 12,
            color: '#73726e',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {email.snippet}
        </div>
      )}
    </div>
    {expanded && <ReceivedEmailBody emailId={email.id} />}
  </div>
);

interface AdjusterEmailsPanelProps {
  jobId: string;
  /** The inboxes are searched each time this turns true (the dialog opening). */
  open: boolean;
  /** After each inbox check that went through */
  onChecked?: (result: WMAdjusterInboxCheck) => void;
}

/** Received mail for the follow-up dialog, newest first, checked on open. */
const AdjusterEmailsPanel: React.FC<AdjusterEmailsPanelProps> = ({ jobId, open, onChecked }) => {
  const { emails, isLoading, check } = useAdjusterEmails(jobId, open);
  const { mutate: runCheck, reset: resetCheck } = check;
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      runCheck();
    } else {
      setShowAll(false);
      setExpandedId(null);
      resetCheck();
    }
  }, [open, jobId, runCheck, resetCheck]);

  const result = check.data;
  useEffect(() => {
    if (result) onChecked?.(result);
  }, [result, onChecked]);
  const failures = result?.errors || [];
  let status: React.ReactNode = null;
  if (check.isPending) {
    status = <><Spin size="small" /><Text type="secondary">Checking inbox…</Text></>;
  } else if (check.isError) {
    status = <Text type="danger">Inbox check failed</Text>;
  } else if (result?.skipped_reason) {
    status = <Text type="secondary">{result.skipped_reason}</Text>;
  } else if (result && failures.length > 0) {
    status = (
      <Tooltip title={failures.map((f) => `${f.account}: ${f.error}`).join('\n')}>
        <Text type="warning">
          {failures.length} of {result.accounts_checked + failures.length} inboxes couldn't be checked
        </Text>
      </Tooltip>
    );
  } else if (result) {
    status = <Text type="secondary">Inbox checked {dayjs(result.checked_at).format('h:mm A')}</Text>;
  }

  const shown = showAll ? emails : emails.slice(0, PREVIEW_COUNT);

  return (
    <div style={{
      background: '#fafaf9', border: '1px solid #e7e5e4',
      borderRadius: 6, padding: '8px 12px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <MailOutlined style={{ color: '#1f74c9' }} />
        <Text strong style={{ fontSize: 13 }}>Received emails</Text>
        {emails.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{emails.length}</Text>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          {status}
          {!check.isPending && (
            <Button
              size="small"
              type="link"
              icon={<ReloadOutlined />}
              onClick={() => runCheck()}
              style={{ padding: 0 }}
            >
              Check again
            </Button>
          )}
        </span>
      </div>

      {emails.length === 0 ? (
        !isLoading && !check.isPending && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            No emails from the adjuster or about this claim.
          </Text>
        )
      ) : (
        <>
          {shown.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              expanded={expandedId === email.id}
              onToggle={() => setExpandedId(expandedId === email.id ? null : email.id)}
            />
          ))}
          {emails.length > PREVIEW_COUNT && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${emails.length}`}
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default AdjusterEmailsPanel;
