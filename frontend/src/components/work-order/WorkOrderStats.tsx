import React, { useMemo } from 'react';
import { Row, Col, Card, Statistic, Typography } from 'antd';
import {
  FileTextOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { WorkOrder } from '../../types';

const { Text } = Typography;

interface WorkOrderStatsProps {
  workOrders: WorkOrder[];
}

const WorkOrderStats: React.FC<WorkOrderStatsProps> = ({ workOrders }) => {
  const stats = useMemo(() => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const currentYear = now.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);
    
    // Total work orders
    const total = workOrders.length;
    
    // Pending approval count
    const pendingCount = workOrders.filter(wo => wo.status === 'pending').length;
    
    // This week's orders
    const thisWeekCount = workOrders.filter(wo => {
      const createdAt = new Date(wo.created_at);
      return createdAt >= oneWeekAgo;
    }).length;
    
    // Total revenue (completed orders only)
    const totalRevenue = workOrders
      .filter(wo => wo.status === 'completed')
      .reduce((sum, wo) => {
        // Handle final_cost as string or number
        const cost = typeof wo.final_cost === 'string' 
          ? parseFloat(wo.final_cost) || 0 
          : wo.final_cost || 0;
        return sum + cost;
      }, 0);
    
    // Status distribution with date filtering for completed/cancelled
    const allStatuses = ['draft', 'pending', 'approved', 'in_progress', 'completed', 'cancelled'];
    const statusCounts = allStatuses.reduce((acc, status) => {
      if (status === 'completed' || status === 'cancelled') {
        // Filter completed and cancelled by current year
        acc[status] = workOrders.filter(wo => {
          if (wo.status !== status) return false;
          const updatedAt = new Date(wo.updated_at);
          return updatedAt >= yearStart && updatedAt <= yearEnd;
        }).length;
      } else {
        // Show all other statuses regardless of date
        acc[status] = workOrders.filter(wo => wo.status === status).length;
      }
      return acc;
    }, {} as Record<string, number>);
    
    // High priority orders
    const highPriorityCount = workOrders.filter(wo => 
      wo.status === 'pending' || wo.status === 'approved'
    ).length;
    
    return {
      total,
      pendingCount,
      thisWeekCount,
      totalRevenue,
      statusCounts,
      highPriorityCount,
      currentYear,
    };
  }, [workOrders]);

  const getStatusColor = (status: string): string => {
    const colors = {
      draft: '#d9d9d9',
      pending: '#faad14',
      approved: '#1890ff',
      in_progress: '#13c2c2',
      completed: '#52c41a',
      cancelled: '#f5222d',
    };
    return colors[status as keyof typeof colors] || '#d9d9d9';
  };

  const getChangePercentage = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  return (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      {/* Total Work Orders */}
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Total Work Orders"
            value={stats.total}
            prefix={<FileTextOutlined style={{ color: '#1890ff' }} />}
            suffix=" items"
          />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Total number of work orders
          </Text>
        </Card>
      </Col>

      {/* Pending Approval */}
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Pending Approval"
            value={stats.pendingCount}
            prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />}
            suffix=" items"
            valueStyle={{ color: stats.pendingCount > 0 ? '#faad14' : undefined }}
          />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Requires immediate processing
          </Text>
        </Card>
      </Col>

      {/* This Week's Orders */}
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="This Week's Orders"
            value={stats.thisWeekCount}
            prefix={<CalendarOutlined style={{ color: '#13c2c2' }} />}
            suffix=" items"
            valueStyle={{ color: '#13c2c2' }}
          />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Created in the last 7 days
          </Text>
        </Card>
      </Col>

      {/* Total Revenue */}
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="Total Revenue"
            value={stats.totalRevenue}
            prefix={<DollarOutlined style={{ color: '#52c41a' }} />}
            precision={0}
            valueStyle={{ color: '#52c41a' }}
          />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Based on completed work orders
          </Text>
        </Card>
      </Col>

      {/* Status Distribution and Metrics Row */}
      <Col xs={24}>
        <Row gutter={16} style={{ marginTop: 24 }}>
          {/* Status Distribution - 2 columns */}
          <Col xs={24} lg={12}>
            <Card 
              title={`Status Distribution (${stats.currentYear})`} 
              size="small"
              extra={
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  * Completed/Cancelled filtered by year
                </Text>
              }
              style={{ height: '100%' }}
            >
              <Row gutter={[8, 8]} justify="space-between" align="middle" style={{ height: '100%' }}>
                {['draft', 'pending', 'approved', 'in_progress', 'completed', 'cancelled'].map((status) => {
                  const statusLabels = {
                    draft: 'Draft',
                    pending: 'Pending',
                    approved: 'Approved',
                    in_progress: 'In Progress',
                    completed: 'Completed',
                    cancelled: 'Cancelled',
                  };

                  const count = stats.statusCounts[status] || 0;

                  return (
                    <Col key={status} span={4} style={{ display: 'flex', justifyContent: 'center' }}>
                      <div
                        style={{
                          padding: '8px 4px',
                          backgroundColor: getStatusColor(status),
                          borderRadius: '6px',
                          textAlign: 'center',
                          color: status === 'draft' ? '#000' : '#fff',
                          opacity: count === 0 ? 0.6 : 1,
                          width: '100%',
                          minWidth: '60px',
                          maxWidth: '80px',
                        }}
                      >
                        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                          {count}
                        </div>
                        <div style={{ fontSize: '11px', opacity: 0.9 }}>
                          {statusLabels[status as keyof typeof statusLabels]}
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          </Col>

          {/* Metrics - 2 columns */}
          <Col xs={24} lg={12}>
            <Row gutter={16} style={{ height: '100%' }}>
              {/* Completion Rate */}
              <Col xs={24} sm={12}>
                <Card size="small" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Statistic
                    title="Completion Rate"
                    value={
                      stats.total > 0
                        ? ((stats.statusCounts.completed || 0) / stats.total) * 100
                        : 0
                    }
                    suffix="%"
                    precision={1}
                    valueStyle={{ fontSize: '20px', color: '#52c41a' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>

              {/* Active Orders */}
              <Col xs={24} sm={12}>
                <Card size="small" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Statistic
                    title="Active Orders"
                    value={
                      (stats.statusCounts.approved || 0) + 
                      (stats.statusCounts.in_progress || 0)
                    }
                    suffix=" items"
                    valueStyle={{ fontSize: '20px', color: '#1890ff' }}
                    prefix={<ExclamationCircleOutlined />}
                  />
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      </Col>

    </Row>
  );
};

export default WorkOrderStats;