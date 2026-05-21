import React, { useState, useCallback } from 'react';
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
  FileExcelOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cabinetEstimateService } from '../services/cabinetEstimateService';
import type { CabinetEstimate, EstimateStatus } from '../types/cabinetEstimate';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_COLORS: Record<EstimateStatus, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};

const CabinetEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['cabinet-estimates', { search, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      cabinetEstimateService.list({
        search: search || undefined,
        status: statusFilter,
        page,
        page_size: pageSize,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cabinetEstimateService.delete(id),
    onSuccess: () => {
      message.success('Estimate deleted');
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimates'] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) => cabinetEstimateService.clone(id),
    onSuccess: (result) => {
      message.success('Estimate cloned');
      navigate(`/cabinet-estimates/${result.id}`);
    },
  });

  const handleCreate = useCallback(async () => {
    try {
      const result = await cabinetEstimateService.create({ boxes: [] });
      navigate(`/cabinet-estimates/${result.id}`);
    } catch {
      message.error('Failed to create estimate');
    }
  }, [navigate]);

  const columns = [
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      render: (text: string, record: CabinetEstimate) => (
        <a onClick={() => navigate(`/cabinet-estimates/${record.id}`)}>
          {text || 'Untitled'}
        </a>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      key: 'client_name',
      render: (text: string) => text || '-',
    },
    {
      title: 'Claim #',
      dataIndex: 'claim_number',
      key: 'claim_number',
      render: (text: string) => text || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: EstimateStatus) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>{status.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Tier',
      dataIndex: 'tier',
      key: 'tier',
      width: 120,
      render: (text: string) => text || '-',
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (val: number) => (val ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-'),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 110,
      render: (text: string) => (text ? new Date(text).toLocaleDateString() : '-'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: any, record: CabinetEstimate) => (
        <Space size="small">
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => cloneMutation.mutate(record.id)}
            title="Clone"
          />
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={() => cabinetEstimateService.exportPdf(record.id, { address: record.property_address })}
            title="Export PDF"
            disabled={record.status === 'draft'}
          />
          <Button
            size="small"
            icon={<FileExcelOutlined />}
            onClick={() => cabinetEstimateService.exportExcel(record.id)}
            title="Export Excel"
            disabled={!record.boxes?.length}
          />
          <Popconfirm
            title="Delete this estimate?"
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} title="Delete" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileItem = (record: CabinetEstimate) => (
    <List.Item
      style={{ padding: '12px 0' }}
      actions={[
        <Dropdown
          key="actions"
          menu={{
            items: [
              {
                key: 'clone',
                icon: <CopyOutlined />,
                label: 'Clone',
                onClick: () => cloneMutation.mutate(record.id),
              },
              {
                key: 'pdf',
                icon: <FilePdfOutlined />,
                label: 'Export PDF',
                disabled: record.status === 'draft',
                onClick: () => cabinetEstimateService.exportPdf(record.id, { address: record.property_address }),
              },
              {
                key: 'excel',
                icon: <FileExcelOutlined />,
                label: 'Export Excel',
                disabled: !record.boxes?.length,
                onClick: () => cabinetEstimateService.exportExcel(record.id),
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
        onClick={() => navigate(`/cabinet-estimates/${record.id}`)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color={STATUS_COLORS[record.status] || 'default'}>{record.status.toUpperCase()}</Tag>
          {record.tier && <Tag>{record.tier}</Tag>}
        </div>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
          {record.property_address || 'Untitled'}
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

  return (
    <div style={{ padding: isMobile ? '0' : '24px' }}>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>Cabinet Estimates</Title>}
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
            placeholder="Search by address, zip code..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            allowClear
            style={{ flex: 1 }}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: isMobile ? '100%' : 150 }}
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
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
            dataSource={data?.items || []}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{
              current: page,
              pageSize,
              total: data?.total || 0,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} estimates`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
};

export default CabinetEstimateList;
