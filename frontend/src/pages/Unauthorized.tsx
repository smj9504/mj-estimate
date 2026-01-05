import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Result, Typography, Space } from 'antd';
import { HomeOutlined, ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * Unauthorized Page Component
 *
 * Displayed when a user tries to access a route they don't have permission for.
 * Provides clear feedback and navigation options.
 */
const Unauthorized: React.FC = () => {
  const navigate = useNavigate();

  const handleGoHome = (): void => {
    navigate('/dashboard', { replace: true });
  };

  const handleGoBack = (): void => {
    // If there's history, go back; otherwise go to dashboard
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/dashboard', { replace: true });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5',
        padding: '20px',
      }}
    >
      <Result
        status="403"
        title="Access Denied"
        icon={
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#fff2e8',
              margin: '0 auto 16px',
            }}
          >
            <LockOutlined style={{ fontSize: '40px', color: '#fa8c16' }} />
          </div>
        }
        subTitle={
          <div style={{ textAlign: 'center' }}>
            <Text>You don't have permission to access this page.</Text>
            <br />
            <Text type="secondary">
              Please contact your administrator if you believe this is a mistake.
            </Text>
          </div>
        }
        extra={
          <Space wrap>
            <Button
              type="primary"
              size="large"
              icon={<HomeOutlined />}
              onClick={handleGoHome}
            >
              Go to Dashboard
            </Button>
            <Button
              size="large"
              icon={<ArrowLeftOutlined />}
              onClick={handleGoBack}
            >
              Go Back
            </Button>
          </Space>
        }
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '40px',
          maxWidth: '600px',
          margin: '0 auto',
        }}
      />
    </div>
  );
};

export default Unauthorized;
