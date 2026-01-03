/**
 * Pack Calculator New - Detail View Page (Read-Only)
 * Shows detailed breakdown of pack-out/pack-in estimates
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Typography,
  Space,
  Button,
  Descriptions,
  Table,
  Tag,
  Collapse,
  Statistic,
  message,
  Spin,
  Divider,
  Tabs,
  Alert,
  Empty,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
  BoxPlotOutlined,
  TeamOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import {
  packCalculationAPI,
  PackCalculationDetail,
  RoomBreakdown,
  XactimateLineItem,
} from '../services/packCalculationService';
import { formatDate } from '../utils/formatters';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const PackCalculatorNewDetail: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [calculation, setCalculation] = useState<PackCalculationDetail | null>(null);

  useEffect(() => {
    if (id) {
      loadCalculation(id);
    }
  }, [id]);

  const loadCalculation = async (calculationId: string) => {
    setLoading(true);
    try {
      const data = await packCalculationAPI.getById(calculationId);
      setCalculation(data);
    } catch (error) {
      message.error('Failed to load calculation details');
      console.error('Error loading calculation:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/reconstruction-estimate/pack-calculator-new/list');
  };

  const handleEdit = () => {
    message.info('Edit functionality coming soon!');
    // TODO: Navigate to edit page when implemented
  };

  const handleDownload = () => {
    message.info('PDF export coming soon!');
    // TODO: Implement PDF export
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Spin size="large" tip="Loading calculation details..." />
      </div>
    );
  }

  if (!calculation) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <Empty
          description="Calculation not found"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" onClick={handleBack}>
            Back to List
          </Button>
        </Empty>
      </div>
    );
  }

  // Material columns
  const materialColumns = [
    {
      title: 'Xactimate Code',
      dataIndex: 'code',
      key: 'code',
      width: '20%',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: '50%',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      width: '15%',
      align: 'right' as const,
      render: (value: number) => value.toFixed(2),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: '15%',
      align: 'center' as const,
    },
  ];

  // Labor columns
  const laborColumns = [
    {
      title: 'Xactimate Code',
      dataIndex: 'code',
      key: 'code',
      width: '20%',
      render: (text: string) => <Tag color="orange">{text}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: '50%',
    },
    {
      title: 'Hours',
      dataIndex: 'quantity',
      key: 'quantity',
      width: '15%',
      align: 'right' as const,
      render: (value: number) => value.toFixed(2),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: '15%',
      align: 'center' as const,
    },
  ];

  // Room breakdown columns
  const roomColumns = [
    {
      title: 'Room Name',
      dataIndex: 'room_name',
      key: 'room_name',
      width: '25%',
    },
    {
      title: 'Floor',
      dataIndex: 'floor_level',
      key: 'floor_level',
      width: '15%',
      align: 'center' as const,
    },
    {
      title: 'Items',
      dataIndex: 'item_count',
      key: 'item_count',
      width: '15%',
      align: 'center' as const,
    },
    {
      title: 'Pack-Out Hours',
      dataIndex: 'pack_out_labor_hours',
      key: 'pack_out_labor_hours',
      width: '15%',
      align: 'right' as const,
      render: (value: number) => value?.toFixed(2) || '0.00',
    },
    {
      title: 'Pack-In Hours',
      dataIndex: 'pack_in_labor_hours',
      key: 'pack_in_labor_hours',
      width: '15%',
      align: 'right' as const,
      render: (value: number) => value?.toFixed(2) || '0.00',
    },
    {
      title: 'Materials',
      dataIndex: 'materials',
      key: 'materials',
      width: '15%',
      align: 'center' as const,
      render: (materials: XactimateLineItem[]) => (
        <Tag>{materials?.length || 0} items</Tag>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <Card>
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                  Back
                </Button>
                <Title level={2} style={{ margin: 0 }}>
                  <ThunderboltOutlined /> {calculation.calculation_name}
                </Title>
              </Space>
            </Col>
            <Col>
              <Space>
                <Button icon={<EditOutlined />} onClick={handleEdit}>
                  Edit
                </Button>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleDownload}
                >
                  Export PDF
                </Button>
              </Space>
            </Col>
          </Row>

          <Divider />

          {/* Status and Info */}
          <Row gutter={16}>
            <Col span={12}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Created">
                  {formatDate(calculation.created_at)}
                </Descriptions.Item>
                {calculation.project_address && (
                  <Descriptions.Item label="Project Address">
                    {calculation.project_address}
                  </Descriptions.Item>
                )}
                {calculation.notes && (
                  <Descriptions.Item label="Notes">
                    {calculation.notes}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  <Text strong>Status:</Text>
                  {calculation.needs_review ? (
                    <Tag color="warning" icon={<WarningOutlined />}>
                      Needs Review
                    </Tag>
                  ) : (
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      Ready
                    </Tag>
                  )}
                </Space>
                <Space>
                  <Text strong>AI Confidence:</Text>
                  <Tag color="purple" icon={<RobotOutlined />}>
                    {(calculation.ml_confidence * 100).toFixed(0)}%
                  </Tag>
                </Space>
                {calculation.auto_selected && (
                  <Tag color="blue">Auto-Selected Strategies</Tag>
                )}
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Summary Statistics */}
        <Card title="Summary">
          <Row gutter={16}>
            <Col span={6}>
              <Statistic
                title="Total Rooms"
                value={calculation.rooms?.length || 0}
                prefix={<BoxPlotOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Total Boxes"
                value={calculation.pack_out_materials?.reduce(
                  (sum, mat) => {
                    // Only count box materials (CPS BX*, TMC BXDISH, CPS BXWDR, etc.)
                    const isBox = mat.code?.startsWith('CPS BX') ||
                                  mat.code?.startsWith('TMC BX') ||
                                  mat.code?.startsWith('CPS BXWDR');
                    return sum + (isBox ? (mat.quantity || 0) : 0);
                  },
                  0
                ).toFixed(0)}
                prefix={<BoxPlotOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Pack-Out Hours"
                value={calculation.total_pack_out_hours?.toFixed(2) || '0.00'}
                prefix={<TeamOutlined />}
                valueStyle={{ color: '#faad14' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Pack-In Hours"
                value={calculation.total_pack_in_hours?.toFixed(2) || '0.00'}
                prefix={<TeamOutlined />}
                valueStyle={{ color: '#f5222d' }}
              />
            </Col>
          </Row>
        </Card>

        {/* Main Content Tabs */}
        <Card>
          <Tabs defaultActiveKey="materials">
            <Tabs.TabPane tab="Materials" key="materials">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="Pack-Out Materials"
                  description={`Total of ${calculation.pack_out_materials?.length || 0} material items required for packing`}
                  type="info"
                  showIcon
                />
                <Table
                  columns={materialColumns}
                  dataSource={calculation.pack_out_materials || []}
                  rowKey={(record, index) => `${record.code}-${index}`}
                  pagination={false}
                  size="small"
                />
              </Space>
            </Tabs.TabPane>

            <Tabs.TabPane tab="Labor" key="labor">
              <Row gutter={16}>
                <Col span={12}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      message="Pack-Out Labor"
                      description={`Total: ${calculation.total_pack_out_hours?.toFixed(2)} hours`}
                      type="warning"
                      showIcon
                    />
                    <Table
                      columns={laborColumns}
                      dataSource={calculation.pack_out_labor || []}
                      rowKey={(record, index) => `packout-${record.code}-${index}`}
                      pagination={false}
                      size="small"
                    />
                  </Space>
                </Col>
                <Col span={12}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      message="Pack-In Labor"
                      description={`Total: ${calculation.total_pack_in_hours?.toFixed(2)} hours`}
                      type="success"
                      showIcon
                    />
                    <Table
                      columns={laborColumns}
                      dataSource={calculation.pack_in_labor || []}
                      rowKey={(record, index) => `packin-${record.code}-${index}`}
                      pagination={false}
                      size="small"
                    />
                  </Space>
                </Col>
              </Row>
            </Tabs.TabPane>

            <Tabs.TabPane tab="Protection" key="protection">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="Floor Protection"
                  description={`Total: ${calculation.total_protection_sf?.toFixed(2) || 0} sq ft`}
                  type="info"
                  showIcon
                />
                {calculation.explanation_protection && (
                  <Alert
                    message="Protection Strategy"
                    description={calculation.explanation_protection}
                    type="info"
                  />
                )}
                <Table
                  columns={materialColumns}
                  dataSource={calculation.protection || []}
                  rowKey={(record, index) => `protection-${record.code}-${index}`}
                  pagination={false}
                  size="small"
                />
              </Space>
            </Tabs.TabPane>

            <Tabs.TabPane tab="Room Breakdown" key="rooms">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message={`${calculation.rooms?.length || 0} Rooms`}
                  description="Detailed breakdown by room"
                  type="info"
                  showIcon
                />
                <Table
                  columns={roomColumns}
                  dataSource={calculation.rooms || []}
                  rowKey={(record, index) => `room-${index}`}
                  pagination={false}
                  expandable={{
                    expandedRowRender: (record: RoomBreakdown) => (
                      <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        {record.explanation_pack_out && (
                          <Alert
                            message="Pack-Out Explanation"
                            description={record.explanation_pack_out}
                            type="info"
                            showIcon
                          />
                        )}
                        {record.materials && record.materials.length > 0 && (
                          <div>
                            <Text strong>Materials:</Text>
                            <Table
                              columns={materialColumns}
                              dataSource={record.materials}
                              rowKey={(mat, idx) => `${record.room_id}-${mat.code}-${idx}`}
                              pagination={false}
                              size="small"
                              style={{ marginTop: 8 }}
                            />
                          </div>
                        )}
                      </Space>
                    ),
                  }}
                />
              </Space>
            </Tabs.TabPane>

            <Tabs.TabPane tab="Debris" key="debris">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="Debris Calculation"
                  description="Estimated debris from packing materials"
                  type="warning"
                  showIcon
                />
                <Row gutter={16}>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="Cardboard (Recyclable)"
                        value={calculation.debris?.cardboard_recyclable_lb?.toFixed(2) || '0.00'}
                        suffix="lb"
                      />
                      <Text type="secondary">
                        {calculation.debris?.cardboard_recyclable_ton?.toFixed(3) || '0.000'} tons
                      </Text>
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="Plastic Waste"
                        value={calculation.debris?.plastic_waste_lb?.toFixed(2) || '0.00'}
                        suffix="lb"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card>
                      <Statistic
                        title="Paper Waste"
                        value={calculation.debris?.paper_waste_lb?.toFixed(2) || '0.00'}
                        suffix="lb"
                      />
                    </Card>
                  </Col>
                </Row>
                <Card>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Statistic
                        title="Total Debris"
                        value={calculation.debris?.total_debris_lb?.toFixed(2) || '0.00'}
                        suffix="lb"
                        valueStyle={{ color: '#f5222d' }}
                      />
                    </Col>
                    <Col span={12}>
                      <Statistic
                        title="Total Debris"
                        value={calculation.debris?.total_debris_ton?.toFixed(3) || '0.000'}
                        suffix="tons"
                        valueStyle={{ color: '#f5222d' }}
                      />
                    </Col>
                  </Row>
                </Card>
              </Space>
            </Tabs.TabPane>

            {calculation.strategies_used && (
              <Tabs.TabPane tab="Strategies Used" key="strategies">
                <Descriptions bordered column={1}>
                  {calculation.strategies_used.material_estimation && (
                    <Descriptions.Item label="Material Estimation">
                      {calculation.strategies_used.material_estimation}
                    </Descriptions.Item>
                  )}
                  {calculation.strategies_used.labor_calculation && (
                    <Descriptions.Item label="Labor Calculation">
                      {calculation.strategies_used.labor_calculation}
                    </Descriptions.Item>
                  )}
                  {calculation.strategies_used.protection_estimate && (
                    <Descriptions.Item label="Protection Estimate">
                      {calculation.strategies_used.protection_estimate}
                    </Descriptions.Item>
                  )}
                  {calculation.strategies_used.debris_calculation && (
                    <Descriptions.Item label="Debris Calculation">
                      {calculation.strategies_used.debris_calculation}
                    </Descriptions.Item>
                  )}
                  {calculation.strategies_used.fuzzy_matching_used && (
                    <Descriptions.Item label="Fuzzy Matching">
                      <Tag color="blue">Used</Tag>
                      {calculation.strategies_used.fuzzy_matches && (
                        <Text type="secondary">
                          {` (${calculation.strategies_used.fuzzy_matches.length} matches)`}
                        </Text>
                      )}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Tabs.TabPane>
            )}
          </Tabs>
        </Card>
      </Space>
    </div>
  );
};

export default PackCalculatorNewDetail;
