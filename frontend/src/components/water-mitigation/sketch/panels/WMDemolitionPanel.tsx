/**
 * WMDemolitionPanel - Sidebar panel for managing demolition zones.
 *
 * When a zone is selected: shows an editable properties form.
 * When nothing is selected: shows a grouped summary table plus
 *   "Add Wall Demo" / "Add Baseboard" quick-add buttons for types
 *   that cannot be drawn on the 2D canvas.
 *
 * Zones that still have dimension1_ft === 0 are highlighted in amber
 * to signal that the user needs to enter real measurements.
 *
 * Usage:
 *   <WMDemolitionPanel
 *     zones={overlayData.demolitionZones}
 *     selectedZoneId={selection?.elementType === 'demolition' ? selection.elementId : null}
 *     materialTypes={materialTypes}
 *     floorSketchId={floorSketch.id}
 *     onUpdateZone={(id, updates) => handleUpdateZone(id, updates)}
 *     onDeleteZone={(id) => handleDeleteZone(id)}
 *     onSelectZone={(id) => handleSelect(id, 'demolition')}
 *     onAddZone={(zone) => handleAddZone(zone)}
 *   />
 */
import React, { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Select,
  Space,
  Typography,
  Divider,
  Popconfirm,
  Tag,
  Tooltip,
  Alert,
} from 'antd';
import {
  DeleteOutlined,
  DownOutlined,
  RightOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { WMDemolitionZone, DemoMaterialType } from '../../../../types/wmSketch';
import { DEFAULT_DEMO_MATERIAL_TYPES, WOOD_FLOOR_SUB_TYPES, WALL_MATERIAL_SUB_TYPES, WALL_MATERIAL_IDS, TRIM_SIZE_SUB_TYPES, TRIM_SIZE_MATERIAL_IDS, EA_ITEM_PIXEL_SIZES } from '../../../../types/wmSketch';
import { calcDemoZoneSqft, generateOverlayId } from '../utils/wmCalculations';
import DimensionInput from './DimensionInput';

const { Text } = Typography;

export interface WMDemolitionPanelProps {
  zones: WMDemolitionZone[];
  selectedZoneId: string | null;
  materialTypes: DemoMaterialType[];
  /** The floor sketch ID — needed when creating new zones from the panel */
  floorSketchId: string;
  onUpdateZone: (id: string, updates: Partial<WMDemolitionZone>) => void;
  onDeleteZone: (id: string) => void;
  onSelectZone: (id: string) => void;
  onAddZone: (zone: WMDemolitionZone) => void;
}

// Small inline color swatch
const ColorSwatch: React.FC<{ color: string; size?: number }> = ({ color, size = 12 }) => (
  <span
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: 2,
      backgroundColor: color,
      border: '1px solid rgba(0,0,0,0.15)',
      flexShrink: 0,
      verticalAlign: 'middle',
    }}
  />
);

