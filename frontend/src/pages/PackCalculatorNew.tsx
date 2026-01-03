/**
 * Pack Calculation Page - New Multi-Mode Interface
 * Supports 5 input modes: MANUAL, BULK_TEXT, TEMPLATE, SMART, HYBRID
 */

import React, { useState } from 'react';
import { Card, Typography, Space, Divider, Alert } from 'antd';
import { ThunderboltOutlined, InfoCircleOutlined } from '@ant-design/icons';
import PackCalculatorMultiMode from '../components/pack-calculation/PackCalculatorMultiMode';

const { Title, Paragraph, Text } = Typography;

const PackCalculatorNew: React.FC = () => {
  const [showOldVersion, setShowOldVersion] = useState(false);

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

        {/* New Feature Announcement */}
        <Alert
          message="🎉 New Multi-Mode Input System"
          description={
            <div>
              <p>
                We've completely redesigned the pack calculation experience! Choose from 5 different input methods:
              </p>
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                <li><strong>Manual Entry</strong> - Traditional item-by-item input</li>
                <li><strong>Bulk Text</strong> - Paste lists from clipboard (saves 15+ minutes!)</li>
                <li><strong>Room Templates</strong> - Pre-configured room types with density adjustment</li>
                <li><strong>Smart AI</strong> - AI-powered density estimation</li>
                <li><strong>Hybrid Mode</strong> - Combine multiple methods for maximum accuracy</li>
              </ul>
            </div>
          }
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          closable
        />

        {/* Main Calculator Component */}
        <PackCalculatorMultiMode />

        <Divider />

        {/* Footer Info */}
        <Card size="small">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text type="secondary">
              <strong>Pro Tips:</strong>
            </Text>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#666' }}>
              <li>Use <strong>Bulk Text</strong> mode to paste lists from spreadsheets or notes</li>
              <li>Use <strong>Room Templates</strong> for quick estimates of common rooms</li>
              <li>Use <strong>Hybrid Mode</strong> to combine templates with manual adjustments</li>
              <li>Higher density levels account for fuller cabinets, closets, and drawers</li>
              <li>All estimates include hidden contents (cabinets, drawers, closets)</li>
            </ul>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default PackCalculatorNew;
