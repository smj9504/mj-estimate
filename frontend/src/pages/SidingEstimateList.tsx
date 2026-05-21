import React, { useState, useEffect } from 'react';
import {
  Card, Table, Button, Space, Tag, Input, message, Typography, Popconfirm, Grid, List, Dropdown,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, MoreOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { sidingEstimateService } from '../services/sidingEstimateService';
import type { SidingEstimate } from '../types/sidingEstimate';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const SidingEstimateList: React.FC = () => {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [estimates, setEstimates] = useState<SidingEstimate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const result = await sidingEstimateService.list({
        page,
        page_size: 20,
        search: search || undefined,
      });
      setEstimates(result.items);
      setTotal(result.total);
    } catch {
      message.error('Failed to load estimates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [page, search]);

  const handleDelete = async (id: string) => {
    try {
      await sidingEstimateService.delete(id);
      message.success('Deleted');
      fetchList();
    } catch {
      message.error('Failed to delete');
    }
  };

  const columns = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      render: (v: string, record: SidingEstimate) => (
        <a onClick={() => navigate(`/siding-estimates/${record.id}`)}>
          {v || 'No address'}
          {record.city && `, ${record.city}`}
          {record.state && `, ${record.state}`}
        </a>
      ),
    },
    {
      title: 'EV Report',
      dataIndex: 'eagleview_report_id',
      width: 120,
      render: (v: string) => v ? <Tag color="blue">#{v}</Tag> : '-',
    },
    {
      title: 'Siding SF',
      dataIndex: 'total_siding_area_net',
      width: 100,
      align: 'right' as const,
      render: (v: number) => v ? v.toLocaleString() : '-',
    },
    {
      title: 'Total',
      dataIndex: 'total',
      width: 120,
      align: 'right' as const,
      render: (v: number) => v ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => (
        <Tag color={v === 'draft' ? 'default' : v === 'calculated' ? 'blue' : 'green'}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString() : '-',
    },
    {
      title: '',
      width: 80,
      render: (_: any, record: SidingEstimate) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/siding-estimates/${record.id}`)}
          />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileItem = (record: SidingEstimate) => {
    const addr = [record.property_address, record.city, record.state].filter(Boolean).join(', ');

    return (
      <List.Item
        style={{ padding: '12px 0' }}
        actions={[
          <Dropdown
            key="actions"
            menu={{
              items: [
                {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: 'Edit',
                  onClick: () => navigate(`/siding-estimates/${record.id}`),
                },
                { type: 'divider' as const },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    if (window.confirm('Delete this estimate?')) {
                      handleDelete(record.id);
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
          onClick={() => navigate(`/siding-estimates/${record.id}`)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Tag color={record.status === 'draft' ? 'default' : record.status === 'calculated' ? 'blue' : 'green'}>
              {record.status}
            </Tag>
            {record.eagleview_report_id && <Tag color="blue">EV #{record.eagleview_report_id}</Tag>}
          </div>
          <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
            {addr || 'No address'}
          </Text>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {record.total_siding_area_net ? (
              <Text type="secondary" style={{ fontSize: 12 }}>{record.total_siding_area_net.toLocaleString()} SF</Text>
            ) : null}
            {record.total ? (
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                ${record.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '0' : '16px' }}>
      <Card
        title={<Title level={4} style={{ margin: 0 }}>Siding Estimates</Title>}
        extra={
          <Space size={isMobile ? 'small' : 'middle'}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/siding-estimates/new')}
            >
              {isMobile ? 'New' : 'New Estimate'}
            </Button>
          </Space>
        }
        styles={{
          header: isMobile ? { padding: '0 12px' } : undefined,
          body: isMobile ? { padding: '12px' } : undefined,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="Search..."
            allowClear
            onSearch={setSearch}
            style={{ width: isMobile ? '100%' : 300 }}
          />
        </div>

        {isMobile ? (
          <List
            dataSource={estimates}
            loading={loading}
            renderItem={renderMobileItem}
            pagination={{
              current: page,
              total,
              pageSize: 20,
              size: 'small',
              showTotal: (t) => `${t} estimates`,
              onChange: setPage,
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={estimates}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              total,
              pageSize: 20,
              onChange: setPage,
              showTotal: (t) => `${t} estimates`,
            }}
          />
        )}
      </Card>
    </div>
  );
};

export default SidingEstimateList;
