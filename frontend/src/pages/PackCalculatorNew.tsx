/**
 * Pack Calculation Page - New Multi-Mode Interface
 * Supports 5 input modes: MANUAL, BULK_TEXT, TEMPLATE, SMART, HYBRID
 */

import React from 'react';
import { Card, Typography, Space } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import PackCalculatorMultiMode from '../components/pack-calculation/PackCalculatorMultiMode';

const { Title, Paragraph } = Typography;

const PackCalculatorNew: React.FC = () => {
  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Page Header */}
        <Card>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Title level={2} style={{ margin: 0 }}>
              <ThunderboltOutlined /> Pack-Out/Pack-In Calculator
            </Title>
            <Paragraph style={{ margin: 0, color: '#666' }}>
              Calculate materials and labor for packing/unpacking operations
            </Paragraph>
          </Space>
        </Card>

        {/* Main Calculator Component */}
        <PackCalculatorMultiMode />
      </Space>
    </div>
  );
};

export default PackCalculatorNew;
