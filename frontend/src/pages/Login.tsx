import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import AuthLayout, { AuthFieldLabel } from '../components/auth/AuthLayout';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || '/todos';

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);

    try {
      await login(values.username, values.password);
      // Check if user is contractor - redirect to contractor portal
      const storedUser = localStorage.getItem('auth_user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        // Someone given a home screen goes there instead
        if (userData.role === 'contractor' && !userData.home_screen) {
          navigate('/contractor-portal', { replace: true });
          return;
        }
      }
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleInitAdmin = async () => {
    try {
      const response = await fetch('/api/auth/init-admin', {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok) {
        setError(null);
        alert(data.message);
      } else {
        setError(data.detail || 'Failed to initialize admin');
      }
    } catch (err) {
      setError('Failed to initialize admin');
    }
  };

  return (
    <AuthLayout title="Sign in to your account">
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
        name="login"
        className="auth-form"
        onFinish={onFinish}
        layout="vertical"
        requiredMark={false}
      >
        <AuthFieldLabel htmlFor="login_username">Username or email</AuthFieldLabel>
        <Form.Item
          name="username"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          <Input
            size="large"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </Form.Item>

        <AuthFieldLabel
          htmlFor="login_password"
          action={<Link to="/forgot-password" className="auth-link">Forgot password?</Link>}
        >
          Password
        </AuthFieldLabel>
        <Form.Item
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password size="large" autoComplete="current-password" />
        </Form.Item>

        <Form.Item className="auth-submit">
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
          >
            Sign in
          </Button>
        </Form.Item>
      </Form>

      {/* Development only: Initialize admin button */}
      {process.env.NODE_ENV === 'development' && (
        <div className="auth-dev">
          <span className="auth-dev-title">Development mode</span>
          <span>Initialize admin account (only once)</span>
          <Button size="small" onClick={handleInitAdmin}>
            Initialize admin
          </Button>
          <span>Username: admin / Password: admin123</span>
        </div>
      )}
    </AuthLayout>
  );
};

export default Login;
