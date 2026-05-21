import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Typography, Row, Col, Statistic, Table, Tag, Space,
  Button, Alert, Tooltip, Divider, Spin, Badge,
} from 'antd';
import {
  AlertOutlined, DollarOutlined, CheckCircleOutlined,
  ClockCircleOutlined, MailOutlined, FileTextOutlined,
  BuildOutlined, ExclamationCircleOutlined, ArrowRightOutlined,
  ToolOutlined, TeamOutlined, AuditOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { lifecycleService } from '../services/lifecycleService';
import type { PaymentGap, PendingEstimate } from '../services/lifecycleService';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const ClaimsLifecycleDashboard: React.FC = () => {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['lifecycle-stats'],
    queryFn: () => lifecycleService.getStats(),
  });

  const { data: overdueItems = [], isLoading: overdueLoading } = useQuery({
    queryKey: ['lifecycle-overdue'],
    queryFn: () => lifecycleService.getOverdueItems(),
  });

  const { data: paymentGaps = [], isLoading: gapsLoading } = useQuery({
    queryKey: ['lifecycle-payment-gaps'],
    queryFn: () => lifecycleService.getPaymentGaps(100),
  });

  const { data: pendingEstimates = [], isLoading: estimatesLoading } = useQuery({
    queryKey: ['lifecycle-pending-estimates'],
    queryFn: () => lifecycleService.getPendingEstimates(),
  });

  const { data: activeRebuilds = [], isLoading: rebuildsLoading } = useQuery({
    queryKey: ['lifecycle-active-rebuilds'],
    queryFn: () => lifecycleService.getActiveRebuilds(),
  });

  const f = stats?.followup;
  const s = stats?.supplement;
  const r = stats?.rebuild;

  const paymentGapColumns: ColumnsType<PaymentGap> = [
    {
      title: 'Claim #', dataIndex: 'claim_number', width: 110,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Property', dataIndex: 'property_address', ellipsis: true,
      render: (v?: string) => v || '-',
    },
    {
      title: 'Invoice', dataIndex: 'invoice_amount', width: 110, align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Paid', dataIndex: 'insurance_paid', width: 110, align: 'right',
      render: (v: number) => <Text type={v > 0 ? 'success' : undefined}>{formatCurrency(v)}</Text>,
    },
    {
      title: 'Gap', dataIndex: 'difference', width: 110, align: 'right',
      render: (v: number) => <Text type="danger" strong>{formatCurrency(v)}</Text>,
      sorter: (a, b) => b.difference - a.difference,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Supplement', dataIndex: 'needs_supplement', width: 90, align: 'center',
      render: (v: boolean) => v ? <Tag color="warning">Needed</Tag> : '-',
    },
  ];

  const pendingEstimateColumns: ColumnsType<PendingEstimate> = [
    {
      title: 'Claim #', dataIndex: 'claim_number', width: 110,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Insurance', dataIndex: 'insurance_company', width: 140, ellipsis: true,
    },
    {
      title: 'Adjuster', dataIndex: 'adjuster_name', width: 130,
      render: (v?: string) => v || '-',
    },
    {
      title: 'Property', dataIndex: 'property_address', ellipsis: true,
      render: (v?: string) => v || '-',
    },
    {
      title: 'Date of Loss', dataIndex: 'date_of_loss', width: 110,
      render: (v?: string) => v ? dayjs(v).format('MM/DD/YYYY') : '-',
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Claims Lifecycle Dashboard</Title>
        <Button icon={<ReloadOutlined />} onClick={() => refetchStats()}>Refresh</Button>
      </div>

      {/* Top-level Summary Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {/* Follow-up Section */}
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            title={<Space><MailOutlined style={{ color: '#1890ff' }} /><span>Follow-up</span></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/claim-followup')}>View <ArrowRightOutlined /></Button>}
            loading={statsLoading}
          >
            <Row gutter={8}>
              <Col span={12}>
                <Statistic title="Pending" value={f?.pending || 0} valueStyle={{ fontSize: 18 }} />
              </Col>
              <Col span={12}>
                <Statistic title="Awaiting" value={f?.awaiting_response || 0} valueStyle={{ fontSize: 18, color: '#fa8c16' }} />
              </Col>
            </Row>
            {(f?.overdue || 0) > 0 && (
              <Alert message={`${f?.overdue} overdue`} type="error" showIcon
                style={{ marginTop: 8, padding: '4px 8px' }} />
            )}
          </Card>
        </Col>

        {/* Payment Section */}
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            title={<Space><DollarOutlined style={{ color: '#52c41a' }} /><span>Payments</span></Space>}
            loading={gapsLoading}
          >
            <Statistic
              title="Outstanding Gaps"
              value={paymentGaps.length}
              valueStyle={{ fontSize: 18, color: paymentGaps.length > 0 ? '#cf1322' : '#52c41a' }}
            />
            {paymentGaps.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Total: {formatCurrency(paymentGaps.reduce((sum, g) => sum + g.difference, 0))}
                </Text>
              </div>
            )}
          </Card>
        </Col>

        {/* Supplement Section */}
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            title={<Space><FileTextOutlined style={{ color: '#722ed1' }} /><span>Supplements</span></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/supplements')}>View <ArrowRightOutlined /></Button>}
            loading={statsLoading}
          >
            <Row gutter={8}>
              <Col span={12}>
                <Statistic title="Active" value={(s?.identified || 0) + (s?.in_progress || 0) + (s?.submitted || 0)}
                  valueStyle={{ fontSize: 18 }} />
              </Col>
              <Col span={12}>
                <Statistic title="Approved" value={s?.approved || 0}
                  valueStyle={{ fontSize: 18, color: '#52c41a' }} />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Rebuild Section */}
        <Col xs={24} sm={12} lg={6}>
          <Card
            size="small"
            title={<Space><BuildOutlined style={{ color: '#fa8c16' }} /><span>Rebuild</span></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/rebuild-projects')}>View <ArrowRightOutlined /></Button>}
            loading={statsLoading}
          >
            <Row gutter={8}>
              <Col span={12}>
                <Statistic title="In Progress" value={r?.in_progress || 0}
                  valueStyle={{ fontSize: 18, color: '#722ed1' }} />
              </Col>
              <Col span={12}>
                <Statistic title="Completed" value={r?.completed || 0}
                  valueStyle={{ fontSize: 18, color: '#52c41a' }} />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* Left Column */}
        <Col xs={24} lg={12}>
          {/* Overdue Follow-ups */}
          <Card
            size="small"
            title={
              <Space>
                <AlertOutlined style={{ color: '#cf1322' }} />
                <span>Overdue Follow-ups</span>
                <Badge count={overdueItems.length} style={{ backgroundColor: '#cf1322' }} />
              </Space>
            }
            extra={<Button type="link" size="small" onClick={() => navigate('/claim-followup')}>View All</Button>}
            style={{ marginBottom: 16 }}
          >
            {overdueItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 16, color: '#52c41a' }}>
                <CheckCircleOutlined style={{ fontSize: 24, marginBottom: 4 }} />
                <div><Text type="secondary">No overdue tasks</Text></div>
              </div>
            ) : (
              <Table
                dataSource={overdueItems.slice(0, 8)}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Task', dataIndex: 'title', ellipsis: true,
                    render: (t: string) => <Text strong>{t}</Text>,
                  },
                  {
                    title: 'Address', dataIndex: 'property_address', ellipsis: true,
                    render: (v: string) => v || '-',
                  },
                  {
                    title: 'Type', dataIndex: 'task_type', width: 100,
                    render: (t: string) => <Tag>{t.replace('_', ' ')}</Tag>,
                  },
                  {
                    title: 'Due', dataIndex: 'due_date', width: 110,
                    render: (d: string) => (
                      <Tooltip title={dayjs(d).format('MM/DD/YYYY')}>
                        <Text type="danger" style={{ whiteSpace: 'nowrap' }}>{dayjs(d).fromNow()}</Text>
                      </Tooltip>
                    ),
                  },
                  {
                    title: '', width: 40,
                    render: (_, r: any) => (
                      <Button type="link" size="small" onClick={() => navigate(`/claim-followup/${r.id}/email`)}>
                        <MailOutlined />
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          {/* Pending Insurance Estimates */}
          <Card
            size="small"
            title={
              <Space>
                <AuditOutlined style={{ color: '#fa8c16' }} />
                <span>Awaiting Insurance Estimates</span>
                <Badge count={pendingEstimates.length} style={{ backgroundColor: '#fa8c16' }} />
              </Space>
            }
          >
            {pendingEstimates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Text type="secondary">All estimates received</Text>
              </div>
            ) : (
              <Table
                dataSource={pendingEstimates.slice(0, 8)}
                rowKey="claim_id"
                size="small"
                pagination={false}
                columns={pendingEstimateColumns}
              />
            )}
          </Card>
        </Col>

        {/* Right Column */}
        <Col xs={24} lg={12}>
          {/* Payment Gaps */}
          <Card
            size="small"
            title={
              <Space>
                <DollarOutlined style={{ color: '#cf1322' }} />
                <span>Payment Gaps</span>
                <Badge count={paymentGaps.length}
                  style={{ backgroundColor: paymentGaps.length > 0 ? '#cf1322' : '#d9d9d9' }} />
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {paymentGaps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 16, color: '#52c41a' }}>
                <CheckCircleOutlined style={{ fontSize: 24, marginBottom: 4 }} />
                <div><Text type="secondary">All payments up to date</Text></div>
              </div>
            ) : (
              <Table
                dataSource={paymentGaps.slice(0, 8)}
                rowKey="claim_id"
                size="small"
                pagination={false}
                columns={paymentGapColumns}
              />
            )}
          </Card>

          {/* Active Rebuild Projects */}
          <Card
            size="small"
            title={
              <Space>
                <ToolOutlined style={{ color: '#722ed1' }} />
                <span>Active Rebuild Projects</span>
                <Badge count={activeRebuilds.length} style={{ backgroundColor: '#722ed1' }} />
              </Space>
            }
            extra={<Button type="link" size="small" onClick={() => navigate('/rebuild-projects')}>View All</Button>}
          >
            {activeRebuilds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Text type="secondary">No active projects</Text>
              </div>
            ) : (
              <Table
                dataSource={activeRebuilds.slice(0, 8)}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Project', dataIndex: 'title', ellipsis: true,
                    render: (t: string) => <Text strong>{t}</Text>,
                  },
                  {
                    title: 'Contractor', key: 'contractor', width: 130,
                    render: (_, r: any) => r.contractor_name || <Text type="secondary">-</Text>,
                  },
                  {
                    title: 'Contract $', dataIndex: 'contract_amount', width: 110, align: 'right',
                    render: formatCurrency,
                  },
                  {
                    title: 'Docs', width: 70, align: 'center',
                    render: (_, r: any) => {
                      const sent = [r.coc_sent, r.invoice_sent, r.photos_sent].filter(Boolean).length;
                      return <Badge count={`${sent}/3`}
                        style={{ backgroundColor: sent === 3 ? '#52c41a' : '#faad14' }} />;
                    },
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ClaimsLifecycleDashboard;
