import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Button, Space, Typography, Tooltip, Empty } from 'antd';
import {
  PaperClipOutlined, DownloadOutlined, InboxOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { emailIngestionService } from '../../services/emailIngestionService';
import type { IngestionLog } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Text } = Typography;

interface ReceivedEmailsProps {
  claimId: string;
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

const ReceivedEmails: React.FC<ReceivedEmailsProps> = ({ claimId }) => {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['ingested-emails-claim', claimId],
    queryFn: () => emailIngestionService.listLogsByClaim(claimId),
  });

  if (logs.length === 0 && !isLoading) {
    return (
      <Empty
        description="No received emails with attachments"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const columns: ColumnsType<IngestionLog> = [
    {
      title: 'Received',
      dataIndex: 'received_at',
      width: 130,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).fromNow()}</Text>
        </Tooltip>
      ) : '-',
      sorter: (a, b) =>
        dayjs(a.received_at || 0).unix() - dayjs(b.received_at || 0).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'From',
      dataIndex: 'sender',
      ellipsis: true,
      render: (s?: string) => (
        <Tooltip title={s}>
          <Text style={{ fontSize: 12 }}>{senderAddress(s)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Subject',
      dataIndex: 'subject',
      ellipsis: true,
      render: (s?: string) => (
        <Tooltip title={s}>
          <Text style={{ fontSize: 12 }}>{s || '(no subject)'}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Attachment',
      width: 240,
      render: (_, r) => {
        const name = r.file_name || r.attachment_name;
        if (!name) return '-';
        return (
          <Space size={4}>
            <PaperClipOutlined style={{ fontSize: 11, color: '#8c8c8c' }} />
            <Tooltip title={name}>
              <Text style={{ fontSize: 12, maxWidth: 150 }} ellipsis>
                {name}
              </Text>
            </Tooltip>
            {r.file_size ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {formatSize(r.file_size)}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: 'Matched',
      width: 110,
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
              {manual ? 'Manual' : r.match_method}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '',
      width: 100,
      align: 'center',
      render: (_, r) => r.file_id ? (
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() =>
            window.open(`/api/files/download/${r.file_id}?inline=true`, '_blank')
          }
          style={{ fontSize: 11 }}
        >
          Open
        </Button>
      ) : null,
    },
  ];

  return (
    <Table<IngestionLog>
      rowKey="id"
      size="small"
      loading={isLoading}
      dataSource={logs}
      columns={columns}
      pagination={false}
      locale={{
        emptyText: (
          <Space direction="vertical" size={4} style={{ padding: 12 }}>
            <InboxOutlined style={{ fontSize: 20, color: '#bfbfbf' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              No received emails with attachments
            </Text>
          </Space>
        ),
      }}
    />
  );
};

export default ReceivedEmails;
