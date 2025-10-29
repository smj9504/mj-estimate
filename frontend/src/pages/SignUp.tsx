import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Space, Alert, Select } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, PhoneOutlined, IdcardOutlined } from '@ant-design/icons';
import authService from '../services/authService';

const { Title, Text, Link } = Typography;
const { Option } = Select;

interface SignUpFormValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  first_name: string;
  last_name: string;
  staff_number: string;
  role?: string;
}

const SignUp: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: SignUpFormValues) => {
    setLoading(true);
    setError(null);

    try {
      const { confirmPassword, ...registerData } = values;

      await authService.register({
        ...registerData,
        role: registerData.role || 'technician',
        hire_date: new Date().toISOString()
      });

      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5'
      }}>
        <Card style={{ width: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <Alert
            message="Registration Successful"
            description="Your account has been created. Redirecting to login..."
            type="success"
            showIcon
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#f0f2f5',
      padding: '20px'
    }}>
      <Card style={{ width: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2}>Create Account</Title>
            <Text type="secondary">Join MJ Estimate</Text>
          </div>

          {error && (
            <Alert
              message={error}
              type="error"
              closable
              onClose={() => setError(null)}
            />
          )}

          <Form
            form={form}
            name="signup"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[
                { required: true, message: 'Please enter a username' },
                { min: 3, message: 'Username must be at least 3 characters' }
              ]}
            >
              <Input
                size="large"
                prefix={<UserOutlined />}
                placeholder="Username"
              />
            </Form.Item>

            <Form.Item
              name="email"
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email' }
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder="Email"
              />
            </Form.Item>

            <Space style={{ width: '100%' }} size="middle">
              <Form.Item
                name="first_name"
                rules={[{ required: true, message: 'Required' }]}
                style={{ marginBottom: 0, flex: 1 }}
              >
                <Input
                  size="large"
                  placeholder="First Name"
                />
              </Form.Item>

              <Form.Item
                name="last_name"
                rules={[{ required: true, message: 'Required' }]}
                style={{ marginBottom: 0, flex: 1 }}
              >
                <Input
                  size="large"
                  placeholder="Last Name"
                />
              </Form.Item>
            </Space>

            <Form.Item
              name="staff_number"
              rules={[{ required: true, message: 'Please enter staff number' }]}
            >
              <Input
                size="large"
                prefix={<IdcardOutlined />}
                placeholder="Staff Number (e.g., EMP001)"
              />
            </Form.Item>

            <Form.Item
              name="role"
              initialValue="technician"
            >
              <Select size="large" placeholder="Select Role">
                <Option value="technician">Technician</Option>
                <Option value="staff">Staff</Option>
                <Option value="sales">Sales</Option>
                <Option value="customer_service">Customer Service</Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Please enter a password' },
                { min: 6, message: 'Password must be at least 6 characters' }
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Please confirm your password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="Confirm Password"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={loading}
                block
              >
                Create Account
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Text>Already have an account? </Text>
            <Link onClick={() => navigate('/login')}>Sign In</Link>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default SignUp;
