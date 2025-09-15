import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Result, Typography } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

const { Text } = Typography;

const NotFound: React.FC = () => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate('/dashboard', { replace: true });
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      backgroundColor: '#f0f2f5',
      padding: '20px'
    }}>
      <Result
        status="404"
        title="404"
        subTitle={
          <div style={{ textAlign: 'center' }}>
            <Text>Sorry, we couldn't find the page you're looking for.</Text>
            <br />
            <Text type="secondary">The page may have been moved, deleted, or the URL might be incorrect.</Text>
          </div>
        }
        extra={[
          <Button 
            key="home"
            type="primary" 
            size="large"
            icon={<HomeOutlined />}
            onClick={handleGoHome}
          >
            Back to Home
          </Button>,
          <Button 
            key="back" 
            size="large"
            onClick={() => window.history.back()}
          >
            Go Back
          </Button>
        ]}
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '40px',
          maxWidth: '600px',
          margin: '0 auto'
        }}
      />
    </div>
  );
};

export default NotFound;