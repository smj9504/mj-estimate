import React, { useState } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Typography, 
  Space, 
  Select, 
  Badge, 
  Empty,
  Spin,
  Alert,
  Table,
  Progress,
  Tabs,
  Button
} from 'antd';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  TeamOutlined,
  DollarOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { 
  dashboardService, 
  WorkOrderSummary,
  DashboardData,
  isManagerDashboardData,
  isAdminDashboardData
} from '../services/dashboardService';
import WorkOrderCard from '../components/dashboard/WorkOrderCard';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

const { Title, Text } = Typography;
const { Option } = Select;

const RoleBasedDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [timePeriod, setTimePeriod] = useState<string>('week');

  // Determine which dashboard to load based on user role
  const getDashboardData = () => {
    if (!user) return null;
    
    // Admin roles get admin dashboard
    if (user.role === 'admin' || user.role === 'super_admin') {
      return dashboardService.getAdminDashboard(timePeriod);
    }
    // Manager roles get manager dashboard  
    else if (user.role === 'manager' || user.role === 'supervisor') {
      return dashboardService.getManagerDashboard(timePeriod);
    }
    // Everyone else gets user dashboard
    else {
      return dashboardService.getUserDashboard(timePeriod);
    }
  };

  const { data: dashboardData, isLoading, error } = useQuery<DashboardData | null>({
    queryKey: ['dashboard', user?.role, timePeriod],
    queryFn: getDashboardData,
    enabled: !!user,
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  if (!user) {
    return (
      <Alert
        message="Authentication Required"
        description="Please login to view the dashboard."
        type="warning"
        showIcon
        action={
          <Button type="primary" onClick={() => navigate('/login')}>
            Go to Login
          </Button>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" tip="Loading dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        message="Error loading dashboard"
        description={`Unable to load dashboard data. ${error instanceof Error ? error.message : 'Please try again later.'}`}
        type="error"
        showIcon
      />
    );
  }

  if (!dashboardData) {
    return <Empty description="No dashboard data available" />;
  }

  const priorityColors = {
    urgent: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    low: '#16a34a'
  };

  const getPriorityCount = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return dashboardData.urgent_work_orders.length;
      case 'high':
        return dashboardData.high_priority_work_orders.length;
      case 'medium':
        return dashboardData.medium_priority_work_orders.length;
      case 'low':
        return dashboardData.low_priority_work_orders.length;
      default:
        return 0;
    }
  };

  const priorityData = [
    { name: 'Urgent', value: getPriorityCount('urgent'), color: priorityColors.urgent },
    { name: 'High', value: getPriorityCount('high'), color: priorityColors.high },
    { name: 'Medium', value: getPriorityCount('medium'), color: priorityColors.medium },
    { name: 'Low', value: getPriorityCount('low'), color: priorityColors.low }
  ];

  const renderWorkOrderSection = (
    title: string, 
    workOrders: WorkOrderSummary[], 
    color?: string
  ) => (
    <Card 
      title={
        <Space>
          <Badge count={workOrders.length} style={{ backgroundColor: color }}>
            <Text strong>{title}</Text>
          </Badge>
        </Space>
      }
      style={{ marginBottom: 16, maxHeight: 400, overflow: 'auto' }}
    >
      {workOrders.length === 0 ? (
        <Empty description={`No ${title.toLowerCase()}`} />
      ) : (
        workOrders.map(wo => (
          <WorkOrderCard
            key={wo.id}
            workOrder={wo}
            onEdit={() => navigate(`/work-orders/${wo.id}`)}
            onComplete={() => console.log('Complete', wo.id)}
            onRevision={() => console.log('Revision', wo.id)}
          />
        ))
      )}
    </Card>
  );

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2}>
            {user?.role === 'admin' ? 'Admin' : user?.role === 'manager' ? 'Manager' : 'My'} Dashboard
          </Title>
        </Col>
        <Col>
          <Select
            value={timePeriod}
            onChange={setTimePeriod}
            style={{ width: 120 }}
          >
            <Option value="week">Week</Option>
            <Option value="month">Month</Option>
            <Option value="quarter">Quarter</Option>
            <Option value="year">Year</Option>
          </Select>
        </Col>
      </Row>

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Total Assigned"
              value={dashboardData.total_assigned}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Completed Today"
              value={dashboardData.completed_today}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Completed This Week"
              value={dashboardData.completed_this_week}
              prefix={<CalendarOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Pending Revisions"
              value={dashboardData.pending_revisions}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Main Content */}
      <Row gutter={[16, 16]}>
        {/* Work Orders Section */}
        <Col xs={24} lg={16}>
          <Tabs
            defaultActiveKey="priority"
            items={[
              {
                key: 'priority',
                label: 'By Priority',
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      {renderWorkOrderSection('Urgent', dashboardData.urgent_work_orders, priorityColors.urgent)}
                    </Col>
                    <Col xs={24} md={12}>
                      {renderWorkOrderSection('High Priority', dashboardData.high_priority_work_orders, priorityColors.high)}
                    </Col>
                    <Col xs={24} md={12}>
                      {renderWorkOrderSection('Medium Priority', dashboardData.medium_priority_work_orders, priorityColors.medium)}
                    </Col>
                    <Col xs={24} md={12}>
                      {renderWorkOrderSection('Low Priority', dashboardData.low_priority_work_orders, priorityColors.low)}
                    </Col>
                  </Row>
                )
              },
              {
                key: 'overdue',
                label: `Overdue (${dashboardData.overdue_work_orders.length})`,
                children: renderWorkOrderSection('Overdue Work Orders', dashboardData.overdue_work_orders, '#dc2626')
              },
              ...(dashboardData.documents_requiring_revision.length > 0 ? [{
                key: 'revisions',
                label: `Revisions (${dashboardData.documents_requiring_revision.length})`,
                children: (
                  <Card>
                    <Table
                      dataSource={dashboardData.documents_requiring_revision}
                      columns={[
                        {
                          title: 'Document',
                          dataIndex: 'document_number',
                          key: 'document_number',
                        },
                        {
                          title: 'Type',
                          dataIndex: 'document_type',
                          key: 'document_type',
                        },
                        {
                          title: 'Client',
                          dataIndex: 'client_name',
                          key: 'client_name',
                        },
                        {
                          title: 'Days Pending',
                          dataIndex: 'days_pending',
                          key: 'days_pending',
                          render: (days: number) => (
                            <Text type={days > 3 ? 'danger' : 'warning'}>{days} days</Text>
                          )
                        },
                        {
                          title: 'Action',
                          key: 'action',
                          render: (_, record) => (
                            <Button
                              type="link"
                              onClick={() => navigate(`/documents/${record.id}`)}
                            >
                              Review
                            </Button>
                          )
                        }
                      ]}
                      pagination={false}
                    />
                  </Card>
                )
              }] : [])
            ]}
          />
        </Col>

        {/* Charts and Stats */}
        <Col xs={24} lg={8}>
          {/* Priority Distribution */}
          <Card title="Priority Distribution" style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }: any) => `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          {/* Document Completions */}
          <Card title="Document Completions" style={{ marginBottom: 16 }}>
            {dashboardData.document_completions.map(stat => (
              <div key={stat.document_type} style={{ marginBottom: 16 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text>{stat.document_type.toUpperCase()}</Text>
                  <Text strong>{stat.completed_count}</Text>
                </Space>
                <Progress 
                  percent={(stat.completed_count / (stat.completed_count + 5)) * 100} 
                  showInfo={false}
                  strokeColor="#1890ff"
                />
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text type="secondary">Paid: {stat.paid_count}</Text>
                  <Text type="secondary">${(stat.total_amount || 0).toLocaleString()}</Text>
                </Space>
              </div>
            ))}
          </Card>

          {/* Team Stats for Managers/Admins */}
          {isManagerDashboardData(dashboardData) && (
            <Card title="Team Overview" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Statistic
                  title="Team Total Assigned"
                  value={dashboardData.team_total_assigned || 0}
                  prefix={<TeamOutlined />}
                />
                <Statistic
                  title="Team Completed Today"
                  value={dashboardData.team_completed_today || 0}
                  valueStyle={{ color: '#52c41a' }}
                />
                <Statistic
                  title="Team Completed This Week"
                  value={dashboardData.team_completed_this_week || 0}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Space>
            </Card>
          )}

          {/* System Stats for Admins */}
          {isAdminDashboardData(dashboardData) && (
            <Card title="System Overview">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Statistic
                  title="Total Work Orders"
                  value={dashboardData.system_total_work_orders}
                />
                <Statistic
                  title="Companies"
                  value={dashboardData.companies_count}
                  prefix={<TeamOutlined />}
                />
                <Statistic
                  title={`Revenue (${timePeriod})`}
                  value={dashboardData.total_revenue_this_period}
                  prefix="$"
                  precision={2}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Space>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default RoleBasedDashboard;