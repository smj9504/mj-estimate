/**
 * BESketchToolbar - Bathroom Estimate Sketch toolbar
 *
 * Tools: Select, Wall, Room, Fixture, Measure, Tile Zone, Damage Zone
 * Actions: Undo, Redo, Zoom controls, Settings toggles
 */

import React from 'react';
import { Button, Space, Divider, Tooltip, Switch, Typography } from 'antd';
import {
  SelectOutlined,
  LineOutlined,
  BorderOutlined,
  AppstoreOutlined,
  ColumnHeightOutlined,
  CalculatorOutlined,
  WarningOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  TableOutlined,
} from '@ant-design/icons';
import type { BESketchTool } from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';

const { Text } = Typography;

interface BESketchToolbarProps {
  api: BESketchStateAPI;
}

const TOOLS: { key: BESketchTool; icon: React.ReactNode; label: string; tooltip: string }[] = [
  { key: 'select', icon: <SelectOutlined />, label: 'Select', tooltip: 'Select and move elements' },
  { key: 'wall', icon: <LineOutlined />, label: 'Wall', tooltip: 'Draw walls' },
  { key: 'room', icon: <BorderOutlined />, label: 'Room', tooltip: 'Click vertices to draw polygon room (dbl-click to close). Shift+drag for rectangle.' },
  { key: 'fixture', icon: <AppstoreOutlined />, label: 'Fixture', tooltip: 'Place bathroom fixtures (tub, shower, vanity, toilet)' },
  { key: 'measure', icon: <ColumnHeightOutlined />, label: 'Measure', tooltip: 'Measure distances' },
  { key: 'tile_zone', icon: <CalculatorOutlined />, label: 'Tile', tooltip: 'View and configure tile zones' },
  { key: 'damage_zone', icon: <WarningOutlined />, label: 'Damage', tooltip: 'Mark water damage / cement board areas' },
];

const BESketchToolbar: React.FC<BESketchToolbarProps> = ({ api }) => {
  const { activeTool, setActiveTool, undo, redo, canUndo, canRedo, data, updateSettings } = api;

  return (
    <div
      style={{
        padding: '4px 8px',
        borderBottom: '1px solid #e8e8e8',
        backgroundColor: '#fafafa',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Tools */}
      <Space size={2} style={{ flexShrink: 0 }}>
        {TOOLS.map((t) => (
          <Tooltip key={t.key} title={t.tooltip}>
            <Button
              type={activeTool === t.key ? 'primary' : 'default'}
              icon={t.icon}
              size="small"
              onClick={() => setActiveTool(t.key)}
              style={{ padding: '0 6px', fontSize: 12 }}
            />
          </Tooltip>
        ))}
      </Space>

      <Divider type="vertical" style={{ margin: '0 2px' }} />

      {/* Actions */}
      <Space size={2} style={{ flexShrink: 0 }}>
        <Divider type="vertical" style={{ display: 'none' }} />

        {/* Undo / Redo */}
        <Tooltip title="Undo (Ctrl+Z)">
          <Button size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Y)">
          <Button size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
        </Tooltip>

        <Divider type="vertical" style={{ margin: '0 2px' }} />

        <Tooltip title="Toggle grid">
          <Button
            size="small"
            icon={<TableOutlined />}
            type={data.settings.showGrid ? 'primary' : 'default'}
            ghost={data.settings.showGrid}
            onClick={() => updateSettings({ showGrid: !data.settings.showGrid })}
          />
        </Tooltip>
        <Tooltip title="Toggle dimensions">
          <Button
            size="small"
            icon={<EyeOutlined />}
            type={data.settings.showDimensions ? 'primary' : 'default'}
            ghost={data.settings.showDimensions}
            onClick={() => updateSettings({ showDimensions: !data.settings.showDimensions })}
          />
        </Tooltip>
      </Space>
    </div>
  );
};

export default BESketchToolbar;
