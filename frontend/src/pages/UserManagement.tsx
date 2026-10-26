import React, { useState, useEffect } from 'react';
import {
  Table, Button, Card, Typography, Space, Modal, Form, Input, Select,
  Tag, message, Popconfirm, Switch, Tooltip, Tabs, Radio, Divider, Alert
} from 'antd';
import {
  PlusOutlined, EditOutlined, LockOutlined, UserOutlined,
  MailOutlined, IdcardOutlined, KeyOutlined
} from '@ant-design/icons';
import authService from '../services/authService';
import { useAuth } from '../contexts/AuthContext';
import ScreenChecklist from '../components/admin/ScreenChecklist';
import ResetPasswordModal from '../components/admin/ResetPasswordModal';
import CompanyMultiSelect, { useCompanyOptions } from '../components/company/CompanyMultiSelect';
import { ALL_SCREEN_KEYS } from '../constants/screens';

const { Title, Text } = Typography;
const { Option } = Select;

// Admins always see every screen
const ADMIN_ROLES = ['admin', 'super_admin'];

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  supervisor: 'Supervisor',
  technician: 'Technician',
  staff: 'Staff',
  sales: 'Sales',
  customer_service: 'Customer Service',
  accountant: 'Accountant',
  viewer: 'Viewer',
  contractor: 'Contractor',
};

interface ScreenSettings {
  screens: string[];
  role_defaults: Record<string, string[]>;
}

interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  staff_number: string;
  is_active: boolean;
  can_login: boolean;
  email_verified: boolean;
  created_at: string;
  screen_access: string[] | null;
  must_change_password?: boolean;
  company_ids?: string[];
}

