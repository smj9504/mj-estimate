import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Tag, Button, Space, Typography, Tooltip, Modal, Input,
  Empty, Badge, Popover,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, MailOutlined,
  ExclamationCircleOutlined, SendOutlined, MessageOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { claimFollowUpService } from '../../services/claimFollowUpService';
import type { SentEmail } from '../../types/claimFollowUp';
import type { ColumnsType } from 'antd/es/table';
import { useSheetModal } from '../common/ui';

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
  const { isPhone, sheetProps } = useSheetModal();

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

  const renderStatus = (r: SentEmail) => {
    if (r.status === 'failed') return <Tag color="red">Failed</Tag>;
    if (r.status === 'sent') return <Tag color="blue" icon={<CheckCircleOutlined />}>Sent</Tag>;
    return <Tag>{r.status}</Tag>;
  };

  const renderOpened = (r: SentEmail) => {
    if (r.opened_at) {
      return (
        <Tooltip title={
          <div>
            <div>First opened: {dayjs(r.opened_at).format('MM/DD HH:mm')}</div>
            {r.last_opened_at && r.last_opened_at !== r.opened_at && (
              <div>Last opened: {dayjs(r.last_opened_at).format('MM/DD HH:mm')}</div>
            )}
            <div>Opens: {r.open_count}</div>
          </div>
        }>
          <Tag color="green" icon={<EyeOutlined />}>Read</Tag>
        </Tooltip>
      );
    }
    if (r.status === 'sent') {
      // No opens recorded. Distinguish "recipient hasn't opened it" from
      // "we never attached the pixel", which would otherwise both read
      // as Unread and be silently indistinguishable.
      if (r.tracking_pixel_sent === false) {
        return (
          <Tooltip title="No tracking pixel was attached to this email, so opens could not be recorded. This says nothing about whether the recipient read it.">
            <Tag color="orange">Not tracked</Tag>
          </Tooltip>
        );
      }
      return (
        <Tooltip title={
          r.tracking_pixel_sent
            ? 'Tracking pixel was attached but never loaded. Most mail clients block remote images, so this does not prove the email is unread.'
            : 'Sent before open tracking was recorded, so it is unknown whether a tracking pixel was attached.'
        }>
          <Tag icon={<EyeOutlined />}>Unread</Tag>
        </Tooltip>
      );
    }
    return '-';
  };

  const columns: ColumnsType<SentEmail> = [
    {
      title: 'Sent', dataIndex: 'sent_at', width: 130,
      responsive: ['md'],
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
      responsive: ['md'],
      render: (addrs: string[]) => (
        <Text style={{ fontSize: 12 }}>{addrs?.join(', ')}</Text>
      ),
    },
    {
      title: 'Subject', dataIndex: 'subject', ellipsis: !isPhone,
      render: (subj: string, record) => {
        const link = (
          <Popover
            title={subj}
            content={
              <div style={{ maxWidth: 'min(400px, 80vw)', maxHeight: 300, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: record.body_html || '' }} />
            }
            trigger="click"
          >
            <Button
              type="link"
              size="small"
              style={isPhone
                ? { padding: 0, fontSize: 12, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }
                : { padding: 0, fontSize: 12 }}
            >
              {subj}
            </Button>
          </Popover>
        );
        if (!isPhone) return link;
        // Phones fold Sent, To, Status and Opened under the subject
        return (
          <>
            {link}
            <div>
              <Text type="secondary" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                {[record.sent_at && dayjs(record.sent_at).fromNow(), record.to_addresses?.join(', ')]
                  .filter(Boolean).join(' · ')}
              </Text>
            </div>
            <Space size={4} wrap style={{ marginTop: 4 }}>
              {renderStatus(record)}
              {renderOpened(record)}
            </Space>
          </>
        );
      },
    },
    {
      title: 'Status', width: 80, align: 'center',
      responsive: ['md'],
      render: (_, r) => renderStatus(r),
    },
    {
      title: 'Opened', width: 90, align: 'center',
      responsive: ['md'],
      render: (_, r) => renderOpened(r),
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
        {...sheetProps}
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
          background-color: #fbf3db !important;
        }
      `}</style>
    </>
  );
};

export default EmailHistory;
