import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, Typography, Space, Alert, Divider, Select,
  Row, Col, message
} from 'antd';
import {
  UserOutlined, MailOutlined, PhoneOutlined, LockOutlined, SaveOutlined
} from '@ant-design/icons';
import { HOME_CHOICES, HOME_TODOS } from '../constants/screens';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/authService';
import ChangePasswordModal from '../components/auth/ChangePasswordModal';

const { Title, Text } = Typography;

const Profile: React.FC = () => {
  const { user, canAccessPath } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone || '',
        mobile_phone: user.mobile_phone || '',
        home_screen: user.home_screen || HOME_TODOS,
      });
    }
  }, [user, form]);

  const handleUpdateProfile = async (values: any) => {
    setLoading(true);
    setError(null);

    try {
      const updatedUser = await authService.updateCurrentUser({
        first_name: values.first_name,
        last_name: values.last_name,
        phone: values.phone,
        mobile_phone: values.mobile_phone,
        home_screen: values.home_screen,
      });

      // Update localStorage so AuthContext picks up changes on reload
      const storedUser = localStorage.getItem('auth_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        const merged = { ...parsed, ...updatedUser };
        localStorage.setItem('auth_user', JSON.stringify(merged));
      }

      message.success('Profile updated successfully');
      window.location.reload();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to update profile';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert
          message="Not Logged In"
          description="Please log in to view your profile"
          type="warning"
          showIcon
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={2}>My Profile</Title>
          <Text type="secondary">Manage your account information</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            closable
            onClose={() => setError(null)}
          />
        )}

        {/* Account Information Card */}
        <Card title="Account Information">
          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Username</Text>
                <Text>{user.username}</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Staff Number</Text>
                <Text>{user.staff_number || 'N/A'}</Text>
              </Space>
            </Col>
          </Row>

          <Divider />

          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Role</Text>
                <Text>{user.role.replace(/_/g, ' ').toUpperCase()}</Text>
              </Space>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Account Status</Text>
                <Text type={user.is_active ? 'success' : 'danger'}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Text>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Personal Information Form */}
        <Card title="Personal Information">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleUpdateProfile}
            requiredMark={false}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="first_name"
                  label="First Name"
                  rules={[{ required: true, message: 'Please enter your first name' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="First Name" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="last_name"
                  label="Last Name"
                  rules={[{ required: true, message: 'Please enter your last name' }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="Last Name" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="email"
              label="Email"
              extra="Password change codes go here. Ask an admin to change it."
            >
              <Input prefix={<MailOutlined />} disabled />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="phone" label="Phone Number">
                  <Input prefix={<PhoneOutlined />} placeholder="Phone" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="mobile_phone" label="Mobile Phone">
                  <Input prefix={<PhoneOutlined />} placeholder="Mobile" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="home_screen"
              label="Home screen"
              extra="What opens first when you start the app."
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={HOME_CHOICES
                  .filter(c => canAccessPath(c.path))
                  .map(c => ({ value: c.key, label: c.label }))}
              />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={loading}
                >
                  Save Changes
                </Button>
                <Button onClick={() => form.resetFields()}>Reset</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* Security Section */}
        <Card title="Security">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>
              To change your password, we'll email a code to {user.email} to confirm it's you.
            </Text>
            <Button
              icon={<LockOutlined />}
              onClick={() => setPasswordModalVisible(true)}
            >
              Change password
            </Button>
          </Space>
        </Card>
      </Space>

      <ChangePasswordModal
        open={passwordModalVisible}
        email={user.email}
        onClose={() => setPasswordModalVisible(false)}
      />
    </div>
  );
};

export default Profile;