const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [form] = Form.useForm();
  const formRole: string | undefined = Form.useWatch('role', form);

  const [screenSettings, setScreenSettings] = useState<ScreenSettings | null>(null);
  const [screenMode, setScreenMode] = useState<'role' | 'custom'>('role');
  const [customScreens, setCustomScreens] = useState<string[]>([]);

  const { data: companyOptions = [] } = useCompanyOptions();
  const companyName = (id: string) => companyOptions.find(c => c.id === id)?.name;

  const [defaultsRole, setDefaultsRole] = useState('technician');
  const [defaultsDraft, setDefaultsDraft] = useState<string[]>([]);
  const [savingDefaults, setSavingDefaults] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchScreenSettings();
  }, []);

  useEffect(() => {
    if (screenSettings) {
      setDefaultsDraft(screenSettings.role_defaults[defaultsRole] ?? ALL_SCREEN_KEYS);
    }
  }, [screenSettings, defaultsRole]);

  const fetchScreenSettings = async () => {
    try {
      setScreenSettings(await authService.getScreenAccessSettings());
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to load screen access');
    }
  };

  const roleScreens = (role?: string) =>
    (role && screenSettings?.role_defaults[role]) || ALL_SCREEN_KEYS;

  const handleScreenModeChange = (mode: 'role' | 'custom') => {
    if (mode === 'custom') {
      // Start from what the person sees today
      setCustomScreens(editingUser?.screen_access ?? roleScreens(formRole));
    }
    setScreenMode(mode);
  };

  const handleSaveRoleDefaults = async () => {
    setSavingDefaults(true);
    try {
      setScreenSettings(await authService.updateRoleScreens(defaultsRole, defaultsDraft));
      message.success(`${ROLE_LABELS[defaultsRole]} screens saved`);
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to save role screens');
    } finally {
      setSavingDefaults(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await authService.getUsers();
      setUsers(data);
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = () => {
    setEditingUser(null);
    form.resetFields();
    setScreenMode('role');
    setCustomScreens([]);
    setModalVisible(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      staff_number: user.staff_number,
      role: user.role,
      company_ids: user.company_ids ?? [],
      is_active: user.is_active,
      can_login: user.can_login
    });
    setScreenMode(user.screen_access ? 'custom' : 'role');
    setCustomScreens(user.screen_access ?? []);
    setModalVisible(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      // Admins see everything, so leave whatever list they had alone
      const screen_access = ADMIN_ROLES.includes(values.role)
        ? undefined
        : (screenMode === 'custom' ? customScreens : null);

      if (editingUser) {
        // Update existing user
        await authService.updateUser(editingUser.id, { ...values, screen_access });
        message.success('User updated successfully');
      } else {
        // Create new user
        const created = await authService.register({
          ...values,
          hire_date: new Date().toISOString()
        });
        if (screen_access || values.company_ids?.length) {
          await authService.updateUser(created.id, {
            ...(screen_access ? { screen_access } : {}),
            company_ids: values.company_ids ?? [],
          });
        }
        message.success('User created successfully');
      }

      setModalVisible(false);
      form.resetFields();
      fetchUsers();
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error
        return;
      }
      message.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleToggleActive = async (user: User, active: boolean) => {
    try {
      await authService.updateUser(user.id, { is_active: active });
      message.success(`User ${active ? 'activated' : 'deactivated'} successfully`);
      fetchUsers();
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleToggleLogin = async (user: User, canLogin: boolean) => {
    try {
      await authService.updateUser(user.id, { can_login: canLogin });
      message.success(`Login ${canLogin ? 'enabled' : 'disabled'} successfully`);
      fetchUsers();
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Failed to update user');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => (
        <Space>
          <UserOutlined />
          {text}
        </Space>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'full_name',
      key: 'full_name',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (text: string) => (
        <Space>
          <MailOutlined />
          {text}
        </Space>
      ),
    },
    {
      title: 'Staff Number',
      dataIndex: 'staff_number',
      key: 'staff_number',
      render: (text: string) => (
        <Space>
          <IdcardOutlined />
          {text}
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const colors: Record<string, string> = {
          admin: 'red',
          manager: 'blue',
          supervisor: 'cyan',
          technician: 'green',
          staff: 'default',
          contractor: 'orange',
        };
        return <Tag color={colors[role] || 'default'}>{role.toUpperCase()}</Tag>;
      },
    },
    {
      title: 'Companies',
      key: 'companies',
      render: (_: any, record: User) => {
        const ids = record.company_ids ?? [];
        if (ids.length === 0) {
          return ADMIN_ROLES.includes(record.role)
            ? <Text type="secondary">None</Text>
            : (
              <Tooltip title="Sees no claims, cash jobs or their documents until you add a company">
                <Tag color="orange">No company</Tag>
              </Tooltip>
            );
        }
        return (
          <Space size={[0, 4]} wrap>
            {ids.map(id => <Tag key={id}>{companyName(id) ?? 'Removed company'}</Tag>)}
          </Space>
        );
      },
    },
    {
      title: 'Screens',
      key: 'screens',
      render: (_: any, record: User) => {
        if (ADMIN_ROLES.includes(record.role)) {
          return <Text type="secondary">All (admin)</Text>;
        }
        if (record.screen_access) {
          return <Tag color="purple">Custom · {record.screen_access.length}/{ALL_SCREEN_KEYS.length}</Tag>;
        }
        return <Tag>Role default · {roleScreens(record.role).length}/{ALL_SCREEN_KEYS.length}</Tag>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: User) => (
        <Space>
          <Tooltip title={record.is_active ? 'Active' : 'Inactive'}>
            <Switch
              checked={record.is_active}
              onChange={(checked) => handleToggleActive(record, checked)}
              checkedChildren="Active"
              unCheckedChildren="Inactive"
              size="small"
            />
          </Tooltip>
          <Tooltip title={record.can_login ? 'Can Login' : 'Login Disabled'}>
            <Switch
              checked={record.can_login}
              onChange={(checked) => handleToggleLogin(record, checked)}
              checkedChildren={<LockOutlined />}
              unCheckedChildren={<LockOutlined />}
              size="small"
            />
          </Tooltip>
          {record.must_change_password && (
            <Tooltip title="An admin reset this password; they choose their own at next sign-in">
              <Tag>Temporary password</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: User) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEditUser(record)}
          >
            Edit
          </Button>
          <Tooltip
            title={record.id === currentUser?.id
              ? 'Change your own password from your profile'
              : 'Reset password'}
          >
            <Button
              type="text"
              className="ui-icon-btn"
              icon={<KeyOutlined />}
              aria-label={`Reset password for ${record.username}`}
              disabled={record.id === currentUser?.id}
              onClick={() => setResettingUser(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // People in the selected role who have their own list
  const ownListCount = users.filter(u => u.role === defaultsRole && u.screen_access).length;

  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title level={2}>User Management</Title>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddUser}
            >
              Add User
            </Button>
          </div>

          <Tabs
            items={[
              {
                key: 'users',
                label: 'Users',
                children: (
                  <Table
                    columns={columns}
                    dataSource={users}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                  />
                ),
              },
              {
                key: 'role-screens',
                label: 'Screens by role',
                children: (
                  <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 720 }}>
                    <Text type="secondary">
                      Everyone with this role sees these screens in the sidebar, unless they have their
                      own list. Admins always see every screen.
                    </Text>
                    <Select
                      value={defaultsRole}
                      onChange={setDefaultsRole}
                      style={{ width: 240 }}
                      options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                    {ownListCount > 0 && (
                      <Alert
                        type="info"
                        showIcon
                        message={`${ownListCount} ${ownListCount === 1 ? 'person' : 'people'} with this role ${ownListCount === 1 ? 'has' : 'have'} their own screen list and won't follow these changes.`}
                      />
                    )}
                    <ScreenChecklist
                      value={defaultsDraft}
                      onChange={setDefaultsDraft}
                      disabled={!screenSettings}
                    />
                    <Button
                      type="primary"
                      onClick={handleSaveRoleDefaults}
                      loading={savingDefaults}
                      disabled={!screenSettings}
                    >
                      Save {ROLE_LABELS[defaultsRole]} screens
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      </Card>

      <Modal
        title={editingUser ? 'Edit User' : 'Add New User'}
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        width={720}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: !editingUser, message: 'Please enter username' },
              { min: 3, message: 'Username must be at least 3 characters' }
            ]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="Username" 
              disabled={!!editingUser}
            />
          </Form.Item>

          {!editingUser && (
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Please enter password' },
                { min: 6, message: 'Password must be at least 6 characters' }
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Password" />
            </Form.Item>
          )}

          <Form.Item
            name="staff_number"
            label="Staff Number"
            rules={[{ required: !editingUser, message: 'Please enter staff number' }]}
          >
            <Input 
              prefix={<IdcardOutlined />} 
              placeholder="e.g., EMP001"
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter email' },
              { type: 'email', message: 'Please enter valid email' }
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="Email" />
          </Form.Item>

          <Space style={{ width: '100%' }} size="middle">
            <Form.Item
              name="first_name"
              label="First Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Input placeholder="First Name" />
            </Form.Item>

            <Form.Item
              name="last_name"
              label="Last Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Input placeholder="Last Name" />
            </Form.Item>
          </Space>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select role' }]}
            initialValue="technician"
          >
            <Select placeholder="Select Role">
              <Option value="admin">Admin</Option>
              <Option value="manager">Manager</Option>
              <Option value="supervisor">Supervisor</Option>
              <Option value="technician">Technician</Option>
              <Option value="staff">Staff</Option>
              <Option value="sales">Sales</Option>
              <Option value="customer_service">Customer Service</Option>
              <Option value="contractor">Contractor</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="company_ids"
            label="Companies"
            extra={formRole && ADMIN_ROLES.includes(formRole)
              ? 'Admins see every claim and cash job whatever their companies.'
              : 'They see only the claims and cash jobs these companies work, and the documents on them.'}
          >
            <CompanyMultiSelect placeholder="No company" aria-label="Companies" />
          </Form.Item>

          <Divider orientation="left" plain>Screens</Divider>
          {formRole && ADMIN_ROLES.includes(formRole) ? (
            <Text type="secondary">Admins see every screen.</Text>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
              <Radio.Group
                value={screenMode}
                onChange={e => handleScreenModeChange(e.target.value)}
              >
                <Radio value="role">Same as role{formRole ? ` (${ROLE_LABELS[formRole] ?? formRole})` : ''}</Radio>
                <Radio value="custom">Choose screens for this person</Radio>
              </Radio.Group>
              <ScreenChecklist
                value={screenMode === 'custom' ? customScreens : roleScreens(formRole)}
                onChange={setCustomScreens}
                disabled={screenMode === 'role'}
              />
            </Space>
          )}

          {editingUser && (
            <>
              <Form.Item
                name="is_active"
                label="Active"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="can_login"
                label="Can Login"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <ResetPasswordModal
        user={resettingUser}
        onClose={() => {
          setResettingUser(null);
          fetchUsers(); // shows the Temporary password tag
        }}
      />
    </div>
  );
};

export default UserManagement;
