import React, { useState, useMemo } from 'react';
import { Card, Radio, Space, Typography, Skeleton, Empty } from 'antd';
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { RevenueData } from '../../services/dashboardService';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export interface RevenueChartProps {
  data: RevenueData[];
  loading?: boolean;
  height?: number;
  showComparison?: boolean;
  title?: string;
}

type ChartType = 'line' | 'area' | 'bar';
type TimeRange = 'daily' | 'weekly' | 'monthly';

const RevenueChart: React.FC<RevenueChartProps> = ({
  data = [],
  loading = false,
  height = 400,
  showComparison = true,
  title = 'Revenue Trend'
}) => {
  const [chartType, setChartType] = useState<ChartType>('area');
  const [timeRange, setTimeRange] = useState<TimeRange>('daily');

  // Process data based on time range
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const sortedData = [...data].sort((a, b) => 
      dayjs(a.date).valueOf() - dayjs(b.date).valueOf()
    );

    switch (timeRange) {
      case 'weekly': {
        const weeklyData = new Map<string, { revenue: number; work_orders: number; count: number }>();
        
        sortedData.forEach(item => {
          const weekStart = dayjs(item.date).startOf('week').format('YYYY-MM-DD');
          const current = weeklyData.get(weekStart) || { revenue: 0, work_orders: 0, count: 0 };
          weeklyData.set(weekStart, {
            revenue: current.revenue + item.revenue,
            work_orders: current.work_orders + item.work_orders,
            count: current.count + 1
          });
        });

        return Array.from(weeklyData.entries()).map(([date, totals]) => ({
          date,
          revenue: totals.revenue,
          work_orders: totals.work_orders,
          displayDate: `${dayjs(date).format('MM/DD')} Week`
        }));
      }

      case 'monthly': {
        const monthlyData = new Map<string, { revenue: number; work_orders: number; count: number }>();
        
        sortedData.forEach(item => {
          const monthStart = dayjs(item.date).startOf('month').format('YYYY-MM-DD');
          const current = monthlyData.get(monthStart) || { revenue: 0, work_orders: 0, count: 0 };
          monthlyData.set(monthStart, {
            revenue: current.revenue + item.revenue,
            work_orders: current.work_orders + item.work_orders,
            count: current.count + 1
          });
        });

        return Array.from(monthlyData.entries()).map(([date, totals]) => ({
          date,
          revenue: totals.revenue,
          work_orders: totals.work_orders,
          displayDate: dayjs(date).format('YYYY-MM')
        }));
      }

      default: // daily
        return sortedData.map(item => ({
          ...item,
          displayDate: dayjs(item.date).format('MM/DD')
        }));
    }
  }, [data, timeRange]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${(value || 0).toLocaleString()}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
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
            {data.displayDate}
          </p>
          <p style={{ margin: '4px 0', color: '#1890ff' }}>
            Revenue: {formatCurrency(data.revenue)}
          </p>
          <p style={{ margin: 0, color: '#52c41a' }}>
            Orders: {data.work_orders} items
          </p>
        </div>
      );
    }
    return null;
  };

  const renderChart = () => {
    const commonProps = {
      data: processedData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 }
    };

    switch (chartType) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="displayDate" 
              stroke="#666"
              fontSize={12}
            />
            <YAxis 
              yAxisId="revenue"
              orientation="left"
              stroke="#1890ff"
              fontSize={12}
              tickFormatter={formatCurrency}
            />
            {showComparison && (
              <YAxis 
                yAxisId="orders"
                orientation="right"
                stroke="#52c41a"
                fontSize={12}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              yAxisId="revenue"
              type="monotone"
              dataKey="revenue"
              stroke="#1890ff"
              strokeWidth={3}
              dot={{ fill: '#1890ff', r: 4 }}
              name="Revenue"
            />
            {showComparison && (
              <Line
                yAxisId="orders"
                type="monotone"
                dataKey="work_orders"
                stroke="#52c41a"
                strokeWidth={2}
                dot={{ fill: '#52c41a', r: 3 }}
                name="Work Orders"
              />
            )}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1890ff" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#1890ff" stopOpacity={0.1}/>
              </linearGradient>
              {showComparison && (
                <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#52c41a" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#52c41a" stopOpacity={0.1}/>
                </linearGradient>
              )}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="displayDate" 
              stroke="#666"
              fontSize={12}
            />
            <YAxis 
              yAxisId="revenue"
              orientation="left"
              stroke="#1890ff"
              fontSize={12}
              tickFormatter={formatCurrency}
            />
            {showComparison && (
              <YAxis 
                yAxisId="orders"
                orientation="right"
                stroke="#52c41a"
                fontSize={12}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area
              yAxisId="revenue"
              type="monotone"
              dataKey="revenue"
              stroke="#1890ff"
              fillOpacity={1}
              fill="url(#colorRevenue)"
              strokeWidth={2}
              name="Revenue"
            />
            {showComparison && (
              <Area
                yAxisId="orders"
                type="monotone"
                dataKey="work_orders"
                stroke="#52c41a"
                fillOpacity={1}
                fill="url(#colorOrders)"
                strokeWidth={2}
                name="Work Orders"
              />
            )}
          </AreaChart>
        );

      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="displayDate" 
              stroke="#666"
              fontSize={12}
            />
            <YAxis 
              yAxisId="revenue"
              orientation="left"
              stroke="#1890ff"
              fontSize={12}
              tickFormatter={formatCurrency}
            />
            {showComparison && (
              <YAxis 
                yAxisId="orders"
                orientation="right"
                stroke="#52c41a"
                fontSize={12}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar
              yAxisId="revenue"
              dataKey="revenue"
              fill="#1890ff"
              name="Revenue"
              radius={[4, 4, 0, 0]}
            />
            {showComparison && (
              <Bar
                yAxisId="orders"
                dataKey="work_orders"
                fill="#52c41a"
                name="Work Orders"
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        );

      default:
        return null;
    }
  };

  const totalRevenue = processedData.reduce((sum, item) => sum + item.revenue, 0);
  const totalOrders = processedData.reduce((sum, item) => sum + item.work_orders, 0);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

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
        <Space>
          <Radio.Group
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            size="small"
          >
            <Radio.Button value="daily">Daily</Radio.Button>
            <Radio.Button value="weekly">Weekly</Radio.Button>
            <Radio.Button value="monthly">Monthly</Radio.Button>
          </Radio.Group>
          
          <Radio.Group
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            size="small"
          >
            <Radio.Button value="area">Area</Radio.Button>
            <Radio.Button value="line">Line</Radio.Button>
            <Radio.Button value="bar">Bar</Radio.Button>
          </Radio.Group>
        </Space>
      }
    >
      {/* Summary Stats */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-around', 
        marginBottom: 20,
        padding: '16px',
        backgroundColor: '#fafafa',
        borderRadius: '6px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <Text strong style={{ fontSize: '18px', color: '#1890ff' }}>
            {formatCurrency(totalRevenue)}
          </Text>
          <br />
          <Text type="secondary">Total Revenue</Text>
        </div>
        <div style={{ textAlign: 'center' }}>
          <Text strong style={{ fontSize: '18px', color: '#52c41a' }}>
            {totalOrders.toLocaleString()} items
          </Text>
          <br />
          <Text type="secondary">Total Orders</Text>
        </div>
        <div style={{ textAlign: 'center' }}>
          <Text strong style={{ fontSize: '18px', color: '#722ed1' }}>
            {formatCurrency(averageOrderValue)}
          </Text>
          <br />
          <Text type="secondary">Average Order Amount</Text>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        {renderChart() || <div />}
      </ResponsiveContainer>
    </Card>
  );
};

export default RevenueChart;