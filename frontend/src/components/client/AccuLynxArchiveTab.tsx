import React, { useMemo } from 'react';
import {
  Collapse, Descriptions, Empty, Spin, Tag, Typography, Space, Button, Table, List, Tabs,
} from 'antd';
import { FolderOpenOutlined, MailOutlined, MessageOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  acculynxArchiveService,
  type AccuLynxArchivedJob,
  type AccuLynxArchivedMessage,
} from '../../services/acculynxArchiveService';

const { Text, Paragraph } = Typography;

const formatCurrency = (amount?: number) =>
  amount == null ? '-' : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value?: string) => (value ? dayjs(value).format('MM/DD/YYYY') : '-');

const MILESTONE_COLORS: Record<string, string> = {
  Lead: 'default',
  Prospect: 'blue',
  Approved: 'cyan',
  Completed: 'green',
  Invoiced: 'gold',
  Closed: 'purple',
};

const DriveButton: React.FC<{ job: AccuLynxArchivedJob; size?: 'small' | 'middle' }> = ({ job, size = 'small' }) =>
  job.drive_url ? (
    <Button
      size={size}
      icon={<FolderOpenOutlined />}
      href={job.drive_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      Open documents in Google Drive
    </Button>
  ) : null;

/** One thread = all messages sharing a thread id, oldest first. */
const MessageThreads: React.FC<{ messages: AccuLynxArchivedMessage[] }> = ({ messages }) => {
  const threads = useMemo(() => {
    const byThread = new Map<string, AccuLynxArchivedMessage[]>();
    messages.forEach((m) => {
      const list = byThread.get(m.thread_id) || [];
      list.push(m);
      byThread.set(m.thread_id, list);
    });
    return Array.from(byThread.values()).sort(
      (a, b) => dayjs(b[b.length - 1].sent_at).valueOf() - dayjs(a[a.length - 1].sent_at).valueOf(),
    );
  }, [messages]);

  if (!threads.length) return <Empty description="No messages" image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return (
    <Collapse
      size="small"
      items={threads.map((thread) => {
        const last = thread[thread.length - 1];
        const isEmail = (last.message_type || '').toLowerCase() === 'email';
        return {
          key: thread[0].thread_id,
          label: (
            <Space size={8} wrap>
              {isEmail ? <MailOutlined /> : <MessageOutlined />}
              <Text strong>{thread[0].subject || last.message_type || 'Message'}</Text>
              <Text type="secondary">
                {thread.length > 1 ? `${thread.length} messages · ` : ''}
                {formatDate(last.sent_at)}
              </Text>
            </Space>
          ),
          children: (
            <List
              itemLayout="vertical"
              dataSource={thread}
              renderItem={(m) => (
                <List.Item key={m.id}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={8} wrap>
                      <Text strong>{m.sender_name || m.sender_email || 'Unknown'}</Text>
                      {m.sender_email && m.sender_name && <Text type="secondary">{m.sender_email}</Text>}
                      <Text type="secondary">{m.sent_at ? dayjs(m.sent_at).format('MM/DD/YYYY h:mm A') : ''}</Text>
                    </Space>
                    {m.recipients.length > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        To: {m.recipients.filter((r) => r.type === 'to').map((r) => r.email || r.name).join(', ')}
                        {m.recipients.some((r) => r.type === 'cc') &&
                          ` · Cc: ${m.recipients.filter((r) => r.type === 'cc').map((r) => r.email || r.name).join(', ')}`}
                      </Text>
                    )}
                    <Paragraph style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                      {m.body_text || <Text type="secondary">(no text)</Text>}
                    </Paragraph>
                    {m.attachments.length > 0 && (
                      <Space size={4} wrap>
                        <PaperClipOutlined />
                        {m.attachments.map((a, i) => (
                          <Tag key={i}>{a.name}</Tag>
                        ))}
                      </Space>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          ),
        };
      })}
    />
  );
};

const JobDetail: React.FC<{ job: AccuLynxArchivedJob }> = ({ job }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['acculynx-archive-job', job.id],
    queryFn: () => acculynxArchiveService.getJob(job.id),
  });

  if (isLoading || !data) return <Spin />;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
        <Descriptions.Item label="Insurance">{data.insurance_company || '-'}</Descriptions.Item>
        <Descriptions.Item label="Claim #">{data.claim_number || '-'}</Descriptions.Item>
        <Descriptions.Item label="Date of loss">{formatDate(data.date_of_loss)}</Descriptions.Item>
        <Descriptions.Item label="Adjuster">
          {[data.adjuster_name, data.adjuster_phone, data.adjuster_email].filter(Boolean).join(' · ') || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="Damage">{data.damage_location || '-'}</Descriptions.Item>
        <Descriptions.Item label="Trades">{data.trade_types || '-'}</Descriptions.Item>
        <Descriptions.Item label="Approved value">{formatCurrency(data.approved_job_value)}</Descriptions.Item>
        <Descriptions.Item label="Received">{formatCurrency(data.total_received)}</Descriptions.Item>
        <Descriptions.Item label="Balance due">{formatCurrency(data.balance_due)}</Descriptions.Item>
      </Descriptions>

      <Tabs
        size="small"
        items={[
          {
            key: 'messages',
            label: `Messages (${data.messages.length})`,
            children: <MessageThreads messages={data.messages} />,
          },
          {
            key: 'documents',
            label: `Documents (${data.documents.length})`,
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <DriveButton job={data} size="middle" />
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={data.documents}
                  columns={[
                    { title: 'Folder', dataIndex: 'folder_name', key: 'folder', width: 200 },
                    { title: 'Name', dataIndex: 'name', key: 'name' },
                    { title: 'Uploaded by', dataIndex: 'uploaded_by', key: 'by', width: 150, render: (v) => v || '-' },
                    { title: 'Date', dataIndex: 'uploaded_at', key: 'date', width: 110, render: formatDate },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'payments',
            label: `Payments (${data.payments.length})`,
            children: (
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={data.payments}
                columns={[
                  { title: 'Date', dataIndex: 'date', key: 'date', width: 110, render: formatDate },
                  { title: 'From', dataIndex: 'from', key: 'from', render: (v) => v || '-' },
                  { title: 'Check #', dataIndex: 'check_number', key: 'check', width: 110, render: (v) => v || '-' },
                  { title: 'Amount', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: formatCurrency },
                ]}
              />
            ),
          },
        ]}
      />
    </Space>
  );
};

interface AccuLynxArchiveTabProps {
  jobs: AccuLynxArchivedJob[];
  isLoading?: boolean;
}

/** Read-only history of this client's jobs from AccuLynx (account closed). */
const AccuLynxArchiveTab: React.FC<AccuLynxArchiveTabProps> = ({ jobs, isLoading }) => {
  if (isLoading) return <Spin />;
  if (!jobs.length) return <Empty description="No AccuLynx history" />;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Text type="secondary">
        Jobs from AccuLynx, kept for reference. Read-only — documents are in Google Drive.
      </Text>
      <Collapse
        items={jobs.map((job) => ({
          key: job.id,
          label: (
            <Space size={8} wrap>
              <Text strong>{job.job_name || job.address || 'AccuLynx job'}</Text>
              {job.job_number && <Text type="secondary">#{job.job_number}</Text>}
              {job.milestone && <Tag color={MILESTONE_COLORS[job.milestone] || 'default'}>{job.milestone}</Tag>}
              <Text type="secondary">
                {[job.address, job.city, job.state].filter(Boolean).join(', ')} · {formatDate(job.job_created_at)}
              </Text>
            </Space>
          ),
          extra: <DriveButton job={job} />,
          children: <JobDetail job={job} />,
        }))}
      />
    </Space>
  );
};

export default AccuLynxArchiveTab;
