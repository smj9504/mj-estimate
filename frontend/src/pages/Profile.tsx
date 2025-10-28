import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, Typography, Space, Alert, Divider,
  Row, Col, message, Modal
} from 'antd';
import {
  UserOutlined, MailOutlined, PhoneOutlined, LockOutlined,
  SaveOutlined, IdcardOutlined
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/authService';

const { Title, Text } = Typography;

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone || '',
        mobile_phone: user.mobile_phone || '',
      });
    }
  }, [user, form]);

  const handleUpdateProfile = async (values: any) => {
    setLoading(true);
    setError(null);

    try {
      await authService.updateCurrentUser({
        email: values.email,
        first_name: values.first_name,
        last_name: values.last_name,
        phone: values.phone,
        mobile_phone: values.mobile_phone,
      });

      message.success('Profile updated successfully');

      // Reload to get updated user info
      window.location.reload();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to update profile';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (values: any) => {
    setLoading(true);
    setError(null);

    try {
      await authService.changePassword(
        values.current_password,
        values.new_password
      );

      message.success('Password changed successfully');
      setPasswordModalVisible(false);
      passwordForm.resetFields();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Failed to change password';
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

          <Divider />

          <Space direction="vertical" style={{ width: '100%' }}>
            <Text strong>Email Verified</Text>
            <Text type={user.email_verified ? 'success' : 'warning'}>
              {user.email_verified ? 'Verified' : 'Not Verified'}
            </Text>
          </Space>
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
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email' }
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="Email" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="phone"
                  label="Phone Number"
                >
                  <Input prefix={<PhoneOutlined />} placeholder="Phone" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="mobile_phone"
                  label="Mobile Phone"
                >
                  <Input prefix={<PhoneOutlined />} placeholder="Mobile" />
                </Form.Item>
              </Col>
            </Row>

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
                <Button onClick={() => form.resetFields()}>
                  Reset
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* Security Section */}
        <Card title="Security">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>
              Keep your account secure by using a strong password and changing it regularly.
            </Text>
            <Button
              icon={<LockOutlined />}
              onClick={() => setPasswordModalVisible(true)}
            >
              Change Password
            </Button>
          </Space>
        </Card>
      </Space>

      {/* Change Password Modal */}
      <Modal
        title="Change Password"
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          passwordForm.resetFields();
          setError(null);
        }}
        footer={null}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          requiredMark={false}
        >
          <Form.Item
            name="current_password"
            label="Current Password"
            rules={[{ required: true, message: 'Please enter your current password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Current Password"
            />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 6, message: 'Password must be at least 6 characters' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="New Password"
            />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="Confirm New Password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: 'Please confirm your new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Confirm New Password"
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
              >
                Change Password
              </Button>
              <Button onClick={() => {
                setPasswordModalVisible(false);
                passwordForm.resetFields();
              }}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Profile;
