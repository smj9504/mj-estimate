import React from 'react';
import { Space, Typography, Divider } from 'antd';

const { Text } = Typography;

interface SketchStatusBarProps {
  coordinates?: { x: number; y: number };
  selectedTool?: string;
  zoom?: number;
  elementCount?: { rooms: number; walls: number; fixtures: number };
  lastAction?: string;
}

const SketchStatusBar: React.FC<SketchStatusBarProps> = ({
  coordinates = { x: 0, y: 0 },
  selectedTool = 'select',
  zoom = 1,
  elementCount = { rooms: 0, walls: 0, fixtures: 0 },
  lastAction = 'Ready',
}) => {
  const formatCoordinate = (value: number): string => {
    const feet = Math.floor(Math.abs(value) / 12);
    const inches = Math.round(Math.abs(value) % 12);
    const sign = value < 0 ? '-' : '';

    if (feet === 0) {
      return `${sign}${inches}"`;
    } else if (inches === 0) {
      return `${sign}${feet}'`;
    } else {
      return `${sign}${feet}' ${inches}"`;
    }
  };

  return (
    <div
      style={{
        padding: '4px 16px',
        backgroundColor: '#f5f5f5',
        borderTop: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        fontSize: '12px',
        minHeight: '32px',
      }}
    >
      <Space split={<Divider type="vertical" />} size="middle">
        <Text style={{ fontSize: '12px' }}>
          <strong>Tool:</strong> {selectedTool.charAt(0).toUpperCase() + selectedTool.slice(1)}
        </Text>

        <Text style={{ fontSize: '12px' }}>
          <strong>Position:</strong> X: {formatCoordinate(coordinates.x)}, Y: {formatCoordinate(coordinates.y)}
        </Text>

        <Text style={{ fontSize: '12px' }}>
          <strong>Zoom:</strong> {Math.round(zoom * 100)}%
        </Text>

        <Text style={{ fontSize: '12px' }}>
          <strong>Elements:</strong> {elementCount.rooms}R, {elementCount.walls}W, {elementCount.fixtures}F
        </Text>

        <Text style={{ fontSize: '12px', flex: 1 }}>
          <strong>Status:</strong> {lastAction}
        </Text>
      </Space>
    </div>
  );
};

export default SketchStatusBar;