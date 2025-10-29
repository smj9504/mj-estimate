import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Space, Alert, Result, Spin } from 'antd';
import { LockOutlined, CheckCircleOutlined } from '@ant-design/icons';
import authService from '../services/authService';

const { Title, Text, Link } = Typography;

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [email, setEmail] = useState<string>('');

  const token = searchParams.get('token');

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setError('Invalid or missing reset token');
        setVerifying(false);
        return;
      }

      try {
        const response = await authService.verifyResetToken(token);
        setTokenValid(true);
        setEmail(response.email || '');
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Invalid or expired reset token');
        setTokenValid(false);
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      await authService.confirmPasswordReset({
        token,
        new_password: values.password
      });

      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5'
      }}>
        <Card style={{ width: 400, textAlign: 'center' }}>
          <Space direction="vertical" size="large">
            <Spin size="large" />
            <Text>Verifying reset token...</Text>
          </Space>
        </Card>
      </div>
    );
  }

  if (!tokenValid || error) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5'
      }}>
        <Card style={{ width: 450, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <Result
            status="error"
            title="Invalid Reset Link"
            subTitle={error || "This password reset link is invalid or has expired."}
            extra={[
              <Button type="primary" key="forgot" onClick={() => navigate('/forgot-password')}>
                Request New Link
              </Button>,
              <Button key="login" onClick={() => navigate('/login')}>
                Back to Login
              </Button>
            ]}
          />
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5'
      }}>
        <Card style={{ width: 450, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <Result
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            status="success"
            title="Password Reset Successful"
            subTitle="Your password has been reset. Redirecting to login..."
            extra={
              <Button type="primary" onClick={() => navigate('/login')}>
                Go to Login
              </Button>
            }
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
      backgroundColor: '#f0f2f5'
    }}>
      <Card style={{ width: 450, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2}>Set New Password</Title>
            {email && (
              <Text type="secondary">
                Resetting password for: <strong>{email}</strong>
              </Text>
            )}
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
            name="reset-password"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Please enter a new password' },
                { min: 6, message: 'Password must be at least 6 characters' }
              ]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="New Password"
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
                placeholder="Confirm New Password"
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
                Reset Password
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Link onClick={() => navigate('/login')}>
              Back to Login
            </Link>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default ResetPassword;
