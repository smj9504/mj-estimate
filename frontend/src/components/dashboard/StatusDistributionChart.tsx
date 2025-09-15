import React, { useState } from 'react';
import { Card, Radio, Space, Typography, List, Avatar, Skeleton, Empty, Tag } from 'antd';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { StatusDistribution } from '../../services/dashboardService';

const { Title, Text } = Typography;

export interface StatusDistributionChartProps {
  data: StatusDistribution[];
  loading?: boolean;
  height?: number;
  title?: string;
  showLegend?: boolean;
  showList?: boolean;
}

type ChartType = 'pie' | 'donut' | 'bar' | 'list';

const STATUS_COLORS = {
  pending: '#faad14',      // Orange
  approved: '#52c41a',     // Green
  in_progress: '#1890ff',  // Blue
  completed: '#722ed1',    // Purple
  cancelled: '#ff4d4f',    // Red
  on_hold: '#d9d9d9',     // Gray
  draft: '#13c2c2',       // Cyan
  rejected: '#f5222d'     // Dark Red
};

const STATUS_ICONS = {
  pending: <ClockCircleOutlined />,
  approved: <CheckCircleOutlined />,
  in_progress: <PlayCircleOutlined />,
  completed: <CheckCircleOutlined />,
  cancelled: <PauseCircleOutlined />,
  on_hold: <PauseCircleOutlined />,
  draft: <ExclamationCircleOutlined />,
  rejected: <ExclamationCircleOutlined />
};

const STATUS_LABELS = {
  pending: 'Pending Approval',
  approved: 'Approved',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  on_hold: 'On Hold',
  draft: 'Draft',
  rejected: 'Rejected'
};

const StatusDistributionChart: React.FC<StatusDistributionChartProps> = ({
  data = [],
  loading = false,
  height = 300,
  title = 'Task Status Distribution',
  showLegend = true,
  showList = true
}) => {
  const [chartType, setChartType] = useState<ChartType>('donut');

  const processedData = data.map(item => ({
    ...item,
    name: STATUS_LABELS[item.status as keyof typeof STATUS_LABELS] || item.status,
    color: STATUS_COLORS[item.status as keyof typeof STATUS_COLORS] || '#d9d9d9',
    icon: STATUS_ICONS[item.status as keyof typeof STATUS_ICONS]
  }));

  const totalCount = processedData.reduce((sum, item) => sum + item.count, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: '#fff',
          border: '1px solid #d9d9d9',
          borderRadius: '6px',
          padding: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>
            {data.name}
          </p>
          <p style={{ margin: '4px 0', color: data.color }}>
            Count: {data.count} items
          </p>
          <p style={{ margin: 0, color: '#666' }}>
            Ratio: {data.percentage.toFixed(1)}%
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomLegend = ({ payload }: any) => {
    return (
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        justifyContent: 'center',
        marginTop: 16,
        gap: '12px'
      }}>
        {payload?.map((entry: any, index: number) => (
          <div
            key={index}
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '12px'
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                backgroundColor: entry.color,
                marginRight: 8,
                borderRadius: '2px'
              }}
            />
            <span>{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderChart = () => {
    switch (chartType) {
      case 'pie':
        return (
          <PieChart>
            <Pie
              data={processedData}
              cx="50%"
              cy="50%"
              outerRadius={height / 3}
              fill="#8884d8"
              dataKey="count"
              label={({ name, percent }: any) => `${name}: ${percent ? (percent * 100).toFixed(1) : 0}%`}
            >
              {processedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        );

      case 'donut':
        return (
          <PieChart>
            <Pie
              data={processedData}
              cx="50%"
              cy="50%"
              innerRadius={height / 6}
              outerRadius={height / 3}
              fill="#8884d8"
              dataKey="count"
            >
              {processedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend content={<CustomLegend />} />}
            
            {/* Center text for donut */}
            <text 
              x="50%" 
              y="50%" 
              textAnchor="middle" 
              dominantBaseline="central"
              style={{ fontSize: '24px', fontWeight: 'bold', fill: '#666' }}
            >
              {totalCount}
            </text>
            <text 
              x="50%" 
              y="50%" 
              dy="20"
              textAnchor="middle" 
              dominantBaseline="central"
              style={{ fontSize: '12px', fill: '#999' }}
            >
              Total Tasks
            </text>
          </PieChart>
        );

      case 'bar':
        return (
          <BarChart data={processedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              angle={-45}
              textAnchor="end"
              height={80}
              fontSize={12}
            />
            <YAxis fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Bar 
              dataKey="count" 
              radius={[4, 4, 0, 0]}
            >
              {processedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        );

      case 'list':
        return null; // List view is rendered separately

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Card title={title}>
        <Skeleton active />
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card title={title}>
        <Empty 
          description="No data available"
          style={{ padding: '40px 0' }}
        />
      </Card>
    );
  }

  return (
    <Card 
      title={title}
      extra={
        <Radio.Group
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
          size="small"
        >
          <Radio.Button value="donut">Donut</Radio.Button>
          <Radio.Button value="pie">Pie</Radio.Button>
          <Radio.Button value="bar">Bar</Radio.Button>
          <Radio.Button value="list">List</Radio.Button>
        </Radio.Group>
      }
    >
      {chartType === 'list' ? (
        <List
          dataSource={processedData.sort((a, b) => b.count - a.count)}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  <Avatar 
                    icon={item.icon} 
                    style={{ backgroundColor: item.color }}
                  />
                }
                title={
                  <Space>
                    <span>{item.name}</span>
                    <Tag color={item.color}>{item.count} items</Tag>
                  </Space>
                }
                description={
                  <div>
                    <div style={{ 
                      width: '100%', 
                      backgroundColor: '#f0f0f0', 
                      borderRadius: '4px',
                      height: '8px',
                      marginBottom: '4px'
                    }}>
                      <div 
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: item.color,
                          height: '100%',
                          borderRadius: '4px',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                    <Text type="secondary">{item.percentage.toFixed(1)}%</Text>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {renderChart() || <div />}
        </ResponsiveContainer>
      )}

      {/* Summary section for non-list views */}
      {chartType !== 'list' && showList && (
        <div style={{ 
          marginTop: 20, 
          padding: '16px', 
          backgroundColor: '#fafafa',
          borderRadius: '6px'
        }}>
          <Title level={5} style={{ margin: '0 0 12px 0' }}>Status Details</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {processedData.map((item, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    backgroundColor: item.color,
                    marginRight: 8,
                    borderRadius: '2px'
                  }}
                />
                <span style={{ fontSize: '14px' }}>
                  {item.name}: <strong>{item.count} items</strong> ({item.percentage.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default StatusDistributionChart;