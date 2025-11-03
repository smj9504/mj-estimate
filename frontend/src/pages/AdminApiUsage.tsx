import React, { useEffect, useState } from 'react';
import { Card, Tabs, Table, Statistic, Row, Col, Tag, Space, DatePicker, Select } from 'antd';
import dayjs from 'dayjs';
import { analyticsService, ApiUsageBucket } from '../services/analyticsService';

const { TabPane } = Tabs;

const AdminApiUsage: React.FC = () => {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiUsageBucket[]>([]);
  const [provider, setProvider] = useState<string>('openai');
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await analyticsService.getApiUsage(period, {
        provider,
        start: range ? range[0].toISOString() : undefined,
        end: range ? range[1].toISOString() : undefined,
      });
      setData(res.buckets);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, provider, JSON.stringify(range)]);

  const totals = data.reduce((acc, b) => ({
    requests: acc.requests + b.requests,
    tokens: acc.tokens + b.total_tokens,
    cost: acc.cost + b.cost_usd,
  }), { requests: 0, tokens: 0, cost: 0 });

  const columns = [
    { title: 'Period', dataIndex: 'period', key: 'period' },
    { title: 'Requests', dataIndex: 'requests', key: 'requests' },
    { title: 'Total Tokens', dataIndex: 'total_tokens', key: 'total_tokens' },
    { title: 'Cost (USD)', dataIndex: 'cost_usd', key: 'cost_usd', render: (v: number) => `$${v.toFixed(2)}` },
    {
      title: 'By Service', key: 'by_service',
      render: (_: any, record: ApiUsageBucket) => {
        const entries = Object.entries(record.by_service || {});
        if (!entries.length) return '-';
        return (
          <Space wrap>
            {entries.map(([name, s]) => (
              <Tag key={name} color="blue">{name}: {s.requests} req · ${s.cost_usd.toFixed(2)}</Tag>
            ))}
          </Space>
        );
      }
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><h2>API Usage (Admin)</h2></Col>
        <Col>
          <Space>
            <Select value={provider} onChange={setProvider} style={{ width: 160 }} options={[{ value: 'openai', label: 'OpenAI' }]} />
            <DatePicker.RangePicker value={range as any} onChange={setRange as any} allowClear />
          </Space>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title="Total Requests" value={totals.requests} /></Card></Col>
        <Col span={8}><Card><Statistic title="Total Tokens" value={totals.tokens} /></Card></Col>
        <Col span={8}><Card><Statistic title="Total Cost (USD)" prefix="$" value={totals.cost.toFixed(2)} /></Card></Col>
      </Row>

      <Card>
        <Tabs activeKey={period} onChange={key => setPeriod(key as any)}>
          <TabPane tab="Daily" key="daily" />
          <TabPane tab="Weekly" key="weekly" />
          <TabPane tab="Monthly" key="monthly" />
        </Tabs>
        <Table rowKey="period" loading={loading} columns={columns as any} dataSource={data} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  );
};

export default AdminApiUsage;


