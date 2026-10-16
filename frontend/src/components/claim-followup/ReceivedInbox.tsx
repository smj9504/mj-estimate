import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Table, Tag, Button, Space, Typography, Tooltip, Input, Switch, Modal, message,
} from 'antd';
import { PaperClipOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { emailIngestionService } from '../../services/emailIngestionService';
import type { ReceivedEmail } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import ClaimSearchSelect from '../common/ClaimSearchSelect';
import ReceivedEmailBody from './ReceivedEmailBody';

const { Text } = Typography;

const PAGE_SIZE = 25;

/** Strip the display name so the address stays readable. */
const senderLabel = (sender?: string): string => {
  if (!sender) return '-';
  const name = sender.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  if (name) return name;
  const match = sender.match(/<([^>]+)>/);
  return match ? match[1] : sender;
};

/**
 * Every inbound message from the polled accounts, newest first. Messages
 * the matcher couldn't place on a claim are linked here by hand.
 */
const ReceivedInbox: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [assigning, setAssigning] = useState<ReceivedEmail | null>(null);
  const [assignClaimId, setAssignClaimId] = useState<string | undefined>();

  const { data, isFetching } = useQuery({
    queryKey: ['received-emails', search, unmatchedOnly, page],
    queryFn: () => emailIngestionService.listReceived({
      search: search || undefined,
      unmatched: unmatchedOnly || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, claimId }: { id: string; claimId: string }) =>
      emailIngestionService.assignReceived(id, claimId),
    onSuccess: () => {
      message.success('Email linked to claim');
      setAssigning(null);
      setAssignClaimId(undefined);
      queryClient.invalidateQueries({ queryKey: ['received-emails'] });
      queryClient.invalidateQueries({ queryKey: ['received-emails-claim'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Link failed'),
  });

  const openAssign = (email: ReceivedEmail) => {
    setAssigning(email);
    setAssignClaimId(email.matched_claim_id);
  };

  const columns: ColumnsType<ReceivedEmail> = [
    {
      title: 'Date',
      dataIndex: 'received_at',
      width: 110,
      render: (d?: string) => d ? (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).format('MM/DD HH:mm')}</Text>
        </Tooltip>
      ) : '-',
    },
    {
      title: 'From',
      dataIndex: 'sender',
      width: 180,
      ellipsis: true,
      render: (s?: string) => (
        <Tooltip title={s}>
          <Text style={{ fontSize: 12 }}>{senderLabel(s)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Subject',
      ellipsis: true,
      render: (_, r) => (
        <Tooltip title={r.subject}>
          <Text strong style={{ fontSize: 12 }}>{r.subject || '(no subject)'}</Text>
          {r.snippet && (
            <Text type="secondary" style={{ fontSize: 12 }}> — {r.snippet}</Text>
          )}
        </Tooltip>
      ),
    },
    {
      title: '',
      width: 44,
      align: 'center',
      render: (_, r) => r.attachment_names.length ? (
        <Tooltip title={r.attachment_names.join(', ')}>
          <PaperClipOutlined style={{ fontSize: 12, color: '#73726e' }} />
        </Tooltip>
      ) : null,
    },
    {
      title: 'Claim',
      width: 220,
      ellipsis: true,
      render: (_, r) => r.matched_claim_id ? (
        <Tooltip
          title={r.match_method
            ? `${r.match_method}${r.match_confidence != null ? ` (${r.match_confidence}%)` : ''}`
            : undefined}
        >
          <Space size={4}>
            <Text style={{ fontSize: 12 }}>{r.client_name || '-'}</Text>
            {r.claim_number && (
              <Text type="secondary" style={{ fontSize: 11 }}>#{r.claim_number}</Text>
            )}
          </Space>
        </Tooltip>
      ) : r.client_name ? (
        <Tooltip title="Client matched, claim not picked">
          <Tag style={{ fontSize: 11 }}>{r.client_name}</Tag>
        </Tooltip>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>Unmatched</Text>
      ),
    },
    {
      title: '',
      width: 90,
      align: 'center',
      render: (_, r) => (
        <Button
          size="small"
          icon={<LinkOutlined />}
          onClick={(e) => { e.stopPropagation(); openAssign(r); }}
          style={{ fontSize: 11 }}
        >
          {r.matched_claim_id ? 'Change' : 'Link'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="Search subject, sender, text"
          style={{ width: 280 }}
          onSearch={(v) => { setSearch(v.trim()); setPage(1); }}
        />
        <Space size={6}>
          <Switch
            size="small"
            checked={unmatchedOnly}
            onChange={(v) => { setUnmatchedOnly(v); setPage(1); }}
          />
          <Text style={{ fontSize: 13 }}>Unmatched only</Text>
        </Space>
      </Space>

      <Table<ReceivedEmail>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data?.items || []}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: data?.total || 0,
          showSizeChanger: false,
          showTotal: (t) => `Total: ${t} emails`,
          onChange: setPage,
        }}
        expandable={{
          expandRowByClick: true,
          expandedRowRender: (r) => <ReceivedEmailBody emailId={r.id} />,
        }}
      />

      <Modal
        title="Link email to claim"
        open={!!assigning}
        onCancel={() => { setAssigning(null); setAssignClaimId(undefined); }}
        onOk={() => assigning && assignClaimId
          && assignMutation.mutate({ id: assigning.id, claimId: assignClaimId })}
        okButtonProps={{ disabled: !assignClaimId }}
        confirmLoading={assignMutation.isPending}
      >
        {assigning && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text strong>{assigning.subject || '(no subject)'}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{assigning.sender}</Text>
          </div>
        )}
        <ClaimSearchSelect
          style={{ width: '100%' }}
          value={assignClaimId}
          onChange={(id) => setAssignClaimId(id)}
        />
      </Modal>
    </>
  );
};

export default ReceivedInbox;
