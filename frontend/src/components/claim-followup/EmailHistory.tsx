import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Tag, Button, Space, Typography, Tooltip, Modal, Input,
  Empty, Badge, Popover,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, MailOutlined,
  ExclamationCircleOutlined, SendOutlined, MessageOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import type { SentEmail } from '../../types/claimFollowUp';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Text } = Typography;
const { TextArea } = Input;

interface EmailHistoryProps {
  claimId: string;
}

const EmailHistory: React.FC<EmailHistoryProps> = ({ claimId }) => {
  const queryClient = useQueryClient();
  const [replyModalEmail, setReplyModalEmail] = useState<SentEmail | null>(null);
  const [replySummary, setReplySummary] = useState('');
  const [expandedBody, setExpandedBody] = useState<string | null>(null);

  const { data: emails = [], isLoading } = useQuery({
    queryKey: ['sent-emails-claim', claimId],
    queryFn: () => claimFollowUpService.getSentEmailsByClaimId(claimId),
  });

  const markReplyMutation = useMutation({
    mutationFn: ({ emailId, summary }: { emailId: string; summary?: string }) =>
      claimFollowUpService.markReply(emailId, summary),
    onSuccess: () => {
      setReplyModalEmail(null);
      setReplySummary('');
      queryClient.invalidateQueries({ queryKey: ['sent-emails-claim', claimId] });
    },
  });

  if (emails.length === 0 && !isLoading) {
    return <Empty description="No emails sent yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const columns: ColumnsType<SentEmail> = [
    {
      title: 'Sent', dataIndex: 'sent_at', width: 130,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).fromNow()}</Text>
        </Tooltip>
      ) : '-',
      sorter: (a, b) => dayjs(a.sent_at).unix() - dayjs(b.sent_at).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'To', dataIndex: 'to_addresses', ellipsis: true,
      render: (addrs: string[]) => (
        <Text style={{ fontSize: 12 }}>{addrs?.join(', ')}</Text>
      ),
    },
    {
      title: 'Subject', dataIndex: 'subject', ellipsis: true,
      render: (subj: string, record) => (
        <Popover
          title={subj}
          content={
            <div style={{ maxWidth: 400, maxHeight: 300, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: record.body_html || '' }} />
          }
          trigger="click"
        >
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }}>
            {subj}
          </Button>
        </Popover>
      ),
    },
    {
      title: 'Status', width: 80, align: 'center',
      render: (_, r) => {
        if (r.status === 'failed') return <Tag color="red">Failed</Tag>;
        if (r.status === 'sent') return <Tag color="blue" icon={<CheckCircleOutlined />}>Sent</Tag>;
        return <Tag>{r.status}</Tag>;
      },
    },
    {
      title: 'Reply', width: 110, align: 'center',
      render: (_, r) => {
        if (r.reply_received) {
          return (
            <Tooltip title={
              <div>
                <div>Received: {r.reply_received_at ? dayjs(r.reply_received_at).format('MM/DD HH:mm') : ''}</div>
                {r.reply_summary && <div>Summary: {r.reply_summary}</div>}
              </div>
            }>
              <Tag color="green" icon={<MessageOutlined />}>Replied</Tag>
            </Tooltip>
          );
        }
        if (r.status === 'sent') {
          return (
            <Button
              type="dashed"
              size="small"
              icon={<ClockCircleOutlined />}
              onClick={() => { setReplyModalEmail(r); setReplySummary(''); }}
              style={{ fontSize: 11 }}
            >
              Mark Reply
            </Button>
          );
        }
        return '-';
      },
    },
  ];

  return (
    <>
      <Table
        dataSource={emails}
        columns={columns}
        rowKey="id"
        size="small"
        loading={isLoading}
        pagination={false}
        rowClassName={(r) => r.reply_received ? '' : r.status === 'sent' ? 'email-awaiting' : ''}
      />

      {/* Mark Reply Modal */}
      <Modal
        title={
          <Space>
            <MessageOutlined />
            <span>Mark Reply Received</span>
          </Space>
        }
        open={!!replyModalEmail}
        onOk={() => {
          if (replyModalEmail) {
            markReplyMutation.mutate({
              emailId: replyModalEmail.id,
              summary: replySummary || undefined,
            });
          }
        }}
        onCancel={() => setReplyModalEmail(null)}
        confirmLoading={markReplyMutation.isPending}
        okText="Mark as Replied"
      >
        {replyModalEmail && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">Subject: </Text>
            <Text>{replyModalEmail.subject}</Text>
            <br />
            <Text type="secondary">To: </Text>
            <Text>{replyModalEmail.to_addresses?.join(', ')}</Text>
            <br />
            <Text type="secondary">Sent: </Text>
            <Text>{replyModalEmail.sent_at ? dayjs(replyModalEmail.sent_at).format('MM/DD/YYYY h:mm A') : '-'}</Text>
          </div>
        )}
        <TextArea
          rows={3}
          placeholder="Reply summary (optional) - What did they say?"
          value={replySummary}
          onChange={e => setReplySummary(e.target.value)}
        />
      </Modal>

      <style>{`
        .email-awaiting {
          background-color: #fffbe6 !important;
        }
      `}</style>
    </>
  );
};

export default EmailHistory;
