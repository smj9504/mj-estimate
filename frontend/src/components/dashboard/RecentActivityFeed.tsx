import React, { useState } from 'react';
import { 
  Card, 
  Timeline, 
  Typography, 
  Space, 
  Avatar, 
  Button, 
  Tag, 
  Skeleton, 
  Empty,
  Radio,
  Tooltip,
  Badge
} from 'antd';
import {
  FileTextOutlined,
  UserOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  WarningOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { RecentActivity } from '../../services/dashboardService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/en';

dayjs.extend(relativeTime);
dayjs.locale('en');

const { Text, Title } = Typography;

export interface RecentActivityFeedProps {
  data: RecentActivity[];
  loading?: boolean;
  title?: string;
  maxItems?: number;
  showRefresh?: boolean;
  onRefresh?: () => void;
  onItemClick?: (activity: RecentActivity) => void;
}

type FilterType = 'all' | 'work_order_created' | 'status_changed' | 'payment_received' | 'staff_activity';

const ACTIVITY_ICONS = {
  work_order_created: <PlusCircleOutlined style={{ color: '#52c41a' }} />,
  status_changed: <EditOutlined style={{ color: '#1890ff' }} />,
  payment_received: <DollarOutlined style={{ color: '#722ed1' }} />,
  staff_activity: <UserOutlined style={{ color: '#fa8c16' }} />,
  document_created: <FileTextOutlined style={{ color: '#13c2c2' }} />,
  document_updated: <EditOutlined style={{ color: '#1890ff' }} />,
  document_deleted: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
  system_alert: <WarningOutlined style={{ color: '#fa541c' }} />
};

const ACTIVITY_COLORS = {
  work_order_created: '#52c41a',
  status_changed: '#1890ff',
  payment_received: '#722ed1',
  staff_activity: '#fa8c16',
  document_created: '#13c2c2',
  document_updated: '#1890ff',
  document_deleted: '#ff4d4f',
  system_alert: '#fa541c'
};

const ACTIVITY_LABELS = {
  work_order_created: 'Work Order Created',
  status_changed: 'Status Changed',
  payment_received: 'Payment Received',
  staff_activity: 'Staff Activity',
  document_created: 'Document Created',
  document_updated: 'Document Updated',
  document_deleted: 'Document Deleted',
  system_alert: 'System Alert'
};

const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({
  data = [],
  loading = false,
  title = 'Recent Activity',
  maxItems = 10,
  showRefresh = true,
  onRefresh,
  onItemClick
}) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');

  const filteredData = filter === 'all' 
    ? data 
    : data.filter(item => item.type === filter);

  const displayData = filteredData.slice(0, maxItems);

  const formatRelativeTime = (timestamp: string) => {
    return dayjs(timestamp).fromNow();
  };

  const formatCurrency = (amount: number) => {
    return `$${(amount || 0).toLocaleString()}`;
  };

  const getActivityIcon = (type: string) => {
    return ACTIVITY_ICONS[type as keyof typeof ACTIVITY_ICONS] || <FileTextOutlined />;
  };

  const getActivityColor = (type: string) => {
    return ACTIVITY_COLORS[type as keyof typeof ACTIVITY_COLORS] || '#666';
  };

  const renderTimelineItem = (activity: RecentActivity) => {
    return {
      dot: (
        <Avatar 
          size="small" 
          icon={getActivityIcon(activity.type)}
          style={{ backgroundColor: getActivityColor(activity.type) }}
        />
      ),
      children: (
        <div 
          style={{ 
            cursor: onItemClick ? 'pointer' : 'default',
            padding: '4px 0'
          }}
          onClick={() => onItemClick?.(activity)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <Text strong>{activity.title}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {activity.description}
              </Text>
              
              {/* Additional info based on activity type */}
              <div style={{ marginTop: '8px' }}>
                <Space size="small" wrap>
                  {activity.work_order_number && (
                    <Tag color="blue" style={{ fontSize: '11px' }}>
                      {activity.work_order_number}
                    </Tag>
                  )}
                  {activity.staff_name && (
                    <Tag color="green" style={{ fontSize: '11px' }}>
                      {activity.staff_name}
                    </Tag>
                  )}
                  {activity.amount && (
                    <Tag color="purple" style={{ fontSize: '11px' }}>
                      {formatCurrency(activity.amount)}
                    </Tag>
                  )}
                </Space>
              </div>
            </div>
            
            <div style={{ textAlign: 'right' }}>
              <Text type="secondary" style={{ fontSize: '11px' }}>
                {formatRelativeTime(activity.timestamp)}
              </Text>
            </div>
          </div>
        </div>
      )
    };
  };

  const renderListItem = (activity: RecentActivity) => (
    <div
      key={activity.id}
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        cursor: onItemClick ? 'pointer' : 'default',
        transition: 'background-color 0.2s',
      }}
      className="activity-item"
      onClick={() => onItemClick?.(activity)}
      onMouseEnter={(e) => {
        if (onItemClick) {
          e.currentTarget.style.backgroundColor = '#f5f5f5';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <Avatar 
          size="small" 
          icon={getActivityIcon(activity.type)}
          style={{ 
            backgroundColor: getActivityColor(activity.type),
            marginRight: 12,
            flexShrink: 0
          }}
        />
        
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <Text strong style={{ fontSize: '14px' }}>
                {activity.title}
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {activity.description}
              </Text>
            </div>
            
            <Text type="secondary" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
              {formatRelativeTime(activity.timestamp)}
            </Text>
          </div>
          
          {/* Tags */}
          {(activity.work_order_number || activity.staff_name || activity.amount) && (
            <div style={{ marginTop: '8px' }}>
              <Space size="small" wrap>
                {activity.work_order_number && (
                  <Tag color="blue">
                    {activity.work_order_number}
                  </Tag>
                )}
                {activity.staff_name && (
                  <Tag color="green">
                    {activity.staff_name}
                  </Tag>
                )}
                {activity.amount && (
                  <Tag color="purple">
                    {formatCurrency(activity.amount)}
                  </Tag>
                )}
              </Space>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <Card title={title}>
        <Skeleton avatar paragraph={{ rows: 4 }} active />
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card title={title}>
        <Empty 
          description="No recent activity"
          style={{ padding: '40px 0' }}
        />
      </Card>
    );
  }

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{title}</span>
          <Badge count={displayData.length} showZero color="#1890ff" />
        </div>
      }
      extra={
        <Space>
          {/* Filter buttons */}
          <Radio.Group
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            size="small"
          >
            <Radio.Button value="all">All</Radio.Button>
            <Radio.Button value="work_order_created">Created</Radio.Button>
            <Radio.Button value="status_changed">Status</Radio.Button>
            <Radio.Button value="payment_received">Payment</Radio.Button>
          </Radio.Group>

          {/* View mode toggle */}
          <Radio.Group
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            size="small"
          >
            <Radio.Button value="timeline">Timeline</Radio.Button>
            <Radio.Button value="list">List</Radio.Button>
          </Radio.Group>

          {/* Refresh button */}
          {showRefresh && onRefresh && (
            <Tooltip title="Refresh">
              <Button 
                type="text" 
                icon={<ReloadOutlined />} 
                onClick={onRefresh}
                size="small"
              />
            </Tooltip>
          )}
        </Space>
      }
      styles={{ body: { padding: viewMode === 'list' ? 0 : 24 } }}
    >
      {displayData.length === 0 ? (
        <Empty 
          description={`No filtered activities`}
          style={{ padding: '20px 0' }}
        />
      ) : viewMode === 'timeline' ? (
        <Timeline items={displayData.map(renderTimelineItem)} />
      ) : (
        <div>
          {displayData.map(renderListItem)}
        </div>
      )}

      {/* Show more button */}
      {filteredData.length > maxItems && (
        <div style={{ textAlign: 'center', marginTop: 16, padding: viewMode === 'list' ? 16 : 0 }}>
          <Button type="link" size="small">
            Show More ({filteredData.length - maxItems} more)
          </Button>
        </div>
      )}

      {/* Activity summary */}
      {data.length > 0 && (
        <div style={{ 
          marginTop: 16, 
          padding: '12px',
          backgroundColor: '#fafafa',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#666'
        }}>
          <Space split={<span>•</span>}>
            <span>Total Activities: {data.length} items</span>
            <span>Showing: {displayData.length} items</span>
            <span>Last Updated: {formatRelativeTime(data[0]?.timestamp || new Date().toISOString())}</span>
          </Space>
        </div>
      )}
    </Card>
  );
};

export default RecentActivityFeed;