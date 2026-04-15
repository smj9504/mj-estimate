/**
 * WMSketchToolbar
 *
 * Horizontal toolbar with grouped tool buttons for the WM sketch canvas.
 *
 * Tool groups (left → right):
 *   [Select] | [Demo ▾] | [Equipment ▾] | [Containment] | [Floor Protection]
 *   --- | [Undo] [Redo] | [Save*]
 *
 * Usage:
 *   <WMSketchToolbar
 *     activeTool={activeTool}
 *     activeMaterialTypeId={activeMaterialTypeId}
 *     activeEquipmentType={activeEquipmentType}
 *     materialTypes={materialTypes}
 *     onToolChange={setTool}
 *     onMaterialTypeChange={setActiveMaterialType}
 *     onEquipmentTypeChange={setActiveEquipmentType}
 *     onSave={save}
 *     onUndo={undo}
 *     onRedo={redo}
 *     canUndo={canUndo}
 *     canRedo={canRedo}
 *     isSaving={isSaving}
 *     isDirty={isDirty}
 *   />
 */

import React from 'react';
import {
  Button,
  Dropdown,
  Space,
  Tooltip,
  Badge,
  Divider,
  Popover,
  theme,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SelectOutlined,
  BorderOutlined,
  ToolOutlined,
  DashOutlined,
  ColumnWidthOutlined,
  SkinOutlined,
  FontSizeOutlined,
  UndoOutlined,
  RedoOutlined,
  SaveOutlined,
  DownOutlined,
  QuestionCircleOutlined,
  LineOutlined,
  GatewayOutlined,
  ScissorOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import type {
  WMSketchTool,
  DemoMaterialType,
  EquipmentType,
  ShapePreset,
} from '../../../types/wmSketch';
import { EQUIPMENT_CONFIG, SHAPE_PRESETS, getEffectiveRenderMode } from '../../../types/wmSketch';

// Space.Compact is available in antd v5+; aliased for readability
const { Compact: SpaceCompact } = Space;

// ============================================================================
// Props
// ============================================================================

export interface WMSketchToolbarProps {
  activeTool: WMSketchTool;
  activeMaterialTypeId: string | null;
  activeEquipmentType: EquipmentType | null;
  activeShapePresetId?: string | null;
  materialTypes: DemoMaterialType[];
  onToolChange: (tool: WMSketchTool) => void;
  onMaterialTypeChange: (materialTypeId: string) => void;
  onEquipmentTypeChange: (equipmentType: EquipmentType) => void;
  onShapePresetChange?: (presetId: string) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isSaving: boolean;
  isDirty: boolean;
}

// ============================================================================
// Color Swatch helper
// ============================================================================

const ColorSwatch: React.FC<{ color: string }> = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 12,
      height: 12,
      borderRadius: 2,
      background: color,
      border: '1px solid rgba(0,0,0,0.15)',
      flexShrink: 0,
    }}
  />
);

// ============================================================================
// Hand / Pan icon (not available in @ant-design/icons v5.6)
// ============================================================================

const HandIcon: React.FC = () => (
  <span role="img" className="anticon" style={{ display: 'inline-flex' }}>
    <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
      <path d="M456.4 138.6c-26.5 0-48 21.5-48 48v301.2h-0.2V302.6c0-26.5-21.5-48-48-48s-48 21.5-48 48v256.6l-44.4-73.6c-14-23.3-44.3-30.8-67.5-16.7-23.3 14-30.8 44.3-16.7 67.5l142 235.6c6.2 10.3 15.2 35.2 15.2 56.6v51.4c0 17.7 14.3 32 32 32h352c17.7 0 32-14.3 32-32V768c0-27 10-53.3 28.1-73.4l78-86.6c17.5-19.4 27.3-44.8 27.3-71.2V302.6c0-26.5-21.5-48-48-48s-48 21.5-48 48v186h-0.2V234.6c0-26.5-21.5-48-48-48s-48 21.5-48 48v254h-0.2V186.6c0-26.5-21.5-48-48-48z" />
    </svg>
  </span>
);

// ============================================================================
// Equipment shape icon helper
// ============================================================================

