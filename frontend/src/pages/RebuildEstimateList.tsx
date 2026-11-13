/**
 * Rebuild estimates: each job's address, client, what went into it and its
 * total, newest first.
 */

import React, { useState } from 'react';
import { Button, Card, Empty, Grid, Input, List, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import rebuildEstimateService from '../services/rebuildEstimateService';
import type { RebuildEstimate } from '../types/rebuildEstimate';
import { money } from '../components/rebuild-estimate/lineEdit';

const { Text } = Typography;

const address = (e: RebuildEstimate) =>
  [e.property_address, e.city, e.state].filter(Boolean).join(', ') || 'No address yet';

const RebuildEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = !Grid.useBreakpoint().md;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['rebuild-estimates', { search, page }],
    queryFn: () => rebuildEstimateService.list({ search: search || undefined, page, page_size: pageSize }),
  });
  const create = useMutation({
    mutationFn: () => rebuildEstimateService.create({}),
    onSuccess: (est) => navigate(`/rebuild-estimates/${est.id}`),
    onError: () => message.error("The estimate couldn't be created"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => rebuildEstimateService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rebuild-estimates'] });
      message.success('Deleted');
    },
  });

  const madeOf = (e: RebuildEstimate) => (
    <Space size={4} wrap>
      {(e.source_labels || []).map((label) => <Tag key={label}>{label}</Tag>)}
    </Space>
  );
  const actions = (e: RebuildEstimate) => (
    <span onClick={(ev) => ev.stopPropagation()}>
      <Popconfirm title="Delete this estimate?" okText="Delete" okButtonProps={{ danger: true }}
        onConfirm={() => remove.mutate(e.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" />
      </Popconfirm>
    </span>
  );

  return (
    <div style={{ padding: isMobile ? 0 : 24 }}>
      <Card
        title="Rebuild Estimates"
        extra={(
          <Button type="primary" icon={<PlusOutlined />} loading={create.isPending} onClick={() => create.mutate()}
            data-testid="new-rebuild-estimate">
            {isMobile ? 'New' : 'New Estimate'}
          </Button>
        )}
        styles={isMobile ? { header: { padding: '0 12px' }, body: { padding: 12 } } : undefined}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          One estimate for the whole rebuild: the flooring, bathroom and kitchen estimates brought in, and the
          other repairs added room by room.
        </Text>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search address or zip"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ maxWidth: isMobile ? undefined : 320, marginBottom: 16 }}
        />
        {isMobile ? (
          <List
            loading={isLoading}
            dataSource={data?.items || []}
            locale={{ emptyText: <Empty description="No rebuild estimates yet" /> }}
            renderItem={(e) => (
              <List.Item onClick={() => navigate(`/rebuild-estimates/${e.id}`)} style={{ cursor: 'pointer' }} extra={actions(e)}>
                <List.Item.Meta title={address(e)} description={(
                  <Space size={6} wrap><Text strong>{money(e.total)}</Text>{madeOf(e)}</Space>
                )} />
              </List.Item>
            )}
          />
        ) : (
          <Table
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items || []}
            locale={{ emptyText: <Empty description="No rebuild estimates yet" /> }}
            onRow={(e) => ({ onClick: () => navigate(`/rebuild-estimates/${e.id}`), style: { cursor: 'pointer' } })}
            pagination={{ current: page, pageSize, total: data?.total || 0, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: 'Property', key: 'property', render: (_: unknown, e: RebuildEstimate) => <Text strong>{address(e)}</Text> },
              {
                title: 'Client / Claim',
                key: 'client',
                render: (_: unknown, e: RebuildEstimate) => (
                  <span>
                    {e.client_name || <Text type="secondary">—</Text>}
                    {e.claim_number && <Text type="secondary"> · #{e.claim_number}</Text>}
                  </span>
                ),
              },
              { title: 'Made of', key: 'sources', render: (_: unknown, e: RebuildEstimate) => madeOf(e) },
              {
                title: 'Total', dataIndex: 'total', key: 'total', width: 140, align: 'right' as const,
                render: (t: number) => money(t),
              },
              { title: '', key: 'actions', width: 60, render: (_: unknown, e: RebuildEstimate) => actions(e) },
            ]}
          />
        )}
      </Card>
    </div>
  );
};

export default RebuildEstimateList;
