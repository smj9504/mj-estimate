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
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  CopyOutlined,
  FilePdfOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { roofingEstimateService } from '../services/roofingEstimateService';
import type { RoofingEstimate } from '../types/roofingEstimate';
import { STATUS_COLORS } from '../types/roofingEstimate';

const { Title } = Typography;

const RoofingEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  return (
    <div style={{ padding: '24px' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>Roofing Estimates</Title>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            New Estimate
          </Button>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Input
              placeholder="Search by address or zip..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              allowClear
            />
          </Col>
          <Col span={6}>
            <Select
              placeholder="Status"
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPage(1); }}
              allowClear
              style={{ width: '100%' }}
              options={[
                { label: 'Draft', value: 'draft' },
                { label: 'Calculated', value: 'calculated' },
                { label: 'Approved', value: 'approved' },
                { label: 'Exported', value: 'exported' },
              ]}
            />
          </Col>
        </Row>
      </Card>

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
    </div>
  );
};

export default RoofingEstimateList;
