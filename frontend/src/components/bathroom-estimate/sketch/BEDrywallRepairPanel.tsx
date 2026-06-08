/**
 * BEDrywallRepairPanel - Drywall repair estimate panel
 *
 * Per-zone breakdown:
 *  - Install Drywall (incl. gluing): material + labor cost
 *  - Texture, Prime & Paint: texture + paint cost
 *  - Per-zone total
 * Summary totals at the top.
 */

import React, { useCallback } from 'react';
import {
  Card,
  Typography,
  Select,
  InputNumber,
  Switch,
  Tag,
  Divider,
  Statistic,
  Collapse,
  Empty,
  Button,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type {
  BEDrywallRepairZone,
  DrywallTextureType,
} from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';

const { Text } = Typography;
const { Option } = Select;

interface BEDrywallRepairPanelProps {
  api: BESketchStateAPI;
}

const TEXTURE_LABELS: Record<DrywallTextureType, string> = {
  skip_trowel: 'Skip Trowel',
  orange_peel: 'Orange Peel',
  knockdown: 'Knockdown',
  flat: 'Flat / Smooth',
  smooth: 'Smooth',
};

/** Describe wall direction/orientation from two boundary points */
function wallDirectionLabel(b: { x: number; y: number }[]): string {
  if (b.length < 2) return '';
  const dx = b[1].x - b[0].x;
  const dy = b[1].y - b[0].y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDy < absDx * 0.3) return 'H';  // horizontal
  if (absDx < absDy * 0.3) return 'V';  // vertical
  return 'D';  // diagonal
}

