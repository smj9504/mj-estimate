import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, Tooltip, Popconfirm, message } from 'antd';
import { PaperClipOutlined, DisconnectOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { emailIngestionService } from '../../services/emailIngestionService';
import type { IngestionLog, ReceivedEmail } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import ReceivedEmailBody from './ReceivedEmailBody';
import ReceivedEmailAttachments, { type EmailEstimateAttachment } from './ReceivedEmailAttachments';
import { Pill } from '../common/ui';

dayjs.extend(relativeTime);


interface ReceivedEmailsProps {
  claimId: string;
  /** The claim's client, for filing an attachment on the claim */
  clientId?: string;
  /** Opens Add revision with an emailed PDF; left out where the claim has no carrier */
  onAddEstimate?: (attachment: EmailEstimateAttachment) => void;
}

/**
 * One inbound message. `email` is the stored message (any mail since
 * received_emails existed); older mail is known only through its
 * attachment logs, so `email` is absent for those rows.
 */
interface Row {
  key: string;
  email?: ReceivedEmail;
  subject?: string;
  sender?: string;
  received_at?: string;
  snippet?: string;
  match_method?: string;
  match_confidence?: number;
  /** Stored attachment files logged against this message for this claim. */
  files: IngestionLog[];
  /** Every attachment filename on the message, stored or not. */
  attachmentNames: string[];
}

/** Strip the angle-bracket display name so the address stays readable. */
const senderAddress = (sender?: string): string => {
  if (!sender) return '-';
  const match = sender.match(/<([^>]+)>/);
  return match ? match[1] : sender;
};

const MATCH_LABELS: Record<string, string> = {
  reply_thread: 'Reply',
  adjuster_email: 'Adjuster',
  claim_number: 'Claim #',
  policy_number: 'Policy #',
  address: 'Address',
  // Someone on the claim naming its street ("a supplement for larkspur")
  contact_street: 'Street',
  name: 'Name',
  manual: 'Manual',
  same_email: 'Same email',
};

/**
 * Search the inboxes for the claim's mail now — the morning poll may not have
 * seen a reply yet — and refresh the received list. Says how much was found.
 */
export const useClaimInboxCheck = (claimId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emailIngestionService.checkClaimInbox(claimId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['received-emails-claim', claimId] });
      queryClient.invalidateQueries({ queryKey: ['received-emails'] });
      // The check keeps the files of the claim's mail, older mail's too
      queryClient.invalidateQueries({ queryKey: ['received-attachments'] });
      queryClient.invalidateQueries({ queryKey: ['ingested-emails-claim', claimId] });
      if (result.skipped_reason) {
        message.info(result.skipped_reason);
        return;
      }
      const failed = result.errors.map((e) => e.account).join(', ');
      if (failed && !result.accounts_checked) {
        message.error(`Couldn't check ${failed}`);
        return;
      }
      const found = result.new_on_claim ?? 0;
      if (found) message.success(`${found} new email${found === 1 ? '' : 's'} on this claim`);
      else message.info('No new mail for this claim');
      if (failed) message.warning(`Couldn't check ${failed}`);
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Inbox check failed'),
  });
};

