/**
 * BEInsulationPanel - Insulation estimate panel
 *
 * Per-zone breakdown:
 *  - Insulation type, R-value
 *  - Demo toggle (if existing insulation needs removal)
 *  - Material + labor cost
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
  BEInsulationZone,
  InsulationType,
} from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';

const { Text } = Typography;
const { Option } = Select;

interface BEInsulationPanelProps {
  api: BESketchStateAPI;
}

const INSULATION_TYPE_LABELS: Record<InsulationType, string> = {
  fiberglass_batt: 'Fiberglass Batt',
  blown_in: 'Blown-in',
  spray_foam: 'Spray Foam',
  rigid_board: 'Rigid Board',
};

/** Describe wall direction/orientation from two boundary points */
function wallDirectionLabel(b: { x: number; y: number }[]): string {
  if (b.length < 2) return '';
  const dx = b[1].x - b[0].x;
  const dy = b[1].y - b[0].y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDy < absDx * 0.3) return 'H';
  if (absDx < absDy * 0.3) return 'V';
  return 'D';
}

const BEInsulationPanel: React.FC<BEInsulationPanelProps> = ({ api }) => {
  const { data, updateInsulationZone, removeInsulationZone, selectedId, setSelectedId } = api;
  const zones = data.insulationZones ?? [];
  const ppf = data.settings.pixelsPerFoot;

  const totalAreaSF = zones.reduce((s, z) => s + z.areaSF, 0);
  const demoAreaSF = zones.filter(z => z.needsDemo).reduce((s, z) => s + z.areaSF, 0);

  const handleUpdate = useCallback(
    (id: string, updates: Partial<BEInsulationZone>) => {
      updateInsulationZone(id, updates);
    },
    [updateInsulationZone],
  );

  if (zones.length === 0) {
    return (
      <Card size="small" style={{ margin: '4px 0' }}>
        <Empty description="No insulation zones" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Select the Insulation tool and drag to mark insulation areas on the sketch.
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
        style={{ marginBottom: 8, backgroundColor: '#fce4ec', border: '1px solid #f48fb1' }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          <Statistic
            title={<Text style={{ fontSize: 10 }}>Install Area</Text>}
            value={Math.round(totalAreaSF * 10) / 10}
            suffix="SF"
            valueStyle={{ fontSize: 15 }}
          />
          {demoAreaSF > 0 && (
            <Statistic
              title={<Text style={{ fontSize: 10 }}>Demo Area</Text>}
              value={Math.round(demoAreaSF * 10) / 10}
              suffix="SF"
              valueStyle={{ fontSize: 15, color: '#c62828' }}
            />
          )}
        </div>
      </Card>

      {/* Per-zone details */}
      <Collapse
        size="small"
        activeKey={selectedId && zones.some((z) => z.id === selectedId)
          ? [selectedId]
          : zones.slice(0, 2).map((z) => z.id)
        }
        onChange={() => {}}
      >
        {zones.map((zone, idx) => {
          let lengthFt = 0;
          let dirLabel = '';
          if (zone.surface === 'wall' && zone.boundary.length >= 2) {
            const dx = zone.boundary[1].x - zone.boundary[0].x;
            const dy = zone.boundary[1].y - zone.boundary[0].y;
            lengthFt = Math.sqrt(dx * dx + dy * dy) / ppf;
            dirLabel = wallDirectionLabel(zone.boundary);
          }

          const isZoneSelected = selectedId === zone.id;
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
                    backgroundColor: isZoneSelected ? 'rgba(233, 30, 99, 0.08)' : undefined,
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
                          ? (zone.surface === 'ceiling' ? '#ab47bc' : '#e91e63')
                          : (zone.surface === 'ceiling' ? 'rgba(171,71,188,0.6)' : 'rgba(233,30,99,0.6)'),
                        border: isZoneSelected
                          ? (zone.surface === 'ceiling' ? '2px solid #6a1b9a' : '2px solid #ad1457')
                          : '1px solid rgba(0,0,0,0.2)',
                      }}
                    />
                    <Text strong style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{label}</Text>
                    {zone.needsDemo && <Tag color="red" style={{ fontSize: 9, margin: 0, padding: '0 3px' }}>Demo</Tag>}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 4 }}>
                    {lengthFt > 0 && <Tag color="geekblue" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>{lengthFt.toFixed(1)}ft</Tag>}
                    <Tag color="magenta" style={{ fontSize: 9, margin: 0, padding: '0 4px' }}>{zone.areaSF} SF</Tag>
                  </div>
                </div>
              }
            >
              <div style={{ fontSize: 11 }}>
                {/* Surface badge */}
                <div style={{ marginBottom: 6 }}>
                  <Tag color={zone.surface === 'wall' ? 'magenta' : 'purple'} style={{ marginBottom: 4 }}>
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
                      value={zone.heightInches}
                      min={12}
                      max={240}
                      suffix='″'
                      onChange={(v) => v && handleUpdate(zone.id, { heightInches: v })}
                      style={{ width: '100%', marginTop: 2 }}
                    />
                  </div>
                )}

                {/* Needs Demo toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text type="secondary">Demo Existing:</Text>
                  <Switch
                    size="small"
                    checked={zone.needsDemo}
                    onChange={(v) => handleUpdate(zone.id, { needsDemo: v })}
                  />
                </div>

                {/* Insulation type */}
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary">Type:</Text>
                  <Select
                    size="small"
                    value={zone.insulationType}
                    onChange={(v: InsulationType) => handleUpdate(zone.id, { insulationType: v })}
                    style={{ width: '100%', marginTop: 2 }}
                  >
                    {(Object.keys(INSULATION_TYPE_LABELS) as InsulationType[]).map((k) => (
                      <Option key={k} value={k}>{INSULATION_TYPE_LABELS[k]}</Option>
                    ))}
                  </Select>
                </div>

                {/* R-value */}
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary">R-Value:</Text>
                  <InputNumber
                    size="small"
                    value={zone.rValue}
                    min={1}
                    max={60}
                    onChange={(v) => v && handleUpdate(zone.id, { rValue: v })}
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
                    removeInsulationZone(zone.id);
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

export default BEInsulationPanel;
