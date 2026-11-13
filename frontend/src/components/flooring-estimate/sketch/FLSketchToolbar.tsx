/**
 * Tools of the flooring sketch, undo/redo, zoom and the save state.
 */

import React from 'react';
import { Button, Select, Space, Tag, Tooltip } from 'antd';
import {
  AimOutlined, BorderOutlined, DragOutlined, ExpandOutlined, RedoOutlined, SelectOutlined, UndoOutlined,
  ZoomInOutlined, ZoomOutOutlined,
} from '@ant-design/icons';
import type { FixtureType } from '../../../types/flooringEstimate';
import type { SketchTool } from './FLSketchCanvas';
import type { SaveStatus } from './hooks/useSketchAutosave';
import { FIXTURE_LABELS } from './utils/sketchOps';

interface ToolbarProps {
  tool: SketchTool;
  fixtureType: FixtureType;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  readOnly?: boolean;
  compact?: boolean;
  onTool: (tool: SketchTool) => void;
  onFixtureType: (type: FixtureType) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onZoom: (factor: number) => void;
}

const POLYGON_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 3h8v4h4v7H2z" />
  </svg>
);
const DOOR_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 14h12M4 14V3M4 3a11 11 0 0 1 10 11" />
  </svg>
);
const OPEN_WALL_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 3v10h12V3" />
    <path d="M2 3h12" strokeDasharray="2 2" />
  </svg>
);
const WALL_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2 13h12" />
    <rect x="7" y="4" width="2.5" height="9" fill="currentColor" stroke="none" />
  </svg>
);
const CABINET_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <rect x="1.5" y="4" width="13" height="8" />
    <path d="M8 4v8M5.5 7.5v1M10.5 7.5v1" />
  </svg>
);

const STATUS: Record<SaveStatus, { color: string; text: string }> = {
  saved: { color: 'default', text: 'Saved' },
  pending: { color: 'default', text: 'Unsaved changes' },
  saving: { color: 'processing', text: 'Saving…' },
  error: { color: 'error', text: 'Not saved — retrying on the next change' },
};

const FLSketchToolbar: React.FC<ToolbarProps> = ({
  tool, fixtureType, canUndo, canRedo, status, readOnly, compact,
  onTool, onFixtureType, onUndo, onRedo, onFit, onZoom,
}) => {
  const toolButton = (key: SketchTool, label: string, icon: React.ReactNode, hint: string) => (
    <Tooltip title={hint} key={key}>
      <Button
        size="small"
        type={tool === key ? 'primary' : 'default'}
        icon={icon}
        onClick={() => onTool(key)}
        aria-pressed={tool === key}
        data-testid={`tool-${key}`}
      >
        {compact ? null : label}
      </Button>
    </Tooltip>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <Space wrap size={4}>
        {toolButton('select', 'Select', <SelectOutlined />, 'Select, move, drag corners (V)')}
        {toolButton('pan', 'Pan', <DragOutlined />, 'Move the view')}
        {!readOnly && (
          <>
            {toolButton('rect', 'Room', <BorderOutlined />, 'Drag out a rectangular room (R)')}
            {toolButton('polygon', 'Shape', POLYGON_ICON, 'Click corner by corner; type a wall length as you go (P)')}
            {toolButton('opening', 'Door', DOOR_ICON, 'Click a wall to put a doorway in it (D)')}
            {toolButton('openwall', 'Open wall', OPEN_WALL_ICON, 'Click a wall to take it out: that side is open, with no wall or baseboard')}
            {toolButton('wall', 'Wall', WALL_ICON, 'Drag out from a wall to build a wall onto it; a click makes a 2\' wall (W)')}
            {toolButton('cabinet', 'Cabinets', CABINET_ICON, 'Drag along a wall where base cabinets stand')}
            {toolButton('fixture', 'Fixture', <AimOutlined />, 'Click to place the fixture picked on the right')}
            <Select
              size="small"
              value={fixtureType}
              style={{ width: 128 }}
              onChange={(t) => {
                onFixtureType(t);
                onTool('fixture');
              }}
              options={(Object.keys(FIXTURE_LABELS) as FixtureType[]).map((t) => ({ value: t, label: FIXTURE_LABELS[t] }))}
              aria-label="Fixture to place"
              virtual={false}
              listHeight={400}
            />
          </>
        )}
      </Space>
      <Space wrap size={4}>
        {!readOnly && (
          <>
            <Tooltip title="Undo (Ctrl+Z)">
              <Button size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} aria-label="Undo" />
            </Tooltip>
            <Tooltip title="Redo (Ctrl+Shift+Z)">
              <Button size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} aria-label="Redo" />
            </Tooltip>
          </>
        )}
        <Button size="small" icon={<ZoomOutOutlined />} onClick={() => onZoom(1 / 1.25)} aria-label="Zoom out" />
        <Button size="small" icon={<ZoomInOutlined />} onClick={() => onZoom(1.25)} aria-label="Zoom in" />
        <Tooltip title="Fit the drawing">
          <Button size="small" icon={<ExpandOutlined />} onClick={onFit} aria-label="Fit" />
        </Tooltip>
        {!readOnly && (
          <Tag color={STATUS[status].color} style={{ marginInlineEnd: 0 }} data-testid="sketch-save-status">
            {STATUS[status].text}
          </Tag>
        )}
      </Space>
    </div>
  );
};

export default FLSketchToolbar;
