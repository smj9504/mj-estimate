import React from 'react';
import { Card, Typography, Alert, Space } from 'antd';
import { SketchOutlined } from '@ant-design/icons';
import SketchCanvas from '../components/sketch/SketchCanvas';

const { Title, Paragraph } = Typography;

const SketchTest: React.FC = () => {
  return (
    <div style={{ padding: '0' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header Section */}
        <Card>
          <Space align="center">
            <SketchOutlined style={{ fontSize: '32px', color: '#1890ff' }} />
            <div>
              <Title level={2} style={{ margin: 0 }}>
                Interior Sketch Test
              </Title>
              <Paragraph type="secondary" style={{ margin: 0 }}>
                Test the interior sketch functionality with room drawing and fixture placement
              </Paragraph>
            </div>
          </Space>
        </Card>

        {/* Status Alert */}
        <Alert
          message="Development Status"
          description="This is a test environment for the Interior Sketch feature. All drawing and data will be saved to the development database."
          type="info"
          showIcon
        />

        {/* Features List */}
        <Card title="Available Features" size="small">
          <Space direction="vertical" size="small">
            <div>✅ Wall drawing with mouse/touch</div>
            <div>✅ Room creation from connected walls</div>
            <div>✅ Fixture placement (doors, windows, cabinets)</div>
            <div>✅ Measurement display in feet and inches (12' 6")</div>
            <div>✅ Area calculations (sq ft)</div>
            <div>✅ Multiple rooms per sketch</div>
            <div>🔧 Wall splitting and joining (in development)</div>
            <div>🔧 Precise dimension input (in development)</div>
            <div>🔧 ESX export (future feature)</div>
          </Space>
        </Card>

        {/* Main Sketch Canvas */}
        <Card
          title="Sketch Canvas - Height Fix Test"
          style={{ minHeight: '600px' }}
          styles={{ body: { padding: 0 } }}
        >
          <div style={{
            height: '580px',
            width: '100%',
            border: '1px solid #e8e8e8',
            position: 'relative'
          }}>
            <SketchCanvas
              instanceId="sketch-height-test"
              width="100%"
              height="100%"
              showToolbar={true}
              showSidebar={true}
              showStatusBar={true}
            />
          </div>
        </Card>

        {/* Instructions */}
        <Card title="How to Use" size="small">
          <Space direction="vertical" size="small">
            <Paragraph>
              <strong>Wall Tool:</strong> Click to place wall start point, click again to place end point
            </Paragraph>
            <Paragraph>
              <strong>Room Tool:</strong> Click inside an enclosed area to create a room
            </Paragraph>
            <Paragraph>
              <strong>Fixture Tool:</strong> Select a fixture type and click to place it
            </Paragraph>
            <Paragraph>
              <strong>Select Tool:</strong> Click on elements to select and edit properties
            </Paragraph>
            <Paragraph>
              <strong>Keyboard Shortcuts:</strong> V (Select), W (Wall), R (Room), F (Fixture), M (Measure)
            </Paragraph>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default SketchTest;