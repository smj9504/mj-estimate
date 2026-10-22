import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Alert, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import authService from '../services/authService';
import AuthLayout, { AuthFieldLabel } from '../components/auth/AuthLayout';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  // Why the link can't be used; a failed save shows `error` on the form instead
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [email, setEmail] = useState<string>('');

  const token = searchParams.get('token');

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setTokenError('Invalid or missing reset token');
        setVerifying(false);
        return;
      }

      try {
        const response = await authService.verifyResetToken(token);
        setTokenValid(true);
        setEmail(response.email || '');
      } catch (err: any) {
        setTokenError(err.response?.data?.detail || 'Invalid or expired reset token');
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
      <AuthLayout>
        <div className="auth-status" role="status">
          <Spin size="small" />
          Checking your reset link…
        </div>
      </AuthLayout>
    );
  }

  if (!tokenValid) {
    return (
      <AuthLayout
        title="Invalid reset link"
        description={tokenError || 'This password reset link is invalid or has expired.'}
      >
        <div className="auth-actions">
          <Button type="primary" size="large" onClick={() => navigate('/forgot-password')}>
            Request a new link
          </Button>
          <Button size="large" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout
        title="Password updated"
        description="Your password has been reset. Taking you to sign in…"
      >
        <div className="auth-actions">
          <Button type="primary" size="large" onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      description={email ? <>For <strong>{email}</strong></> : undefined}
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
        name="reset-password"
        className="auth-form"
        onFinish={onFinish}
        layout="vertical"
        requiredMark={false}
      >
        {/* Lets password managers file the new password under the right account */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />

        <AuthFieldLabel
          htmlFor="reset-password_password"
          action={<span className="auth-label-hint">At least 6 characters</span>}
        >
          New password
        </AuthFieldLabel>
        <Form.Item
          name="password"
          rules={[
            { required: true, message: 'Please enter a new password' },
            { min: 6, message: 'Password must be at least 6 characters' }
          ]}
        >
          <Input.Password size="large" autoComplete="new-password" autoFocus />
        </Form.Item>

        <AuthFieldLabel htmlFor="reset-password_confirmPassword">Confirm new password</AuthFieldLabel>
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
          <Input.Password size="large" autoComplete="new-password" />
        </Form.Item>

        <Form.Item className="auth-submit">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
          >
            Reset password
          </Button>
        </Form.Item>
      </Form>

      <Link to="/login" className="auth-link auth-back">
        <ArrowLeftOutlined aria-hidden="true" /> Back to sign in
      </Link>
    </AuthLayout>
  );
};

export default ResetPassword;
