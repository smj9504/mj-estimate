/**
 * BETileCalculationPanel - Tile calculation breakdown panel
 *
 * Shows per-zone tile specifications:
 *  - Zone type & area SF
 *  - Tile material, size, pattern selection
 *  - Waste %, material cost, labor cost
 *  - Calculated totals (tiles needed, boxes, cost)
 *
 * Appears when user selects the Tile Zone tool.
 */

import React, { useMemo, useCallback } from 'react';
import {
  Card,
  Table,
  Typography,
  Select,
  InputNumber,
  Tag,
  Space,
  Divider,
  Statistic,
  Row,
  Col,
  Collapse,
  Empty,
} from 'antd';
import {
  CalculatorOutlined,
} from '@ant-design/icons';
import type {
  BETileZone,
  BETileSpec,
  TileMaterial,
  TilePattern,
  TileSize,
  TileZoneType,
} from '../../../types/bathroomSketch';
import { TILE_ZONE_COLORS } from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';

const { Text, Title } = Typography;
const { Panel } = Collapse;
const { Option } = Select;

interface BETileCalculationPanelProps {
  api: BESketchStateAPI;
}

// ── Tile size dimensions (inches) ──
const TILE_SIZE_MAP: Record<TileSize, { w: number; h: number; label: string }> = {
  '4x4': { w: 4, h: 4, label: '4" × 4"' },
  '6x6': { w: 6, h: 6, label: '6" × 6"' },
  '12x12': { w: 12, h: 12, label: '12" × 12"' },
  '12x24': { w: 12, h: 24, label: '12" × 24"' },
  '18x18': { w: 18, h: 18, label: '18" × 18"' },
  '24x24': { w: 24, h: 24, label: '24" × 24"' },
  '3x6_subway': { w: 3, h: 6, label: '3" × 6" Subway' },
  '4x12_subway': { w: 4, h: 12, label: '4" × 12" Subway' },
  'custom': { w: 12, h: 12, label: 'Custom' },
};

// ── Calculate tile quantity ──
interface TileCalcResult {
  /** Net area after waste */
  totalAreaSF: number;
  /** Tiles needed */
  tilesNeeded: number;
  /** Boxes needed (assuming 10 SF/box for large, 5 SF/box for small) */
  boxesNeeded: number;
  /** Material cost */
  materialCost: number;
  /** Labor cost */
  laborCost: number;
  /** Total cost */
  totalCost: number;
}

