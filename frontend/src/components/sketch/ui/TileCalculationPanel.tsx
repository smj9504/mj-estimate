/**
 * Tile Calculation Panel
 * Sidebar panel for bathroom tile estimation with realistic 2026 pricing
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Select, InputNumber, Typography, Space, Divider,
  Tag, Collapse, Empty, Statistic, Row, Col, Radio,
} from 'antd';
import {
  CalculatorOutlined,
} from '@ant-design/icons';
import { useSketchContext } from '../context/SketchProvider';
import {
  TileZone,
  TileCalculationResult,
  TileSize,
  ShowerFloorType,
} from '../../../types/sketch';
import {
  calculateBathroomTiles,
  calculateTileCount,
  recalculateTileTotals,
} from '../utils/tileCalculations';
import {
  TILE_SIZE_OPTIONS,
  SHOWER_PAN_PRICES,
} from '../../../constants/fixtures';

const { Text, Title } = Typography;
const { Panel } = Collapse;
const { Option } = Select;

interface TileCalculationPanelProps {
  selectedRoomId?: string;
  onHighlightZone?: (zoneType: string | null) => void;
}

const ZONE_COLORS: Record<string, string> = {
  floor: '#1890ff',
  wall: '#52c41a',
  tub_deck: '#faad14',
  tub_front_panel: '#fa8c16',
  tub_surround: '#eb2f96',
  shower_wall: '#722ed1',
  shower_floor: '#13c2c2',
};

const TileCalculationPanel: React.FC<TileCalculationPanelProps> = ({
  selectedRoomId,
  onHighlightZone,
}) => {
  const { sketch } = useSketchContext();
  const [result, setResult] = useState<TileCalculationResult | null>(null);
  const [showerFloorType, setShowerFloorType] = useState<ShowerFloorType>('tile');

  const bathroomRooms = useMemo(() => {
    if (!sketch) return [];
    return sketch.rooms.filter(r => r.type === 'bathroom');
  }, [sketch]);

  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(selectedRoomId);

  useEffect(() => {
    if (selectedRoomId) {
      setActiveRoomId(selectedRoomId);
    } else if (bathroomRooms.length > 0 && !activeRoomId) {
      setActiveRoomId(bathroomRooms[0].id);
    }
  }, [selectedRoomId, bathroomRooms, activeRoomId]);

  // Calculate tiles when room or options change
  useEffect(() => {
    if (!sketch || !activeRoomId) {
      setResult(null);
      return;
    }

    const room = sketch.rooms.find(r => r.id === activeRoomId);
    if (!room) {
      setResult(null);
      return;
    }

    const calc = calculateBathroomTiles(room, sketch, showerFloorType);
    setResult(calc);
  }, [sketch, activeRoomId, showerFloorType]);

  // Update a zone field and recalculate
  const updateZone = useCallback((zoneId: string, updates: Partial<TileZone>) => {
    if (!result) return;
    const updatedZones = result.zones.map(z =>
      z.id === zoneId ? { ...z, ...updates } : z
    );
    setResult(recalculateTileTotals({ ...result, zones: updatedZones }));
  }, [result]);

  if (!sketch) {
    return <Card size="small"><Empty description="No sketch loaded" /></Card>;
  }

  if (bathroomRooms.length === 0) {
    return (
      <Card size="small" title={<Space><CalculatorOutlined /><Text strong>Tile Estimation</Text></Space>}>
        <Empty description={
          <Space direction="vertical" align="center">
            <Text type="secondary">No bathroom rooms found</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Draw walls and create a room with type "bathroom" to start
            </Text>
          </Space>
        } />
      </Card>
    );
  }

  // Check if room has shower fixtures
  const hasShower = sketch.roomFixtures.some(
    f => f.roomId === activeRoomId && f.type === 'shower'
  );

  return (
    <div style={{ width: '100%' }}>
      {/* Room Selector */}
      <Card size="small" style={{ marginBottom: 8 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space><CalculatorOutlined /><Text strong>Tile Estimation</Text></Space>
          <Select
            value={activeRoomId}
            onChange={setActiveRoomId}
            style={{ width: '100%' }}
            size="small"
            placeholder="Select bathroom"
          >
            {bathroomRooms.map(room => (
              <Option key={room.id} value={room.id}>
                {room.name} ({room.areas.floorArea.toFixed(1)} SF)
              </Option>
            ))}
          </Select>
        </Space>
      </Card>

      {/* Shower Floor Type Selector */}
      {hasShower && (
        <Card size="small" style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            Shower Floor Type
          </Text>
          <Radio.Group
            value={showerFloorType}
            onChange={(e) => setShowerFloorType(e.target.value)}
            size="small"
            style={{ width: '100%' }}
          >
            <Radio.Button value="tile" style={{ fontSize: 11 }}>
              Tile Floor
            </Radio.Button>
            <Radio.Button value="fiberglass_pan" style={{ fontSize: 11 }}>
              Fiberglass Pan
            </Radio.Button>
            <Radio.Button value="acrylic_pan" style={{ fontSize: 11 }}>
              Acrylic Pan
            </Radio.Button>
          </Radio.Group>
          {showerFloorType !== 'tile' && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              {showerFloorType === 'fiberglass_pan'
                ? `Fiberglass Pan: ~$${SHOWER_PAN_PRICES.fiberglass_pan.totalCost} installed`
                : `Acrylic Pan: ~$${SHOWER_PAN_PRICES.acrylic_pan.totalCost} installed`
              }
            </Text>
          )}
        </Card>
      )}

      {result && result.zones.length > 0 && (
        <>
          {/* Tile Zones */}
          <Collapse
            defaultActiveKey={result.zones.map(z => z.id)}
            size="small"
            style={{ marginBottom: 8 }}
          >
            {result.zones.map(zone => {
              const isTiled = zone.isTiled;
              let tileCount = 0, boxCount = 0, areaWithWaste = 0;
              let zoneMaterialCost = 0;
              let zoneLaborCost = 0;

              if (isTiled) {
                const calc = calculateTileCount(
                  zone.areaSqFt, zone.tileSize, zone.wastePercent,
                  zone.customTileWidth, zone.customTileHeight
                );
                tileCount = calc.tileCount;
                boxCount = calc.boxCount;
                areaWithWaste = calc.areaWithWaste;
                zoneMaterialCost = areaWithWaste * zone.unitPrice;
                zoneLaborCost = areaWithWaste * zone.laborRate;
              } else {
                zoneMaterialCost = zone.fixedCost || 0;
              }

              return (
                <Panel
                  key={zone.id}
                  header={
                    <Space>
                      <div style={{
                        width: 12, height: 12, borderRadius: 2,
                        backgroundColor: ZONE_COLORS[zone.type] || '#999',
                      }} />
                      <Text strong style={{ fontSize: 12 }}>{zone.label}</Text>
                      <Tag color="blue" style={{ fontSize: 11 }}>
                        {zone.areaSqFt.toFixed(1)} SF
                      </Tag>
                    </Space>
                  }
                >
                  {isTiled ? (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      {/* Tile Size */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12 }}>Tile Size:</Text>
                        <Select
                          value={zone.tileSize}
                          onChange={(v) => updateZone(zone.id, { tileSize: v })}
                          size="small" style={{ width: 150 }}
                        >
                          {TILE_SIZE_OPTIONS.map(opt => (
                            <Option key={opt.id} value={opt.id}>{opt.label}</Option>
                          ))}
                        </Select>
                      </div>

                      {/* Waste % */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12 }}>Waste %:</Text>
                        <InputNumber
                          value={zone.wastePercent}
                          onChange={(v) => updateZone(zone.id, { wastePercent: v || 10 })}
                          min={0} max={30} size="small" style={{ width: 80 }}
                          addonAfter="%"
                        />
                      </div>

                      {/* Material Price/SF */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12 }}>Material $/SF:</Text>
                        <InputNumber
                          value={zone.unitPrice}
                          onChange={(v) => updateZone(zone.id, { unitPrice: v || 0 })}
                          min={0} step={0.5} size="small" style={{ width: 100 }}
                          prefix="$"
                        />
                      </div>

                      {/* Labor Rate/SF */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12 }}>Labor $/SF:</Text>
                        <InputNumber
                          value={zone.laborRate}
                          onChange={(v) => updateZone(zone.id, { laborRate: v || 0 })}
                          min={0} step={0.5} size="small" style={{ width: 100 }}
                          prefix="$"
                        />
                      </div>

                      <Divider style={{ margin: '4px 0' }} />

                      {/* Calculated Values */}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Area w/ waste:</Text>
                        <Text style={{ fontSize: 11 }}>{areaWithWaste.toFixed(1)} SF</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Tiles needed:</Text>
                        <Text style={{ fontSize: 11 }}>{tileCount} pcs</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Boxes:</Text>
                        <Text style={{ fontSize: 11 }}>{boxCount} boxes</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Material:</Text>
                        <Text style={{ fontSize: 11, color: '#1890ff' }}>${zoneMaterialCost.toFixed(2)}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Labor:</Text>
                        <Text style={{ fontSize: 11, color: '#52c41a' }}>${zoneLaborCost.toFixed(2)}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Zone Total:</Text>
                        <Text strong style={{ fontSize: 12 }}>${(zoneMaterialCost + zoneLaborCost).toFixed(2)}</Text>
                      </div>
                    </Space>
                  ) : (
                    /* Non-tiled zone (shower pan) */
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Type:</Text>
                        <Tag color="cyan">{zone.label}</Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Installed Cost:</Text>
                        <Text strong style={{ fontSize: 12 }}>${(zone.fixedCost || 0).toFixed(2)}</Text>
                      </div>
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        Includes material + installation labor
                      </Text>
                    </Space>
                  )}
                </Panel>
              );
            })}
          </Collapse>

          {/* Summary Totals */}
          <Card size="small" style={{ backgroundColor: '#f6ffed', borderColor: '#b7eb8f' }}>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>Summary</Title>
            <Row gutter={[8, 4]}>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Total Area</Text>}
                  value={result.totalAreaSqFt}
                  precision={1} suffix="SF"
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Total Tiles</Text>}
                  value={result.totalTileCount}
                  suffix="pcs"
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Material</Text>}
                  value={result.totalMaterialCost}
                  precision={2} prefix="$"
                  valueStyle={{ fontSize: 16, color: '#1890ff' }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>Labor</Text>}
                  value={result.totalLaborCost}
                  precision={2} prefix="$"
                  valueStyle={{ fontSize: 16, color: '#52c41a' }}
                />
              </Col>
              <Col span={24}>
                <Divider style={{ margin: '8px 0' }} />
                <Statistic
                  title={<Text strong style={{ fontSize: 12 }}>Grand Total</Text>}
                  value={result.grandTotal}
                  precision={2} prefix="$"
                  valueStyle={{ fontSize: 20, color: '#3f8600' }}
                />
              </Col>
            </Row>
          </Card>
        </>
      )}

      {result && result.zones.length === 0 && (
        <Card size="small">
          <Empty description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              Add bathroom fixtures (bathtub, shower) to calculate tile areas
            </Text>
          } />
        </Card>
      )}
    </div>
  );
};

export default TileCalculationPanel;
