/**
 * BEDrywallRepairPanel - Drywall repair estimate panel
 *
 * Per-zone breakdown:
 *  - Install Drywall (incl. gluing): material + labor cost
 *  - Texture, Prime & Paint: texture + paint cost
 *  - Per-zone total
 * Summary totals at the top.
 */

import React, { useMemo, useCallback } from 'react';
import {
  Card,
  Typography,
  Select,
  InputNumber,
  Switch,
  Tag,
  Space,
  Divider,
  Statistic,
  Row,
  Col,
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

// ── Cost calculation ──

interface DrywallCalcResult {
  drywallMaterialCost: number;
  drywallLaborCost: number;
  drywallSubtotal: number;
  textureCost: number;
  paintCost: number;
  finishSubtotal: number;
  totalCost: number;
}

function calcDrywallRepair(zone: BEDrywallRepairZone): DrywallCalcResult {
  const sf = zone.areaSF;
  const drywallMaterialCost = sf * zone.drywallMaterialCostPerSF;
  const drywallLaborCost = sf * zone.drywallLaborCostPerSF;
  const drywallSubtotal = drywallMaterialCost + drywallLaborCost;
  const textureCost = sf * zone.textureCostPerSF;
  const paintCost = sf * zone.paintCostPerSF * (zone.paintCoats / 2);
  const finishSubtotal = textureCost + paintCost;
  const totalCost = drywallSubtotal + finishSubtotal;
  return {
    drywallMaterialCost: Math.round(drywallMaterialCost * 100) / 100,
    drywallLaborCost: Math.round(drywallLaborCost * 100) / 100,
    drywallSubtotal: Math.round(drywallSubtotal * 100) / 100,
    textureCost: Math.round(textureCost * 100) / 100,
    paintCost: Math.round(paintCost * 100) / 100,
    finishSubtotal: Math.round(finishSubtotal * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
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

  const calculations = useMemo(() => zones.map((z) => ({ zone: z, calc: calcDrywallRepair(z) })), [zones]);

  const totals = useMemo(
    () =>
      calculations.reduce(
        (acc, { zone, calc }) => ({
          drywallSubtotal: acc.drywallSubtotal + calc.drywallSubtotal,
          finishSubtotal: acc.finishSubtotal + calc.finishSubtotal,
          totalCost: acc.totalCost + calc.totalCost,
        }),
        { drywallSubtotal: 0, finishSubtotal: 0, totalCost: 0 },
      ),
    [calculations],
  );

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
        <Row gutter={8}>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Total Area</Text>}
              value={Math.round(totalAreaSF * 10) / 10}
              suffix="SF"
              valueStyle={{ fontSize: 15 }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Install DW</Text>}
              value={Math.round(totals.drywallSubtotal)}
              prefix="$"
              valueStyle={{ fontSize: 15 }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Total</Text>}
              value={Math.round(totals.totalCost)}
              prefix="$"
              valueStyle={{ fontSize: 15, color: '#d46b08' }}
            />
          </Col>
        </Row>
        <Divider style={{ margin: '6px 0' }} />
        <Row gutter={4}>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 10 }}>Install Drywall (incl. gluing)</Text>
            <br />
            <Text strong style={{ fontSize: 12 }}>${Math.round(totals.drywallSubtotal)}</Text>
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 10 }}>Texture, Prime & Paint</Text>
            <br />
            <Text strong style={{ fontSize: 12 }}>${Math.round(totals.finishSubtotal)}</Text>
          </Col>
        </Row>
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
        {calculations.map(({ zone, calc }, idx) => {
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

                <Divider style={{ margin: '6px 0' }}>
                  <Text style={{ fontSize: 10 }} type="secondary">Unit Costs ($/SF)</Text>
                </Divider>

                {/* Cost inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 10 }}>DW Material</Text>
                    <InputNumber
                      size="small"
                      value={zone.drywallMaterialCostPerSF}
                      min={0.5}
                      max={20}
                      step={0.25}
                      prefix="$"
                      onChange={(v) => v && handleUpdate(zone.id, { drywallMaterialCostPerSF: v })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 10 }}>DW Labor</Text>
                    <InputNumber
                      size="small"
                      value={zone.drywallLaborCostPerSF}
                      min={0.5}
                      max={30}
                      step={0.25}
                      prefix="$"
                      onChange={(v) => v && handleUpdate(zone.id, { drywallLaborCostPerSF: v })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Texture</Text>
                    <InputNumber
                      size="small"
                      value={zone.textureCostPerSF}
                      min={0.25}
                      max={20}
                      step={0.25}
                      prefix="$"
                      onChange={(v) => v && handleUpdate(zone.id, { textureCostPerSF: v })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 10 }}>Prime & Paint</Text>
                    <InputNumber
                      size="small"
                      value={zone.paintCostPerSF}
                      min={0.25}
                      max={20}
                      step={0.25}
                      prefix="$"
                      onChange={(v) => v && handleUpdate(zone.id, { paintCostPerSF: v })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <Divider style={{ margin: '6px 0' }} />

                {/* Cost breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 11 }}>
                  <Text type="secondary">Area:</Text>
                  <Text strong>{zone.areaSF} SF</Text>
                  <Text type="secondary">DW material:</Text>
                  <Text>${calc.drywallMaterialCost.toFixed(2)}</Text>
                  <Text type="secondary">DW labor{zone.includeGluing ? ' + glue' : ''}:</Text>
                  <Text>${calc.drywallLaborCost.toFixed(2)}</Text>
                  <Text type="secondary" style={{ borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>Install DW:</Text>
                  <Text strong style={{ borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>${calc.drywallSubtotal.toFixed(2)}</Text>
                  <Text type="secondary">Texture:</Text>
                  <Text>${calc.textureCost.toFixed(2)}</Text>
                  <Text type="secondary">Prime & paint ({zone.paintCoats} coats):</Text>
                  <Text>${calc.paintCost.toFixed(2)}</Text>
                  <Text type="secondary" style={{ borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>Finish total:</Text>
                  <Text strong style={{ borderTop: '1px solid #f0f0f0', paddingTop: 2 }}>${calc.finishSubtotal.toFixed(2)}</Text>
                  <Text type="secondary" style={{ borderTop: '2px solid #ffd591', paddingTop: 3, fontWeight: 600 }}>Zone total:</Text>
                  <Text strong style={{ borderTop: '2px solid #ffd591', paddingTop: 3, color: '#d46b08' }}>${calc.totalCost.toFixed(2)}</Text>
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