// Edit form shown when a zone is selected
const ZoneEditForm: React.FC<{
  zone: WMDemolitionZone;
  materialTypes: DemoMaterialType[];
  onUpdate: (updates: Partial<WMDemolitionZone>) => void;
  onDelete: () => void;
}> = ({ zone, materialTypes, onUpdate, onDelete }) => {
  const selectedMaterial = materialTypes.find((m) => m.id === zone.material_type);
  const unit = selectedMaterial?.unit ?? 'SF';
  const isWallSF = selectedMaterial?.surface === 'wall' && unit === 'SF';
  const isLF = unit === 'LF';
  const isEA = unit === 'EA';
  const isStair = zone.material_type === 'stair_demo';
  const isLineType = isWallSF || isLF;
  const areaLabel = isEA ? 'EA' : isLF ? 'LF' : 'SF';

  const needsDimensions = isEA
    ? (isStair && zone.dimension1_ft === 0)
    : isLineType
      ? zone.dimension1_ft === 0
      : zone.dimension1_ft === 0 || zone.dimension2_ft === 0;

  const calculatedArea = useMemo(() => {
    if (isEA) return isStair ? zone.dimension1_ft : 1;
    if (isLF) return zone.dimension1_ft;
    if (isWallSF) return zone.dimension1_ft * (zone.height_ft ?? 8);
    return calcDemoZoneSqft(zone.dimension1_ft, zone.dimension2_ft);
  }, [zone.dimension1_ft, zone.dimension2_ft, zone.height_ft, isLF, isWallSF, isEA, isStair]);

  const handleMaterialChange = (value: string) => {
    const mat = materialTypes.find((m) => m.id === value);
    if (mat) {
      onUpdate({
        material_type: mat.id,
        surface: mat.surface,
        color: mat.color,
      });
    }
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {/* Warning when dimensions have not been entered */}
      {needsDimensions && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="Enter real dimensions below"
          style={{ fontSize: 11, padding: '4px 8px' }}
        />
      )}

      {/* Material type */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Material Type
        </Text>
        <Select
          size="small"
          value={zone.material_type}
          onChange={handleMaterialChange}
          style={{ width: '100%' }}
          optionLabelProp="label"
        >
          {materialTypes.map((m) => (
            <Select.Option key={m.id} value={m.id} label={m.name}>
              <Space size={6}>
                <ColorSwatch color={m.color} />
                <span>{m.name}</span>
                <Tag
                  style={{ marginLeft: 'auto', fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                  color="default"
                >
                  {m.unit}
                </Tag>
              </Space>
            </Select.Option>
          ))}
        </Select>
      </div>

      {/* Wood floor sub-type selector */}
      {zone.material_type === 'wood_floor' && (
        <div>
          <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
            Floor Type
          </Text>
          <Select
            size="small"
            value={zone.sub_type || undefined}
            onChange={(value) => {
              const subCfg = WOOD_FLOOR_SUB_TYPES.find((s) => s.id === value);
              onUpdate({
                sub_type: value,
                ...(subCfg ? { color: subCfg.color } : {}),
              });
            }}
            placeholder="Select floor type"
            style={{ width: '100%' }}
            allowClear
            onClear={() => onUpdate({ sub_type: undefined, color: '#B8860B' })}
          >
            {WOOD_FLOOR_SUB_TYPES.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                <Space size={6}>
                  <ColorSwatch color={s.color} />
                  <span>{s.name}</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </div>
      )}

      {/* Wall material sub-type selector */}
      {WALL_MATERIAL_IDS.has(zone.material_type) && (
        <div>
          <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
            Wall Material
          </Text>
          <Select
            size="small"
            value={zone.sub_type || undefined}
            onChange={(value) => {
              const subCfg = WALL_MATERIAL_SUB_TYPES.find((s) => s.id === value);
              onUpdate({
                sub_type: value,
                ...(subCfg ? { color: subCfg.color } : {}),
              });
            }}
            placeholder="Select wall material"
            style={{ width: '100%' }}
            allowClear
            onClear={() => onUpdate({ sub_type: undefined, color: selectedMaterial?.color ?? '#FFB6C1' })}
          >
            {WALL_MATERIAL_SUB_TYPES.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                <Space size={6}>
                  <ColorSwatch color={s.color} />
                  <span>{s.name}</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </div>
      )}

      {/* Trim / Door size sub-type selector */}
      {TRIM_SIZE_MATERIAL_IDS.has(zone.material_type) && (
        <div>
          <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
            Size
          </Text>
          <Select
            size="small"
            value={zone.sub_type || undefined}
            onChange={(value) => {
              const sizeMap = EA_ITEM_PIXEL_SIZES[zone.material_type] ?? {};
              const sz = sizeMap[value] ?? sizeMap[''] ?? { w: 36, h: 36 };
              onUpdate({ sub_type: value, pixel_width: sz.w, pixel_height: sz.h });
            }}
            placeholder="Select size"
            style={{ width: '100%' }}
            allowClear
            onClear={() => {
              const sizeMap = EA_ITEM_PIXEL_SIZES[zone.material_type] ?? {};
              const sz = sizeMap[''] ?? { w: 36, h: 36 };
              onUpdate({ sub_type: undefined, pixel_width: sz.w, pixel_height: sz.h });
            }}
          >
            {TRIM_SIZE_SUB_TYPES.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                <Space size={6}>
                  <span>{s.name}</span>
                  <Text type="secondary" style={{ fontSize: 10 }}>({s.description})</Text>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </div>
      )}

      {/* Dimensions — layout depends on zone type */}
      {isEA ? (
        /* EA items: stair needs tread count, others are just 1 EA each */
        isStair ? (
          <div>
            <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
              Tread Count
            </Text>
            <Input
              size="small"
              type="number"
              min={0}
              value={zone.dimension1_ft || ''}
              placeholder="e.g. 12"
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 0;
                onUpdate({ dimension1_ft: val, calculated_sqft: val });
              }}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            />
          </div>
        ) : null
      ) : isLF ? (
        /* Baseboard / Quarter Round: length only */
        <DimensionInput
          label="Length"
          value={zone.dimension1_ft}
          onChange={(ft) =>
            onUpdate({ dimension1_ft: ft, calculated_sqft: ft })
          }
        />
      ) : isWallSF ? (
        /* Wall (SF): length + height → area */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <DimensionInput
            label="Length"
            value={zone.dimension1_ft}
            onChange={(ft) =>
              onUpdate({
                dimension1_ft: ft,
                calculated_sqft: ft * (zone.height_ft ?? 8),
              })
            }
          />
          <DimensionInput
            label="Height"
            value={zone.height_ft ?? 8}
            onChange={(ft) =>
              onUpdate({
                height_ft: ft,
                calculated_sqft: zone.dimension1_ft * ft,
              })
            }
          />
        </div>
      ) : (
        /* Floor / Ceiling: two dimensions */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <DimensionInput
            label="Dimension 1"
            value={zone.dimension1_ft}
            onChange={(ft) =>
              onUpdate({
                dimension1_ft: ft,
                calculated_sqft: calcDemoZoneSqft(ft, zone.dimension2_ft),
              })
            }
          />
          <DimensionInput
            label="Dimension 2"
            value={zone.dimension2_ft}
            onChange={(ft) =>
              onUpdate({
                dimension2_ft: ft,
                calculated_sqft: calcDemoZoneSqft(zone.dimension1_ft, ft),
              })
            }
          />
        </div>
      )}

      {/* Calculated area (read-only) */}
      <div
        style={{
          backgroundColor: needsDimensions ? '#fff7e6' : '#f5f5f5',
          borderRadius: 4,
          padding: '4px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: needsDimensions ? '1px solid #ffd591' : '1px solid transparent',
        }}
      >
        <Text style={{ fontSize: 12, color: '#666' }}>
          {isEA ? (isStair ? 'Tread Count' : 'Quantity') : 'Calculated Area'}
        </Text>
        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {needsDimensions ? '—' : isEA ? `${Math.round(calculatedArea)} EA` : `${calculatedArea.toFixed(2)} ${areaLabel}`}
        </Text>
      </div>

      {/* Carpet Pad checkbox — only for carpet material */}
      {zone.material_type === 'carpet' && (
        <Checkbox
          checked={zone.include_pad ?? false}
          onChange={(e) => onUpdate({ include_pad: e.target.checked })}
        >
          <span style={{ fontSize: 12 }}>Include Carpet Pad</span>
          {zone.include_pad && !needsDimensions && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              (+{calculatedArea.toFixed(2)} SF)
            </Text>
          )}
        </Checkbox>
      )}

      {/* Insulation checkbox — for wall/ceiling SF materials only (not trim/baseboard LF) */}
      {(selectedMaterial?.surface === 'wall' || selectedMaterial?.surface === 'ceiling')
        && selectedMaterial?.unit === 'SF'
        && zone.material_type !== 'insulation' && (
        <Checkbox
          checked={zone.include_insulation ?? false}
          onChange={(e) => onUpdate({ include_insulation: e.target.checked })}
        >
          <span style={{ fontSize: 12 }}>Include Insulation</span>
          {zone.include_insulation && !needsDimensions && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              (+{calculatedArea.toFixed(2)} SF)
            </Text>
          )}
        </Checkbox>
      )}

      {/* Label */}
      <div>
        <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
          Label <Text type="secondary" style={{ fontSize: 11 }}>(optional)</Text>
        </Text>
        <Input
          size="small"
          value={zone.label ?? ''}
          placeholder="e.g. Living Room"
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      {/* Delete */}
      <Popconfirm
        title="Delete this demolition zone?"
        onConfirm={onDelete}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
      >
        <Button type="default" danger size="small" icon={<DeleteOutlined />} block>
          Delete Zone
        </Button>
      </Popconfirm>
    </Space>
  );
};

// Grouped summary row
interface GroupState {
  [materialType: string]: boolean;
}

const SummaryView: React.FC<{
  zones: WMDemolitionZone[];
  materialTypes: DemoMaterialType[];
  floorSketchId: string;
  onSelectZone: (id: string) => void;
  onAddZone: (zone: WMDemolitionZone) => void;
}> = ({ zones, materialTypes, floorSketchId, onSelectZone, onAddZone }) => {
  const [expandedGroups, setExpandedGroups] = useState<GroupState>({});

  // Group zones by materialType
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { material: DemoMaterialType | undefined; zones: WMDemolitionZone[]; totalSqft: number }
    >();
    for (const zone of zones) {
      const existing = map.get(zone.material_type);
      if (existing) {
        existing.zones.push(zone);
        existing.totalSqft += zone.calculated_sqft;
      } else {
        map.set(zone.material_type, {
          material: materialTypes.find((m) => m.id === zone.material_type),
          zones: [zone],
          totalSqft: zone.calculated_sqft,
        });
      }
    }
    return Array.from(map.values());
  }, [zones, materialTypes]);

  const toggleGroup = (materialType: string) => {
    setExpandedGroups((prev) => ({ ...prev, [materialType]: !prev[materialType] }));
  };

  /** Add a list-only zone (wall / baseboard) without canvas drawing */
  const handleAddListOnly = (materialId: string) => {
    const mat =
      materialTypes.find((m) => m.id === materialId) ??
      DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === materialId);
    if (!mat) return;
    // Stagger canvas position so multiple list-only lines (same material) are
    // visible and editable instead of stacking at (0,0).
    const idx = zones.length;
    const col = idx % 12;
    const row = Math.floor(idx / 12);
    const x = 28 + col * 34;
    const y = 28 + row * 34;
    // EA items (except stair) default to qty=1; stair needs tread count entry
    const isEAType = mat.unit === 'EA';
    const isStairType = mat.id === 'stair_demo';
    const zone: WMDemolitionZone = {
      id: generateOverlayId(),
      floor_sketch_id: floorSketchId,
      material_type: mat.id,
      surface: mat.surface,
      color: mat.color,
      x,
      y,
      dimension1_ft: (isEAType && !isStairType) ? 1 : 0,
      dimension2_ft: 0,
      rotation: 0,
      calculated_sqft: (isEAType && !isStairType) ? 1 : 0,
      display_order: zones.length,
    };
    onAddZone(zone);
  };

  // Wall / baseboard / EA material types available for quick-add
  const wallTypes = materialTypes.filter((m) => m.surface === 'wall' && m.unit === 'SF');
  const baseboardTypes = materialTypes.filter((m) => m.unit === 'LF');
  const eaTypes = materialTypes.filter((m) => m.unit === 'EA');

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {/* Quick-add buttons for wall / baseboard (not drawable on canvas) */}
      {(wallTypes.length > 0 || baseboardTypes.length > 0) && (
        <div
          style={{
            padding: '8px',
            background: '#fafafa',
            borderRadius: 4,
            border: '1px solid #f0f0f0',
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 6 }}>
            Wall / Baseboard (list only — no canvas drawing)
          </Text>
          <Space wrap size={4}>
            {wallTypes.map((m) => (
              <Tooltip key={m.id} title={`Add ${m.name} entry`}>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddListOnly(m.id)}
                  style={{
                    borderColor: m.color,
                    color: m.color,
                    fontSize: 11,
                  }}
                >
                  {m.name}
                </Button>
              </Tooltip>
            ))}
            {baseboardTypes.map((m) => (
              <Tooltip key={m.id} title={`Add ${m.name} entry`}>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddListOnly(m.id)}
                  style={{
                    borderColor: m.color,
                    color: m.color,
                    fontSize: 11,
                  }}
                >
                  {m.name}
                </Button>
              </Tooltip>
            ))}
          </Space>
        </div>
      )}

      {eaTypes.length > 0 && (
        <div
          style={{
            padding: '8px',
            background: '#fafafa',
            borderRadius: 4,
            border: '1px solid #f0f0f0',
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 6 }}>
            Trim / Door / Stair Demo (list only — per unit)
          </Text>
          <Space wrap size={4}>
            {eaTypes.map((m) => (
              <Tooltip key={m.id} title={`Add ${m.name} entry`}>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => handleAddListOnly(m.id)}
                  style={{
                    borderColor: m.color,
                    color: m.color,
                    fontSize: 11,
                  }}
                >
                  {m.name}
                </Button>
              </Tooltip>
            ))}
          </Space>
        </div>
      )}

      {zones.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No demolition zones added. Select the Demolition tool and draw on the canvas, or use the
          buttons above for wall / baseboard items.
        </Text>
      )}

      {groups.map((group) => {
        const materialId = group.zones[0].material_type;
        const isExpanded = expandedGroups[materialId] ?? false;
        const unit = group.material?.unit ?? 'SF';
        const color = group.material?.color ?? group.zones[0].color;
        const name = group.material?.name ?? materialId;
        const needsCount = group.zones.filter((z) => z.dimension1_ft === 0).length;

        return (
          <div key={materialId}>
            {/* Group header */}
            <div
              onClick={() => toggleGroup(materialId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {isExpanded ? (
                <DownOutlined style={{ fontSize: 10, color: '#999' }} />
              ) : (
                <RightOutlined style={{ fontSize: 10, color: '#999' }} />
              )}
              <ColorSwatch color={color} size={10} />
              <Text style={{ fontSize: 12, flex: 1 }}>{name}</Text>
              {needsCount > 0 && (
                <Tooltip title={`${needsCount} zone(s) need dimensions`}>
                  <WarningOutlined style={{ color: '#fa8c16', fontSize: 11 }} />
                </Tooltip>
              )}
              <Text type="secondary" style={{ fontSize: 11 }}>
                {group.zones.length} zone{group.zones.length !== 1 ? 's' : ''}
              </Text>
              <Text
                strong
                style={{
                  fontSize: 12,
                  minWidth: 60,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {unit === 'EA' ? Math.round(group.totalSqft) : group.totalSqft.toFixed(2)} {unit}
              </Text>
            </div>

            {/* Expanded zone list */}
            {isExpanded && (
              <div style={{ paddingLeft: 22 }}>
                {group.zones.map((zone, i) => {
                  const needsDims = zone.dimension1_ft === 0;
                  return (
                    <div
                      key={zone.id}
                      onClick={() => onSelectZone(zone.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 6px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        background: needsDims ? '#fff7e6' : 'transparent',
                        border: needsDims ? '1px solid #ffd591' : '1px solid transparent',
                        marginBottom: 2,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = needsDims ? '#ffe7ba' : '#e6f7ff')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = needsDims ? '#fff7e6' : 'transparent')
                      }
                    >
                      {needsDims && (
                        <WarningOutlined style={{ color: '#fa8c16', fontSize: 10, flexShrink: 0 }} />
                      )}
                      {!needsDims && (
                        <Text type="secondary" style={{ fontSize: 11, minWidth: 16 }}>
                          {i + 1}.
                        </Text>
                      )}
                      <Text style={{ fontSize: 11, flex: 1 }}>
                        {zone.label || `Zone ${i + 1}`}
                        {zone.material_type === 'wood_floor' && zone.sub_type && (
                          <Tag
                            style={{ marginLeft: 4, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}
                            color="orange"
                          >
                            {WOOD_FLOOR_SUB_TYPES.find((s) => s.id === zone.sub_type)?.name ?? zone.sub_type}
                          </Tag>
                        )}
                        {WALL_MATERIAL_IDS.has(zone.material_type) && zone.sub_type && (
                          <Tag
                            style={{ marginLeft: 4, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}
                            color="magenta"
                          >
                            {WALL_MATERIAL_SUB_TYPES.find((s) => s.id === zone.sub_type)?.name ?? zone.sub_type}
                          </Tag>
                        )}
                        {TRIM_SIZE_MATERIAL_IDS.has(zone.material_type) && zone.sub_type && (
                          <Tag
                            style={{ marginLeft: 4, fontSize: 9, lineHeight: '14px', padding: '0 3px' }}
                            color="blue"
                          >
                            {TRIM_SIZE_SUB_TYPES.find((s) => s.id === zone.sub_type)?.name ?? zone.sub_type}
                          </Tag>
                        )}
                      </Text>
                      <Text
                        type="secondary"
                        style={{
                          fontSize: 11,
                          fontVariantNumeric: 'tabular-nums',
                          color: needsDims ? '#fa8c16' : undefined,
                        }}
                      >
                        {needsDims ? 'needs dims' : unit === 'EA' ? `${Math.round(zone.calculated_sqft)} ${unit}` : `${zone.calculated_sqft.toFixed(2)} ${unit}`}
                      </Text>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {zones.length > 0 && (() => {
        const sfTotal = zones.filter((z) => {
          const m = materialTypes.find((mt) => mt.id === z.material_type);
          return !m || m.unit === 'SF';
        }).reduce((sum, z) => sum + z.calculated_sqft, 0);
        const lfTotal = zones.filter((z) => materialTypes.find((mt) => mt.id === z.material_type)?.unit === 'LF')
          .reduce((sum, z) => sum + z.calculated_sqft, 0);
        const eaTotal = zones.filter((z) => materialTypes.find((mt) => mt.id === z.material_type)?.unit === 'EA')
          .reduce((sum, z) => sum + z.calculated_sqft, 0);
        const parts: string[] = [];
        if (sfTotal > 0) parts.push(`${sfTotal.toFixed(2)} SF`);
        if (lfTotal > 0) parts.push(`${lfTotal.toFixed(2)} LF`);
        if (eaTotal > 0) parts.push(`${Math.round(eaTotal)} EA`);
        return (
          <>
            <Divider style={{ margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Total ({zones.length} zones)
              </Text>
              <Text strong style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {parts.join(' + ') || '0'}
              </Text>
            </div>
          </>
        );
      })()}
    </Space>
  );
};

const WMDemolitionPanel: React.FC<WMDemolitionPanelProps> = ({
  zones,
  selectedZoneId,
  materialTypes,
  floorSketchId,
  onUpdateZone,
  onDeleteZone,
  onSelectZone,
  onAddZone,
}) => {
  const selectedZone = selectedZoneId ? zones.find((z) => z.id === selectedZoneId) : null;

  return (
    <div style={{ padding: '8px 0' }}>
      {selectedZone ? (
        <>
          {/* Header with back-to-list hint */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 10,
              padding: '0 2px',
            }}
          >
            <ColorSwatch color={selectedZone.color} size={10} />
            <Text style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
              {materialTypes.find((m) => m.id === selectedZone.material_type)?.name ??
                selectedZone.material_type}
            </Text>
            <Tooltip title="Deselect (click empty canvas area)">
              <Text type="secondary" style={{ fontSize: 11 }}>
                editing
              </Text>
            </Tooltip>
          </div>
          <ZoneEditForm
            zone={selectedZone}
            materialTypes={materialTypes}
            onUpdate={(updates) => onUpdateZone(selectedZone.id, updates)}
            onDelete={() => onDeleteZone(selectedZone.id)}
          />
        </>
      ) : (
        <SummaryView
          zones={zones}
          materialTypes={materialTypes}
          floorSketchId={floorSketchId}
          onSelectZone={onSelectZone}
          onAddZone={onAddZone}
        />
      )}
    </div>
  );
};

export default WMDemolitionPanel;
