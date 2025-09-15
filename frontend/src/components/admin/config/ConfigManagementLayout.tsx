/**
 * Configuration Management Layout Component
 * Main layout for all configuration modules with tabs
 */

import React, { useState } from 'react';
import { Card, Tabs, Alert, Space } from 'antd';
import {
  DollarOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import PaymentConfig from './PaymentConfig';
import DocumentTypesConfig from './DocumentTypesConfig';
import TradesConfig from './TradesConfig';

interface ConfigManagementLayoutProps {
  defaultTab?: string;
}

const ConfigManagementLayout: React.FC<ConfigManagementLayoutProps> = ({ 
  defaultTab = 'payment' 
}) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabItems = [
    {
      key: 'payment',
      label: (
        <Space>
          <DollarOutlined />
          Payment
        </Space>
      ),
      children: (
        <>
          <Alert
            message="Payment Configuration"
            description="Manage payment methods and payment frequencies. These settings determine how companies can receive payments and payment schedules."
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
          <PaymentConfig />
        </>
      ),
    },
    {
      key: 'document-types',
      label: (
        <Space>
          <FileTextOutlined />
          Document Types
        </Space>
      ),
      children: (
        <>
          <Alert
            message="Document Types Configuration"
            description="Configure document types and their pricing rules. Set up base prices, location-based pricing, addons, and measurement report requirements for each document type."
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
          <DocumentTypesConfig />
        </>
      ),
    },
    {
      key: 'trades',
      label: (
        <Space>
          <ToolOutlined />
          Trades
        </Space>
      ),
      children: (
        <>
          <Alert
            message="Trades Management"
            description="Manage trades for document classification. Trades are used to categorize work in estimates and invoices. They don't have fixed prices as pricing is determined by document type and specific job requirements."
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
          <TradesConfig />
        </>
      ),
    },
    // Future configuration tabs can be added here
    // Examples:
    // - Tax Rates
    // - Notification Templates
    // - System Settings
  ];

  return (
    <Card
      title={
        <Space>
          <SettingOutlined />
          <span>System Configuration</span>
        </Space>
      }
      style={{ height: '100%' }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        type="card"
      />
    </Card>
  );
};

export default ConfigManagementLayout;