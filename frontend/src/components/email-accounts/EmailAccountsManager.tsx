import React, { useState, useRef, useEffect } from 'react';
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
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  MailOutlined,
  SyncOutlined,
  GoogleOutlined,
} from '@ant-design/icons';
import { emailIngestionService } from '../../services/emailIngestionService';
import { companyService } from '../../services/companyService';
import { useAuth } from '../../contexts/AuthContext';
import type { EmailAccount, EmailAccountCreate, EmailAccountUpdate } from '../../types/emailIngestion';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Text } = Typography;

const PRESETS: Record<string, { imap_server: string; imap_port: number; use_ssl: boolean }> = {
  gmail: { imap_server: 'imap.gmail.com', imap_port: 993, use_ssl: true },
  outlook: { imap_server: 'outlook.office365.com', imap_port: 993, use_ssl: true },
  yahoo: { imap_server: 'imap.mail.yahoo.com', imap_port: 993, use_ssl: true },
};

interface Props {
  /**
   * admin: every account the person may see, any company (Email Ingestion).
   * profile: the person's own mailboxes, whatever their role, with how-to
   * steps (My Profile). New ones are theirs and go under one of their companies.
   */
  variant?: 'admin' | 'profile';
}

const EmailAccountsManager: React.FC<Props> = ({ variant = 'admin' }) => {
  const isProfile = variant === 'profile';
  const { user, isAdmin } = useAuth();
  const admin = isAdmin();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: isProfile ? ['email-accounts-mine'] : ['email-accounts-all'],
    queryFn: () => emailIngestionService.listAccounts(isProfile ? { mine: true } : undefined),
  });
  // Both lists and every page's From picker read accounts under an email-accounts key
  const refreshAccounts = () => queryClient.invalidateQueries({
    predicate: q => String(q.queryKey[0]).startsWith('email-accounts'),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-for-email'],
    queryFn: () => companyService.getCompanies(),
  });

  // Profile: new accounts go under one of the person's own companies, which is
  // also all the API lets someone who isn't an admin pick. An admin may have none.
  const ownCompanies = (user?.company_ids ?? []).map(id => ({
    id,
    name: (companies as any[]).find(c => c.id === id)?.name
      || accounts.find(a => a.company_id === id)?.company_name
      || 'Your company',
  }));
  const [filingCompanyId, setFilingCompanyId] = useState<string | undefined>();
  const newAccountCompanyId = isProfile ? (filingCompanyId ?? ownCompanies[0]?.id) : undefined;
  const noOwnCompany = isProfile && !admin && ownCompanies.length === 0;

  const createMutation = useMutation({
    mutationFn: (payload: EmailAccountCreate) => emailIngestionService.createAccount(payload, { mine: isProfile }),
    onSuccess: () => {
      message.success('Account created');
      setModalOpen(false);
      form.resetFields();
      refreshAccounts();
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
      refreshAccounts();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => emailIngestionService.deleteAccount(id),
    onSuccess: () => {
      message.success('Account deleted');
      refreshAccounts();
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed to delete'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => emailIngestionService.testAccount(id),
    onSuccess: (result) => {
      if (result.success) {
        message.success(`Connected! ${result.inbox_count} emails in inbox`);
      } else {
        message.error(result.message);
      }
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Connection test failed'),
  });

  const [oauthLoading, setOauthLoading] = useState(false);
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup popup poll timer on unmount
  useEffect(() => {
    return () => {
      if (oauthPollRef.current) clearInterval(oauthPollRef.current);
    };
  }, []);

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
            company_id: newAccountCompanyId,
          }, { mine: isProfile });
          message.success(`Connected ${account.email_address} via Google OAuth`);
          refreshAccounts();
        } catch (err: any) {
          message.error(err?.response?.data?.detail || 'OAuth connection failed');
        } finally {
          setOauthLoading(false);
        }
      };
      window.addEventListener('message', handler);

      // Fallback: if popup closed without completing (ref-tracked for unmount cleanup)
      if (oauthPollRef.current) clearInterval(oauthPollRef.current);
      oauthPollRef.current = setInterval(() => {
        if (popup?.closed) {
          if (oauthPollRef.current) clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
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
      company_id: newAccountCompanyId,
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
      smtp_server: account.smtp_server || undefined,
      smtp_port: account.smtp_port || undefined,
      send_only: account.provider_type === 'custom' && !!account.smtp_server,
    });
    setModalOpen(true);
  };

  const handleSubmit = (values: any) => {
    const { send_only, ...payload } = values;
    // Send-only custom accounts (Resend etc.) have no real mailbox to poll,
    // so the IMAP fields are never shown/edited by the user - fill dummy
    // values (satisfies the NOT NULL columns) and force auto_schedule off
    // so poll_all_accounts never tries to connect to a nonexistent inbox.
    if (payload.provider_type === 'custom' && send_only) {
      payload.imap_server = payload.imap_server || 'unused.invalid';
      payload.imap_port = payload.imap_port || 993;
      payload.use_ssl = true;
      payload.auto_schedule = undefined;
    }
    if (editingAccount) {
      updateMutation.mutate({ id: editingAccount.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // The account being edited may sit under a company that isn't one of theirs
  const companyOptions = [...ownCompanies];
  if (editingAccount?.company_id && !companyOptions.some(c => c.id === editingAccount.company_id)) {
    companyOptions.push({ id: editingAccount.company_id, name: editingAccount.company_name || 'Company' });
  }

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
    ...(!isProfile || ownCompanies.length !== 1 ? [{
      title: 'Company',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 150,
      render: (v?: string) => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">-</Text>,
    }] : []),
    {
      title: 'Provider',
      dataIndex: 'provider_type',
      key: 'provider_type',
      width: 130,
      render: (v: string, record: EmailAccount) => (
        <Space size={4}>
          <Tag>{v.toUpperCase()}</Tag>
          {v === 'custom' && record.smtp_server && <Tag color="purple">Send-only</Tag>}
        </Space>
      ),
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
      width: isProfile ? 110 : 80,
      render: (v: boolean, record: EmailAccount) => (
        <Space size={4} wrap>
          {v ? <Tag color="green">Active</Tag> : <Tag color="default">Inactive</Tag>}
          {isProfile && record.can_send === false && <Tag>Can't send</Tag>}
        </Space>
      ),
    },
    ...(!isProfile ? [{
      title: 'Last Synced',
      dataIndex: 'last_synced_at',
      key: 'last_synced_at',
      width: 150,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : 'Never',
    }] : []),
    {
      title: 'Actions',
      key: 'actions',
      width: isProfile ? 130 : 200,
      render: (_: any, record: EmailAccount) => {
        // Send-only accounts (Resend etc.) have no inbox - Test Connection
        // and Poll Now both try to open an IMAP session, which always fails
        // for these since there's nothing to authenticate against.
        const isSendOnly = record.provider_type === 'custom' && !!record.smtp_server;
        return (
        <Space size="small">
          {!isSendOnly && (
            <Tooltip title="Test Connection">
              <Button
                size="small"
                icon={<ApiOutlined />}
                aria-label={`Test connection for ${record.email_address}`}
                loading={testingId === record.id && testMutation.isPending}
                onClick={() => {
                  setTestingId(record.id);
                  testMutation.mutate(record.id);
                }}
              />
            </Tooltip>
          )}
          {!isSendOnly && !isProfile && (
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
          )}
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              aria-label={`Edit ${record.email_address}`}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          <Popconfirm title="Delete this account?" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${record.email_address}`} />
          </Popconfirm>
        </Space>
        );
      },
    },
  ];

  const addButtons = (
    <Space wrap>
      <Button
        icon={<GoogleOutlined />}
        loading={oauthLoading}
        disabled={noOwnCompany}
        onClick={handleGoogleConnect}
        style={noOwnCompany ? undefined : { background: '#4285f4', borderColor: '#4285f4', color: '#fff' }}
      >
        Connect with Google
      </Button>
      <Button type="primary" icon={<PlusOutlined />} disabled={noOwnCompany} onClick={openCreateModal}>
        {isProfile ? 'Add manually' : 'Add Account (Manual)'}
      </Button>
    </Space>
  );

  const howTo = (
    <div style={{ marginBottom: 16 }}>
      <Text>
        Your own mailboxes for sending email from this app (to adjusters, contractors, homeowners).
        Shared company inboxes aren't listed here. Add the mailbox you send from:
      </Text>
      <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
        <li>
          <b>Gmail or Google Workspace:</b> click <b>Connect with Google</b>, sign in with that address
          in the window that opens and allow access. No password to type.
        </li>
        <li>
          <b>Outlook, Yahoo or another provider:</b> click <b>Add manually</b>, pick the provider, and
          enter your email address and an <b>app password</b> (not your normal password). Make one in
          your mail account's security settings; for Gmail it's Google Account &gt; Security &gt;
          2-Step Verification &gt; App passwords.
        </li>
        <li>
          Click <EditOutlined aria-label="Edit" /> to add your <b>Sender Name</b> and <b>Sender Phone</b>:
          they go in the signature of what you send.
        </li>
        <li>
          Click <ApiOutlined aria-label="Test Connection" /> to check the account connects.
        </li>
        <li>
          When you send an email in the app, choose this account in the <b>From</b> box.
        </li>
      </ol>
      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        Once a day the app also reads this inbox and files email about a claim on that claim, where
        everyone working the claim can read it. Turn off <b>Active</b> to stop sending and reading.
      </Text>
    </div>
  );

  return (
    <>
      <Card
        title={<><MailOutlined style={{ marginRight: 8 }} />{isProfile ? 'Email Accounts' : 'Email Account Settings'}</>}
        extra={isProfile ? undefined : addButtons}
      >
        {isProfile ? (
          <>
            {howTo}
            {noOwnCompany ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="You aren't in a company yet"
                description="An email account is kept under your company. Ask an admin to add you to your company in User Management."
              />
            ) : (
              <Space wrap style={{ marginBottom: 16 }}>
                {ownCompanies.length > 1 && (
                  <Space size={8}>
                    <Text type="secondary">New accounts go under</Text>
                    <Select
                      size="small"
                      style={{ minWidth: 180 }}
                      value={newAccountCompanyId}
                      onChange={setFilingCompanyId}
                      aria-label="Company for new email accounts"
                      options={ownCompanies.map(c => ({ value: c.id, label: c.name }))}
                    />
                  </Space>
                )}
                {addButtons}
              </Space>
            )}
          </>
        ) : (
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
        )}

        <Table
          columns={columns}
          dataSource={accounts}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          scroll={isProfile ? { x: 600 } : undefined}
          locale={isProfile ? { emptyText: 'No email account of yours yet' } : undefined}
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
            <Input placeholder={isProfile ? 'e.g. My work email' : 'e.g. Claims Inbox'} />
          </Form.Item>

          <Form.Item name="provider_type" label="Provider" rules={[{ required: true }]}>
            <Select onChange={handleProviderChange}>
              <Select.Option value="gmail">Gmail</Select.Option>
              <Select.Option value="outlook">Outlook / Office 365</Select.Option>
              <Select.Option value="yahoo">Yahoo</Select.Option>
              <Select.Option value="custom">Custom IMAP</Select.Option>
            </Select>
          </Form.Item>

          {isProfile ? (
            // Only the person's own companies; with one there's nothing to pick
            <Form.Item
              name="company_id"
              label="Company"
              hidden={companyOptions.length <= 1}
              rules={admin ? [] : [{ required: true, message: 'Choose your company' }]}
            >
              <Select options={companyOptions.map(c => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          ) : (
            <Form.Item name="company_id" label="Company">
              <Select allowClear placeholder="Select company (optional)">
                {companies.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

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

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.provider_type !== cur.provider_type || prev.send_only !== cur.send_only}>
            {({ getFieldValue }) => getFieldValue('provider_type') === 'custom' ? (
              <>
                <Form.Item
                  name="send_only"
                  label="Send-only (no inbox — e.g. Resend)"
                  valuePropName="checked"
                  tooltip="This account only sends mail; there's no mailbox to poll for replies."
                >
                  <Switch />
                </Form.Item>

                {getFieldValue('send_only') ? (
                  <Alert
                    message="Auto-Schedule stays off for send-only accounts — there's no inbox to poll."
                    type="info"
                    style={{ marginBottom: 12 }}
                  />
                ) : (
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
                )}

                <Form.Item
                  name="smtp_server"
                  label="SMTP Server"
                  rules={getFieldValue('send_only') ? [{ required: true }] : []}
                >
                  <Input placeholder="smtp.resend.com" />
                </Form.Item>
                <Form.Item name="smtp_port" label="SMTP Port">
                  <InputNumber style={{ width: '100%' }} placeholder="587" />
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
            tooltip={isProfile
              ? 'Turn off for an inbox you only want read, never sent from. It won\'t appear in the From box.'
              : 'Disable for ingestion-only accounts (e.g. mjestimate1@gmail). They won\'t appear in the From selector.'}>
            <Switch />
          </Form.Item>

          <Alert
            message="Emails are checked automatically once a day (6:00 AM ET)."
            description={isProfile ? undefined : 'Need results sooner? Use the "Poll Now" button on the account list.'}
            type="info"
            showIcon
          />
        </Form>
      </Modal>
    </>
  );
};

export default EmailAccountsManager;
