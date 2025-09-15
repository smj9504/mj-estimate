import React from 'react';
import { Card, Statistic, Progress, Typography, Space, Tooltip } from 'antd';
import { 
  ArrowUpOutlined, 
  ArrowDownOutlined, 
  InfoCircleOutlined 
} from '@ant-design/icons';

const { Text } = Typography;

export interface MetricCardProps {
  title: string;
  value: number | string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  precision?: number;
  loading?: boolean;
  trend?: {
    value: number;
    label?: string;
    isPositive?: boolean;
  };
  progress?: {
    percent: number;
    status?: 'normal' | 'success' | 'exception' | 'active';
  };
  tooltip?: string;
  color?: string;
  backgroundColor?: string;
  size?: 'small' | 'default' | 'large';
  extra?: React.ReactNode;
  onClick?: () => void;
  formatter?: (value: number | string) => React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  prefix,
  suffix,
  precision,
  loading = false,
  trend,
  progress,
  tooltip,
  color = '#1890ff',
  backgroundColor,
  size = 'default',
  extra,
  onClick,
  formatter
}) => {
  const getTrendIcon = () => {
    if (!trend) return null;
    
    const isPositive = trend.isPositive ?? trend.value > 0;
    return isPositive ? (
      <ArrowUpOutlined style={{ color: '#52c41a' }} />
    ) : (
      <ArrowDownOutlined style={{ color: '#ff4d4f' }} />
    );
  };

  const getTrendColor = () => {
    if (!trend) return undefined;
    
    const isPositive = trend.isPositive ?? trend.value > 0;
    return isPositive ? '#52c41a' : '#ff4d4f';
  };

  const getCardHeight = () => {
    switch (size) {
      case 'small': return 120;
      case 'large': return 200;
      default: return 160;
    }
  };

  const titleElement = tooltip ? (
    <Space>
      {title}
      <Tooltip title={tooltip}>
        <InfoCircleOutlined style={{ color: '#999' }} />
      </Tooltip>
    </Space>
  ) : title;

  return (
    <Card 
      loading={loading}
      hoverable={!!onClick}
      onClick={onClick}
      style={{ 
        height: getCardHeight(),
        backgroundColor,
        cursor: onClick ? 'pointer' : 'default'
      }}
      styles={{ body: { 
        padding: size === 'small' ? '16px' : '20px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      } }}
      extra={extra}
    >
      <Statistic
        title={titleElement}
        value={value}
        prefix={prefix}
        suffix={suffix}
        precision={precision}
        valueStyle={{ 
          color,
          fontSize: size === 'small' ? '20px' : size === 'large' ? '32px' : '24px',
          fontWeight: 'bold'
        }}
        formatter={formatter}
      />
      
      {/* Trend Display */}
      {trend && (
        <div style={{ marginTop: 8 }}>
          <Space size="small">
            {getTrendIcon()}
            <Text 
              style={{ 
                color: getTrendColor(),
                fontSize: '12px',
                fontWeight: 'bold'
              }}
            >
              {Math.abs(trend.value)}%
            </Text>
            {trend.label && (
              <Text style={{ color: '#999', fontSize: '12px' }}>
                {trend.label}
              </Text>
            )}
          </Space>
        </div>
      )}
      
      {/* Progress Bar */}
      {progress && (
        <div style={{ marginTop: 12 }}>
          <Progress 
            percent={progress.percent} 
            status={progress.status}
            size="small"
            showInfo={false}
          />
          <Text style={{ fontSize: '12px', color: '#999' }}>
            {progress.percent}% Target Achieved
          </Text>
        </div>
      )}
    </Card>
  );
};

export default MetricCard;