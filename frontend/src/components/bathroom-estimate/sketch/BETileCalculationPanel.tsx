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
  shower_curb: 'Shower Curb',
  shower_glass_panel: 'Glass Panel (fixed)',
  shower_door: 'Shower Door',
  vanity_backsplash: 'Vanity Backsplash',
};

// ── Component ──

const BETileCalculationPanel: React.FC<BETileCalculationPanelProps> = ({ api }) => {
  const { data, updateTileZone } = api;
  const zones = data.tileZones;

  // ── Separate tile vs glass zones ──
  const GLASS_TYPES: Set<TileZoneType> = new Set(['shower_glass_panel', 'shower_door']);

  const tileZones = useMemo(() => zones.filter((z) => !GLASS_TYPES.has(z.type)), [zones]);
  const glassZones = useMemo(() => zones.filter((z) => GLASS_TYPES.has(z.type)), [zones]);

  // ── Calculations ──
  const tileCalcs = useMemo(() => {
    return tileZones.map((z) => ({ zone: z, calc: calculateTileForZone(z) }));
  }, [tileZones]);

  const glassCalcs = useMemo(() => {
    return glassZones.map((z) => ({ zone: z, calc: calculateTileForZone(z) }));
  }, [glassZones]);

  const tileTotals = useMemo(() => {
    return tileCalcs.reduce(
      (acc, { calc }) => ({
        areaSF: acc.areaSF + calc.totalAreaSF,
        materialCost: acc.materialCost + calc.materialCost,
        laborCost: acc.laborCost + calc.laborCost,
        totalCost: acc.totalCost + calc.totalCost,
      }),
      { areaSF: 0, materialCost: 0, laborCost: 0, totalCost: 0 },
    );
  }, [tileCalcs]);

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

  // ── Shared zone panel renderer ──
  const renderZonePanel = ({ zone, calc }: { zone: BETileZone; calc: TileCalcResult }) => {
    const isGlass = GLASS_TYPES.has(zone.type);
    return (
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
            <Tag color={isGlass ? 'cyan' : 'blue'} style={{ fontSize: 10, margin: 0 }}>{zone.areaSF} SF</Tag>
          </div>
        }
      >
        <div style={{ fontSize: 11 }}>
          {!isGlass && (
            <>
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

              {/* Waste */}
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">Waste %:</Text>
                <InputNumber
                  size="small"
                  value={zone.tileSpec.wastePct}
                  min={5}
                  max={30}
                  onChange={(v) => v && handleSpecChange(zone.id, 'wastePct', v)}
                  style={{ width: '100%', marginTop: 2 }}
                  suffix="%"
                />
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
              </div>
            </>
          )}
          {isGlass && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              <Text type="secondary">Area:</Text>
              <Text strong>{zone.areaSF} SF</Text>
            </div>
          )}
        </div>
      </Panel>
    );
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {/* ── Tile Summary ── */}
      <Card size="small" style={{ marginBottom: 8, backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' }}>
        <Statistic
          title={<Text style={{ fontSize: 10 }}>Tile Area</Text>}
          value={tileTotals.areaSF}
          suffix="SF"
          valueStyle={{ fontSize: 16 }}
          precision={1}
        />
      </Card>

      {/* ── Tile Zones ── */}
      {tileCalcs.length > 0 && (
        <Collapse size="small" defaultActiveKey={tileZones.slice(0, 3).map((z) => z.id)}>
          {tileCalcs.map(renderZonePanel)}
        </Collapse>
      )}

      {/* ── Glass / Door Section ── */}
      {glassCalcs.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0 8px' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>Glass & Door</Text>
          </Divider>
          <Collapse size="small" defaultActiveKey={glassZones.map((z) => z.id)}>
            {glassCalcs.map(renderZonePanel)}
          </Collapse>
        </>
      )}
    </div>
  );
};

export default BETileCalculationPanel;
