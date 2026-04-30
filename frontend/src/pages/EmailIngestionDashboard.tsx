import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Typography,
  Row,
  Col,
  Statistic,
  Tabs,
  Tooltip,
  Popconfirm,
  Drawer,
} from 'antd';
import {
  MailOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  UserOutlined,
  LinkOutlined,
  StopOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { emailIngestionService } from '../services/emailIngestionService';
import { clientService } from '../services/clientService';
import type { IngestionLog, IngestionStats, EmailAccount } from '../types/emailIngestion';
import type { ClientListItem } from '../types/client';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  pending: 'orange',
  processing: 'blue',
  classified: 'cyan',
  matched: 'geekblue',
  uploaded: 'green',
  skipped: 'default',
  failed: 'red',
  duplicate: 'purple',
};

const EmailIngestionDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<IngestionLog | null>(null);
  const [skipModalOpen, setSkipModalOpen] = useState(false);
  const [assignForm] = Form.useForm();
  const [skipForm] = Form.useForm();

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['email-ingestion-stats'],
    queryFn: () => emailIngestionService.getStats(),
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['email-ingestion-logs', statusFilter],
    queryFn: () => emailIngestionService.listLogs({ status: statusFilter, limit: 100 }),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

  // Client search for manual assign
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientResults } = useQuery({
    queryKey: ['client-search', clientSearch],
    queryFn: () => clientService.search(clientSearch, 20),
    enabled: clientSearch.length >= 2,
  });

  // Mutations
  const pollAllMutation = useMutation({
    mutationFn: () => emailIngestionService.pollAll(),
    onSuccess: (result) => {
      message.success(`${result.total_uploaded} files uploaded from ${result.accounts_polled} accounts`);
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Polling failed'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ logId, payload }: { logId: string; payload: any }) =>
      emailIngestionService.assignLog(logId, payload),
    onSuccess: () => {
      message.success('Log assigned successfully');
      setAssignModalOpen(false);
      assignForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Assignment failed'),
  });

  const skipMutation = useMutation({
    mutationFn: ({ logId, payload }: { logId: string; payload: any }) =>
      emailIngestionService.skipLog(logId, payload),
    onSuccess: () => {
      message.success('Log skipped');
      setSkipModalOpen(false);
      skipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-logs'] });
      queryClient.invalidateQueries({ queryKey: ['email-ingestion-stats'] });
    },
  });

  const columns: ColumnsType<IngestionLog> = [
    {
      title: 'Date',
      dataIndex: 'received_at',
      key: 'received_at',
      width: 130,
      render: (v: string) => v ? dayjs(v).format('MM/DD HH:mm') : '-',
      sorter: (a, b) => (a.received_at || '').localeCompare(b.received_at || ''),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Account',
      dataIndex: 'account_email',
      key: 'account_email',
      width: 180,
      ellipsis: true,
    },
    {
      title: 'Subject',
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: 'Attachment',
      dataIndex: 'attachment_name',
      key: 'attachment_name',
      width: 200,
      ellipsis: true,
      render: (v: string) => v ? (
        <Tooltip title={v}>
          <FileTextOutlined style={{ marginRight: 4 }} />{v}
        </Tooltip>
      ) : '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>{status.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      key: 'client_name',
      width: 150,
      render: (v: string, record: IngestionLog) => v ? (
        <a onClick={() => record.matched_client_id && navigate(`/clients/${record.matched_client_id}`)}>
          <UserOutlined style={{ marginRight: 4 }} />{v}
        </a>
      ) : <Text type="secondary">-</Text>,
    },
    {
      title: 'Claim',
      dataIndex: 'claim_number',
      key: 'claim_number',
      width: 130,
    },
    {
      title: 'Match',
      dataIndex: 'match_method',
      key: 'match_method',
      width: 100,
      render: (v: string, record: IngestionLog) => v ? (
        <Tooltip title={`Confidence: ${record.match_confidence}%`}>
          <Tag>{v}</Tag>
        </Tooltip>
      ) : null,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, record: IngestionLog) => (
        <Space size="small">
          {(record.status === 'pending' || record.status === 'classified') && (
            <>
              <Tooltip title="Assign to Client/Claim">
                <Button
                  size="small"
                  type="primary"
                  icon={<LinkOutlined />}
                  onClick={() => {
                    setSelectedLog(record);
                    setAssignModalOpen(true);
                  }}
                />
              </Tooltip>
              <Tooltip title="Skip">
                <Button
                  size="small"
                  icon={<StopOutlined />}
                  onClick={() => {
                    setSelectedLog(record);
                    setSkipModalOpen(true);
                  }}
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            <MailOutlined style={{ marginRight: 8 }} />
            Email Ingestion
          </Title>
        </Col>
        <Col>
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => navigate('/email-ingestion/accounts')}
            >
              Account Settings
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={pollAllMutation.isPending}
              onClick={() => pollAllMutation.mutate()}
            >
              Check Emails Now
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Total" value={stats?.total || 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="Uploaded"
              value={stats?.uploaded || 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="Pending"
              value={stats?.pending || 0}
              valueStyle={{ color: '#faad14' }}
              prefix={<ExclamationCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Skipped" value={stats?.skipped || 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="Failed"
              value={stats?.failed || 0}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Duplicates" value={stats?.duplicates || 0} />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Text strong>Filter:</Text>
          <Select
            placeholder="All statuses"
            allowClear
            style={{ width: 160 }}
            value={statusFilter}
            onChange={setStatusFilter}
          >
            <Select.Option value="pending">Pending</Select.Option>
            <Select.Option value="uploaded">Uploaded</Select.Option>
            <Select.Option value="skipped">Skipped</Select.Option>
            <Select.Option value="failed">Failed</Select.Option>
            <Select.Option value="duplicate">Duplicate</Select.Option>
          </Select>
          <Button icon={<ReloadOutlined />} onClick={() => refetchLogs()}>
            Refresh
          </Button>
        </Space>
      </Card>

      {/* Logs Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          loading={logsLoading}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `Total: ${t}` }}
          scroll={{ x: 1200 }}
        />
      </Card>

      {/* Manual Assign Modal */}
      <Modal
        title="Assign to Client / Claim"
        open={assignModalOpen}
        onCancel={() => { setAssignModalOpen(false); assignForm.resetFields(); }}
        onOk={() => assignForm.submit()}
        confirmLoading={assignMutation.isPending}
      >
        <Form
          form={assignForm}
          layout="vertical"
          onFinish={(values) => {
            if (selectedLog) {
              assignMutation.mutate({ logId: selectedLog.id, payload: values });
            }
          }}
        >
          {selectedLog && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
              <Text strong>Email: </Text>{selectedLog.subject}<br />
              <Text strong>File: </Text>{selectedLog.attachment_name}
            </div>
          )}
          <Form.Item name="client_id" label="Client" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Search client..."
              filterOption={false}
              onSearch={setClientSearch}
              notFoundContent={clientSearch.length < 2 ? 'Type to search...' : 'No clients found'}
            >
              {(clientResults as any)?.clients?.map((c: ClientListItem) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.display_name} {c.address ? `- ${c.address}` : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="create_claim" valuePropName="checked" initialValue={true}>
            <Select placeholder="Claim action">
              <Select.Option value={true}>Create new claim</Select.Option>
              <Select.Option value={false}>Select existing claim</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="claim_number" label="Claim Number (for new claim)">
            <Input placeholder="e.g. CLM-2026-001" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Skip Modal */}
      <Modal
        title="Skip This Entry"
        open={skipModalOpen}
        onCancel={() => { setSkipModalOpen(false); skipForm.resetFields(); }}
        onOk={() => skipForm.submit()}
        confirmLoading={skipMutation.isPending}
      >
        <Form
          form={skipForm}
          layout="vertical"
          onFinish={(values) => {
            if (selectedLog) {
              skipMutation.mutate({ logId: selectedLog.id, payload: values });
            }
          }}
        >
          <Form.Item name="reason" label="Reason" rules={[{ required: true, message: 'Please enter a reason' }]}>
            <Input.TextArea rows={3} placeholder="Why skip this email?" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmailIngestionDashboard;
