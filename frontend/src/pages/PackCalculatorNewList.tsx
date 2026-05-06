/**
 * Packing Estimate List Page
 * Shows all packing estimates with client/company info
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Card, message, Popconfirm, Tag,
  Typography, Row, Col, Statistic, Tooltip, Empty,
} from 'antd';
import {
  PlusOutlined, EyeOutlined, DeleteOutlined,
  ReloadOutlined, ThunderboltOutlined, TeamOutlined,
  FileTextOutlined, DollarOutlined, UserOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import type { PackEstimateSummary } from '../types/packing-estimate';
import { formatDate } from '../utils/formatters';

const { Title, Text } = Typography;

const PackCalculatorNewList: React.FC = () => {
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<PackEstimateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => { fetchEstimates(); }, []);

  const fetchEstimates = async () => {
    setLoading(true);
    try {
      const data = await packingService.listEstimates({ limit: 100 });
      setEstimates(data.items);
      setTotal(data.total);
    } catch {
      message.error('Failed to load estimates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await packingService.deleteEstimate(id);
      message.success('Estimate deleted');
      fetchEstimates();
    } catch {
      message.error('Failed to delete');
    }
  };

  const columns = [
    {
      title: 'Estimate',
      dataIndex: 'calculation_name',
      key: 'name',
      render: (text: string, record: PackEstimateSummary) => (
        <Space direction="vertical" size={0}>
          <Text strong>
            <FileTextOutlined /> {text || 'Untitled'}
          </Text>
          {record.project_address && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.project_address}
            </Text>
          )}
        </Space>
      ),
      width: '25%',
    },
    {
      title: 'Client',
      key: 'client',
      render: (_: any, record: PackEstimateSummary) => (
        record.client_name ? (
          <Space size={4}>
            <UserOutlined />
            <Text>{record.client_name}</Text>
          </Space>
        ) : <Text type="secondary">-</Text>
      ),
      width: '15%',
    },
    {
      title: 'Rooms',
      dataIndex: 'total_rooms',
      key: 'rooms',
      align: 'center' as const,
      width: '8%',
    },
    {
      title: 'Hours',
      dataIndex: 'total_hours',
      key: 'hours',
      align: 'center' as const,
      render: (v: number | null) => v?.toFixed(1) || '-',
      width: '8%',
    },
    {
      title: 'Total',
      dataIndex: 'grand_total',
      key: 'total',
      align: 'right' as const,
      render: (v: number | null) => v
        ? <Text strong style={{ color: '#1890ff' }}>
            ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
        : '-',
      width: '12%',
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      align: 'center' as const,
      render: (mode: string | null) => (
        <Tag color={mode === 'photo_ai' ? 'purple' : 'blue'}>
          {mode === 'photo_ai' ? 'Photo AI' : 'Quick'}
        </Tag>
      ),
      width: '8%',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      align: 'center' as const,
      render: (status: string | null) => {
        const colorMap: Record<string, string> = {
          draft: 'default', completed: 'success', approved: 'blue',
        };
        return <Tag color={colorMap[status || 'draft'] || 'default'}>
          {status || 'draft'}
        </Tag>;
      },
      width: '8%',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string | null) => v ? formatDate(v) : '-',
      width: '10%',
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'center' as const,
      render: (_: any, record: PackEstimateSummary) => (
        <Space size="small">
          <Tooltip title="View">
            <Button
              type="primary" size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this estimate?"
            onConfirm={() => handleDelete(record.id)}
            okButtonProps={{ danger: true }}
          >
            <Button danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
      width: '10%',
    },
  ];

  const totalGrand = estimates.reduce((s, e) => s + (e.grand_total || 0), 0);

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card>
          <Row justify="space-between" align="middle">
            <Col>
              <Title level={3} style={{ margin: 0 }}>
                <ThunderboltOutlined /> Packing Estimates
              </Title>
            </Col>
            <Col>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={fetchEstimates} loading={loading}>
                  Refresh
                </Button>
                <Button
                  type="primary" size="large"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/reconstruction-estimate/pack-calculator-new')}
                >
                  New Estimate
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {estimates.length > 0 && (
          <Card>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="Total Estimates" value={total} prefix={<FileTextOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic title="Total Rooms" value={estimates.reduce((s, e) => s + e.total_rooms, 0)} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Total Hours"
                  value={estimates.reduce((s, e) => s + (e.total_hours || 0), 0).toFixed(1)}
                  prefix={<TeamOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Total Value"
                  value={totalGrand}
                  prefix={<DollarOutlined />}
                  precision={2}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
            </Row>
          </Card>
        )}

        <Card>
          <Table
            columns={columns}
            dataSource={estimates}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showTotal: t => `${t} estimates` }}
            locale={{
              emptyText: (
                <Empty description={
                  <Space direction="vertical">
                    <Text>No packing estimates yet</Text>
                    <Button
                      type="primary" icon={<PlusOutlined />}
                      onClick={() => navigate('/reconstruction-estimate/pack-calculator-new')}
                    >
                      Create First Estimate
                    </Button>
                  </Space>
                } />
              ),
            }}
          />
        </Card>
      </Space>
    </div>
  );
};

export default PackCalculatorNewList;
