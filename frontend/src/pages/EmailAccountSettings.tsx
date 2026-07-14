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
  InputNumber,
  Select,
  Switch,
  message,
  Typography,
  Popconfirm,
  Alert,
  Tooltip,
  Result,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  MailOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  GoogleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { emailIngestionService } from '../services/emailIngestionService';
import { companyService } from '../services/companyService';
import type { EmailAccount, EmailAccountCreate, EmailAccountUpdate, PROVIDER_PRESETS } from '../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

const PRESETS: Record<string, { imap_server: string; imap_port: number; use_ssl: boolean }> = {
  gmail: { imap_server: 'imap.gmail.com', imap_port: 993, use_ssl: true },
  outlook: { imap_server: 'outlook.office365.com', imap_port: 993, use_ssl: true },
  yahoo: { imap_server: 'imap.mail.yahoo.com', imap_port: 993, use_ssl: true },
};

const EmailAccountSettings: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; inbox_count?: number } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['email-accounts-all'],
    queryFn: () => emailIngestionService.listAccounts(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-for-email'],
    queryFn: () => companyService.getCompanies(),
  });

  const createMutation = useMutation({
    mutationFn: (payload: EmailAccountCreate) => emailIngestionService.createAccount(payload),
    onSuccess: () => {
      message.success('Account created');
      setModalOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['email-accounts-all'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to create account'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EmailAccountUpdate }) =>
      emailIngestionService.updateAccount(id, payload),
    onSuccess: () => {
      message.success('Account updated');
      setModalOpen(false);
      setEditingAccount(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['email-accounts-all'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => emailIngestionService.deleteAccount(id),
    onSuccess: () => {
      message.success('Account deleted');
      queryClient.invalidateQueries({ queryKey: ['email-accounts-all'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => emailIngestionService.testAccount(id),
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        message.success(`Connected! ${result.inbox_count} emails in inbox`);
      } else {
        message.error(result.message);
      }
    },
  });

  const [oauthLoading, setOauthLoading] = useState(false);

  const handleGoogleConnect = async () => {
    setOauthLoading(true);
    try {
      const { authorization_url } = await emailIngestionService.getOAuthUrl();
      // Open popup for OAuth
      const width = 500, height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        authorization_url,
        'google-oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      // Listen for callback from popup
      const handler = async (event: MessageEvent) => {
        if (event.data?.type !== 'google-oauth-callback') return;
        window.removeEventListener('message', handler);

        if (event.data.error) {
          message.error(`Google sign-in failed: ${event.data.error}`);
          setOauthLoading(false);
          return;
        }

        try {
          const account = await emailIngestionService.connectOAuth({
            code: event.data.code,
          });
          message.success(`Connected ${account.email_address} via Google OAuth`);
          queryClient.invalidateQueries({ queryKey: ['email-accounts-all'] });
        } catch (err: any) {
          message.error(err?.response?.data?.detail || 'OAuth connection failed');
        } finally {
          setOauthLoading(false);
        }
      };
      window.addEventListener('message', handler);

      // Fallback: if popup closed without completing
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setOauthLoading(false);
          window.removeEventListener('message', handler);
        }
      }, 1000);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to start OAuth');
      setOauthLoading(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    const preset = PRESETS[provider];
    if (preset) {
      form.setFieldsValue(preset);
    }
  };

  const openCreateModal = () => {
    setEditingAccount(null);
    form.resetFields();
    form.setFieldsValue({
      provider_type: 'gmail',
      ...PRESETS.gmail,
      use_ssl: true,
      is_active: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (account: EmailAccount) => {
    setEditingAccount(account);
    form.setFieldsValue({
      display_name: account.display_name,
      email_address: account.email_address,
      provider_type: account.provider_type,
      imap_server: account.imap_server,
      imap_port: account.imap_port,
      use_ssl: account.use_ssl,
      username: account.username,
      company_id: account.company_id || undefined,
      sender_name: account.sender_name || undefined,
      sender_phone: account.sender_phone || undefined,
      can_send: account.can_send !== false,
      is_active: account.is_active,
      auto_schedule: account.auto_schedule,
    });
    setModalOpen(true);
  };

  const handleSubmit = (values: any) => {
    if (editingAccount) {
      updateMutation.mutate({ id: editingAccount.id, payload: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const columns: ColumnsType<EmailAccount> = [
    {
      title: 'Name',
      dataIndex: 'display_name',
      key: 'display_name',
    },
    {
      title: 'Email',
      dataIndex: 'email_address',
      key: 'email_address',
      render: (v: string) => <><MailOutlined style={{ marginRight: 4 }} />{v}</>,
    },
    {
      title: 'Company',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 150,
      render: (v?: string) => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: 'Provider',
      dataIndex: 'provider_type',
      key: 'provider_type',
      width: 100,
      render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
    },
    {
      title: 'Auth',
      dataIndex: 'auth_method',
      key: 'auth_method',
      width: 80,
      render: (v: string) => v === 'oauth'
        ? <Tag color="blue"><GoogleOutlined /> OAuth</Tag>
        : <Tag>Password</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (v: boolean) => v
        ? <Tag color="green">Active</Tag>
        : <Tag color="default">Inactive</Tag>,
    },
    {
      title: 'Last Synced',
      dataIndex: 'last_synced_at',
      key: 'last_synced_at',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : 'Never',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: any, record: EmailAccount) => (
        <Space size="small">
          <Tooltip title="Test Connection">
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testingId === record.id && testMutation.isPending}
              onClick={() => {
                setTestingId(record.id);
                testMutation.mutate(record.id);
              }}
            />
          </Tooltip>
          <Tooltip title="Poll Now">
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={async () => {
                try {
                  const result = await emailIngestionService.pollAccount(record.id);
                  message.success(`Found ${result.emails_found} emails, uploaded ${result.uploaded}`);
                } catch {
                  message.error('Polling failed');
                }
              }}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />
          </Tooltip>
          <Popconfirm title="Delete this account?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Space style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/email-ingestion')}>
          Back to Dashboard
        </Button>
      </Space>

      <Card
        title={<><MailOutlined style={{ marginRight: 8 }} />Email Account Settings</>}
        extra={
          <Space>
            <Button
              icon={<GoogleOutlined />}
              loading={oauthLoading}
              onClick={handleGoogleConnect}
              style={{ background: '#4285f4', borderColor: '#4285f4', color: '#fff' }}
            >
              Connect with Google
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              Add Account (Manual)
            </Button>
          </Space>
        }
      >
        <Alert
          message="Recommended: Connect with Google"
          description={
            <span>
              Click <b>"Connect with Google"</b> to link your account with one click (no App Password needed).
              For manual setup, you need to enable 2-Factor Authentication and generate an App Password
              (Google Account &gt; Security &gt; 2-Step Verification &gt; App passwords).
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Table
          columns={columns}
          dataSource={accounts}
          rowKey="id"
          loading={isLoading}
          pagination={false}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingAccount ? 'Edit Email Account' : 'Add Email Account'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingAccount(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="display_name" label="Display Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Claims Inbox" />
          </Form.Item>

          <Form.Item name="provider_type" label="Provider" rules={[{ required: true }]}>
            <Select onChange={handleProviderChange}>
              <Select.Option value="gmail">Gmail</Select.Option>
              <Select.Option value="outlook">Outlook / Office 365</Select.Option>
              <Select.Option value="yahoo">Yahoo</Select.Option>
              <Select.Option value="custom">Custom IMAP</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="company_id" label="Company">
            <Select allowClear placeholder="Select company (optional)">
              {companies.map((c: any) => (
                <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="email_address" label="Email Address" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="claims@mycompany.com" />
          </Form.Item>

          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Email Signature</Text>
            <Form.Item name="sender_name" label="Sender Name" style={{ marginBottom: 8 }}>
              <Input placeholder="e.g. Mila Song" />
            </Form.Item>
            <Form.Item name="sender_phone" label="Sender Phone" style={{ marginBottom: 0 }}>
              <Input placeholder="e.g. (571) 663-3273" />
            </Form.Item>
          </div>

          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input placeholder="Usually same as email address" />
          </Form.Item>

          <Form.Item
            name="password"
            label={editingAccount ? 'Password (leave empty to keep current)' : 'Password / App Password'}
            rules={editingAccount ? [] : [{ required: true }]}
          >
            <Input.Password placeholder={editingAccount ? '(unchanged)' : 'App Password for Gmail'} />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.provider_type !== cur.provider_type}>
            {({ getFieldValue }) => getFieldValue('provider_type') === 'custom' ? (
              <>
                <Form.Item name="imap_server" label="IMAP Server" rules={[{ required: true }]}>
                  <Input placeholder="imap.example.com" />
                </Form.Item>
                <Form.Item name="imap_port" label="Port" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="use_ssl" label="Use SSL" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </>
            ) : (
              <Alert
                message={`IMAP: ${getFieldValue('imap_server') || 'auto'} : ${getFieldValue('imap_port') || 993} (SSL)`}
                type="info"
                style={{ marginBottom: 16 }}
              />
            )}
          </Form.Item>

          <Form.Item name="is_active" label="Active" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>

          <Form.Item name="can_send" label="Can Send (show in From)" valuePropName="checked" initialValue={true}
            tooltip="Disable for ingestion-only accounts (e.g. mjestimate1@gmail). They won't appear in the From selector.">
            <Switch />
          </Form.Item>

          <Form.Item name="auto_schedule" label="Auto Schedule (optional)">
            <Select allowClear placeholder="Manual only">
              <Select.Option value="0 9 * * *">Daily at 9:00 AM</Select.Option>
              <Select.Option value="0 9,15 * * *">Twice daily (9 AM, 3 PM)</Select.Option>
              <Select.Option value="0 9 * * 1-5">Weekdays at 9:00 AM</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmailAccountSettings;
