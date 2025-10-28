/**
 * Material Detection Page
 * AI-powered construction material detection from images for reconstruction estimates
 */

import React from 'react';
import { Typography, Row, Col } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import MaterialDetection from '../components/reconstruction-estimate/MaterialDetection';

const { Title, Text } = Typography;

const MaterialDetectionPage: React.FC = () => {
  return (
    <div style={{ padding: '24px' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2}>
            <RobotOutlined /> AI Material Detection
          </Title>
          <Text type="secondary">
            Automatically detect and classify construction materials from images
          </Text>
        </Col>
      </Row>

      <MaterialDetection
        onMaterialsDetected={(materials) => {
          console.log('Detected materials:', materials);
        }}
      />
    </div>
  );
};

export default MaterialDetectionPage;
