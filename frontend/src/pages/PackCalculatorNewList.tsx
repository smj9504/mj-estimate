/**
 * Packing Estimate List Page
 * Shows all packing estimates with client/company info
 * Includes mode selection modal for new estimates
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Card, message, Popconfirm, Tag,
  Typography, Row, Col, Tooltip, Empty, Modal,
  Grid, List, Dropdown,
} from 'antd';
import {
  PlusOutlined, EyeOutlined, DeleteOutlined,
  ReloadOutlined, ThunderboltOutlined, UserOutlined,
  CameraOutlined, CloseOutlined, MoreOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import type { PackEstimateSummary } from '../types/packing-estimate';
import { formatDate } from '../utils/formatters';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const PackCalculatorNewList: React.FC = () => {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const [estimates, setEstimates] = useState<PackEstimateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [modeModalOpen, setModeModalOpen] = useState(false);

  useEffect(() => { fetchEstimates(); }, []);

  const fetchEstimates = async () => {
    setLoading(true);
    try {
      const data = await packingService.listEstimates({ limit: 100 });
      setEstimates(data.items);
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

  const handleNewEstimate = useCallback(() => {
    setModeModalOpen(true);
  }, []);

  const handleSelectMode = useCallback((mode: 'quick' | 'photo_ai') => {
    setModeModalOpen(false);
    navigate('/reconstruction-estimate/pack-calculator-new', {
      state: { initialMode: mode },
    });
  }, [navigate]);

  const columns = [
    {
      title: 'Estimate',
      dataIndex: 'calculation_name',
      key: 'name',
      render: (text: string, record: PackEstimateSummary) => (
        <Space direction="vertical" size={0}>
          <Text strong>
            {text || 'Untitled'}
          </Text>
          {record.project_address && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.project_address}
            </Text>
          )}
        </Space>
      ),
      ellipsis: true,
    },
    {
      title: 'Client',
      key: 'client',
      render: (_: any, record: PackEstimateSummary) => (
        record.client_name ? (
          <Space size={4} style={{ whiteSpace: 'nowrap' }}>
            <UserOutlined />
            <Text ellipsis={{ tooltip: record.client_name }}>{record.client_name}</Text>
          </Space>
        ) : <Text type="secondary">-</Text>
      ),
      width: 180,
      ellipsis: true,
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
      width: 90,
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
      width: 80,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string | null) => v ? <span style={{ whiteSpace: 'nowrap' }}>{formatDate(v)}</span> : '-',
      width: 150,
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'center' as const,
      fixed: 'right' as const,
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
      width: 100,
    },
  ];

  const renderMobileItem = (record: PackEstimateSummary) => (
    <List.Item
      style={{ padding: '12px 0' }}
      actions={[
        <Dropdown
          key="actions"
          menu={{
            items: [
              {
                key: 'view',
                icon: <EyeOutlined />,
                label: 'View',
                onClick: () => navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`),
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
        onClick={() => navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color={record.mode === 'photo_ai' ? 'purple' : 'blue'}>
            {record.mode === 'photo_ai' ? 'Photo AI' : 'Quick'}
          </Tag>
          <Tag color={
            record.status === 'completed' ? 'success'
              : record.status === 'approved' ? 'blue'
              : 'default'
          }>
            {record.status || 'draft'}
          </Tag>
        </div>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
          {record.calculation_name || 'Untitled'}
        </Text>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {record.project_address && (
            <Text type="secondary" style={{ fontSize: 12 }}>{record.project_address}</Text>
          )}
          {record.client_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <UserOutlined style={{ marginRight: 2 }} />{record.client_name}
            </Text>
          )}
        </div>
        {record.created_at && (
          <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
            {formatDate(record.created_at)}
          </Text>
        )}
      </div>
    </List.Item>
  );

  return (
    <div style={{ padding: isMobile ? 0 : undefined }}>
      <Space direction="vertical" size={isMobile ? 'middle' : 'large'} style={{ width: '100%' }}>
        <Card
          styles={{
            header: isMobile ? { padding: '0 12px' } : undefined,
            body: { padding: isMobile ? '12px' : '24px' },
          }}
        >
          <Row justify="space-between" align="middle" wrap>
            <Col>
              <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
                <ThunderboltOutlined /> Packing Estimates
              </Title>
            </Col>
            <Col>
              <Space size="small">
                {!isMobile && (
                  <Button icon={<ReloadOutlined />} onClick={fetchEstimates} loading={loading}>
                    Refresh
                  </Button>
                )}
                <Button
                  type="primary" size={isMobile ? 'middle' : 'large'}
                  icon={<PlusOutlined />}
                  onClick={handleNewEstimate}
                >
                  {isMobile ? 'New' : 'New Estimate'}
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        <Card styles={{ body: { padding: isMobile ? '12px' : '24px' } }}>
          {isMobile ? (
            <List
              dataSource={estimates}
              loading={loading}
              renderItem={renderMobileItem}
              pagination={{ pageSize: 10, size: 'small', showTotal: t => `${t} estimates` }}
              locale={{
                emptyText: (
                  <Empty description={
                    <Space direction="vertical">
                      <Text>No packing estimates yet</Text>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleNewEstimate}>
                        Create First Estimate
                      </Button>
                    </Space>
                  } />
                ),
              }}
            />
          ) : (
            <Table
              columns={columns}
              dataSource={estimates}
              rowKey="id"
              loading={loading}
              scroll={{ x: 700 }}
              pagination={{ pageSize: 10, showTotal: t => `${t} estimates` }}
              locale={{
                emptyText: (
                  <Empty description={
                    <Space direction="vertical">
                      <Text>No packing estimates yet</Text>
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleNewEstimate}>
                        Create First Estimate
                      </Button>
                    </Space>
                  } />
                ),
              }}
            />
          )}
        </Card>
      </Space>

      {/* Mode Selection Modal */}
      <Modal
        open={modeModalOpen}
        onCancel={() => setModeModalOpen(false)}
        footer={null}
        closable
        closeIcon={<CloseOutlined />}
        width={480}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <Title level={4} style={{ margin: 0 }}>New Estimate</Title>
          <Text type="secondary">Choose an estimation method to get started.</Text>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Quick Estimate Option */}
            <div
              onClick={() => handleSelectMode('quick')}
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                padding: '20px 24px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#52c41a';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(82,196,26,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#e8e8e8';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: '#f6ffed', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <ThunderboltOutlined style={{ fontSize: 24, color: '#52c41a' }} />
              </div>
              <div style={{ flex: 1 }}>
                <Space>
                  <Text strong style={{ fontSize: 16 }}>Quick Estimate</Text>
                  <Tag color="success" style={{ borderRadius: 10, fontSize: 11 }}>Free</Tag>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Room presets with content hints. Fast and reliable.
                  </Text>
                </div>
              </div>
            </div>

            {/* Photo AI Option */}
            <div
              onClick={() => handleSelectMode('photo_ai')}
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                padding: '20px 24px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#1890ff';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(24,144,255,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = '#e8e8e8';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: '#e6f7ff', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <CameraOutlined style={{ fontSize: 24, color: '#1890ff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <Space>
                  <Text strong style={{ fontSize: 16 }}>Photo AI</Text>
                  <Tag color="blue" style={{ borderRadius: 10, fontSize: 11 }}>Beta</Tag>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Upload room photos. AI detects items automatically.
                  </Text>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PackCalculatorNewList;
