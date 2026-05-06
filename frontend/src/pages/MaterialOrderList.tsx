/**
 * Material Order List page.
 * Shows saved material orders with search, filter, and navigation to detail.
 */

import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Select,
  Space,
  Typography,
  Tag,
  Popconfirm,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ShoppingCartOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { materialOrderService } from '../services/materialOrderService';
import type { MaterialOrderRecord } from '../types/materialOrder';

const { Title, Text } = Typography;
const { Option } = Select;

const MaterialOrderList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['material-orders', { search, scope_type: scopeFilter, status: statusFilter, page, page_size: pageSize }],
    queryFn: () =>
      materialOrderService.list({
        search: search || undefined,
        scope_type: scopeFilter,
        status: statusFilter,
        page,
        page_size: pageSize,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => materialOrderService.delete(id),
    onSuccess: () => {
      message.success('Material order deleted');
      queryClient.invalidateQueries({ queryKey: ['material-orders'] });
    },
    onError: () => message.error('Failed to delete'),
  });

  const columns = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      ellipsis: true,
      render: (text: string, record: MaterialOrderRecord) => (
        <a onClick={() => navigate(`/material-order/${record.id}`)}>{text || '(no address)'}</a>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'scope_type',
      width: 100,
      render: (t: string) => (
        <Tag color={t === 'roofing' ? 'blue' : 'green'}>{t?.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Brand',
      dataIndex: 'brand',
      width: 130,
    },
    {
      title: 'Items',
      dataIndex: 'item_count',
      width: 70,
      align: 'center' as const,
    },
    {
      title: 'Total',
      dataIndex: 'total_material_cost',
      width: 110,
      align: 'right' as const,
      render: (val: number) =>
        val > 0 ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => (
        <Tag color={s === 'draft' ? 'default' : s === 'ordered' ? 'processing' : 'success'}>
          {s?.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: 110,
      render: (d: string) => d ? new Date(d).toLocaleDateString() : '-',
    },
    {
      title: '',
      width: 50,
      render: (_: any, record: MaterialOrderRecord) => (
        <Popconfirm
          title="Delete this order?"
          onConfirm={() => deleteMutation.mutate(record.id)}
          okText="Delete"
          cancelText="Cancel"
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <ShoppingCartOutlined style={{ marginRight: 8 }} />
          Material Orders
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/material-order/new')}>
          New Order
        </Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="Search address, brand..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 250 }}
            allowClear
          />
          <Select
            placeholder="Type"
            value={scopeFilter}
            onChange={(val) => { setScopeFilter(val); setPage(1); }}
            style={{ width: 120 }}
            allowClear
          >
            <Option value="roofing">Roofing</Option>
            <Option value="siding">Siding</Option>
          </Select>
          <Select
            placeholder="Status"
            value={statusFilter}
            onChange={(val) => { setStatusFilter(val); setPage(1); }}
            style={{ width: 120 }}
            allowClear
          >
            <Option value="draft">Draft</Option>
            <Option value="ordered">Ordered</Option>
            <Option value="completed">Completed</Option>
          </Select>
        </Space>
      </Card>

      <Table
        dataSource={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey="id"
        size="small"
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/material-order/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  );
};

export default MaterialOrderList;
