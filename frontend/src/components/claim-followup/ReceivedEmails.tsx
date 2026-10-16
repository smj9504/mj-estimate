import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Tag, Button, Space, Typography, Tooltip, Empty, Popconfirm, message } from 'antd';
import {
  PaperClipOutlined, DownloadOutlined, InboxOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { emailIngestionService } from '../../services/emailIngestionService';
import { fileService } from '../../services/fileService';
import type { IngestionLog, ReceivedEmail } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import ReceivedEmailBody from './ReceivedEmailBody';

dayjs.extend(relativeTime);

const { Text } = Typography;

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
  claim_number: 'Claim #',
  policy_number: 'Policy #',
  address: 'Address',
  name: 'Name',
  manual: 'Manual',
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
    return (
      <Empty
        description="No received emails"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const columns: ColumnsType<Row> = [
    {
      title: 'Received',
      dataIndex: 'received_at',
      width: 120,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).fromNow()}</Text>
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
          <Text style={{ fontSize: 12 }}>{senderAddress(s)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Subject',
      ellipsis: true,
      render: (_, r) => (
        <Tooltip title={r.subject}>
          <Text style={{ fontSize: 12 }}>{r.subject || '(no subject)'}</Text>
          {r.snippet && (
            <Text type="secondary" style={{ fontSize: 12 }}> — {r.snippet}</Text>
          )}
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
            <PaperClipOutlined style={{ fontSize: 11, color: '#73726e' }} />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.attachmentNames.length}</Text>
          </Space>
        </Tooltip>
      ) : null,
    },
    {
      title: 'Matched',
      width: 90,
      align: 'center',
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
            <Tag color={manual ? 'blue' : 'green'} style={{ fontSize: 11 }}>
              {MATCH_LABELS[r.match_method] || r.match_method}
            </Tag>
          </Tooltip>
        );
      },
    },
  ];

  const renderFiles = (files: IngestionLog[]) => files
    .filter((f) => f.file_id)
    .map((f) => (
      <Space key={f.id} size={6} style={{ display: 'flex', marginTop: 6 }}>
        <PaperClipOutlined style={{ fontSize: 11, color: '#73726e' }} />
        <Text style={{ fontSize: 12 }}>{f.file_name || f.attachment_name}</Text>
        {f.file_size ? (
          <Text type="secondary" style={{ fontSize: 11 }}>{formatSize(f.file_size)}</Text>
        ) : null}
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => window.open(fileService.getInlineUrl(f.file_id!), '_blank')}
          style={{ fontSize: 11 }}
        >
          Open
        </Button>
      </Space>
    ));

  return (
    <Table<Row>
      rowKey="key"
      size="small"
      loading={isLoading}
      dataSource={rows}
      columns={columns}
      pagination={rows.length > 20 ? { pageSize: 20, size: 'small' } : false}
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
                    style={{ fontSize: 11, marginTop: 8 }}
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
          <Space direction="vertical" size={4} style={{ padding: 12 }}>
            <InboxOutlined style={{ fontSize: 20, color: '#a5a29a' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              No received emails
            </Text>
          </Space>
        ),
      }}
    />
  );
};

export default ReceivedEmails;