function calculateTileForZone(zone: BETileZone): TileCalcResult {
  const spec = zone.tileSpec;
  const wasteFactor = 1 + spec.wastePct / 100;
  const totalAreaSF = zone.areaSF * wasteFactor;

  const tileInfo = TILE_SIZE_MAP[spec.size] ?? TILE_SIZE_MAP['12x12'];
  const tileSF = (tileInfo.w * tileInfo.h) / 144;
  const tilesNeeded = Math.ceil(totalAreaSF / tileSF);

  // Box size: larger tiles ~10 SF/box, smaller ~5 SF/box
  const boxSF = tileSF > 0.5 ? 10 : 5;
  const boxesNeeded = Math.ceil(totalAreaSF / boxSF);

  const materialCost = totalAreaSF * spec.materialCostPerSF;
  const laborCost = zone.areaSF * spec.laborCostPerSF; // Labor on net area
  const totalCost = materialCost + laborCost;

  return {
    totalAreaSF: Math.round(totalAreaSF * 100) / 100,
    tilesNeeded,
    boxesNeeded,
    materialCost: Math.round(materialCost * 100) / 100,
    laborCost: Math.round(laborCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

// ── Zone type labels ──
const ZONE_TYPE_LABELS: Record<TileZoneType, string> = {
  floor: 'Floor Tile',
  wall_full: 'Full Wall Tile',
  tub_surround: 'Tub Surround',
  tub_deck: 'Tub Deck',
  tub_front_panel: 'Tub Front Panel',
  shower_walls: 'Shower Walls',
  shower_floor: 'Shower Floor',
  shower_niche: 'Shower Niche',
  shower_bench: 'Shower Bench',
  vanity_backsplash: 'Vanity Backsplash',
};

// ── Component ──

const BETileCalculationPanel: React.FC<BETileCalculationPanelProps> = ({ api }) => {
  const { data, updateTileZone } = api;
  const zones = data.tileZones;

  // ── Calculations ──
  const calculations = useMemo(() => {
    return zones.map((z) => ({ zone: z, calc: calculateTileForZone(z) }));
  }, [zones]);

  const totals = useMemo(() => {
    return calculations.reduce(
      (acc, { calc }) => ({
        areaSF: acc.areaSF + calc.totalAreaSF,
        materialCost: acc.materialCost + calc.materialCost,
        laborCost: acc.laborCost + calc.laborCost,
        totalCost: acc.totalCost + calc.totalCost,
      }),
      { areaSF: 0, materialCost: 0, laborCost: 0, totalCost: 0 },
    );
  }, [calculations]);

  // ── Update zone tile spec ──
  const handleSpecChange = useCallback(
    (zoneId: string, field: keyof BETileSpec, value: any) => {
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) return;
      updateTileZone(zoneId, {
        tileSpec: { ...zone.tileSpec, [field]: value },
      });
    },
    [zones, updateTileZone],
  );

  if (zones.length === 0) {
    return (
      <Card size="small" style={{ margin: '8px 0' }}>
        <Empty
          description="No tile zones detected"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Text type="secondary" style={{ fontSize: 11 }}>
            Place fixtures (bathtub, shower, vanity) to auto-generate tile zones.
          </Text>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* ── Summary Totals ── */}
      <Card size="small" style={{ marginBottom: 8, backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' }}>
        <Row gutter={8}>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Total Area</Text>}
              value={totals.areaSF}
              suffix="SF"
              valueStyle={{ fontSize: 16 }}
              precision={1}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Material</Text>}
              value={totals.materialCost}
              prefix="$"
              valueStyle={{ fontSize: 16 }}
              precision={0}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Total</Text>}
              value={totals.totalCost}
              prefix="$"
              valueStyle={{ fontSize: 16, color: '#389e0d' }}
              precision={0}
            />
          </Col>
        </Row>
      </Card>

      {/* ── Per-Zone Details ── */}
      <Collapse size="small" defaultActiveKey={zones.slice(0, 3).map((z) => z.id)}>
        {calculations.map(({ zone, calc }) => (
          <Panel
            key={zone.id}
            header={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Space size={4}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      backgroundColor: zone.color.replace(/[\d.]+\)$/, '0.6)'),
                      border: '1px solid rgba(0,0,0,0.2)',
                    }}
                  />
                  <Text strong style={{ fontSize: 11 }}>
                    {ZONE_TYPE_LABELS[zone.type] ?? zone.label}
                  </Text>
                </Space>
                <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>{zone.areaSF} SF</Tag>
              </div>
            }
          >
            <div style={{ fontSize: 11 }}>
              {/* Material */}
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">Material:</Text>
                <Select
                  size="small"
                  value={zone.tileSpec.material}
                  onChange={(v: TileMaterial) => handleSpecChange(zone.id, 'material', v)}
                  style={{ width: '100%', marginTop: 2 }}
                >
                  <Option value="porcelain">Porcelain</Option>
                  <Option value="ceramic">Ceramic</Option>
                  <Option value="glass">Glass</Option>
                  <Option value="natural_stone">Natural Stone</Option>
                  <Option value="mosaic">Mosaic</Option>
                </Select>
              </div>

              {/* Size */}
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">Size:</Text>
                <Select
                  size="small"
                  value={zone.tileSpec.size}
                  onChange={(v: TileSize) => handleSpecChange(zone.id, 'size', v)}
                  style={{ width: '100%', marginTop: 2 }}
                >
                  {Object.entries(TILE_SIZE_MAP).map(([k, v]) => (
                    <Option key={k} value={k}>{v.label}</Option>
                  ))}
                </Select>
              </div>

              {/* Pattern */}
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">Pattern:</Text>
                <Select
                  size="small"
                  value={zone.tileSpec.pattern}
                  onChange={(v: TilePattern) => handleSpecChange(zone.id, 'pattern', v)}
                  style={{ width: '100%', marginTop: 2 }}
                >
                  <Option value="straight">Straight Lay</Option>
                  <Option value="diagonal">Diagonal (45°)</Option>
                  <Option value="herringbone">Herringbone</Option>
                  <Option value="subway">Subway (1/2 offset)</Option>
                  <Option value="chevron">Chevron</Option>
                  <Option value="basketweave">Basketweave</Option>
                </Select>
              </div>

              {/* Costs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Waste %</Text>
                  <InputNumber
                    size="small"
                    value={zone.tileSpec.wastePct}
                    min={5}
                    max={30}
                    onChange={(v) => v && handleSpecChange(zone.id, 'wastePct', v)}
                    style={{ width: '100%' }}
                    addonAfter="%"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Mat $/SF</Text>
                  <InputNumber
                    size="small"
                    value={zone.tileSpec.materialCostPerSF}
                    min={1}
                    max={50}
                    step={0.5}
                    onChange={(v) => v && handleSpecChange(zone.id, 'materialCostPerSF', v)}
                    style={{ width: '100%' }}
                    prefix="$"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Labor $/SF</Text>
                  <InputNumber
                    size="small"
                    value={zone.tileSpec.laborCostPerSF}
                    min={1}
                    max={50}
                    step={0.5}
                    onChange={(v) => v && handleSpecChange(zone.id, 'laborCostPerSF', v)}
                    style={{ width: '100%' }}
                    prefix="$"
                  />
                </div>
              </div>

              <Divider style={{ margin: '6px 0' }} />

              {/* Results */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                <Text type="secondary">With waste:</Text>
                <Text strong>{calc.totalAreaSF} SF</Text>
                <Text type="secondary">Tiles needed:</Text>
                <Text strong>{calc.tilesNeeded}</Text>
                <Text type="secondary">Boxes (~):</Text>
                <Text strong>{calc.boxesNeeded}</Text>
                <Text type="secondary">Material:</Text>
                <Text strong>${calc.materialCost.toFixed(0)}</Text>
                <Text type="secondary">Labor:</Text>
                <Text strong>${calc.laborCost.toFixed(0)}</Text>
                <Text type="secondary">Zone total:</Text>
                <Text strong style={{ color: '#389e0d' }}>${calc.totalCost.toFixed(0)}</Text>
              </div>
            </div>
          </Panel>
        ))}
      </Collapse>
    </div>
  );
};

export default BETileCalculationPanel;
