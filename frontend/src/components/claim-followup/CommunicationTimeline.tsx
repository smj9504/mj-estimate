import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Timeline, Tag, Typography, Space, Empty, Spin } from 'antd';
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
import type { CommunicationLog, SentEmail } from '../../types/claimFollowUp';

const { Text } = Typography;

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

const ToggleContent: React.FC<{ html?: string; text?: string; label?: string }> = ({ html, text, label = 'View content' }) => {
  const [open, setOpen] = useState(false);
  const content = html || text;
  if (!content) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <Text
        type="secondary"
        style={{ fontSize: 12, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(!open)}
      >
        {open ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        {' '}{label}
      </Text>
      {open && (
        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            background: '#fafafa',
            borderRadius: 6,
            border: '1px solid #f0f0f0',
            fontSize: 13,
            maxHeight: 300,
            overflow: 'auto',
            wordBreak: 'break-word',
          }}
          dangerouslySetInnerHTML={html ? { __html: html } : undefined}
        >
          {!html ? text : undefined}
        </div>
      )}
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

  if (commLoading || emailsLoading) {
    return <Spin size="small" />;
  }

  // Merge and sort by date
  type TimelineItem = {
    type: 'communication' | 'email';
    date: string;
    data: CommunicationLog | SentEmail;
  };

  const items: TimelineItem[] = [
    ...communications.map((c): TimelineItem => ({
      type: 'communication',
      date: c.created_at || '',
      data: c,
    })),
    ...sentEmails.map((e): TimelineItem => ({
      type: 'email',
      date: e.sent_at || e.created_at || '',
      data: e,
    })),
  ].sort((a, b) => dayjs(b.date).unix() - dayjs(a.date).unix());

  if (items.length === 0) {
    return <Empty description="No communications yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Timeline
      items={items.map((item) => {
        if (item.type === 'communication') {
          const comm = item.data as CommunicationLog;
          return {
            dot: COMM_ICONS[comm.communication_type] || <ClockCircleOutlined />,
            color: comm.response_received ? 'green' : comm.direction === 'outbound' ? 'blue' : 'gray',
            children: (
              <div>
                <Space size={4}>
                  <Tag color={comm.direction === 'outbound' ? 'blue' : 'green'}>
                    {comm.direction === 'outbound' ? 'Sent' : 'Received'}
                  </Tag>
                  <Tag>{comm.communication_type}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(comm.created_at).format('MM/DD/YYYY h:mm A')}
                  </Text>
                </Space>
                <div style={{ marginTop: 4 }}>
                  {comm.contact_name && <Text strong>{comm.contact_name} </Text>}
                  {comm.subject && <Text>- {comm.subject}</Text>}
                </div>
                {comm.summary && (
                  <ToggleContent text={comm.summary} label="View details" />
                )}
                {comm.response_received && (
                  <div style={{ marginTop: 4 }}>
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      Response received {comm.response_date ? dayjs(comm.response_date).format('MM/DD') : ''}
                    </Tag>
                    {comm.response_summary && (
                      <ToggleContent text={comm.response_summary} label="View reply" />
                    )}
                  </div>
                )}
              </div>
            ),
          };
        } else {
          const email = item.data as SentEmail;
          return {
            dot: <SendOutlined />,
            color: email.status === 'sent' ? 'blue' : email.status === 'failed' ? 'red' : 'gray',
            children: (
              <div>
                <Space size={4}>
                  <Tag color={email.status === 'sent' ? 'blue' : email.status === 'failed' ? 'red' : 'default'}>
                    {email.status.toUpperCase()}
                  </Tag>
                  {email.is_ai_generated && <Tag color="purple">AI</Tag>}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(email.sent_at || email.created_at).format('MM/DD/YYYY h:mm A')}
                  </Text>
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Text strong>To: {email.to_addresses.join(', ')}</Text>
                </div>
                <div>
                  <Text>Subject: {email.subject}</Text>
                </div>
                <ToggleContent html={email.body_html} label="View email" />
                {email.attachments?.length > 0 && (
                  <Space size={4} style={{ marginTop: 2 }}>
                    <PaperClipOutlined />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {email.attachments.length} attachment(s)
                    </Text>
                  </Space>
                )}
                {email.reply_received && (
                  <div style={{ marginTop: 4 }}>
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      Reply received {email.reply_received_at ? dayjs(email.reply_received_at).format('MM/DD') : ''}
                    </Tag>
                    {email.reply_summary && (
                      <ToggleContent text={email.reply_summary} label="View reply" />
                    )}
                  </div>
                )}
                {email.error_message && (
                  <Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                    Error: {email.error_message}
                  </Text>
                )}
              </div>
            ),
          };
        }
      })}
    />
  );
};

export default CommunicationTimeline;
