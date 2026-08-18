/**
 * WMSketchToolbar
 *
 * Horizontal toolbar with grouped tool buttons for the WM sketch canvas.
 * Mobile-optimized: text labels hidden on narrow screens, buttons become
 * icon-only with tooltips for discoverability.
 */

import React from 'react';
import {
  Button,
  Dropdown,
  Space,
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
  SwapOutlined,
} from '@ant-design/icons';
import type {
  WMSketchTool,
  DemoMaterialType,
  EquipmentType,
  ShapePreset,
} from '../../../types/wmSketch';
import { EQUIPMENT_CONFIG, SHAPE_PRESETS, getEffectiveRenderMode } from '../../../types/wmSketch';
import { useIsCoarsePointer } from './hooks/useWMResponsive';

// Space.Compact is available in antd v5+
const SpaceCompact = Space.Compact;

// ============================================================================
// Responsive CSS
// ============================================================================

const MOBILE_BP = 768;
const TABLET_BP = 1024;

const responsiveStyles = `
  @media (max-width: ${MOBILE_BP}px) {
    .wm-toolbar-root {
      gap: 2px !important;
      padding: 4px 6px !important;
      min-height: 36px !important;
    }
    .wm-toolbar-root .wm-tb-label {
      display: none !important;
    }
    .wm-toolbar-root .wm-tb-divider {
      margin: 0 1px !important;
    }
    .wm-toolbar-root .wm-tb-hide-mobile {
      display: none !important;
    }
  }
  @media (min-width: ${MOBILE_BP + 1}px) and (max-width: ${TABLET_BP}px) {
    .wm-toolbar-root {
      gap: 3px !important;
      padding: 4px 8px !important;
    }
    .wm-toolbar-root .wm-tb-label {
      display: none !important;
    }
  }
  /*
    Touch pointers: antd's "small" buttons are ~24px tall, well under the
    ~44px a fingertip needs. Grow the hit box without growing the icons, and
    let the strip flick-scroll horizontally instead of clipping tools.
   */
  @media (pointer: coarse) {
    .wm-toolbar-root {
      min-height: 48px !important;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .wm-toolbar-root::-webkit-scrollbar {
      display: none;
    }
    .wm-toolbar-root .ant-btn-sm {
      height: 38px !important;
      min-width: 38px !important;
      padding-inline: 10px !important;
    }
  }
`;

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
  /** Whether new floor protection strips are stair type */
  isStairFloorProtection?: boolean;
  /** Toggle stair floor protection mode */
  onStairFloorProtectionChange?: (isStair: boolean) => void;
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
  isStairFloorProtection = false,
  onStairFloorProtectionChange,
}) => {
  const { token } = theme.useToken();
  // Touch users need gesture docs, not keyboard shortcuts
  const isTouch = useIsCoarsePointer();

  /**
   * These menus are long enough to exceed a phone viewport. Without a cap
   * antd flips them above the trigger and the top items land off-screen,
   * unreachable. Cap the height and let the menu scroll instead.
   */
  const dropdownOverlayStyle: React.CSSProperties = {
    maxHeight: '55vh',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  };

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
      case 'shape': return 'demolition';
      case 'text': return 'demolition';
      default: return 'demolition';
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
        {preset.id === 'door' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
            <line x1="0" y1="13" x2="13" y2="13" stroke={preset.stroke_color} strokeWidth="1.5" />
            <path d="M 13 13 A 13 13 0 0 0 0 0" fill="none" stroke={preset.stroke_color} strokeWidth="1" />
            <circle cx="0" cy="13" r="1.5" fill={preset.stroke_color} />
          </svg>
        ) : (
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
        )}
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
      return (activeTool === 'demolition' || activeTool === 'demolition_line' || activeTool === 'demolition_polygon')
        ? ('primary' as const)
        : ('default' as const);
    }
    return activeTool === tool ? ('primary' as const) : ('default' as const);
  };

  return (
    <>
      <style>{responsiveStyles}</style>
      <div
        className="wm-toolbar-root"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 12px',
          background: '#fff',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexWrap: 'nowrap',
          minHeight: 44,
          overflowX: 'auto',
        }}
      >
        {/* Group 1 — Select + Pan */}
        <SpaceCompact>
          <Button
            type={toolButtonType('select')}
            icon={<SelectOutlined />}
            size="small"
            aria-label="Select tool"
            onClick={() => onToolChange('select')}
          >
            <span className="wm-tb-label">Select</span>
          </Button>
          <Button
            type={toolButtonType('pan')}
            icon={<HandIcon />}
            size="small"
            aria-label="Pan tool"
            onClick={() => onToolChange('pan')}
          />
        </SpaceCompact>

        <Divider className="wm-tb-divider" type="vertical" style={{ margin: '0 4px', height: 20 }} />

        {/* Group 2 — Demolition */}
        <SpaceCompact>
          <Button
              type={toolButtonType('demolition')}
              icon={<BorderOutlined />}
              size="small"
              aria-label="Demolition tool"
              onClick={() => {
                if (!activeMaterialTypeId && materialTypes.length > 0) {
                  onMaterialTypeChange(materialTypes[0].id);
                  onToolChange('demolition');
                } else if (activeMaterial) {
                  const mode = getEffectiveRenderMode(activeMaterial);
                  onToolChange(renderModeToTool(mode));
                } else {
                  onToolChange('demolition');
                }
              }}
            >
              {activeMaterial ? (
                <Space size={4}>
                  <ColorSwatch color={activeMaterial.color} />
                  <span
                    className="wm-tb-label"
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
                <span className="wm-tb-label">Demo</span>
              )}
            </Button>
          <Dropdown
            menu={{ items: demoMenuItems }}
            trigger={['click']}
            placement="bottomLeft"
            overlayStyle={dropdownOverlayStyle}
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
          <Button
              type={toolButtonType('equipment')}
              icon={<ToolOutlined />}
              size="small"
              aria-label="Equipment tool"
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
                    className="wm-tb-label"
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
                <span className="wm-tb-label">Equipment</span>
              )}
            </Button>
          <Dropdown
            menu={{ items: equipMenuItems }}
            trigger={['click']}
            placement="bottomLeft"
            overlayStyle={dropdownOverlayStyle}
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
        <Button
          type={toolButtonType('containment')}
          icon={<DashOutlined />}
          size="small"
          aria-label="Containment tool"
          onClick={() => onToolChange('containment')}
        >
          <span className="wm-tb-label">Containment</span>
        </Button>

        {/* Group 5 — Floor Protection (with stair toggle) */}
        <SpaceCompact size="small">
          <Button
            type={toolButtonType('floor_protection')}
            icon={<ColumnWidthOutlined />}
            size="small"
            aria-label="Floor protection tool"
            onClick={() => onToolChange('floor_protection')}
          >
            <span className="wm-tb-label">{isStairFloorProtection ? 'Stair Prot' : 'Floor Prot'}</span>
          </Button>
          <Button
            type={isStairFloorProtection ? 'primary' : 'default'}
            size="small"
            onClick={() => {
              onStairFloorProtectionChange?.(!isStairFloorProtection);
              onToolChange('floor_protection');
            }}
            style={{
              padding: '0 6px',
              fontSize: 11,
              fontWeight: isStairFloorProtection ? 600 : 400,
              ...(isStairFloorProtection ? { backgroundColor: '#FF8C00', borderColor: '#FF8C00' } : {}),
            }}
          >
            STR
          </Button>
        </SpaceCompact>

        {/* Group 6 — Content Protection */}
        <Button
          type={toolButtonType('content_protection')}
          icon={<SkinOutlined />}
          size="small"
          aria-label="Content protection tool"
          onClick={() => onToolChange('content_protection')}
        >
          <span className="wm-tb-label">Content Prot</span>
        </Button>

        {/* Group 6b — Content Manipulation */}
        <Button
          type={toolButtonType('content_manipulation')}
          icon={<SwapOutlined />}
          size="small"
          aria-label="Content manipulation tool"
          onClick={() => onToolChange('content_manipulation')}
        >
          <span className="wm-tb-label">Content Move</span>
        </Button>

        {/* More tools — less frequently used */}
        <Dropdown
          menu={{
            items: [
              { key: 'wall', icon: <LineOutlined />, label: 'Wall (W)', onClick: () => onToolChange('wall') },
              { key: 'room', icon: <GatewayOutlined />, label: 'Room (R)', onClick: () => onToolChange('room') },
              { key: 'wall_split', icon: <ScissorOutlined />, label: 'Split Wall', onClick: () => onToolChange('wall_split') },
              { type: 'divider' as const },
              { key: 'demolition_polygon', label: 'Polygon Demo', onClick: () => {
                if (!activeMaterialTypeId && materialTypes.length > 0) onMaterialTypeChange(materialTypes[0].id);
                onToolChange('demolition_polygon');
              }},
              { type: 'divider' as const },
              ...shapeMenuItems as any[],
              { type: 'divider' as const },
              { key: 'text', icon: <FontSizeOutlined />, label: 'Text (T)', onClick: () => onToolChange('text') },
            ],
          }}
          trigger={['click']}
          placement="bottomLeft"
          overlayStyle={dropdownOverlayStyle}
        >
          <Button size="small" aria-label="More tools" icon={<AppstoreOutlined />}>
            <span className="wm-tb-label">More</span>
            <DownOutlined style={{ fontSize: 10, marginLeft: 2 }} />
          </Button>
        </Dropdown>

        {/* Spacer */}
        <div style={{ flex: 1, minWidth: 4 }} />

        <Divider className="wm-tb-divider wm-tb-hide-mobile" type="vertical" style={{ margin: '0 4px', height: 20 }} />

        {/* Group — History */}
        <SpaceCompact>
          <Button
            icon={<UndoOutlined />}
            size="small"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          />
          <Button
            icon={<RedoOutlined />}
            size="small"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          />
        </SpaceCompact>

        {/* Group — Save */}
        <Badge dot={isDirty} offset={[-4, 4]}>
          <Button
            type={isDirty ? 'primary' : 'default'}
            icon={<SaveOutlined />}
            size="small"
            aria-label="Save sketch"
            loading={isSaving}
            onClick={onSave}
          >
            <span className="wm-tb-label">{isSaving ? 'Saving...' : 'Save'}</span>
          </Button>
        </Badge>

        <Divider className="wm-tb-divider wm-tb-hide-mobile" type="vertical" style={{ margin: '0 4px', height: 20 }} />

        {/* Help */}
        <Popover
          trigger="click"
          placement="bottomRight"
          title={isTouch ? 'Touch Gestures' : 'Keyboard Shortcuts'}
          content={
            <div style={{ minWidth: 200 }}>
              {(isTouch
                ? [
                    ['Tap', 'Select / place element'],
                    ['Drag', 'Draw or move element'],
                    ['Pinch', 'Zoom in / out'],
                    ['Two-finger drag', 'Pan canvas'],
                    ['Long press', 'Element menu'],
                    ['Double tap', 'Close polygon'],
                    ['⊕ / ⊖ / ⤡', 'Zoom in / out / fit'],
                    ['Finish', 'End wall or polygon'],
                    ['Panels button', 'Open properties'],
                  ]
                : [
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
                  ]
              ).map(([key, desc]) => (
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
          <Button
            icon={<QuestionCircleOutlined />}
            size="small"
            aria-label={isTouch ? 'Touch gestures' : 'Keyboard shortcuts'}
          />
        </Popover>
      </div>
    </>
  );
};

export default WMSketchToolbar;
