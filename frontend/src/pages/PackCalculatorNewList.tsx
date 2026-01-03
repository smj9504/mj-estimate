/**
 * Pack Calculator New - Calculation List Page
 * Shows all pack-out/pack-in estimates created with the new multi-mode calculator
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Space,
  Card,
  message,
  Popconfirm,
  Tag,
  Typography,
  Row,
  Col,
  Statistic,
  Badge,
  Tooltip,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  BoxPlotOutlined,
  TeamOutlined,
  WarningOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { packCalculationAPI, PackCalculationResult } from '../services/packCalculationService';
import { formatDate } from '../utils/formatters';

const { Title, Text } = Typography;

const PackCalculatorNewList: React.FC = () => {
  const navigate = useNavigate();
  const [calculations, setCalculations] = useState<PackCalculationResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCalculations();
  }, []);

  const fetchCalculations = async () => {
    setLoading(true);
    try {
      const data = await packCalculationAPI.getAll();
      setCalculations(data);
    } catch (error) {
      message.error('Failed to load calculations');
      console.error('Error fetching calculations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await packCalculationAPI.delete(id);
      message.success('Calculation deleted successfully');
      fetchCalculations();
    } catch (error) {
      message.error('Failed to delete calculation');
      console.error('Error deleting calculation:', error);
    }
  };

  const handleView = (record: PackCalculationResult) => {
    navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`);
  };

  const handleCreateNew = () => {
    navigate('/reconstruction-estimate/pack-calculator-new');
  };

  // Calculate summary statistics
  const totalBoxes = calculations.reduce((sum, calc) => {
    const packOutBoxes = calc.pack_out_materials?.reduce((boxSum: number, mat: any) => {
      return boxSum + (mat.quantity || 0);
    }, 0) || 0;
    return sum + packOutBoxes;
  }, 0);

  const totalRooms = calculations.reduce((sum, calc) => sum + (calc.rooms?.length || 0), 0);

  const totalLaborHours = calculations.reduce((sum, calc) => {
    const packOutHours = calc.total_pack_out_hours || 0;
    const packInHours = calc.total_pack_in_hours || 0;
    return sum + packOutHours + packInHours;
  }, 0);

  const columns = [
    {
      title: 'Calculation Name',
      dataIndex: 'calculation_name',
      key: 'calculation_name',
      render: (text: string, record: PackCalculationResult) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: '16px' }}>
            <FileTextOutlined /> {text || 'Untitled Calculation'}
          </Text>
          {record.needs_review && (
            <Tag icon={<WarningOutlined />} color="warning" style={{ marginTop: 4 }}>
              Needs Review
            </Tag>
          )}
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Created: {formatDate(record.created_at)}
          </Text>
        </Space>
      ),
      width: '25%',
    },
    {
      title: 'Rooms',
      key: 'rooms',
      align: 'center' as const,
      render: (_: any, record: PackCalculationResult) => (
        <Space direction="vertical" size={0} style={{ textAlign: 'center', width: '100%' }}>
          <Text strong style={{ fontSize: '20px', color: '#1890ff' }}>
            {record.rooms?.length || 0}
          </Text>
          <Text type="secondary" style={{ fontSize: '12px' }}>rooms</Text>
        </Space>
      ),
      width: '10%',
    },
    {
      title: 'Materials',
      key: 'materials',
      align: 'center' as const,
      render: (_: any, record: PackCalculationResult) => {
        const boxCount = record.pack_out_materials?.reduce((sum: number, mat: any) => {
          return sum + (mat.quantity || 0);
        }, 0) || 0;

        return (
          <Space direction="vertical" size={0} style={{ textAlign: 'center', width: '100%' }}>
            <Text strong style={{ fontSize: '20px', color: '#52c41a' }}>
              <BoxPlotOutlined /> {boxCount}
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>boxes</Text>
          </Space>
        );
      },
      width: '12%',
    },
    {
      title: 'Labor Hours',
      key: 'labor',
      align: 'center' as const,
      render: (_: any, record: PackCalculationResult) => {
        const packOutHours = record.total_pack_out_hours || 0;
        const packInHours = record.total_pack_in_hours || 0;
        const totalHours = packOutHours + packInHours;

        return (
          <Space direction="vertical" size={0} style={{ textAlign: 'center', width: '100%' }}>
            <Text strong style={{ fontSize: '20px', color: '#faad14' }}>
              <TeamOutlined /> {totalHours.toFixed(1)}
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {packOutHours.toFixed(1)} out / {packInHours.toFixed(1)} in
            </Text>
          </Space>
        );
      },
      width: '15%',
    },
    {
      title: 'Status',
      key: 'status',
      align: 'center' as const,
      render: (_: any, record: PackCalculationResult) => {
        const hasReview = record.needs_review;
        const mlConfidence = record.ml_confidence || 0;

        return (
          <Space direction="vertical" size={0} style={{ textAlign: 'center', width: '100%' }}>
            {hasReview ? (
              <Tag color="warning" icon={<WarningOutlined />}>
                Needs Review
              </Tag>
            ) : (
              <Tag color="success">
                Ready
              </Tag>
            )}
            <Text type="secondary" style={{ fontSize: '12px' }}>
              AI: {(mlConfidence * 100).toFixed(0)}%
            </Text>
          </Space>
        );
      },
      width: '15%',
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'center' as const,
      render: (_: any, record: PackCalculationResult) => (
        <Space size="small">
          <Tooltip title="View Details">
            <Button
              type="primary"
              icon={<EyeOutlined />}
              onClick={() => handleView(record)}
              size="small"
            >
              View
            </Button>
          </Tooltip>
          <Popconfirm
            title="Delete this calculation?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record.id!)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete">
              <Button
                danger
                icon={<DeleteOutlined />}
                size="small"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
      width: '15%',
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Page Header */}
        <Card>
          <Row justify="space-between" align="middle">
            <Col>
              <Space direction="vertical" size="small">
                <Title level={2} style={{ margin: 0 }}>
                  <ThunderboltOutlined /> Pack-Out/Pack-In Estimates
                </Title>
                <Text type="secondary">
                  Manage all your packing estimates in one place
                </Text>
              </Space>
            </Col>
            <Col>
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchCalculations}
                  loading={loading}
                >
                  Refresh
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleCreateNew}
                  size="large"
                >
                  New Calculation
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Summary Statistics */}
        {calculations.length > 0 && (
          <Card>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic
                  title="Total Calculations"
                  value={calculations.length}
                  prefix={<FileTextOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Total Rooms"
                  value={totalRooms}
                  prefix={<BoxPlotOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Total Boxes"
                  value={totalBoxes}
                  prefix={<BoxPlotOutlined />}
                  valueStyle={{ color: '#faad14' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Total Labor Hours"
                  value={totalLaborHours.toFixed(1)}
                  prefix={<TeamOutlined />}
                  valueStyle={{ color: '#f5222d' }}
                />
              </Col>
            </Row>
          </Card>
        )}

        {/* Calculations Table */}
        <Card>
          <Table
            columns={columns}
            dataSource={calculations}
            rowKey="id"
            loading={loading}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} calculations`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <Space direction="vertical" size="small">
                      <Text>No pack calculations yet</Text>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreateNew}
                      >
                        Create Your First Calculation
                      </Button>
                    </Space>
                  }
                />
              ),
            }}
          />
        </Card>

        {/* Help Card */}
        <Card size="small" style={{ background: '#f0f2f5' }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>💡 Quick Tips:</Text>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#666' }}>
              <li>Click <strong>View</strong> to see detailed calculation breakdown</li>
              <li>Use <strong>New Calculation</strong> to create estimates using 5 different input modes</li>
              <li>Calculations automatically account for hidden contents (cabinets, closets, drawers)</li>
              <li>All cost estimates are based on Xactimate industry standards</li>
            </ul>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default PackCalculatorNewList;
