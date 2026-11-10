/**
 * WMDemolitionBulkForm - edits two or more selected tear-out zones at once.
 *
 * Mirrors the single-zone form in WMDemolitionPanel, minus the per-zone
 * measurements (length, width, tread count). A field appears when at least
 * one selected zone takes it, changes only the zones that take it, and reads
 * "Mixed" while those zones disagree. Every change is one undo step.
 */
import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Input, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { DemoMaterialType, TrimRemovalExtent, WMDemolitionZone } from '../../../../types/wmSketch';
import {
  DEFAULT_DEMO_MATERIAL_TYPES,
  EA_ITEM_PIXEL_SIZES,
  TRIM_REMOVAL_MATERIAL_IDS,
  TRIM_SIZE_MATERIAL_IDS,
  TRIM_SIZE_SUB_TYPES,
  WALL_MATERIAL_IDS,
  WALL_MATERIAL_SUB_TYPES,
  WOOD_FLOOR_SUB_TYPES,
  calcTrimLF,
} from '../../../../types/wmSketch';
import DimensionInput from './DimensionInput';

const { Text } = Typography;

type ZonePatch = Partial<WMDemolitionZone> & { id: string };

export interface WMDemolitionBulkFormProps {
  zones: WMDemolitionZone[];
  materialTypes: DemoMaterialType[];
  onUpdateZones: (patches: ZonePatch[]) => void;
  /** Delete every zone in the form. Without it there is no Delete button. */
  onDeleteZones?: (ids: string[]) => void;
}

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

const BASEBOARD_OPTIONS: Array<{
  value: NonNullable<WMDemolitionZone['baseboard_type']>;
  label: string;
  color: string;
}> = [
  { value: 'baseboard', label: 'Baseboard', color: '#DEB887' },
  { value: 'quarter_round', label: 'Quarter Round', color: '#C4A882' },
  { value: 'baseboard_quarter_round', label: 'Baseboard + Quarter Round', color: '#D2B48C' },
];

/** Select value standing for "no baseboard / trim". */
const NO_BASEBOARD = '__none__';

const REMOVAL_OPTIONS: Array<{ value: TrimRemovalExtent; label: string }> = [
  { value: 'full', label: 'Full' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'custom', label: 'Custom LF' },
];

function findMaterial(materialTypes: DemoMaterialType[], id: string) {
  return (
    materialTypes.find((m) => m.id === id) ??
    DEFAULT_DEMO_MATERIAL_TYPES.find((m) => m.id === id)
  );
}

const isPolygon = (z: WMDemolitionZone) => (z.polygon_points?.length ?? 0) >= 3;

/** The sub-type list a material draws from; a material change keeps sub_type only within one. */
function subTypeFamily(materialId: string): 'wood' | 'wall' | 'size' | null {
  if (materialId === 'wood_floor') return 'wood';
  if (WALL_MATERIAL_IDS.has(materialId)) return 'wall';
  if (TRIM_SIZE_MATERIAL_IDS.has(materialId)) return 'size';
  return null;
}

function subTypeColor(materialId: string, subType: string | undefined): string | undefined {
  if (!subType) return undefined;
  const family = subTypeFamily(materialId);
  if (family === 'wood') return WOOD_FLOOR_SUB_TYPES.find((s) => s.id === subType)?.color;
  if (family === 'wall') return WALL_MATERIAL_SUB_TYPES.find((s) => s.id === subType)?.color;
  return undefined;
}

function eaPixelSize(materialId: string, subType: string | undefined) {
  const sizes = EA_ITEM_PIXEL_SIZES[materialId] ?? {};
  return sizes[subType || ''] ?? sizes[''] ?? { w: 36, h: 36 };
}