const ReceivedEmails: React.FC<ReceivedEmailsProps> = ({ claimId, clientId, onAddEstimate }) => {
  const queryClient = useQueryClient();

  const { data: received, isLoading: emailsLoading } = useQuery({
    queryKey: ['received-emails-claim', claimId],
    queryFn: () => emailIngestionService.listReceived({ claim_id: claimId, limit: 200 }),
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['ingested-emails-claim', claimId],
    queryFn: () => emailIngestionService.listLogsByClaim(claimId),
  });

  const unlinkMutation = useMutation({
    mutationFn: (emailId: string) => emailIngestionService.assignReceived(emailId, null),
    onSuccess: () => {
      message.success('Email unlinked from this claim');
      queryClient.invalidateQueries({ queryKey: ['received-emails-claim', claimId] });
      queryClient.invalidateQueries({ queryKey: ['received-emails'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Unlink failed'),
  });

  // Merge by message_id: stored messages first, then any attachment-only
  // history from before every message was kept.
  const rows: Row[] = React.useMemo(() => {
    const filesByMessage = new Map<string, IngestionLog[]>();
    logs.forEach((log) => {
      const key = log.message_id || `__log__${log.id}`;
      const list = filesByMessage.get(key);
      if (list) list.push(log);
      else filesByMessage.set(key, [log]);
    });

    const result: Row[] = (received?.items || []).map((email) => {
      const files = filesByMessage.get(email.message_id) || [];
      filesByMessage.delete(email.message_id);
      return {
        key: email.id,
        email,
        subject: email.subject,
        sender: email.sender,
        received_at: email.received_at,
        snippet: email.snippet,
        match_method: email.match_method,
        match_confidence: email.match_confidence,
        files,
        attachmentNames: email.attachment_names,
      };
    });

    filesByMessage.forEach((files, key) => {
      const head = files.find((f) => f.match_method) || files[0];
      result.push({
        key,
        subject: head.subject,
        sender: head.sender,
        received_at: head.received_at,
        match_method: head.match_method,
        match_confidence: head.match_confidence,
        files,
        attachmentNames: files.map((f) => f.file_name || f.attachment_name || '').filter(Boolean),
      });
    });

    return result.sort((a, b) =>
      dayjs(b.received_at || 0).valueOf() - dayjs(a.received_at || 0).valueOf());
  }, [received, logs]);

  const isLoading = emailsLoading || logsLoading;

  if (rows.length === 0 && !isLoading) {
    return <div className="cl-empty">No received emails.</div>;
  }

  const columns: ColumnsType<Row> = [
    {
      title: 'Received',
      dataIndex: 'received_at',
      width: 120,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <span className="cl-nowrap">{dayjs(d).fromNow()}</span>
        </Tooltip>
      ) : '-',
    },
    {
      title: 'From',
      dataIndex: 'sender',
      width: 200,
      ellipsis: true,
      render: (s?: string) => (
        <Tooltip title={s}>
          <span className="cl-meta">{senderAddress(s)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Subject',
      ellipsis: true,
      render: (_, r) => (
        <Tooltip title={r.subject}>
          <span className="cl-subject-text">{r.subject || '(no subject)'}</span>
          {r.snippet && <span className="cl-meta"> — {r.snippet}</span>}
        </Tooltip>
      ),
    },
    {
      title: '',
      width: 50,
      align: 'center',
      render: (_, r) => r.attachmentNames.length ? (
        <Tooltip title={r.attachmentNames.join(', ')}>
          <Space size={2}>
            <PaperClipOutlined className="cl-meta" />
            <span className="cl-meta">{r.attachmentNames.length}</span>
          </Space>
        </Tooltip>
      ) : null,
    },
    {
      title: 'Matched',
      width: 100,
      render: (_, r) => {
        if (!r.match_method) return '-';
        const manual = r.match_method === 'manual';
        return (
          <Tooltip
            title={
              r.match_confidence != null
                ? `${r.match_method} (${r.match_confidence}%)`
                : r.match_method
            }
          >
            <span><Pill tone={manual ? 'blue' : 'gray'}>{MATCH_LABELS[r.match_method] || r.match_method}</Pill></span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Table<Row>
      rowKey="key"
      size="small"
      loading={isLoading}
      dataSource={rows}
      columns={columns}
      pagination={rows.length > 20 ? { pageSize: 20, size: 'small' } : false}
      className="cl-table"
      scroll={{ x: 640 }}
      expandable={{
        expandRowByClick: true,
        rowExpandable: (r) => !!r.email || r.files.some((f) => f.file_id),
        expandedRowRender: (r) => (
          <div>
            {r.email && <ReceivedEmailBody emailId={r.email.id} />}
            <div style={{ padding: '0 8px 4px' }}>
              {(r.email ? r.attachmentNames.length > 0 : r.files.length > 0) && (
                <ReceivedEmailAttachments
                  claimId={claimId}
                  clientId={clientId}
                  emailId={r.email?.id}
                  logs={r.email ? undefined : r.files.filter((f) => f.file_id)}
                  receivedAt={r.received_at}
                  sender={r.sender}
                  onAddEstimate={onAddEstimate}
                />
              )}
              {r.email && (
                <Popconfirm
                  title="Unlink this email from the claim?"
                  onConfirm={() => unlinkMutation.mutate(r.email!.id)}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<DisconnectOutlined />}
                    style={{ marginTop: 8 }}
                  >
                    Not this claim
                  </Button>
                </Popconfirm>
              )}
            </div>
          </div>
        ),
      }}
      locale={{
        emptyText: (
          <div className="cl-empty">No received emails.</div>
        ),
      }}
    />
  );
};

export default ReceivedEmails;