const EquipmentShapeIcon: React.FC<{ color: string; shape: string }> = ({ color, shape }) => {
  const size = 14;
  if (shape === 'circle') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
        <circle cx="7" cy="7" r="6" fill={color} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      </svg>
    );
  }
  if (shape === 'triangle') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
        <polygon points="7,1 13,13 1,13" fill={color} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      </svg>
    );
  }
  // cylinder — draw as rounded rect
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <rect x="2" y="1" width="10" height="12" rx="3" fill={color} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
    </svg>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const WMSketchToolbar: React.FC<WMSketchToolbarProps> = ({
  activeTool,
  activeMaterialTypeId,
  activeEquipmentType,
  activeShapePresetId = null,
  materialTypes,
  onToolChange,
  onMaterialTypeChange,
  onEquipmentTypeChange,
  onShapePresetChange = () => {},
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isSaving,
  isDirty,
}) => {
  const { token } = theme.useToken();

  // Active material for demo button label
  const activeMaterial = materialTypes.find((m) => m.id === activeMaterialTypeId);
  const activeEquipConfig = activeEquipmentType ? EQUIPMENT_CONFIG[activeEquipmentType] : null;
  const activeShapePreset = SHAPE_PRESETS.find((p) => p.id === activeShapePresetId);

  // ------------------------------------------------------------------
  // Demolition dropdown menu (grouped by render mode)
  // ------------------------------------------------------------------
  const areaMaterials = materialTypes.filter((m) => getEffectiveRenderMode(m) === 'area');
  const lineMaterials = materialTypes.filter((m) => getEffectiveRenderMode(m) === 'line');
  const shapeMaterials = materialTypes.filter((m) => getEffectiveRenderMode(m) === 'shape');
  const textMaterials = materialTypes.filter((m) => getEffectiveRenderMode(m) === 'text');

  /** Map render mode to the appropriate sketch tool */
  const renderModeToTool = (mode: string): WMSketchTool => {
    switch (mode) {
      case 'line': return 'demolition_line';
      case 'shape': return 'demolition';  // click-to-place handled in editor
      case 'text': return 'demolition';   // click-to-place text label
      default: return 'demolition';       // area = rectangle drag
    }
  };

  const makeDemoMenuItem = (mt: DemoMaterialType) => {
    const mode = getEffectiveRenderMode(mt);
    return {
      key: mt.id,
      label: (
        <Space size={6}>
          <ColorSwatch color={mt.color} />
          <span>{mt.name}</span>
          <span style={{ fontSize: 10, color: '#8c8c8c' }}>{mt.unit}</span>
        </Space>
      ),
      onClick: () => {
        onMaterialTypeChange(mt.id);
        onToolChange(renderModeToTool(mode));
      },
    };
  };

  const demoMenuItems: MenuProps['items'] = [
    ...areaMaterials.map(makeDemoMenuItem),
    ...(lineMaterials.length > 0
      ? [
          { type: 'divider' as const, key: 'line-divider' },
          { key: 'line-header', label: <span style={{ fontSize: 11, color: '#8c8c8c' }}>Line / Wall</span>, disabled: true },
          ...lineMaterials.map(makeDemoMenuItem),
        ]
      : []),
    ...(shapeMaterials.length > 0
      ? [
          { type: 'divider' as const, key: 'shape-divider' },
          { key: 'shape-header', label: <span style={{ fontSize: 11, color: '#8c8c8c' }}>Shape (click-to-place)</span>, disabled: true },
          ...shapeMaterials.map(makeDemoMenuItem),
        ]
      : []),
    ...(textMaterials.length > 0
      ? [
          { type: 'divider' as const, key: 'text-divider' },
          { key: 'text-header', label: <span style={{ fontSize: 11, color: '#8c8c8c' }}>Text Label</span>, disabled: true },
          ...textMaterials.map(makeDemoMenuItem),
        ]
      : []),
  ];

  // ------------------------------------------------------------------
  // Equipment dropdown menu
  // ------------------------------------------------------------------
  const equipMenuItems: MenuProps['items'] = (
    Object.entries(EQUIPMENT_CONFIG) as [EquipmentType, (typeof EQUIPMENT_CONFIG)[EquipmentType]][]
  ).map(([type, cfg]) => ({
    key: type,
    label: (
      <Space size={6}>
        <EquipmentShapeIcon color={cfg.color} shape={cfg.shape} />
        <span>{cfg.name}</span>
        <span
          style={{
            fontSize: 11,
            color: token.colorTextTertiary,
            fontFamily: 'monospace',
          }}
        >
          ({cfg.abbreviation})
        </span>
      </Space>
    ),
    onClick: () => {
      onEquipmentTypeChange(type);
      onToolChange('equipment');
    },
  }));

  // ------------------------------------------------------------------
  // Shape dropdown menu
  // ------------------------------------------------------------------
  const shapeMenuItems: MenuProps['items'] = SHAPE_PRESETS.map((preset) => ({
    key: preset.id,
    label: (
      <Space size={6}>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: preset.shape_type === 'circle' ? '50%' : 2,
            background: preset.fill_color,
            border: `1.5px solid ${preset.stroke_color}`,
            flexShrink: 0,
          }}
        />
        <span>{preset.name}</span>
        {preset.abbreviation && (
          <span style={{ fontSize: 10, color: token.colorTextTertiary, fontFamily: 'monospace' }}>
            ({preset.abbreviation})
          </span>
        )}
      </Space>
    ),
    onClick: () => {
      onShapePresetChange?.(preset.id);
      onToolChange('shape');
    },
  }));

  // ------------------------------------------------------------------
  // Button style helper
  // ------------------------------------------------------------------
  const toolButtonType = (tool: WMSketchTool) => {
    if (tool === 'demolition') {
      return (activeTool === 'demolition' || activeTool === 'demolition_line')
        ? ('primary' as const)
        : ('default' as const);
    }
    return activeTool === tool ? ('primary' as const) : ('default' as const);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 12px',
        background: '#fff',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexWrap: 'wrap',
        minHeight: 44,
      }}
    >
      {/* Group 1 — Select + Pan */}
      <SpaceCompact>
        <Tooltip title="Select / Move (V)">
          <Button
            type={toolButtonType('select')}
            icon={<SelectOutlined />}
            size="small"
            onClick={() => onToolChange('select')}
          >
            Select
          </Button>
        </Tooltip>
        <Tooltip title="Pan / Hand (H)">
          <Button
            type={toolButtonType('pan')}
            icon={<HandIcon />}
            size="small"
            onClick={() => onToolChange('pan')}
          />
        </Tooltip>
      </SpaceCompact>

      <Divider type="vertical" style={{ margin: '0 4px', height: 20 }} />

      {/* Group 1b — Floor Plan drawing tools */}
      <SpaceCompact>
        <Tooltip title="Draw wall (W)">
          <Button
            type={toolButtonType('wall')}
            icon={<LineOutlined />}
            size="small"
            onClick={() => onToolChange('wall')}
          >
            Wall
          </Button>
        </Tooltip>
        <Tooltip title="Detect room from enclosed walls (R)">
          <Button
            type={toolButtonType('room')}
            icon={<GatewayOutlined />}
            size="small"
            onClick={() => onToolChange('room')}
          >
            Room
          </Button>
        </Tooltip>
        <Tooltip title="Click on a wall to split it">
          <Button
            type={toolButtonType('wall_split')}
            icon={<ScissorOutlined />}
            size="small"
            onClick={() => onToolChange('wall_split')}
          >
            Split
          </Button>
        </Tooltip>
      </SpaceCompact>

      <Divider type="vertical" style={{ margin: '0 4px', height: 20 }} />

      {/* Group 2 — Demolition */}
      <SpaceCompact>
        <Tooltip title="Draw demolition zone">
          <Button
            type={toolButtonType('demolition')}
            icon={<BorderOutlined />}
            size="small"
            onClick={() => {
              // If no material selected yet, auto-select first one
              if (!activeMaterialTypeId && materialTypes.length > 0) {
                onMaterialTypeChange(materialTypes[0].id);
              }
              onToolChange('demolition');
            }}
          >
            {activeMaterial ? (
              <Space size={4}>
                <ColorSwatch color={activeMaterial.color} />
                <span
                  style={{
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeMaterial.name}
                </span>
              </Space>
            ) : (
              'Demo'
            )}
          </Button>
        </Tooltip>
        <Dropdown
          menu={{ items: demoMenuItems }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button
            type={toolButtonType('demolition')}
            size="small"
            icon={<DownOutlined style={{ fontSize: 10 }} />}
            style={{ padding: '0 6px' }}
          />
        </Dropdown>
      </SpaceCompact>

      {/* Group 3 — Equipment */}
      <SpaceCompact>
        <Tooltip title="Place drying equipment">
          <Button
            type={toolButtonType('equipment')}
            icon={<ToolOutlined />}
            size="small"
            onClick={() => {
              if (!activeEquipmentType) {
                onEquipmentTypeChange('air_mover');
              }
              onToolChange('equipment');
            }}
          >
            {activeEquipConfig ? (
              <Space size={4}>
                <EquipmentShapeIcon color={activeEquipConfig.color} shape={activeEquipConfig.shape} />
                <span
                  style={{
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeEquipConfig.name}
                </span>
              </Space>
            ) : (
              'Equipment'
            )}
          </Button>
        </Tooltip>
        <Dropdown
          menu={{ items: equipMenuItems }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button
            type={toolButtonType('equipment')}
            size="small"
            icon={<DownOutlined style={{ fontSize: 10 }} />}
            style={{ padding: '0 6px' }}
          />
        </Dropdown>
      </SpaceCompact>

      {/* Group 4 — Containment */}
      <SpaceCompact>
        <Tooltip title="Draw containment zone">
          <Button
            type={toolButtonType('containment')}
            icon={<DashOutlined />}
            size="small"
            onClick={() => onToolChange('containment')}
          >
            Containment
          </Button>
        </Tooltip>
      </SpaceCompact>

      {/* Group 5 — Floor Protection */}
      <SpaceCompact>
        <Tooltip title="Draw floor protection strip">
          <Button
            type={toolButtonType('floor_protection')}
            icon={<ColumnWidthOutlined />}
            size="small"
            onClick={() => onToolChange('floor_protection')}
          >
            Floor Prot
          </Button>
        </Tooltip>
      </SpaceCompact>

      {/* Group 6 — Content Protection */}
      <SpaceCompact>
        <Tooltip title="Draw content protection area (vinyl cover)">
          <Button
            type={toolButtonType('content_protection')}
            icon={<SkinOutlined />}
            size="small"
            onClick={() => onToolChange('content_protection')}
          >
            Content Prot
          </Button>
        </Tooltip>
      </SpaceCompact>

      {/* Group 7 — Shapes (Door, Cabinet, Fixture, etc.) */}
      <SpaceCompact>
        <Tooltip title="Place shape (door, cabinet, fixture)">
          <Button
            type={toolButtonType('shape')}
            icon={<AppstoreOutlined />}
            size="small"
            onClick={() => {
              if (!activeShapePresetId) {
                onShapePresetChange?.(SHAPE_PRESETS[0].id);
              }
              onToolChange('shape');
            }}
          >
            {activeShapePreset ? (
              <Space size={4}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: activeShapePreset.shape_type === 'circle' ? '50%' : 2,
                    background: activeShapePreset.fill_color,
                    border: `1px solid ${activeShapePreset.stroke_color}`,
                  }}
                />
                <span
                  style={{
                    maxWidth: 60,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeShapePreset.name}
                </span>
              </Space>
            ) : (
              'Shape'
            )}
          </Button>
        </Tooltip>
        <Dropdown
          menu={{ items: shapeMenuItems }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button
            type={toolButtonType('shape')}
            size="small"
            icon={<DownOutlined style={{ fontSize: 10 }} />}
            style={{ padding: '0 6px' }}
          />
        </Dropdown>
      </SpaceCompact>

      {/* Group 8 — Text */}
      <SpaceCompact>
        <Tooltip title="Add text annotation (T)">
          <Button
            type={toolButtonType('text')}
            icon={<FontSizeOutlined />}
            size="small"
            onClick={() => onToolChange('text')}
          >
            Text
          </Button>
        </Tooltip>
      </SpaceCompact>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <Divider type="vertical" style={{ margin: '0 4px', height: 20 }} />

      {/* Group 6 — History */}
      <SpaceCompact>
        <Tooltip title="Undo (Ctrl+Z)">
          <Button
            icon={<UndoOutlined />}
            size="small"
            disabled={!canUndo}
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Y)">
          <Button
            icon={<RedoOutlined />}
            size="small"
            disabled={!canRedo}
            onClick={onRedo}
          />
        </Tooltip>
      </SpaceCompact>

      {/* Group 7 — Save */}
      <Tooltip title={isDirty ? 'Unsaved changes — click to save (Ctrl+S)' : 'All changes saved'}>
        <Badge dot={isDirty} offset={[-4, 4]}>
          <Button
            type={isDirty ? 'primary' : 'default'}
            icon={<SaveOutlined />}
            size="small"
            loading={isSaving}
            onClick={onSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </Badge>
      </Tooltip>

      <Divider type="vertical" style={{ margin: '0 4px', height: 20 }} />

      {/* Group 8 — Help */}
      <Popover
        trigger="click"
        placement="bottomRight"
        title="Keyboard Shortcuts"
        content={
          <div style={{ minWidth: 200 }}>
            {[
              ['V', 'Select tool'],
              ['H', 'Hand / Pan tool'],
              ['T', 'Text tool'],
              ['W', 'Wall tool'],
              ['R', 'Room tool'],
              ['Ctrl+Z', 'Undo'],
              ['Ctrl+Y', 'Redo'],
              ['Ctrl+S', 'Save'],
              ['Del / Backspace', 'Remove selected'],
              ['Scroll wheel', 'Zoom in / out'],
              ['Space + Drag', 'Pan canvas'],
              ['Middle mouse', 'Pan canvas'],
            ].map(([key, desc]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginBottom: 4,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    background: '#f0f0f0',
                    border: '1px solid #d9d9d9',
                    borderRadius: 3,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {key}
                </span>
                <span style={{ color: '#595959' }}>{desc}</span>
              </div>
            ))}
          </div>
        }
      >
        <Tooltip title="Keyboard shortcuts">
          <Button
            icon={<QuestionCircleOutlined />}
            size="small"
          />
        </Tooltip>
      </Popover>
    </div>
  );
};

export default WMSketchToolbar;