/** What a zone changes to when its material is swapped for `mat` (same unit and surface). */
export function materialSwapPatch(zone: WMDemolitionZone, mat: DemoMaterialType): ZonePatch {
  const keepSub = subTypeFamily(zone.material_type) !== null
    && subTypeFamily(zone.material_type) === subTypeFamily(mat.id);
  const subType = keepSub ? zone.sub_type : undefined;
  const patch: ZonePatch = {
    id: zone.id,
    material_type: mat.id,
    surface: mat.surface,
    sub_type: subType,
    color: subTypeColor(mat.id, subType) ?? mat.color,
  };

  if (isPolygon(zone)) return patch; // area comes from the outline, not the material

  if (mat.surface === 'wall' && mat.unit === 'SF') {
    // Same defaults the single-zone form applies
    const height =
      mat.id === 'wall_drywall_2ft' ? 2 :
      mat.id === 'wall_drywall_4ft' ? 4 :
      zone.height_ft ?? 8;
    patch.height_ft = height;
    patch.calculated_sqft = zone.dimension1_ft * height;
  } else if (mat.unit === 'EA') {
    if (TRIM_SIZE_MATERIAL_IDS.has(mat.id)) {
      const sz = eaPixelSize(mat.id, subType);
      patch.pixel_width = sz.w;
      patch.pixel_height = sz.h;
    }
    patch.calculated_sqft = TRIM_REMOVAL_MATERIAL_IDS.has(mat.id)
      ? calcTrimLF(mat.id, subType || '', zone.trim_removal || 'full', zone.trim_lf)
      : mat.id === 'stair_demo'
        ? zone.dimension1_ft
        : 1;
  }
  return patch;
}

/** The value every item shares, or `same: false` when they differ (or there are none). */
function sharedValue<T>(values: T[]): { same: boolean; value: T | undefined } {
  if (values.length === 0) return { same: false, value: undefined };
  const first = values[0];
  return values.every((v) => v === first)
    ? { same: true, value: first }
    : { same: false, value: undefined };
}

const FieldLabel: React.FC<{ title: string; applies: number; total: number }> = ({
  title,
  applies,
  total,
}) => (
  <Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
    {title}
    {applies < total && (
      <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
        ({applies} of {total})
      </Text>
    )}
  </Text>
);

/** Tri-state checkbox over the zones that take a boolean field. */
const BulkCheckbox: React.FC<{
  label: string;
  zones: WMDemolitionZone[];
  total: number;
  isOn: (z: WMDemolitionZone) => boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, zones, total, isOn, onChange }) => {
  const on = zones.filter(isOn).length;
  return (
    <Checkbox
      checked={on === zones.length}
      indeterminate={on > 0 && on < zones.length}
      onChange={(e) => onChange(e.target.checked)}
    >
      <span style={{ fontSize: 12 }}>{label}</span>
      {zones.length < total && (
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
          ({zones.length} of {total})
        </Text>
      )}
    </Checkbox>
  );
};

/**
 * Text box that writes on blur / Enter only, so typing a label across eight
 * zones is one undo step rather than one per keystroke.
 */
const CommitInput: React.FC<{
  value: string;
  mixed: boolean;
  placeholder: string;
  onCommit: (text: string) => void;
  type?: 'text' | 'number';
  suffix?: string;
}> = ({ value, mixed, placeholder, onCommit, type = 'text', suffix }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      size="small"
      type={type}
      min={type === 'number' ? 0 : undefined}
      step={type === 'number' ? 0.5 : undefined}
      value={draft ?? value}
      placeholder={mixed ? 'Mixed' : placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPressEnter={(e) => e.currentTarget.blur()}
      suffix={suffix}
      style={type === 'number' ? { fontVariantNumeric: 'tabular-nums' } : undefined}
    />
  );
};

