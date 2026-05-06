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
import { bathroomEstimateService } from '../services/bathroomEstimateService';
import type { BathroomEstimate } from '../types/bathroomEstimate';

const { Title } = Typography;

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};

const BathroomEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['bathroom-estimates', { search, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      bathroomEstimateService.list({
        search: search || undefined,
        status: statusFilter,
        page,
        page_size: pageSize,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => bathroomEstimateService.delete(id),
    onSuccess: () => {
      message.success('Estimate deleted');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimates'] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) => bathroomEstimateService.clone(id),
    onSuccess: (result) => {
      message.success('Estimate cloned');
      navigate(`/bathroom-estimates/${result.id}`);
    },
  });

  const handleCreate = async () => {
    try {
      const result = await bathroomEstimateService.create({});
      navigate(`/bathroom-estimates/${result.id}`);
    } catch {
      message.error('Failed to create estimate');
    }
  };

  const columns = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      key: 'address',
      render: (addr: string, record: BathroomEstimate) => (
        <a onClick={() => navigate(`/bathroom-estimates/${record.id}`)}>
          {addr || 'No address'}
        </a>
      ),
    },
    {
      title: 'Bathroom',
      key: 'bathroom',
      render: (_: any, record: BathroomEstimate) => {
        const d = (record.designation || '').replace(/_/g, ' ');
        const f = (record.bath_function || '').replace(/_/g, ' ');
        return `${d} ${f}`.trim() || '-';
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
      render: (_: any, record: BathroomEstimate) => (
        <Space size="small">
          <Button
            size="small"
            icon={<FilePdfOutlined />}
            onClick={() => bathroomEstimateService.exportPdf(record.id)}
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
          <Title level={3} style={{ margin: 0 }}>Bathroom Estimates</Title>
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

export default BathroomEstimateList;
