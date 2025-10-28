import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Space, Alert, Result } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { authService } from '../services/api';

const { Title, Text, Link } = Typography;

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.requestPasswordReset(values.email);

      setSuccess(true);
      // In development, show the token
      if (response.token) {
        setResetToken(response.token);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to send reset email. Please try again.');
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
          <Result
            status="success"
            title="Reset Email Sent"
            subTitle="If an account exists with this email, you will receive password reset instructions."
            extra={[
              <Button type="primary" key="login" onClick={() => navigate('/login')}>
                Back to Login
              </Button>,
              resetToken && process.env.NODE_ENV === 'development' && (
                <div key="dev-token" style={{ marginTop: 20 }}>
                  <Alert
                    message="Development Mode"
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Text>Use this token to reset password:</Text>
                        <Input.TextArea
                          value={resetToken}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          readOnly
                        />
                        <Button
                          size="small"
                          onClick={() => navigate(`/reset-password?token=${resetToken}`)}
                        >
                          Go to Reset Password
                        </Button>
                      </Space>
                    }
                    type="info"
                  />
                </div>
              )
            ]}
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
            <Title level={2}>Reset Password</Title>
            <Text type="secondary">
              Enter your email address and we'll send you instructions to reset your password.
            </Text>
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
            name="forgot-password"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            requiredMark={false}
          >
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
                placeholder="Email Address"
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
                Send Reset Instructions
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Link onClick={() => navigate('/login')}>
              <ArrowLeftOutlined /> Back to Login
            </Link>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default ForgotPassword;