const WMDemolitionBulkForm: React.FC<WMDemolitionBulkFormProps> = ({
  zones,
  materialTypes,
  onUpdateZones,
  onDeleteZones,
}) => {
  const total = zones.length;
  const matOf = (z: WMDemolitionZone) => findMaterial(materialTypes, z.material_type);

  // Material type can only move between materials of the same unit and
  // surface, so a wall line stays a line and a floor area stays an area.
  const kind = sharedValue(zones.map((z) => `${matOf(z)?.unit ?? 'SF'}|${z.surface}`));
  const materialOptions = useMemo(() => {
    if (!kind.same) return [];
    const [unit, surface] = (kind.value ?? '').split('|');
    return materialTypes.filter((m) => m.unit === unit && m.surface === surface);
  }, [kind.same, kind.value, materialTypes]);
  const material = sharedValue(zones.map((z) => z.material_type));

  const woodZones = zones.filter((z) => z.material_type === 'wood_floor');
  const wallMaterialZones = zones.filter((z) => WALL_MATERIAL_IDS.has(z.material_type));
  const sizeZones = zones.filter((z) => TRIM_SIZE_MATERIAL_IDS.has(z.material_type));
  const removalZones = zones.filter((z) => TRIM_REMOVAL_MATERIAL_IDS.has(z.material_type));
  const heightZones = zones.filter((z) => {
    const m = matOf(z);
    return m?.surface === 'wall' && m?.unit === 'SF' && !isPolygon(z);
  });
  const carpetZones = zones.filter((z) => z.material_type === 'carpet');
  const glueZones = zones.filter((z) => {
    const m = matOf(z);
    return m?.surface === 'floor' && m?.unit === 'SF';
  });
  // Wall / ceiling SF, not insulation itself
  const extrasZones = zones.filter((z) => {
    const m = matOf(z);
    return (m?.surface === 'wall' || m?.surface === 'ceiling') && m?.unit === 'SF'
      && z.material_type !== 'insulation';
  });
  const baseboardZones = extrasZones.filter((z) => matOf(z)?.surface === 'wall');

  const woodType = sharedValue(woodZones.map((z) => z.sub_type || undefined));
  const wallMaterial = sharedValue(wallMaterialZones.map((z) => z.sub_type || undefined));
  const size = sharedValue(sizeZones.map((z) => z.sub_type || undefined));
  const removal = sharedValue(removalZones.map((z) => z.trim_removal || 'full'));
  const customLF = sharedValue(removalZones.map((z) => z.trim_lf ?? 0));
  const height = sharedValue(heightZones.map((z) => z.height_ft ?? 8));
  const baseboard = sharedValue(baseboardZones.map((z) => z.baseboard_type ?? NO_BASEBOARD));
  const label = sharedValue(zones.map((z) => z.label ?? ''));

  const trimLF = removalZones.reduce(
    (s, z) => s + calcTrimLF(z.material_type, z.sub_type || '', z.trim_removal || 'full', z.trim_lf),
    0,
  );
  const lineLF = baseboardZones.reduce((s, z) => s + (z.dimension1_ft || 0), 0);

  // Counts by material, e.g. "Wall/Drywall ×6 · Wall - Drywall 2ft ×2"
  const breakdown = useMemo(() => {
    const counts = new Map<string, { name: string; color: string; n: number }>();
    for (const z of zones) {
      const m = findMaterial(materialTypes, z.material_type);
      const prev = counts.get(z.material_type);
      if (prev) prev.n += 1;
      else counts.set(z.material_type, { name: m?.name ?? z.material_type, color: m?.color ?? z.color, n: 1 });
    }
    return Array.from(counts.values());
  }, [zones, materialTypes]);

  /** Sets sub_type and its shade on each zone; clearing goes back to the material's color. */
  const setSubTypeWithColor = (targets: WMDemolitionZone[], value: string | undefined) =>
    onUpdateZones(
      targets.map((z) => ({
        id: z.id,
        sub_type: value || undefined,
        color: subTypeColor(z.material_type, value) ?? matOf(z)?.color ?? z.color,
      })),
    );

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }} data-testid="wm-demo-bulk-edit">
      <div>
        <Text strong style={{ fontSize: 13 }}>
          {total} zones selected
        </Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {breakdown.map((b) => (
            <Tag key={b.name} style={{ fontSize: 11, margin: 0 }}>
              <Space size={4}>
                <ColorSwatch color={b.color} size={9} />
                <span>
                  {b.name} ×{b.n}
                </span>
              </Space>
            </Tag>
          ))}
        </div>
      </div>

      {materialOptions.length > 1 && (
        <div>
          <FieldLabel title="Material Type" applies={total} total={total} />
          <Select
            size="small"
            value={material.same ? material.value : undefined}
            placeholder="Mixed"
            onChange={(value: string) => {
              const mat = materialOptions.find((m) => m.id === value);
              if (!mat) return;
              onUpdateZones(
                zones.filter((z) => z.material_type !== mat.id).map((z) => materialSwapPatch(z, mat)),
              );
            }}
            style={{ width: '100%' }}
            optionLabelProp="label"
          >
            {materialOptions.map((m) => (
              <Select.Option key={m.id} value={m.id} label={m.name}>
                <Space size={6}>
                  <ColorSwatch color={m.color} />
                  <span>{m.name}</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </div>
      )}

      {woodZones.length > 0 && (
        <div>
          <FieldLabel title="Floor Type" applies={woodZones.length} total={total} />
          <Select
            size="small"
            value={woodType.same ? woodType.value : undefined}
            placeholder={woodType.same ? 'Select floor type' : 'Mixed'}
            onChange={(value: string | undefined) => setSubTypeWithColor(woodZones, value)}
            style={{ width: '100%' }}
            allowClear
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

      {wallMaterialZones.length > 0 && (
        <div>
          <FieldLabel title="Wall Material" applies={wallMaterialZones.length} total={total} />
          <Select
            size="small"
            value={wallMaterial.same ? wallMaterial.value : undefined}
            placeholder={wallMaterial.same ? 'Select wall material' : 'Mixed'}
            onChange={(value: string | undefined) => setSubTypeWithColor(wallMaterialZones, value)}
            style={{ width: '100%' }}
            allowClear
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

      {sizeZones.length > 0 && (
        <div>
          <FieldLabel title="Size" applies={sizeZones.length} total={total} />
          <Select
            size="small"
            value={size.same ? size.value : undefined}
            placeholder={size.same ? 'Select size' : 'Mixed'}
            onChange={(value: string | undefined) =>
              onUpdateZones(
                sizeZones.map((z) => {
                  const sz = eaPixelSize(z.material_type, value);
                  const patch: ZonePatch = {
                    id: z.id,
                    sub_type: value || undefined,
                    pixel_width: sz.w,
                    pixel_height: sz.h,
                  };
                  if (TRIM_REMOVAL_MATERIAL_IDS.has(z.material_type)) {
                    patch.calculated_sqft = calcTrimLF(
                      z.material_type, value || '', z.trim_removal || 'full', z.trim_lf,
                    );
                  }
                  return patch;
                }),
              )
            }
            style={{ width: '100%' }}
            allowClear
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

      {removalZones.length > 0 && (
        <div>
          <FieldLabel title="Removal" applies={removalZones.length} total={total} />
          <Select
            size="small"
            value={removal.same ? removal.value : undefined}
            placeholder="Mixed"
            onChange={(value: TrimRemovalExtent) =>
              onUpdateZones(
                removalZones.map((z) => ({
                  id: z.id,
                  trim_removal: value,
                  trim_lf: value === 'custom' ? z.trim_lf : undefined,
                  calculated_sqft: calcTrimLF(z.material_type, z.sub_type || '', value, z.trim_lf),
                })),
              )
            }
            style={{ width: '100%' }}
          >
            {REMOVAL_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select>
          {removal.same && removal.value === 'custom' && (
            <div style={{ marginTop: 6 }}>
              <CommitInput
                type="number"
                suffix="LF each"
                value={customLF.same && customLF.value ? String(customLF.value) : ''}
                mixed={!customLF.same}
                placeholder="Enter LF"
                onCommit={(text) => {
                  const val = parseFloat(text) || 0;
                  onUpdateZones(
                    removalZones.map((z) => ({ id: z.id, trim_lf: val, calculated_sqft: val })),
                  );
                }}
              />
            </div>
          )}
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {Math.round(trimLF * 10) / 10} LF total
          </Text>
        </div>
      )}

      {heightZones.length > 0 && (
        <div>
          <FieldLabel title="Height" applies={heightZones.length} total={total} />
          <DimensionInput
            value={height.same ? height.value ?? 0 : 0}
            placeholder={height.same ? "e.g. 8' or 4" : 'Mixed'}
            onChange={(ft) =>
              onUpdateZones(
                heightZones.map((z) => ({
                  id: z.id,
                  height_ft: ft,
                  calculated_sqft: z.dimension1_ft * ft,
                })),
              )
            }
          />
        </div>
      )}

      {(carpetZones.length > 0 || glueZones.length > 0 || extrasZones.length > 0) && (
        <Space direction="vertical" size={4}>
          {carpetZones.length > 0 && (
            <BulkCheckbox
              label="Include Carpet Pad"
              zones={carpetZones}
              total={total}
              isOn={(z) => !!z.include_pad}
              onChange={(checked) =>
                onUpdateZones(carpetZones.map((z) => ({ id: z.id, include_pad: checked })))
              }
            />
          )}
          {glueZones.length > 0 && (
            <BulkCheckbox
              label="Glue Down (extra removal)"
              zones={glueZones}
              total={total}
              isOn={(z) => !!z.glue_down}
              onChange={(checked) =>
                onUpdateZones(glueZones.map((z) => ({ id: z.id, glue_down: checked })))
              }
            />
          )}
          {extrasZones.length > 0 && (
            <BulkCheckbox
              label="Include Insulation"
              zones={extrasZones}
              total={total}
              isOn={(z) => !!z.include_insulation}
              onChange={(checked) =>
                onUpdateZones(extrasZones.map((z) => ({ id: z.id, include_insulation: checked })))
              }
            />
          )}
        </Space>
      )}

      {baseboardZones.length > 0 && (
        <div>
          <FieldLabel title="Baseboard / Trim" applies={baseboardZones.length} total={total} />
          <Select
            size="small"
            value={baseboard.same ? baseboard.value : undefined}
            placeholder="Mixed"
            onChange={(value: string) => {
              const next =
                value === NO_BASEBOARD
                  ? undefined
                  : (value as WMDemolitionZone['baseboard_type']);
              onUpdateZones(baseboardZones.map((z) => ({ id: z.id, baseboard_type: next })));
            }}
            style={{ width: '100%' }}
          >
            <Select.Option value={NO_BASEBOARD}>
              <span style={{ color: '#8c8c8c' }}>None</span>
            </Select.Option>
            {BASEBOARD_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                <Space size={6}>
                  <ColorSwatch color={o.color} size={10} />
                  <span>{o.label}</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
          {baseboard.same && baseboard.value !== NO_BASEBOARD && lineLF > 0 && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              +{lineLF.toFixed(2)} LF
            </Text>
          )}
        </div>
      )}

      {extrasZones.length > 0 && (
        <BulkCheckbox
          label="Include Crown Molding"
          zones={extrasZones}
          total={total}
          isOn={(z) => !!z.include_crown_molding}
          onChange={(checked) =>
            onUpdateZones(extrasZones.map((z) => ({ id: z.id, include_crown_molding: checked })))
          }
        />
      )}

      <div>
        <FieldLabel title="Label" applies={total} total={total} />
        <CommitInput
          value={label.same ? label.value ?? '' : ''}
          mixed={!label.same}
          placeholder="e.g. Living Room"
          onCommit={(text) =>
            onUpdateZones(zones.map((z) => ({ id: z.id, label: text.trim() || undefined })))
          }
        />
      </div>

      {onDeleteZones && (
        <Popconfirm
          title={`Delete these ${total} zones?`}
          onConfirm={() => onDeleteZones(zones.map((z) => z.id))}
          okText="Delete"
          okType="danger"
          cancelText="Cancel"
        >
          <Button type="default" danger size="small" icon={<DeleteOutlined />} block>
            Delete {total} Zones
          </Button>
        </Popconfirm>
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>
        Length, width and tread count stay per zone. Ctrl-click a zone on the canvas to add or
        remove it; click empty canvas to clear the selection.
      </Text>
    </Space>
  );
};

export default WMDemolitionBulkForm;
