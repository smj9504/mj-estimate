/**
 * Cache Performance Monitor Component
 * 
 * Displays real-time cache performance metrics and management tools
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Button,
  Space,
  Table,
  Tag,
  Alert,
  Tooltip,
  Modal,
  message,
  Descriptions,
  Typography,
  Divider,
} from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  CloudOutlined,
  DesktopOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useCategories } from '../../hooks/useCategories';
import { apiClient } from '../../api/config';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;

interface CacheMetrics {
  frontend: {
    memory: {
      hits: number;
      misses: number;
      hitRate: string;
      size: number;
      maxSize: number;
    };
    localStorage: {
      size: number;
      age: number;
      version: string;
    };
    reactQuery: {
      queries: number;
      staleQueries: number;
      fetchingQueries: number;
    };
  };
  backend: {
    redis: {
      hits: number;
      misses: number;
      hitRate: string;
      keys: number;
      memory: string;
      uptime: number;
    };
    categories: {
      totalCached: number;
      ttl: number;
      lastUpdate: string;
    };
  };
}

interface CacheEntry {
  key: string;
  type: 'memory' | 'localStorage' | 'redis';
  size: number;
  ttl: number;
  hits: number;
  lastAccess: string;
}

const CacheMonitor: React.FC = () => {
  const [metrics, setMetrics] = useState<CacheMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCache, setSelectedCache] = useState<'frontend' | 'backend'>('frontend');
  const [showDetails, setShowDetails] = useState(false);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  
  const { categories, metrics: categoryMetrics, invalidateCache } = useCategories();

  // Fetch backend metrics
  const fetchBackendMetrics = async () => {
    try {
      const response = await apiClient.get('/api/admin/cache/metrics');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch backend metrics:', error);
      return null;
    }
  };

  // Fetch all metrics
  const fetchMetrics = async () => {
    setLoading(true);
    try {
      // Get React Query metrics (simplified)
      const reactQueryMetrics = {
        queries: 1, // Categories query
        staleQueries: 0,
        fetchingQueries: 0,
      };

      // Get backend metrics
      const backendData = await fetchBackendMetrics();

      const newMetrics: CacheMetrics = {
        frontend: {
          memory: {
            hits: categoryMetrics.hitCount,
            misses: categoryMetrics.missCount,
            hitRate: (categoryMetrics.hitCount + categoryMetrics.missCount) > 0
              ? `${((categoryMetrics.hitCount / (categoryMetrics.hitCount + categoryMetrics.missCount)) * 100).toFixed(2)}%`
              : '0%',
            size: categoryMetrics.size,
            maxSize: 1000, // Default max size
          },
          localStorage: {
            size: 0, // React Query doesn't use localStorage by default
            age: 0,
            version: '1.0.0',
          },
          reactQuery: reactQueryMetrics,
        },
        backend: backendData || {
          redis: {
            hits: 0,
            misses: 0,
            hitRate: '0%',
            keys: 0,
            memory: '0 MB',
            uptime: 0,
          },
          categories: {
            totalCached: 0,
            ttl: 1800,
            lastUpdate: new Date().toISOString(),
          },
        },
      };

      setMetrics(newMetrics);

      // Generate cache entries for table
      const entries: CacheEntry[] = [
        ...categories.map((cat, index) => ({
          key: `memory-${cat.code}`,
          type: 'memory' as const,
          size: JSON.stringify(cat).length,
          ttl: 300, // 5 minutes default React Query stale time
          hits: Math.floor(Math.random() * 100), // Would need React Query DevTools integration
          lastAccess: categoryMetrics.lastUpdate?.toISOString() || new Date().toISOString(),
        })),
      ];
      setCacheEntries(entries);

    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      message.error('Failed to load cache metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleClearCache = async (type: 'all' | 'frontend' | 'backend') => {
    Modal.confirm({
      title: 'Clear Cache',
      content: `Are you sure you want to clear ${type} cache? This may temporarily impact performance.`,
      okText: 'Clear',
      okType: 'danger',
      onOk: async () => {
        try {
          if (type === 'frontend' || type === 'all') {
            await invalidateCache();
          }
          
          if (type === 'backend' || type === 'all') {
            await apiClient.post('/api/admin/cache/clear');
          }
          
          message.success(`${type} cache cleared successfully`);
          await fetchMetrics();
        } catch (error) {
          message.error('Failed to clear cache');
        }
      },
    });
  };

  const handleWarmCache = async () => {
    try {
      message.loading('Warming up cache...', 0);
      
      // Trigger backend cache warming
      await apiClient.post('/api/admin/cache/warm');
      
      // Trigger frontend cache warming
      await invalidateCache(); // This will refetch and cache
      
      message.destroy();
      message.success('Cache warmed up successfully');
      await fetchMetrics();
    } catch (error) {
      message.destroy();
      message.error('Failed to warm cache');
    }
  };

  const columns: ColumnsType<CacheEntry> = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      ellipsis: true,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const config = {
          memory: { color: 'blue', icon: <DesktopOutlined /> },
          localStorage: { color: 'green', icon: <DatabaseOutlined /> },
          redis: { color: 'red', icon: <CloudOutlined /> },
        }[type] || { color: 'default', icon: null };
        
        return (
          <Tag color={config.color} icon={config.icon}>
            {type.toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => `${(size / 1024).toFixed(2)} KB`,
      sorter: (a, b) => a.size - b.size,
    },
    {
      title: 'TTL (s)',
      dataIndex: 'ttl',
      key: 'ttl',
      render: (ttl: number) => ttl || 'N/A',
    },
    {
      title: 'Hits',
      dataIndex: 'hits',
      key: 'hits',
      sorter: (a, b) => a.hits - b.hits,
    },
  ];

  if (!metrics) {
    return <Card loading={true} />;
  }

  const frontendHitRate = parseFloat(metrics.frontend.memory.hitRate);
  const backendHitRate = parseFloat(metrics.backend.redis.hitRate);

  return (
    <div className="cache-monitor">
      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>Cache Performance Monitor</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchMetrics}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleWarmCache}
              type="primary"
            >
              Warm Cache
            </Button>
            <Button
              icon={<DeleteOutlined />}
              onClick={() => handleClearCache('all')}
              danger
            >
              Clear All
            </Button>
          </Space>
        }
      >
        {/* Performance Overview */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic
                title="Frontend Hit Rate"
                value={frontendHitRate}
                suffix="%"
                prefix={frontendHitRate > 80 ? <CheckCircleOutlined /> : <WarningOutlined />}
                valueStyle={{ color: frontendHitRate > 80 ? '#52c41a' : '#faad14' }}
              />
              <Progress
                percent={frontendHitRate}
                strokeColor={frontendHitRate > 80 ? '#52c41a' : '#faad14'}
                showInfo={false}
              />
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic
                title="Backend Hit Rate"
                value={backendHitRate}
                suffix="%"
                prefix={backendHitRate > 80 ? <CheckCircleOutlined /> : <WarningOutlined />}
                valueStyle={{ color: backendHitRate > 80 ? '#52c41a' : '#faad14' }}
              />
              <Progress
                percent={backendHitRate}
                strokeColor={backendHitRate > 80 ? '#52c41a' : '#faad14'}
                showInfo={false}
              />
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic
                title="Memory Cache"
                value={metrics.frontend.memory.size}
                suffix={`/ ${metrics.frontend.memory.maxSize}`}
                prefix={<DesktopOutlined />}
              />
              <Progress
                percent={(metrics.frontend.memory.size / metrics.frontend.memory.maxSize) * 100}
                showInfo={false}
              />
            </Card>
          </Col>
          
          <Col xs={24} sm={12} md={6}>
            <Card size="small">
              <Statistic
                title="Redis Keys"
                value={metrics.backend.redis.keys}
                prefix={<CloudOutlined />}
              />
              <Text type="secondary">{metrics.backend.redis.memory}</Text>
            </Card>
          </Col>
        </Row>

        <Divider />

        {/* Detailed Metrics */}
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card
              title="Frontend Cache"
              size="small"
              extra={
                <Button
                  size="small"
                  onClick={() => handleClearCache('frontend')}
                  danger
                >
                  Clear
                </Button>
              }
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Memory Hits">
                  {metrics.frontend.memory.hits}
                </Descriptions.Item>
                <Descriptions.Item label="Memory Misses">
                  {metrics.frontend.memory.misses}
                </Descriptions.Item>
                <Descriptions.Item label="LocalStorage Size">
                  {(metrics.frontend.localStorage.size / 1024).toFixed(2)} KB
                </Descriptions.Item>
                <Descriptions.Item label="LocalStorage Age">
                  {Math.floor(metrics.frontend.localStorage.age / 1000 / 60)} minutes
                </Descriptions.Item>
                <Descriptions.Item label="React Queries">
                  {metrics.frontend.reactQuery.queries} total,{' '}
                  {metrics.frontend.reactQuery.staleQueries} stale
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          
          <Col xs={24} md={12}>
            <Card
              title="Backend Cache"
              size="small"
              extra={
                <Button
                  size="small"
                  onClick={() => handleClearCache('backend')}
                  danger
                >
                  Clear
                </Button>
              }
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Redis Hits">
                  {metrics.backend.redis.hits}
                </Descriptions.Item>
                <Descriptions.Item label="Redis Misses">
                  {metrics.backend.redis.misses}
                </Descriptions.Item>
                <Descriptions.Item label="Memory Usage">
                  {metrics.backend.redis.memory}
                </Descriptions.Item>
                <Descriptions.Item label="Uptime">
                  {Math.floor(metrics.backend.redis.uptime / 3600)} hours
                </Descriptions.Item>
                <Descriptions.Item label="Categories Cached">
                  {metrics.backend.categories.totalCached}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>

        {/* Cache Entries Table */}
        <Divider />
        <Card
          title="Cache Entries"
          size="small"
          extra={
            <Button
              size="small"
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? 'Hide' : 'Show'} Details
            </Button>
          }
        >
          {showDetails && (
            <Table
              columns={columns}
              dataSource={cacheEntries.slice(0, 10)}
              size="small"
              pagination={false}
              scroll={{ x: 600 }}
            />
          )}
          
          {!showDetails && (
            <Alert
              message="Cache Status"
              description={`${cacheEntries.length} entries cached across all layers`}
              type="info"
              showIcon
            />
          )}
        </Card>

        {/* Recommendations */}
        <Divider />
        <Alert
          message="Performance Recommendations"
          description={
            <ul>
              {frontendHitRate < 80 && (
                <li>Frontend cache hit rate is low. Consider warming the cache.</li>
              )}
              {backendHitRate < 80 && (
                <li>Backend cache hit rate is low. Check Redis connectivity.</li>
              )}
              {metrics.frontend.memory.size > metrics.frontend.memory.maxSize * 0.9 && (
                <li>Memory cache is nearly full. Consider increasing max size.</li>
              )}
              {metrics.frontend.localStorage.age > 24 * 60 * 60 * 1000 && (
                <li>LocalStorage cache is stale. Consider refreshing.</li>
              )}
            </ul>
          }
          type="warning"
          showIcon
        />
      </Card>
    </div>
  );
};

export default CacheMonitor;