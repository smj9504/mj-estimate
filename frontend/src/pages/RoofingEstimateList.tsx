import React, { useState } from 'react';
import {
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Popconfirm,
  Row,
  Col,
  Grid,
  List,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  CopyOutlined,
  FilePdfOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { roofingEstimateService } from '../services/roofingEstimateService';
import type { RoofingEstimate } from '../types/roofingEstimate';
import { STATUS_COLORS } from '../types/roofingEstimate';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const RoofingEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['roofing-estimates', { search, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      roofingEstimateService.list({
        search: search || undefined,
        status: statusFilter,
        page,
        page_size: pageSize,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => roofingEstimateService.delete(id),
    onSuccess: () => {
      message.success('Estimate deleted');
      queryClient.invalidateQueries({ queryKey: ['roofing-estimates'] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) => roofingEstimateService.clone(id),
    onSuccess: (result) => {
      message.success('Estimate cloned');
      navigate(`/roofing-estimates/${result.id}`);
    },
  });

  const handleCreate = async () => {
    try {
      const result = await roofingEstimateService.create({});
      navigate(`/roofing-estimates/${result.id}`);
    } catch {
      message.error('Failed to create estimate');
    }
  };

  const columns = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      key: 'address',
      render: (addr: string, record: RoofingEstimate) => (
        <a onClick={() => navigate(`/roofing-estimates/${record.id}`)}>
          {addr || 'No address'}
        </a>
      ),
    },
    {
      title: 'Roof',
      key: 'roof',
      render: (_: any, record: RoofingEstimate) => {
        const sq = record.squares ? `${record.squares.toFixed(1)} SQ` : '';
        const pitch = record.predominant_pitch || '';
        return [sq, pitch].filter(Boolean).join(' / ') || '-';
      },
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      key: 'client',
      render: (name: string) => name || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>
          {status?.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      align: 'right' as const,
      render: (total: number) =>
        total ? `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) =>
        date ? new Date(date).toLocaleDateString() : '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: RoofingEstimate) => (
        <Space size="small">
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={() => roofingEstimateService.exportPdf(record.id)}
            disabled={record.status === 'draft'}
          />
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => cloneMutation.mutate(record.id)}
          />
          <Popconfirm
            title="Delete this estimate?"
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileItem = (record: RoofingEstimate) => {
    const sq = record.squares ? `${record.squares.toFixed(1)} SQ` : '';
    const pitch = record.predominant_pitch || '';
    const roofLabel = [sq, pitch].filter(Boolean).join(' / ');

    return (
      <List.Item
        style={{ padding: '12px 0' }}
        actions={[
          <Dropdown
            key="actions"
            menu={{
              items: [
                {
                  key: 'pdf',
                  icon: <FilePdfOutlined />,
                  label: 'Export PDF',
                  disabled: record.status === 'draft',
                  onClick: () => roofingEstimateService.exportPdf(record.id),
                },
                {
                  key: 'clone',
                  icon: <CopyOutlined />,
                  label: 'Clone',
                  onClick: () => cloneMutation.mutate(record.id),
                },
                { type: 'divider' as const },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    if (window.confirm('Delete this estimate?')) {
                      deleteMutation.mutate(record.id);
                    }
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} />
          </Dropdown>,
        ]}
      >
        <div
          style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
          onClick={() => navigate(`/roofing-estimates/${record.id}`)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Tag color={STATUS_COLORS[record.status] || 'default'}>{record.status?.toUpperCase()}</Tag>
            {roofLabel && <Text type="secondary" style={{ fontSize: 12 }}>{roofLabel}</Text>}
          </div>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
            {record.property_address || 'No address'}
          </Text>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {record.client_name && (
              <Text type="secondary" style={{ fontSize: 12 }}>{record.client_name}</Text>
            )}
            {record.total ? (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                ${record.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
            ) : null}
            {record.created_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(record.created_at).toLocaleDateString()}
              </Text>
            )}
          </div>
        </div>
      </List.Item>
    );
  };

  return (
    <div style={{ padding: isMobile ? '0' : '24px' }}>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>Roofing Estimates</Title>}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {isMobile ? 'New' : 'New Estimate'}
          </Button>
        }
        styles={{
          header: isMobile ? { padding: '0 12px' } : undefined,
          body: isMobile ? { padding: '12px' } : undefined,
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 8,
          marginBottom: 16,
        }}>
          <Input
            placeholder="Search by address or zip..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            allowClear
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Status"
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            allowClear
            style={{ width: isMobile ? '100%' : 150 }}
            options={[
              { label: 'Draft', value: 'draft' },
              { label: 'Calculated', value: 'calculated' },
              { label: 'Approved', value: 'approved' },
              { label: 'Exported', value: 'exported' },
            ]}
          />
        </div>

        {isMobile ? (
          <List
            dataSource={data?.items || []}
            loading={isLoading}
            renderItem={renderMobileItem}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              size: 'small',
              showTotal: (total) => `${total} estimates`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={data?.items || []}
            rowKey="id"
            loading={isLoading}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} estimates`,
            }}
          />
        )}
      </Card>
    </div>
  );
};

export default RoofingEstimateList;
