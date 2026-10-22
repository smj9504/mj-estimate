import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import authService from '../services/authService';
import AuthLayout, { AuthFieldLabel } from '../components/auth/AuthLayout';

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The address the instructions went to; set once the request succeeds
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const onFinish = async (values: { email: string }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authService.requestPasswordReset(values.email);

      setSentTo(values.email);
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

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        description={
          <>
            If an account exists for <strong>{sentTo}</strong>, you will receive password
            reset instructions.
          </>
        }
      >
        <div className="auth-actions">
          <Button type="primary" size="large" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
          <button
            type="button"
            className="auth-link-button"
            onClick={() => {
              setSentTo(null);
              setResetToken(null);
            }}
          >
            Use a different email
          </button>
        </div>

        {resetToken && process.env.NODE_ENV === 'development' && (
          <div className="auth-dev">
            <span className="auth-dev-title">Development mode</span>
            <span>Use this token to reset password:</span>
            <Input.TextArea
              value={resetToken}
              autoSize={{ minRows: 2, maxRows: 4 }}
              readOnly
            />
            <Button
              size="small"
              onClick={() => navigate(`/reset-password?token=${resetToken}`)}
            >
              Go to reset password
            </Button>
          </div>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email address and we'll send you instructions to reset your password."
    >
      {error && (
        <Alert
          className="auth-alert"
          message={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}

      <Form
        form={form}
        name="forgot-password"
        className="auth-form"
        onFinish={onFinish}
        layout="vertical"
        requiredMark={false}
      >
        <AuthFieldLabel htmlFor="forgot-password_email">Email</AuthFieldLabel>
        <Form.Item
          name="email"
          rules={[
            { required: true, message: 'Please enter your email' },
            { type: 'email', message: 'Please enter a valid email' }
          ]}
        >
          <Input
            size="large"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            autoFocus
          />
        </Form.Item>

        <Form.Item className="auth-submit">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
          >
            Send reset instructions
          </Button>
        </Form.Item>
      </Form>

      <Link to="/login" className="auth-link auth-back">
        <ArrowLeftOutlined aria-hidden="true" /> Back to sign in
      </Link>
    </AuthLayout>
  );
};

export default ForgotPassword;