/** Point-in-polygon with tolerance: check both the exact point and 4 offset points */
function pointNearRoom(px: number, py: number, boundary: { x: number; y: number }[]): boolean {
  const offsets = [
    { x: 0, y: 0 },
    { x: 3, y: 3 }, { x: -3, y: -3 },
    { x: 3, y: -3 }, { x: -3, y: 3 },
  ];
  for (const off of offsets) {
    const tx = px + off.x, ty = py + off.y;
    let inside = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      const xi = boundary[i].x, yi = boundary[i].y;
      const xj = boundary[j].x, yj = boundary[j].y;
      if ((yi > ty) !== (yj > ty) && tx < (xj - xi) * (ty - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

const BEDrywallRepairPanel: React.FC<BEDrywallRepairPanelProps> = ({ api }) => {
  const { data, updateDrywallRepairZone, removeDrywallRepairZone, selectedId, setSelectedId } = api;
  const zones = data.drywallRepairZones ?? [];
  const ppf = data.settings.pixelsPerFoot;

  const totalAreaSF = zones.reduce((s, z) => s + z.areaSF, 0);

  const handleUpdate = useCallback(
    (id: string, updates: Partial<BEDrywallRepairZone>) => {
      updateDrywallRepairZone(id, updates);
    },
    [updateDrywallRepairZone],
  );

  if (zones.length === 0) {
    return (
      <Card size="small" style={{ margin: '4px 0' }}>
        <Empty description="No drywall repair zones" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Select the Drywall tool and drag to mark repair areas on the sketch.
          </Text>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Summary */}
      <Card
        size="small"
        style={{ marginBottom: 8, backgroundColor: '#fff7e6', border: '1px solid #ffd591' }}
      >
        <Statistic
          title={<Text style={{ fontSize: 10 }}>Total Area</Text>}
          value={Math.round(totalAreaSF * 10) / 10}
          suffix="SF"
          valueStyle={{ fontSize: 15 }}
        />
      </Card>

      {/* Per-zone details */}
      <Collapse
        size="small"
        activeKey={selectedId && zones.some((z) => z.id === selectedId)
          ? [selectedId]
          : zones.slice(0, 2).map((z) => z.id)
        }
        onChange={() => {/* controlled by selectedId; allow collapse by clicking same header */}}
      >
        {zones.map((zone, idx) => {
          // Wall length + direction for identification
          let lengthFt = 0;
          let dirLabel = '';
          if (zone.surface === 'wall' && zone.boundary.length >= 2) {
            const dx = zone.boundary[1].x - zone.boundary[0].x;
            const dy = zone.boundary[1].y - zone.boundary[0].y;
            lengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
            dirLabel = wallDirectionLabel(zone.boundary);
          }

          const isZoneSelected = selectedId === zone.id;
          // Compact label: "W1 (V) 2.5ft" or "C1"
          const typeChar = zone.surface === 'wall' ? 'W' : 'C';
          const label = `${typeChar}${idx + 1}${dirLabel ? ` ${dirLabel}` : ''}`;

          return (
            <Collapse.Panel
              key={zone.id}
              header={
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                    cursor: 'pointer',
                    backgroundColor: isZoneSelected ? 'rgba(255, 152, 0, 0.08)' : undefined,
                    borderRadius: 4, padding: '0 2px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(isZoneSelected ? null : zone.id);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <div
                      style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        backgroundColor: isZoneSelected
                          ? (zone.surface === 'ceiling' ? '#42a5f5' : '#ff9800')
                          : (zone.surface === 'ceiling' ? 'rgba(66,165,245,0.6)' : 'rgba(255,152,0,0.6)'),
                        border: isZoneSelected
                          ? (zone.surface === 'ceiling' ? '2px solid #1565c0' : '2px solid #e65100')
                          : '1px solid rgba(0,0,0,0.2)',
                      }}
                    />
                    <Text strong style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{label}</Text>
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 4 }}>
                    {lengthFt > 0 && <Tag color="geekblue" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>{lengthFt.toFixed(1)}ft</Tag>}
                    <Tag color="orange" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>{zone.areaSF} SF</Tag>
                  </div>
                </div>
              }
            >
              <div style={{ fontSize: 11 }}>
                {/* Surface badge */}
                <div style={{ marginBottom: 6 }}>
                  <Tag color={zone.surface === 'wall' ? 'orange' : 'blue'} style={{ marginBottom: 4 }}>
                    {zone.surface === 'wall' ? 'Wall' : 'Ceiling'}
                  </Tag>
                </div>

                {/* Height — wall only (affects area calculation) */}
                {zone.surface === 'wall' && (
                  <div style={{ marginBottom: 6 }}>
                    <Text type="secondary">Wall Height: </Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>(changes area)</Text>
                    <InputNumber
                      size="small"
                      value={zone.repairHeightInches}
                      min={12}
                      max={240}
                      suffix='″'
                      onChange={(v) => v && handleUpdate(zone.id, { repairHeightInches: v })}
                      style={{ width: '100%', marginTop: 2 }}
                    />
                  </div>
                )}

                {/* Gluing toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text type="secondary">Include Gluing:</Text>
                  <Switch
                    size="small"
                    checked={zone.includeGluing}
                    onChange={(v) => handleUpdate(zone.id, { includeGluing: v })}
                  />
                </div>

                {/* Texture type */}
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary">Texture:</Text>
                  <Select
                    size="small"
                    value={zone.textureType}
                    onChange={(v: DrywallTextureType) => handleUpdate(zone.id, { textureType: v })}
                    style={{ width: '100%', marginTop: 2 }}
                  >
                    {(Object.keys(TEXTURE_LABELS) as DrywallTextureType[]).map((k) => (
                      <Option key={k} value={k}>{TEXTURE_LABELS[k]}</Option>
                    ))}
                  </Select>
                </div>

                {/* Paint coats */}
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary">Paint Coats:</Text>
                  <InputNumber
                    size="small"
                    value={zone.paintCoats}
                    min={1}
                    max={4}
                    onChange={(v) => v && handleUpdate(zone.id, { paintCoats: v })}
                    style={{ width: '100%', marginTop: 2 }}
                  />
                </div>

                <Divider style={{ margin: '6px 0' }} />
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  block
                  onClick={() => {
                    removeDrywallRepairZone(zone.id);
                    setSelectedId(null);
                  }}
                >
                  Remove Zone
                </Button>
              </div>
            </Collapse.Panel>
          );
        })}
      </Collapse>
    </div>
  );
};

export default BEDrywallRepairPanel;
