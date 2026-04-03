/**
 * WMMaterialTypeManager - Modal for managing demolition material types.
 *
 * Accessible via a "Manage Materials" button (rendered inline by this component).
 * Lists all material types with color picker, name input, surface dropdown, unit toggle.
 * Supports add, edit, delete (with confirmation), and reset to defaults.
 *
 * Usage:
 *   <WMMaterialTypeManager
 *     materialTypes={materialTypes}
 *     onMaterialTypesChange={(types) => setMaterialTypes(types)}
 *   />
 */
import React, { useState, useCallback } from 'react';
import {
  Button,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Typography,
  Divider,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { DemoMaterialType, DemoSurface } from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES } from '../../../../types/wmSketch';

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
        icon={<SettingOutlined />}
        onClick={handleOpen}
        style={{ fontSize: 12 }}
      >
        Manage Materials
      </Button>

      <Modal
        title="Manage Material Types"
        open={open}
        onOk={handleOk}
        onCancel={handleCancel}
        okText="Save"
        cancelText="Cancel"
        width={520}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '8px 0' } }}
        destroyOnHidden
      >
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          {localTypes.map((type, index) => (
            <div key={type.id}>
              {index > 0 && <Divider style={{ margin: '6px 0' }} />}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
                {/* Left: Color swatch preview */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 3,
                    backgroundColor: type.color,
                    border: '1px solid rgba(0,0,0,0.15)',
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />

                {/* Center: Fields */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Name */}
                  <Input
                    size="small"
                    value={type.name}
                    placeholder="Material name"
                    onChange={(e) => updateType(type.id, { name: e.target.value })}
                    style={{ fontWeight: 500 }}
                  />

                  {/* Surface + Unit row */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Select
                      size="small"
                      value={type.surface}
                      onChange={(v: DemoSurface) => updateType(type.id, { surface: v })}
                      options={SURFACE_OPTIONS}
                      style={{ flex: 1 }}
                    />
                    <Radio.Group
                      size="small"
                      value={type.unit}
                      onChange={(e) => updateType(type.id, { unit: e.target.value })}
                      buttonStyle="solid"
                    >
                      <Radio.Button value="SF">SF</Radio.Button>
                      <Radio.Button value="LF">LF</Radio.Button>
                    </Radio.Group>
                  </div>

                  {/* Color palette */}
                  <ColorPickerRow
                    value={type.color}
                    onChange={(color) => updateType(type.id, { color })}
                  />
                </div>

                {/* Right: Delete button */}
                <Popconfirm
                  title="Delete this material type?"
                  description="Zones using this type will retain their current color."
                  onConfirm={() => deleteType(type.id)}
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
