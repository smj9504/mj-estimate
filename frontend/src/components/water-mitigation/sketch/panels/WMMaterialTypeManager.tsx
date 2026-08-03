/**
 * WMMaterialTypeManager - Modal for managing demolition material types.
 *
 * Accessible via a "Manage Materials" button (rendered inline by this component).
 * Lists all material types with:
 *   - Color picker and name input
 *   - Surface dropdown and unit toggle
 *   - Render mode selector (area / line / shape / text)
 *   - Stroke style and fill opacity
 *   - Default scope/line item connection
 *   - Add, edit, delete (with confirmation), and reset to defaults
 *
 * Usage:
 *   <WMMaterialTypeManager
 *     materialTypes={materialTypes}
 *     onMaterialTypesChange={(types) => setMaterialTypes(types)}
 *   />
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Button,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Slider,
  Space,
  Typography,
  Divider,
  Tooltip,
  Collapse,
  AutoComplete,
  Spin,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
  BorderOutlined,
  LineOutlined,
  AppstoreOutlined,
  FontSizeOutlined,
  LinkOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import type { DemoMaterialType, DemoSurface, DemoRenderMode, DemoStrokeStyle } from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES, getEffectiveRenderMode } from '../../../../types/wmSketch';

const { Text } = Typography;

export interface WMMaterialTypeManagerProps {
  materialTypes: DemoMaterialType[];
  onMaterialTypesChange: (types: DemoMaterialType[]) => void;
}

const SURFACE_OPTIONS: { label: string; value: DemoSurface }[] = [
  { label: 'Floor', value: 'floor' },
  { label: 'Wall', value: 'wall' },
  { label: 'Ceiling', value: 'ceiling' },
];

const RENDER_MODE_OPTIONS: { label: string; value: DemoRenderMode; icon: React.ReactNode; desc: string }[] = [
  { label: 'Area', value: 'area', icon: <BorderOutlined />, desc: 'Drag to draw filled rectangle' },
  { label: 'Line', value: 'line', icon: <LineOutlined />, desc: 'Drag to draw a line' },
  { label: 'Shape', value: 'shape', icon: <AppstoreOutlined />, desc: 'Click to place a fixed icon' },
  { label: 'Text', value: 'text', icon: <FontSizeOutlined />, desc: 'Click to place a text label' },
];

const STROKE_STYLE_OPTIONS: { label: string; value: DemoStrokeStyle }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

// A palette of suggested colors for new material types
const COLOR_PALETTE = [
  '#B8860B', '#90EE90', '#ADD8E6', '#228B22', '#FFB6C1',
  '#DB7093', '#DEB887', '#D2B48C', '#FF6347', '#4169E1',
  '#9370DB', '#20B2AA', '#FF8C00', '#DC143C', '#00CED1',
];

const generateId = () =>
  `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

/** Inline color picker row using a small palette */
const ColorPickerRow: React.FC<{
  value: string;
  onChange: (color: string) => void;
}> = ({ value, onChange }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
    {COLOR_PALETTE.map((color) => (
      <button
        key={color}
        type="button"
        title={color}
        onClick={() => onChange(color)}
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          backgroundColor: color,
          border: value === color ? '2px solid #1677ff' : '1px solid rgba(0,0,0,0.15)',
          cursor: 'pointer',
          padding: 0,
          outline: 'none',
          flexShrink: 0,
        }}
      />
    ))}
    {/* Native color input for custom colors */}
    <Tooltip title="Custom color">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          border: '1px solid rgba(0,0,0,0.15)',
          cursor: 'pointer',
          padding: 0,
        }}
      />
    </Tooltip>
  </div>
);

/** Render mode preview swatch */
const RenderModePreview: React.FC<{ mode: DemoRenderMode; color: string; strokeStyle?: DemoStrokeStyle; fillOpacity?: number }> = ({
  mode, color, strokeStyle = 'solid', fillOpacity = 0.22,
}) => {
  const w = 28;
  const h = 20;
  const dashArray = strokeStyle === 'dashed' ? '4 2' : strokeStyle === 'dotted' ? '2 2' : 'none';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>
      {mode === 'area' && (
        <rect x="2" y="2" width={w - 4} height={h - 4} rx="2"
          fill={color} fillOpacity={fillOpacity}
          stroke={color} strokeWidth="1.5"
          strokeDasharray={dashArray !== 'none' ? dashArray : undefined} />
      )}
      {mode === 'line' && (
        <line x1="3" y1={h / 2} x2={w - 3} y2={h / 2}
          stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={dashArray !== 'none' ? dashArray : undefined} />
      )}
      {mode === 'shape' && (
        <rect x={(w - 14) / 2} y={(h - 14) / 2} width="14" height="14" rx="2"
          fill={color} fillOpacity={0.85}
          stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      )}
      {mode === 'text' && (
        <text x={w / 2} y={h / 2 + 5} textAnchor="middle"
          fontSize="13" fontWeight="bold" fontFamily="Arial"
          fill={color}>A</text>
      )}
    </svg>
  );
};

