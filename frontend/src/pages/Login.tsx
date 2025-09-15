import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Space, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text, Link } = Typography;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || '/dashboard';

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    
    try {
      await login(values.username, values.password);
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
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      backgroundColor: '#f0f2f5'
    }}>
      <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2}>MJ Estimate</Title>
            <Text type="secondary">Sign in to your account</Text>
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
            name="login"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Please enter your username' }]}
            >
              <Input 
                size="large"
                prefix={<UserOutlined />} 
                placeholder="Username or Email" 
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password 
                size="large"
                prefix={<LockOutlined />} 
                placeholder="Password" 
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
                Sign In
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Space split="|">
              <Link onClick={() => navigate('/register')}>Sign Up</Link>
              <Link onClick={() => navigate('/forgot-password')}>Forgot Password</Link>
            </Space>
          </div>

          {/* Development only: Initialize admin button */}
          {process.env.NODE_ENV === 'development' && (
            <Alert
              message="Development Mode"
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text>Initialize admin account (only once)</Text>
                  <Button size="small" onClick={handleInitAdmin}>
                    Initialize Admin
                  </Button>
                  <Text type="secondary">
                    Username: admin / Password: admin123
                  </Text>
                </Space>
              }
              type="info"
              showIcon
            />
          )}
        </Space>
      </Card>
    </div>
  );
};

export default Login;