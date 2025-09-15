import React, { useState, useEffect } from 'react';
import { 
  Row, 
  Col, 
  Card, 
  Button, 
  Space, 
  Typography, 
  DatePicker, 
  Select, 
  Switch,
  message,
  Modal,
  Table,
  Alert,
  Badge,
  Dropdown,
  Divider,
  Progress,
  List,
  Avatar,
  Statistic,
  Tag,
  Tooltip
} from 'antd';
import {
  ReloadOutlined,
  DownloadOutlined,
  SettingOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  DollarOutlined,
  FileTextOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  TrophyOutlined,
  AlertOutlined,
  EyeOutlined,
  FilterOutlined,
  AppstoreOutlined,
  ToolOutlined,
  UserOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';

// Custom components
import MetricCard from '../components/dashboard/MetricCard';
import RevenueChart from '../components/dashboard/RevenueChart';
import StatusDistributionChart from '../components/dashboard/StatusDistributionChart';
import RecentActivityFeed from '../components/dashboard/RecentActivityFeed';

// Services
import { 
  dashboardService, 
  AdminDashboardData,
  DashboardFilters 
} from '../services/dashboardService';
import { workOrderService } from '../services/workOrderService';
import { companyService } from '../services/companyService';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // State management
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'days'),
    dayjs()
  ]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [selectedWorkOrders, setSelectedWorkOrders] = useState<string[]>([]);
  const [alertsVisible, setAlertsVisible] = useState(true);

  // Build filters for API calls
  const filters: DashboardFilters = {
    date_from: dateRange[0].format('YYYY-MM-DD'),
    date_to: dateRange[1].format('YYYY-MM-DD'),
    ...(selectedCompany && { company_id: selectedCompany }),
    refresh: autoRefresh
  };

  // Data fetching with React Query
  const { 
    data: dashboardData, 
    isLoading: dashboardLoading, 
    isError: dashboardError,
    refetch: refetchDashboard 
  } = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => dashboardService.getAdminDashboard('month'),
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false,
    staleTime: 60 * 1000, // 1 minute
  });

  const { data: companies } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  const { data: pendingWorkOrders } = useQuery({
    queryKey: ['work-orders', 'pending'],
    queryFn: () => workOrderService.searchWorkOrders({ 
      status: 'pending' as any,
      page_size: 50
    }),
  });

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        refetchDashboard();
      }, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval, refetchDashboard]);

  // Event handlers
  const handleRefresh = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      message.success('Dashboard refreshed successfully');
    } catch (error) {
      message.error('Error occurred while refreshing');
    }
  };

  const handleExport = async (type: 'excel' | 'pdf') => {
    try {
      const blob = await dashboardService.exportReport(type, filters);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dashboard-report-${dayjs().format('YYYY-MM-DD')}.${type}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      message.success(`${type.toUpperCase()} file downloaded successfully`);
    } catch (error) {
      message.error('Error occurred during export');
    }
  };

  const handleBulkApprove = async () => {
    if (selectedWorkOrders.length === 0) {
      message.warning('Please select work orders to approve');
      return;
    }

    Modal.confirm({
      title: 'Bulk Approval',
      content: `Do you want to approve ${selectedWorkOrders.length} selected work orders?`,
      onOk: async () => {
        try {
          await dashboardService.approveMultipleOrders(selectedWorkOrders);
          message.success('Work orders approved in bulk successfully');
          setSelectedWorkOrders([]);
          refetchDashboard();
        } catch (error) {
          message.error('Error occurred during bulk approval');
        }
      }
    });
  };

  const stats = dashboardData?.stats;

  if (dashboardError) {
    return (
      <div>
        <Alert
          message="Data Loading Error"
          description="An error occurred while loading dashboard data. Please try refreshing."
          type="error"
          action={
            <Button size="small" danger onClick={handleRefresh}>
              Refresh
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 24px 24px 0' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 24,
        padding: '16px 0'
      }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>
            Admin Dashboard
          </Title>
          <Text type="secondary">
            Work Order System Status and Analytics
          </Text>
        </div>

        <Space size="middle">
          {/* Date Range Picker */}
          <RangePicker
            value={dateRange}
            onChange={(dates) => dates && setDateRange(dates as [Dayjs, Dayjs])}
            format="YYYY-MM-DD"
            style={{ width: 240 }}
          />

          {/* Company Filter */}
          <Select
            placeholder="Select Company"
            style={{ width: 200 }}
            value={selectedCompany}
            onChange={setSelectedCompany}
            allowClear
            showSearch
            options={companies?.map(company => ({
              label: company.name,
              value: company.id
            }))}
          />

          {/* Auto Refresh */}
          <Space>
            <Text>Auto Refresh:</Text>
            <Switch
              checked={autoRefresh}
              onChange={setAutoRefresh}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
          </Space>

          {/* Action Buttons */}
          <Space>
            <Button 
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={dashboardLoading}
            >
              Refresh
            </Button>

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'excel',
                    label: 'Export Excel',
                    icon: <DownloadOutlined />,
                    onClick: () => handleExport('excel')
                  },
                  {
                    key: 'pdf',
                    label: 'Export PDF',
                    icon: <DownloadOutlined />,
                    onClick: () => handleExport('pdf')
                  }
                ]
              }}
            >
              <Button icon={<DownloadOutlined />}>
                Export
              </Button>
            </Dropdown>

            <Button 
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/work-orders/new')}
            >
              Create Work Order
            </Button>
          </Space>
        </Space>
      </div>

      {/* Alerts Section */}
      {alertsVisible && dashboardData?.alerts && dashboardData.alerts.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col span={24}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <AlertOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
                  <Title level={4} style={{ margin: 0 }}>
                    Alerts and Warnings
                  </Title>
                  <Badge count={dashboardData.alerts.length} style={{ marginLeft: 12 }} />
                </div>
                <Button 
                  type="text" 
                  size="small"
                  onClick={() => setAlertsVisible(false)}
                >
                  Close
                </Button>
              </div>

              <List
                dataSource={dashboardData.alerts.slice(0, 3)}
                renderItem={alert => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar 
                          icon={<AlertOutlined />}
                          style={{ 
                            backgroundColor: alert.severity === 'critical' ? '#ff4d4f' : 
                                            alert.severity === 'high' ? '#fa8c16' :
                                            alert.severity === 'medium' ? '#faad14' : '#d9d9d9'
                          }}
                        />
                      }
                      title={
                        <Space>
                          {alert.title}
                          <Tag 
                            color={
                              alert.severity === 'critical' ? 'red' : 
                              alert.severity === 'high' ? 'orange' :
                              alert.severity === 'medium' ? 'yellow' : 'default'
                            }
                          >
                            {alert.severity.toUpperCase()}
                          </Tag>
                        </Space>
                      }
                      description={alert.description}
                    />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {dayjs(alert.timestamp).fromNow()}
                    </Text>
                  </List.Item>
                )}
              />
              
              {dashboardData.alerts.length > 3 && (
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <Button type="link" size="small">
                    View All Alerts ({dashboardData.alerts.length - 3} more)
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* Quick Links Section */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card 
            title={
              <Space>
                <SettingOutlined />
                <span>Quick Management Menu</span>
              </Space>
            }
            size="small"
          >
            <Space wrap size="middle">
              <Button 
                type="primary" 
                icon={<FileTextOutlined />}
                onClick={() => navigate('/admin/document-types')}
              >
                Document Types
              </Button>
              <Button 
                type="primary" 
                icon={<ToolOutlined />}
                onClick={() => navigate('/admin/trades')}
              >
                Trades
              </Button>
              <Button 
                icon={<TeamOutlined />}
                onClick={() => navigate('/companies')}
              >
                Companies
              </Button>
              <Button 
                icon={<UserOutlined />}
                onClick={() => navigate('/staff')}
              >
                Staff
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Key Metrics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="Total Work Orders"
            value={stats?.total_work_orders || 0}
            prefix={<FileTextOutlined />}
            color="#1890ff"
            loading={dashboardLoading}
            onClick={() => navigate('/work-orders')}
            tooltip="Total number of work orders registered in the system"
          />
        </Col>
        
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="This Month Revenue"
            value={stats?.revenue_this_month || 0}
            prefix="$"
            precision={0}
            color="#52c41a"
            loading={dashboardLoading}
            trend={{
              value: stats?.revenue_trend || 0,
              label: "vs Last Month"
            }}
            formatter={(value) => `$${Number(value).toLocaleString()}`}
            tooltip="Total revenue for current month"
          />
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="Pending Approval"
            value={stats?.pending_approvals || 0}
            prefix={<ClockCircleOutlined />}
            color="#fa8c16"
            loading={dashboardLoading}
            onClick={() => navigate('/work-orders?status=pending')}
            tooltip="Number of work orders requiring approval"
          />
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="In Progress"
            value={stats?.active_work_orders || 0}
            prefix={<CheckCircleOutlined />}
            color="#722ed1"
            loading={dashboardLoading}
            onClick={() => navigate('/work-orders?status=in_progress')}
            tooltip="Number of work orders currently in progress"
          />
        </Col>
      </Row>

      {/* Secondary Metrics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={8}>
          <MetricCard
            title="Completion Rate"
            value={stats?.completion_rate || 0}
            suffix="%"
            precision={1}
            color="#52c41a"
            loading={dashboardLoading}
            progress={{
              percent: stats?.completion_rate || 0,
              status: (stats?.completion_rate || 0) >= 80 ? 'success' : 'normal'
            }}
            tooltip="Percentage of completed work orders"
          />
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <MetricCard
            title="Avg Processing Time"
            value={stats?.average_processing_time || 0}
            suffix=" days"
            precision={1}
            color="#1890ff"
            loading={dashboardLoading}
            tooltip="Average time from work order creation to completion"
          />
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <MetricCard
            title="Credit Usage Rate"
            value={dashboardData?.credit_usage?.utilization_rate || 0}
            suffix="%"
            precision={1}
            color="#722ed1"
            loading={dashboardLoading}
            progress={{
              percent: dashboardData?.credit_usage?.utilization_rate || 0,
              status: (dashboardData?.credit_usage?.utilization_rate || 0) >= 90 ? 'exception' : 'normal'
            }}
            tooltip="Percentage of issued credits used"
          />
        </Col>
      </Row>

      {/* Charts Section */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
          <RevenueChart
            data={dashboardData?.revenue_chart || []}
            loading={dashboardLoading}
            height={400}
            showComparison
          />
        </Col>

        <Col xs={24} lg={8}>
          <StatusDistributionChart
            data={dashboardData?.status_distribution || []}
            loading={dashboardLoading}
            height={400}
          />
        </Col>
      </Row>

      {/* Document Type Distribution & Trade Popularity */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card 
            title="Document Type Distribution"
            loading={dashboardLoading}
            extra={<Button type="link" size="small">View More</Button>}
          >
            <div style={{ height: 300 }}>
              {dashboardData?.document_type_distribution?.map((item, index) => (
                <div 
                  key={index}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: index < (dashboardData?.document_type_distribution?.length ?? 0) - 1 ? '1px solid #f0f0f0' : 'none'
                  }}
                >
                  <div>
                    <Text strong>{item.document_type}</Text>
                    <br />
                    <Text type="secondary">{item.count} items</Text>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text strong>${item.revenue.toLocaleString()}</Text>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card 
            title="Popular Trades"
            loading={dashboardLoading}
            extra={<Button type="link" size="small">View More</Button>}
          >
            <div style={{ height: 300 }}>
              {dashboardData?.trade_popularity?.map((item, index) => (
                <div 
                  key={index}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: index < (dashboardData?.trade_popularity?.length ?? 0) - 1 ? '1px solid #f0f0f0' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Badge 
                      count={index + 1} 
                      style={{ 
                        backgroundColor: index === 0 ? '#faad14' : index === 1 ? '#d9d9d9' : index === 2 ? '#d48806' : '#f0f0f0',
                        color: index < 3 ? '#fff' : '#666'
                      }} 
                    />
                    <div style={{ marginLeft: 12 }}>
                      <Text strong>{item.trade_name}</Text>
                      <br />
                      <Text type="secondary">{item.count} items</Text>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text strong>${item.revenue.toLocaleString()}</Text>
                    <br />
                    <Tag color={item.trend === 'up' ? 'green' : item.trend === 'down' ? 'red' : 'blue'}>
                      {item.trend === 'up' ? 'Rising' : item.trend === 'down' ? 'Falling' : 'Stable'}
                    </Tag>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Bottom Section: Activities, Performance, Quick Actions */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <RecentActivityFeed
            data={dashboardData?.recent_activities || []}
            loading={dashboardLoading}
            maxItems={8}
            onRefresh={handleRefresh}
            onItemClick={(activity) => {
              if (activity.work_order_number) {
                // Navigate to work order detail
                navigate(`/work-orders/${activity.work_order_number}`);
              }
            }}
          />
        </Col>

        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            {/* Quick Actions */}
            <Col span={24}>
              <Card title="Quick Actions">
                <Row gutter={[16, 16]}>
                  <Col xs={12} sm={8}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      block
                      size="large"
                      onClick={() => navigate('/work-orders/new')}
                      style={{ height: 60, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
                    >
                      New Work Order
                    </Button>
                  </Col>

                  <Col xs={12} sm={8}>
                    <Button
                      type="default"
                      icon={<AppstoreOutlined />}
                      block
                      size="large"
                      onClick={handleBulkApprove}
                      style={{ height: 60, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
                    >
                      Bulk Approve
                    </Button>
                  </Col>

                  <Col xs={12} sm={8}>
                    <Button
                      type="default"
                      icon={<SettingOutlined />}
                      block
                      size="large"
                      onClick={() => navigate('/settings')}
                      style={{ height: 60, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
                    >
                      System Settings
                    </Button>
                  </Col>
                </Row>
              </Card>
            </Col>

            {/* Top Performing Staff */}
            <Col span={24}>
              <Card 
                title={
                  <Space>
                    <TrophyOutlined style={{ color: '#faad14' }} />
                    Top Staff
                  </Space>
                }
                extra={<Button type="link" size="small">View More</Button>}
              >
                <List
                  dataSource={dashboardData?.staff_performance?.slice(0, 3) || []}
                  renderItem={(staff, index) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={
                          <Badge 
                            count={index + 1}
                            style={{ 
                              backgroundColor: index === 0 ? '#faad14' : index === 1 ? '#d9d9d9' : '#d48806'
                            }}
                          >
                            <Avatar icon={<TeamOutlined />} />
                          </Badge>
                        }
                        title={staff.staff_name}
                        description={`Completed: ${staff.completed_orders} • Revenue: $${staff.revenue_generated.toLocaleString()}`}
                      />
                      <div>
                        <Tooltip title="Rating">
                          <Text strong style={{ color: '#faad14' }}>
                            ★{staff.rating}
                          </Text>
                        </Tooltip>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};

export default AdminDashboard;