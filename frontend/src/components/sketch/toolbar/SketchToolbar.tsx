import React from 'react';
import { Button, Space, Divider, Tooltip } from 'antd';
import {
  SelectOutlined,
  LineOutlined,
  BorderOutlined,
  AppstoreOutlined,
  ColumnHeightOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { useSketchContext } from '../context/SketchProvider';

const SketchToolbar: React.FC = () => {
  const { currentTool, setCurrentTool } = useSketchContext();
  const tools = [
    { key: 'select', icon: <SelectOutlined />, label: 'Select' },
    { key: 'wall', icon: <LineOutlined />, label: 'Wall' },
    { key: 'room', icon: <BorderOutlined />, label: 'Room' },
    { key: 'fixture', icon: <AppstoreOutlined />, label: 'Fixture' },
    { key: 'measure', icon: <ColumnHeightOutlined />, label: 'Measure' },
    { key: 'wall_split', icon: <ScissorOutlined />, label: 'Split Wall', tooltip: 'Click on a wall to split it at that point' },
  ];

  return (
    <div style={{
      padding: '8px',
      borderBottom: '1px solid #e8e8e8',
      backgroundColor: '#f5f5f5'
    }}>
      <Space size="small">
        {tools.map((tool) => {
          const button = (
            <Button
              key={tool.key}
              type={currentTool === tool.key ? 'primary' : 'default'}
              icon={tool.icon}
              onClick={() => setCurrentTool(tool.key as any)}
              size="small"
            >
              {tool.label}
            </Button>
          );

          return tool.tooltip ? (
            <Tooltip key={tool.key} title={tool.tooltip}>
              {button}
            </Tooltip>
          ) : button;
        })}
        <Divider type="vertical" />
        <Button size="small">Zoom In</Button>
        <Button size="small">Zoom Out</Button>
        <Button size="small">Fit All</Button>
      </Space>
    </div>
  );
};

export default SketchToolbar;