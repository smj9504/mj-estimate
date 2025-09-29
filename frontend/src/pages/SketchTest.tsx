import React, { useRef, useEffect } from 'react';
import { Card, Typography, Alert, Space } from 'antd';
import { SketchOutlined } from '@ant-design/icons';
import SketchCanvas from '../components/sketch/SketchCanvas';
import { applyResponsiveHeight, enableContainerQueries, DEFAULT_HEIGHT_CONFIG } from '../utils/responsiveHeight';

const { Title, Paragraph } = Typography;

const SketchTest: React.FC = () => {
  const sketchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sketchContainerRef.current) {
      // Apply responsive height utilities
      applyResponsiveHeight(sketchContainerRef.current, DEFAULT_HEIGHT_CONFIG);
      enableContainerQueries(sketchContainerRef.current);
    }
  }, []);

  return (
    <div style={{ padding: '0', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header Section - Fixed at top */}
      <header style={{ flexShrink: 0 }}>
        <Card style={{ margin: '0 0 16px 0' }}>
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

      </header>

      {/* Main Content - Takes remaining height */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0, // Important for flex child with overflow
        marginBottom: '16px'
      }}>
        <Card
          title="Sketch Canvas - Full Height"
          style={{
            height: '100%',
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}
          styles={{
            body: {
              padding: 0,
              height: '100%',
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }
          }}
        >
          <div
            ref={sketchContainerRef}
            style={{
              height: '100%',
              width: '100%',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden'
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
      </main>

      {/* Collapsible Side Information */}
      <details style={{ flexShrink: 0 }}>
        <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
          <strong>Features & Instructions</strong> (Click to expand)
        </summary>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {/* Features List */}
          <Card title="Available Features" size="small" style={{ flex: '1 1 400px' }}>
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

          {/* Instructions */}
          <Card title="How to Use" size="small" style={{ flex: '1 1 400px' }}>
            <Space direction="vertical" size="small">
              <Paragraph style={{ margin: 0 }}>
                <strong>Wall Tool:</strong> Click to place wall start point, click again to place end point
              </Paragraph>
              <Paragraph style={{ margin: 0 }}>
                <strong>Room Tool:</strong> Click inside an enclosed area to create a room
              </Paragraph>
              <Paragraph style={{ margin: 0 }}>
                <strong>Fixture Tool:</strong> Select a fixture type and click to place it
              </Paragraph>
              <Paragraph style={{ margin: 0 }}>
                <strong>Select Tool:</strong> Click on elements to select and edit properties
              </Paragraph>
              <Paragraph style={{ margin: 0 }}>
                <strong>Keyboard Shortcuts:</strong> V (Select), W (Wall), R (Room), F (Fixture), M (Measure)
              </Paragraph>
            </Space>
          </Card>
        </div>
      </details>

    </div>
  );
};

export default SketchTest;