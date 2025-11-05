import React, { useState, useEffect } from 'react';
import {
  Table, Button, Card, Typography, Space, Modal, Form, Input, Select,
  Tag, message, Popconfirm, Switch, Tooltip
} from 'antd';
import {
  PlusOutlined, EditOutlined, LockOutlined, UserOutlined,
  MailOutlined, IdcardOutlined
} from '@ant-design/icons';
import authService from '../services/authService';

const { Title } = Typography;
const { Option } = Select;

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
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchUsers();
  }, []);

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
      is_active: user.is_active,
      can_login: user.can_login
    });
    setModalVisible(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();

      if (editingUser) {
        // Update existing user
        await authService.updateUser(editingUser.id, values);
        message.success('User updated successfully');
      } else {
        // Create new user
        await authService.register({
          ...values,
          hire_date: new Date().toISOString()
        });
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
      render: (text: string, record: User) => (
        <Space>
          <UserOutlined />
          {text}
          {!record.email_verified && (
            <Tag color="warning">Unverified</Tag>
          )}
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
        };
        return <Tag color={colors[role] || 'default'}>{role.toUpperCase()}</Tag>;
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
      render: (_: any, record: User) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEditUser(record)}
          >
            Edit
          </Button>
        </Space>
      ),
    },
  ];

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

          <Table
            columns={columns}
            dataSource={users}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10 }}
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
        width={600}
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
            </Select>
          </Form.Item>

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
    </div>
  );
};

export default UserManagement;
