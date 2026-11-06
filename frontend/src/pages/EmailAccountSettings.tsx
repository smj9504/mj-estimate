import React from 'react';
import { Button, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import EmailAccountsManager from '../components/email-accounts/EmailAccountsManager';

const EmailAccountSettings: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px' }}>
      <Space style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/email-ingestion')}>
          Back to Dashboard
        </Button>
      </Space>

      <EmailAccountsManager variant="admin" />
    </div>
  );
};

export default EmailAccountSettings;
