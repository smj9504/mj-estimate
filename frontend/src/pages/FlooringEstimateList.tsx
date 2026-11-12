/**
 * Flooring estimates: each job's address, client, status and total, newest
 * first. A new one opens straight on its sketch.
 */

import React, { useState } from 'react';
import {
  Button, Card, Empty, Grid, Input, List, Popconfirm, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import flooringEstimateService from '../services/flooringEstimateService';
import type { FlooringEstimate } from '../types/flooringEstimate';

const { Text } = Typography;

export const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  calculated: 'blue',
  approved: 'green',
  exported: 'purple',
};

const money = (n: number | null | undefined) =>
  `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const address = (e: FlooringEstimate) =>
  [e.property_address, e.city, e.state].filter(Boolean).join(', ') || 'No address yet';

const FlooringEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['flooring-estimates', { search, status, page }],
    queryFn: () => flooringEstimateService.list({
      search: search || undefined, status, page, page_size: pageSize,
    }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['flooring-estimates'] });

  const create = useMutation({
    mutationFn: () => flooringEstimateService.create({ project_type: 'insurance' }),
    onSuccess: (est) => navigate(`/flooring-estimates/${est.id}?tab=sketch`),
    onError: () => message.error("The estimate couldn't be created"),
  });
  const clone = useMutation({
    mutationFn: (id: string) => flooringEstimateService.clone(id),
    onSuccess: (est) => {
      refresh();
      message.success('Copied');
      navigate(`/flooring-estimates/${est.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => flooringEstimateService.delete(id),
    onSuccess: () => {
      refresh();
      message.success('Deleted');
    },
  });

  const actions = (e: FlooringEstimate) => (
    <Space size={4} onClick={(ev) => ev.stopPropagation()}>
      <Button size="small" icon={<CopyOutlined />} aria-label="Copy" onClick={() => clone.mutate(e.id)} />
      <Popconfirm title="Delete this estimate?" okText="Delete" okButtonProps={{ danger: true }}
        onConfirm={() => remove.mutate(e.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" />
      </Popconfirm>
    </Space>
  );

  const columns = [
    {
      title: 'Property',
      key: 'property',
      render: (_: unknown, e: FlooringEstimate) => <Text strong>{address(e)}</Text>,
    },
    {
      title: 'Client / Claim',
      key: 'client',
      render: (_: unknown, e: FlooringEstimate) => (
        <span>
          {e.client_name || <Text type="secondary">—</Text>}
          {e.claim_number && <Text type="secondary"> · #{e.claim_number}</Text>}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string) => <Tag color={STATUS_COLORS[s] || 'default'}>{s}</Tag>,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 140,
      align: 'right' as const,
      render: (t: number) => money(t),
    },
    {
      title: 'Updated',
      key: 'updated',
      width: 120,
      render: (_: unknown, e: FlooringEstimate) => {
        const when = e.updated_at || e.created_at;
        return when ? new Date(when).toLocaleDateString() : '';
      },
    },
    { title: '', key: 'actions', width: 90, render: (_: unknown, e: FlooringEstimate) => actions(e) },
  ];

  return (
    <div style={{ padding: isMobile ? 0 : 24 }}>
      <Card
        title="Flooring Estimates"
        extra={(
          <Button type="primary" icon={<PlusOutlined />} loading={create.isPending} onClick={() => create.mutate()}
            data-testid="new-flooring-estimate">
            {isMobile ? 'New' : 'New Estimate'}
          </Button>
        )}
        styles={isMobile ? { header: { padding: '0 12px' }, body: { padding: 12 } } : undefined}
      >
        <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row', marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search address or zip"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ maxWidth: isMobile ? undefined : 320 }}
          />
          <Select
            allowClear
            placeholder="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            style={{ width: isMobile ? '100%' : 150 }}
            options={Object.keys(STATUS_COLORS).map((s) => ({ value: s, label: s }))}
          />
        </div>

        {isMobile ? (
          <List
            loading={isLoading}
            dataSource={data?.items || []}
            locale={{ emptyText: <Empty description="No flooring estimates yet" /> }}
            pagination={data && data.total > pageSize ? {
              current: page, pageSize, total: data.total, onChange: setPage, size: 'small',
            } : false}
            renderItem={(e) => (
              <List.Item onClick={() => navigate(`/flooring-estimates/${e.id}`)} style={{ cursor: 'pointer' }} extra={actions(e)}>
                <List.Item.Meta
                  title={address(e)}
                  description={(
                    <Space size={6} wrap>
                      <Tag color={STATUS_COLORS[e.status] || 'default'}>{e.status}</Tag>
                      <Text strong>{money(e.total)}</Text>
                      {e.client_name && <Text type="secondary">{e.client_name}</Text>}
                    </Space>
                  )}
                />
              </List.Item>
            )}
          />
        ) : (
          <Table
            rowKey="id"
            loading={isLoading}
            columns={columns}
            dataSource={data?.items || []}
            locale={{ emptyText: <Empty description="No flooring estimates yet" /> }}
            onRow={(e) => ({ onClick: () => navigate(`/flooring-estimates/${e.id}`), style: { cursor: 'pointer' } })}
            pagination={{ current: page, pageSize, total: data?.total || 0, onChange: setPage, showSizeChanger: false }}
          />
        )}
      </Card>
    </div>
  );
};

export default FlooringEstimateList;
