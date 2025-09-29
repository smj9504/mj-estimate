import React from 'react';
import { Button, Space, Divider } from 'antd';
import {
  SelectOutlined,
  LineOutlined,
  BorderOutlined,
  AppstoreOutlined,
  ColumnHeightOutlined,
} from '@ant-design/icons';

interface SketchToolbarProps {
  activeTool?: string;
  onToolChange?: (tool: string) => void;
}

const SketchToolbar: React.FC<SketchToolbarProps> = ({
  activeTool = 'select',
  onToolChange = () => {},
}) => {
  const tools = [
    { key: 'select', icon: <SelectOutlined />, label: 'Select' },
    { key: 'wall', icon: <LineOutlined />, label: 'Wall' },
    { key: 'room', icon: <BorderOutlined />, label: 'Room' },
    { key: 'fixture', icon: <AppstoreOutlined />, label: 'Fixture' },
    { key: 'measure', icon: <ColumnHeightOutlined />, label: 'Measure' },
  ];

  return (
    <div style={{
      padding: '8px',
      borderBottom: '1px solid #e8e8e8',
      backgroundColor: '#f5f5f5'
    }}>
      <Space size="small">
        {tools.map((tool) => (
          <Button
            key={tool.key}
            type={activeTool === tool.key ? 'primary' : 'default'}
            icon={tool.icon}
            onClick={() => onToolChange(tool.key)}
            size="small"
          >
            {tool.label}
          </Button>
        ))}
        <Divider type="vertical" />
        <Button size="small">Zoom In</Button>
        <Button size="small">Zoom Out</Button>
        <Button size="small">Fit All</Button>
      </Space>
    </div>
  );
};

export default SketchToolbar;