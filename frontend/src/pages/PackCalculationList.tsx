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
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { packCalculationAPI, PackCalculationResult } from '../services/packCalculationService';
import { formatDate } from '../utils/formatters';

const { Title } = Typography;

const PackCalculationList: React.FC = () => {
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
      console.log('Fetched pack calculations:', data);
      console.log('Total calculations:', data?.length);
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
    navigate(`/reconstruction-estimate/pack-calculator/${record.id}`);
  };

  const handleEdit = (record: PackCalculationResult) => {
    navigate(`/reconstruction-estimate/pack-calculator/${record.id}/edit`);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'calculation_name',
      key: 'calculation_name',
      render: (text: string, record: PackCalculationResult) => (
        <Space direction="vertical" size={0}>
          <strong>{text || 'Untitled Calculation'}</strong>
          {record.needs_review && (
            <Tag icon={<WarningOutlined />} color="warning">
              Needs Review
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Rooms',
      dataIndex: 'rooms',
      key: 'rooms',
      render: (rooms: any[]) => rooms?.length || 0,
    },
    {
      title: 'Pack-Out',
      key: 'pack_out',
      render: (_: any, record: PackCalculationResult) => (
        <Space direction="vertical" size={0}>
          <span>{record.pack_out_materials?.length || 0} materials</span>
          <span style={{ fontSize: '12px', color: '#888' }}>
            {record.total_pack_out_hours.toFixed(1)} hrs
          </span>
        </Space>
      ),
    },
    {
      title: 'Pack-In',
      key: 'pack_in',
      render: (_: any, record: PackCalculationResult) => (
        <Space direction="vertical" size={0}>
          <span>{record.pack_in_labor?.length || 0} items</span>
          <span style={{ fontSize: '12px', color: '#888' }}>
            {record.total_pack_in_hours.toFixed(1)} hrs
          </span>
        </Space>
      ),
    },
    {
      title: 'Protection',
      dataIndex: 'total_protection_sf',
      key: 'total_protection_sf',
      render: (sf: number) => `${sf.toFixed(0)} SF`,
    },
    {
      title: 'ML Confidence',
      dataIndex: 'ml_confidence',
      key: 'ml_confidence',
      render: (confidence: number, record: PackCalculationResult) => {
        const percentage = (confidence * 100).toFixed(0);
        const color = confidence >= 0.8 ? 'green' : confidence >= 0.6 ? 'orange' : 'red';
        const icon = confidence >= 0.8 ? <CheckCircleOutlined /> : <WarningOutlined />;

        return (
          <Tag icon={icon} color={color}>
            {percentage}%
          </Tag>
        );
      },
    },
    {
      title: 'Strategy',
      dataIndex: 'auto_selected',
      key: 'auto_selected',
      render: (autoSelected: boolean) => (
        <Tag color={autoSelected ? 'blue' : 'default'}>
          {autoSelected ? 'Auto' : 'Manual'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => formatDate(date),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: PackCalculationResult) => (
        <Space>
          <Tooltip title="View Details">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleView(record)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this calculation?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: '24px' }}>
        <Col>
          <Title level={2}>Pack Calculations</Title>
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
              onClick={() => navigate('/reconstruction-estimate/pack-calculator')}
            >
              New Calculation
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Calculations Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={calculations}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => `Total ${total} calculations`,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>
    </div>
  );
};

export default PackCalculationList;
