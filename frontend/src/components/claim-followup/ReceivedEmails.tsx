import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, Tooltip, Popconfirm, message } from 'antd';
import {
  PaperClipOutlined, DownloadOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { emailIngestionService } from '../../services/emailIngestionService';
import { fileService } from '../../services/fileService';
import { getClaimDocumentType } from '../../constants/claimDocumentTypes';
import type { IngestionLog, ReceivedEmail } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import ReceivedEmailBody from './ReceivedEmailBody';
import { Pill } from '../common/ui';

dayjs.extend(relativeTime);


interface ReceivedEmailsProps {
  claimId: string;
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

/** Human-readable file size; sizes come from the `files` row in bytes. */
const formatSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  name: 'Name',
  manual: 'Manual',
  same_email: 'Same email',
};

const ReceivedEmails: React.FC<ReceivedEmailsProps> = ({ claimId }) => {
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

  const renderFiles = (files: IngestionLog[]) => files
    .filter((f) => f.file_id)
    .map((f) => {
      const docType = getClaimDocumentType(f.document_type);
      return (
        <Space key={f.id} size={6} style={{ display: 'flex', marginTop: 6 }}>
          <PaperClipOutlined className="cl-meta" />
          {docType && <Pill tone={docType.tone}>{docType.label}</Pill>}
          <span>{f.file_name || f.attachment_name}</span>
          {f.file_size ? <span className="cl-meta">{formatSize(f.file_size)}</span> : null}
          <Button
            size="small"
            type="text"
            icon={<DownloadOutlined />}
            onClick={() => window.open(fileService.getInlineUrl(f.file_id!), '_blank')}
          >
            Open
          </Button>
        </Space>
      );
    });

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
              {renderFiles(r.files)}
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