/** Line item search for scope connection */
const LineItemSearch: React.FC<{
  lineItemId?: string;
  lineItemDescription?: string;
  onSelect: (id: string | undefined, description: string | undefined) => void;
}> = ({ lineItemId, lineItemDescription, onSelect }) => {
  const [searchText, setSearchText] = useState(lineItemDescription || '');
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode; id: string; description: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external description changes
  useEffect(() => {
    setSearchText(lineItemDescription || '');
  }, [lineItemDescription]);

  const handleSearch = useCallback((text: string) => {
    setSearchText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text || text.length < 2) {
      setOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { default: lineItemService } = await import('../../../../services/lineItemService');
        const items = await lineItemService.getLineItemsForModal({
          search_term: text,
          page_size: 15,
        });
        setOptions(
          items.map((item) => ({
            value: `${item.item_code || item.component_code || ''} - ${item.description}`,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                {item.item_code && (
                  <Tag style={{ fontSize: 10, lineHeight: '14px', padding: '0 3px', margin: 0 }} color="blue">
                    {item.item_code}
                  </Tag>
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.description}
                </span>
                <span style={{ color: '#8c8c8c', fontSize: 10 }}>{item.unit}</span>
              </div>
            ),
            id: String(item.id),
            description: item.description,
          }))
        );
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <AutoComplete
        size="small"
        style={{ flex: 1 }}
        placeholder="Search line items..."
        value={searchText}
        options={options}
        onSearch={handleSearch}
        onSelect={(_val, option) => {
          setSearchText(option.description);
          onSelect(option.id, option.description);
        }}
        onChange={(val) => {
          setSearchText(val);
          if (!val) onSelect(undefined, undefined);
        }}
        notFoundContent={searching ? <Spin size="small" /> : null}
      />
      {lineItemId && (
        <Tooltip title="Disconnect line item">
          <Button
            size="small"
            type="text"
            danger
            icon={<DisconnectOutlined />}
            onClick={() => {
              setSearchText('');
              onSelect(undefined, undefined);
            }}
            style={{ padding: '0 4px' }}
          />
        </Tooltip>
      )}
    </div>
  );
};

/** Single material type editor card */
const MaterialTypeCard: React.FC<{
  type: DemoMaterialType;
  onUpdate: (updates: Partial<DemoMaterialType>) => void;
  onDelete: () => void;
}> = ({ type, onUpdate, onDelete }) => {
  const effectiveMode = getEffectiveRenderMode(type);

  const advancedItems = [
    {
      key: 'advanced',
      label: <Text style={{ fontSize: 11, color: '#8c8c8c' }}>Visual & Scope Settings</Text>,
      children: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {/* Render mode */}
          <div>
            <Text style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>
              Render Mode
            </Text>
            <Radio.Group
              size="small"
              value={effectiveMode}
              onChange={(e) => onUpdate({ render_mode: e.target.value })}
              buttonStyle="solid"
            >
              {RENDER_MODE_OPTIONS.map((opt) => (
                <Tooltip key={opt.value} title={opt.desc}>
                  <Radio.Button value={opt.value}>
                    <Space size={2}>{opt.icon}<span style={{ fontSize: 11 }}>{opt.label}</span></Space>
                  </Radio.Button>
                </Tooltip>
              ))}
            </Radio.Group>
          </div>

          {/* Stroke style */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>
                Stroke Style
              </Text>
              <Select
                size="small"
                value={type.stroke_style || 'solid'}
                onChange={(v: DemoStrokeStyle) => onUpdate({ stroke_style: v })}
                options={STROKE_STYLE_OPTIONS}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>
                Fill Opacity ({Math.round((type.fill_opacity ?? 0.22) * 100)}%)
              </Text>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={type.fill_opacity ?? 0.22}
                onChange={(v) => onUpdate({ fill_opacity: v })}
                style={{ margin: '4px 0 0' }}
              />
            </div>
          </div>

          {/* Preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#f5f5f5', borderRadius: 4 }}>
            <Text style={{ fontSize: 11, color: '#8c8c8c' }}>Preview:</Text>
            <RenderModePreview
              mode={effectiveMode}
              color={type.color}
              strokeStyle={type.stroke_style}
              fillOpacity={type.fill_opacity}
            />
          </div>

          {/* Scope / Line item connection */}
          <div>
            <Text style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>
              <LinkOutlined style={{ marginRight: 4 }} />
              Default Scope Line Item
            </Text>
            <LineItemSearch
              lineItemId={type.default_line_item_id}
              lineItemDescription={type.default_line_item_description}
              onSelect={(id, desc) => onUpdate({
                default_line_item_id: id,
                default_line_item_description: desc,
              })}
            />
            {type.default_line_item_id && (
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                Linked: {type.default_line_item_description || type.default_line_item_id}
              </Text>
            )}
          </div>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
      {/* Left: Render mode preview */}
      <div style={{ marginTop: 6, flexShrink: 0 }}>
        <RenderModePreview
          mode={effectiveMode}
          color={type.color}
          strokeStyle={type.stroke_style}
          fillOpacity={type.fill_opacity}
        />
      </div>

      {/* Center: Fields */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Name */}
        <Input
          size="small"
          value={type.name}
          placeholder="Material name"
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{ fontWeight: 500 }}
        />

        {/* Surface + Unit row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            size="small"
            value={type.surface}
            onChange={(v: DemoSurface) => onUpdate({ surface: v })}
            options={SURFACE_OPTIONS}
            style={{ flex: 1 }}
          />
          <Radio.Group
            size="small"
            value={type.unit}
            onChange={(e) => onUpdate({ unit: e.target.value })}
            buttonStyle="solid"
          >
            <Radio.Button value="SF">SF</Radio.Button>
            <Radio.Button value="LF">LF</Radio.Button>
            <Radio.Button value="EA">EA</Radio.Button>
          </Radio.Group>
        </div>

        {/* Color palette */}
        <ColorPickerRow
          value={type.color}
          onChange={(color) => onUpdate({ color })}
        />

        {/* Advanced settings collapsible */}
        <Collapse
          ghost
          size="small"
          items={advancedItems}
          style={{ marginTop: -4 }}
        />
      </div>

      {/* Right: Delete button */}
      <Popconfirm
        title="Delete this material type?"
        description="Zones using this type will retain their current color."
        onConfirm={onDelete}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          style={{ marginTop: 4 }}
        />
      </Popconfirm>
    </div>
  );
};

const WMMaterialTypeManager: React.FC<WMMaterialTypeManagerProps> = ({
  materialTypes,
  onMaterialTypesChange,
}) => {
  const [open, setOpen] = useState(false);
  // Local copy for editing inside the modal
  const [localTypes, setLocalTypes] = useState<DemoMaterialType[]>(materialTypes);

  const handleOpen = () => {
    setLocalTypes([...materialTypes]);
    setOpen(true);
  };

  const handleOk = () => {
    onMaterialTypesChange(localTypes);
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const updateType = useCallback(
    (id: string, updates: Partial<DemoMaterialType>) => {
      setLocalTypes((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    []
  );

  const addType = () => {
    const newType: DemoMaterialType = {
      id: generateId(),
      name: 'New Material',
      surface: 'floor',
      color: COLOR_PALETTE[localTypes.length % COLOR_PALETTE.length],
      unit: 'SF',
      render_mode: 'area',
      stroke_style: 'solid',
      fill_opacity: 0.22,
    };
    setLocalTypes((prev) => [...prev, newType]);
  };

  const deleteType = (id: string) => {
    setLocalTypes((prev) => prev.filter((t) => t.id !== id));
  };

  const resetToDefaults = () => {
    setLocalTypes([...DEFAULT_DEMO_MATERIAL_TYPES]);
  };

  return (
    <>
      <Button
        size="small"
        type="text"
        icon={<SettingOutlined />}
        onClick={handleOpen}
      />

      <Modal
        title="Manage Material Types"
        open={open}
        onOk={handleOk}
        onCancel={handleCancel}
        okText="Save"
        cancelText="Cancel"
        width={580}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '8px 0' } }}
        destroyOnHidden
      >
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          {localTypes.map((type, index) => (
            <div key={type.id}>
              {index > 0 && <Divider style={{ margin: '6px 0' }} />}
              <MaterialTypeCard
                type={type}
                onUpdate={(updates) => updateType(type.id, updates)}
                onDelete={() => deleteType(type.id)}
              />
            </div>
          ))}

          <Divider style={{ margin: '10px 0 6px 0' }} />

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={addType}
              type="dashed"
              style={{ flex: 1 }}
            >
              Add Material Type
            </Button>
            <Popconfirm
              title="Reset to default material types?"
              description="This will replace all current types with the system defaults."
              onConfirm={resetToDefaults}
              okText="Reset"
              okType="danger"
              cancelText="Cancel"
            >
              <Button
                size="small"
                icon={<ReloadOutlined />}
                style={{ color: '#faad14', borderColor: '#faad14' }}
              >
                Defaults
              </Button>
            </Popconfirm>
          </div>

          {localTypes.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block', padding: '8px 0' }}>
              No material types. Add one above or reset to defaults.
            </Text>
          )}
        </Space>
      </Modal>
    </>
  );
};

export default WMMaterialTypeManager;
