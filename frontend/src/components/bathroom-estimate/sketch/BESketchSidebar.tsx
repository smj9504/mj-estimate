/**
 * BESketchSidebar - Bathroom Estimate Sketch sidebar
 *
 * Panels:
 *  - Room Info (area, perimeter, dimensions)
 *  - Fixture Placement (bathtub, shower, vanity, toilet with config)
 *  - Selected Element Properties
 *  - Tile Zones Summary (Phase 2+)
 */

import React, { useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Divider,
  Select,
  InputNumber,
  Switch,
  Collapse,
  Empty,
  Tag,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type {
  BEFixtureType,
  BathtubSubType,
  VanitySubType,
  ShowerFloorType,
  ShowerDoorType,
  ShowerWallMaterial,
  BEFixture,
  BEDamageZone,
  BERoom,
  BEWall,
  BEPoint,
} from '../../../types/bathroomSketch';
import {
  BE_FIXTURE_DEFAULTS,
  BATHTUB_SURROUND_DEFAULTS,
  VANITY_SUBTYPE_DEFAULTS,
} from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { BATHROOM_PRESETS, type BathroomPreset } from './utils/bePresets';
import BETileCalculationPanel from './BETileCalculationPanel';
import BEDrywallRepairPanel from './BEDrywallRepairPanel';

const { Title, Text } = Typography;
const { Option } = Select;

interface BESketchSidebarProps {
  api: BESketchStateAPI;
  width?: number | string;
}

// ── Fixture palette ──

const FIXTURE_PALETTE: { type: BEFixtureType; label: string; icon: string }[] = [
  { type: 'bathtub', label: 'Bathtub', icon: '🛁' },
  { type: 'shower', label: 'Shower', icon: '🚿' },
  { type: 'vanity', label: 'Vanity', icon: '🪞' },
  { type: 'toilet', label: 'Toilet', icon: '🚽' },
  { type: 'door', label: 'Door', icon: '🚪' },
  { type: 'window', label: 'Window', icon: '🪟' },
  { type: 'mirror', label: 'Mirror', icon: '🪞' },
  { type: 'light', label: 'Light', icon: '💡' },
];

const BESketchSidebar: React.FC<BESketchSidebarProps> = ({ api, width = 280 }) => {
  const {
    data,
    activeTool,
    setActiveTool,
    selectedId,
    setSelectedId,
    addFixture,
    updateFixtureProperties,
    removeFixture,
    removeRoom,
    removeWall,
    removeDamageZone,
    removeDrywallRepairZone,
  } = api;

  const selectedFixture = data.fixtures.find((f) => f.id === selectedId);
  const selectedRoom = data.rooms.find((r) => r.id === selectedId);

  // ── Place fixture at center ──
  const handlePlaceFixture = useCallback(
    (type: BEFixtureType) => {
      // Place at canvas center; user can drag to reposition
      const pos = { x: 200, y: 200 };
      const id = addFixture(type, pos, data.rooms[0]?.id, undefined, {
        bathtubSubType: type === 'bathtub' ? 'standard_alcove' : undefined,
        showerFloorType: type === 'shower' ? 'tile' : undefined,
        showerWallCount: type === 'shower' ? 3 : undefined,
        showerTileHeight: type === 'shower' ? 96 : undefined,
        showerDoorType: type === 'shower' ? 'sliding' : undefined,
        showerDoorSide: type === 'shower' ? 'front' : undefined,
        lightType: type === 'light' ? 'standard' : undefined,
      });
      setSelectedId(id);
      setActiveTool('select');
      message.success(`${type} placed. Drag to reposition.`);
    },
    [addFixture, data.rooms, setSelectedId, setActiveTool],
  );

  // ── Delete selected ──
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    if (selectedFixture) {
      removeFixture(selectedId);
    } else if (selectedRoom) {
      removeRoom(selectedId);
    } else if (data.walls.find((w) => w.id === selectedId)) {
      removeWall(selectedId);
    } else if (data.damageZones.find((z) => z.id === selectedId)) {
      removeDamageZone(selectedId);
    } else if ((data.drywallRepairZones ?? []).find((z) => z.id === selectedId)) {
      removeDrywallRepairZone(selectedId);
    }
  }, [selectedId, selectedFixture, selectedRoom, data.walls, data.damageZones, data.drywallRepairZones, removeFixture, removeRoom, removeWall, removeDamageZone, removeDrywallRepairZone]);

  // ── Apply preset template ──
  const handleApplyPreset = useCallback(
    (preset: BathroomPreset) => {
      const ppf = data.settings.pixelsPerFoot;
      const offsetX = 60;
      const offsetY = 40;

      // Reset sketch before applying preset
      api.resetSketch();

      // Create room boundary
      const boundary: BEPoint[] = [
        { x: offsetX, y: offsetY },
        { x: offsetX + preset.widthFt * ppf, y: offsetY },
        { x: offsetX + preset.widthFt * ppf, y: offsetY + preset.depthFt * ppf },
        { x: offsetX, y: offsetY + preset.depthFt * ppf },
      ];
      api.addRoom(boundary, [], 'Bathroom');

      // Place fixtures
      for (const f of preset.fixtures) {
        const pos: BEPoint = {
          x: offsetX + f.relX * ppf,
          y: offsetY + f.relY * ppf,
        };
        api.addFixture(f.type, pos, undefined, undefined, f.properties, f.dimensions);
      }

      setSelectedId(null);
      message.success(`Applied "${preset.name}" layout`);
    },
    [api, data.settings.pixelsPerFoot, setSelectedId],
  );

  return (
    <div
      style={{
        width,
        backgroundColor: '#fafafa',
        borderLeft: '1px solid #e8e8e8',
        padding: 12,
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <Collapse
        defaultActiveKey={['fixtures', 'rooms', 'properties']}
        size="small"
        bordered={false}
        items={[
          {
            key: 'presets',
            label: <Text strong>Quick Start</Text>,
            children: (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {BATHROOM_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    size="small"
                    block
                    onClick={() => handleApplyPreset(preset)}
                    style={{ textAlign: 'left', height: 'auto', padding: '4px 8px', whiteSpace: 'normal' }}
                  >
                    <div>
                      <Text strong style={{ fontSize: 11 }}>{preset.name}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 10 }}>{preset.description}</Text>
                    </div>
                  </Button>
                ))}
              </Space>
            ),
          },
          {
            key: 'fixtures',
            label: <Text strong>Fixtures</Text>,
            children: (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {FIXTURE_PALETTE.map((fp) => (
                  <Button
                    key={fp.type}
                    size="small"
                    block
                    onClick={() => handlePlaceFixture(fp.type)}
                    style={{ textAlign: 'left', fontSize: 12 }}
                  >
                    {fp.icon} {fp.label}
                  </Button>
                ))}
              </div>
            ),
          },
          {
            key: 'rooms',
            label: <Text strong>Rooms ({data.rooms.length})</Text>,
            children: data.rooms.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Draw walls to create a room, or use the Room tool.
              </Text>
            ) : (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {data.rooms.map((room) => (
                  <Card
                    key={room.id}
                    size="small"
                    style={{
                      cursor: 'pointer',
                      border: selectedId === room.id ? '1px solid #1890ff' : undefined,
                    }}
                    onClick={() => setSelectedId(room.id)}
                  >
                    <Text strong style={{ fontSize: 12 }}>{room.name}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Floor: {room.floorAreaSF} SF | Walls: {room.wallAreaSF} SF | Perimeter: {room.perimeterLF} LF
                    </Text>
                  </Card>
                ))}
              </Space>
            ),
          },
          {
            key: 'properties',
            label: <Text strong>Properties</Text>,
            children: (
              <>
                {!selectedId ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Select an element to view its properties.
                  </Text>
                ) : selectedFixture ? (
                  <FixturePropertiesPanel fixture={selectedFixture} api={api} />
                ) : selectedRoom ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong>{selectedRoom.name}</Text>
                      <Select
                        size="small"
                        value={selectedRoom.roomType ?? 'bathroom'}
                        onChange={(v) => {
                          const nameMap: Record<string, string> = {
                            bathroom: 'Bathroom', closet: 'Closet',
                            toilet_room: 'Toilet Room', linen_closet: 'Linen Closet', other: 'Room',
                          };
                          api.updateRoomMeta(selectedRoom.id, { roomType: v, name: nameMap[v] ?? v });
                        }}
                        style={{ width: 120 }}
                        options={[
                          { label: 'Bathroom', value: 'bathroom' },
                          { label: 'Closet', value: 'closet' },
                          { label: 'Toilet Room', value: 'toilet_room' },
                          { label: 'Linen Closet', value: 'linen_closet' },
                          { label: 'Other', value: 'other' },
                        ]}
                      />
                    </div>
                    {selectedRoom.parentRoomId && (
                      <Tag color="orange" style={{ marginTop: 4 }}>Sub-room</Tag>
                    )}
                    <Divider style={{ margin: '8px 0' }} />
                    <div style={{ fontSize: 12 }}>
                      <div>Floor Area: <strong>{selectedRoom.floorAreaSF} SF</strong>
                        {selectedRoom.netFloorAreaSF !== selectedRoom.floorAreaSF && (
                          <span style={{ color: '#1890ff' }}> (Net: {selectedRoom.netFloorAreaSF} SF)</span>
                        )}
                      </div>
                      <div>Wall Area: <strong>{selectedRoom.wallAreaSF} SF</strong></div>
                      <div>Perimeter: <strong>{selectedRoom.perimeterLF} LF</strong></div>
                      <div>Height: <strong>{selectedRoom.heightInches}"</strong> ({(selectedRoom.heightInches / 12).toFixed(1)} ft)</div>
                    </div>
                  </div>
                ) : data.walls.find((w) => w.id === selectedId) ? (
                  <WallPropertiesPanel
                    wall={data.walls.find((w) => w.id === selectedId)!}
                    ppf={data.settings.pixelsPerFoot}
                    api={api}
                  />
                ) : (data.drywallRepairZones ?? []).find((z) => z.id === selectedId) ? (
                  (() => {
                    const zone = (data.drywallRepairZones ?? []).find((z) => z.id === selectedId)!;
                    const roomName = zone.roomId ? data.rooms.find((r) => r.id === zone.roomId)?.name : undefined;
                    return (
                      <div style={{ fontSize: 12 }}>
                        <Text strong>Drywall Repair Zone</Text>
                        {roomName && <Tag color="orange" style={{ marginLeft: 6 }}>{roomName}</Tag>}
                        <Divider style={{ margin: '6px 0' }} />
                        <div>Area: <strong>{zone.areaSF} SF</strong></div>
                        <div>Height: <strong>{zone.repairHeightInches}"</strong></div>
                        <div>Texture: <strong>{zone.textureType.replace(/_/g, ' ')}</strong></div>
                        <div style={{ marginTop: 4, color: '#888', fontSize: 11 }}>
                          Edit details in the Drywall Repair panel below.
                        </div>
                      </div>
                    );
                  })()
                ) : data.damageZones.find((z) => z.id === selectedId) ? (
                  <DamageZonePropertiesPanel
                    zone={data.damageZones.find((z) => z.id === selectedId)!}
                    rooms={data.rooms}
                    api={api}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Select an element to view its properties.
                  </Text>
                )}

                {selectedId && (
                  <>
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={handleDeleteSelected}
                      block
                    >
                      Delete Selected
                    </Button>
                  </>
                )}
              </>
            ),
          },
          {
            key: 'tile_calc',
            label: <Text strong>Tile Estimate ({data.tileZones.length} zones)</Text>,
            children: <BETileCalculationPanel api={api} />,
          },
          {
            key: 'drywall_repair',
            label: (
              <Text strong>
                Drywall Repair{(data.drywallRepairZones ?? []).length > 0 && (
                  <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>
                    {(data.drywallRepairZones ?? []).length}
                  </Tag>
                )}
              </Text>
            ),
            children: <BEDrywallRepairPanel api={api} />,
          },
          {
            key: 'summary',
            label: <Text strong>Summary</Text>,
            children: (
              <div style={{ fontSize: 12 }}>
                <div>Walls: <Tag>{data.walls.length}</Tag></div>
                <div>Rooms: <Tag>{data.rooms.length}</Tag></div>
                <div>Fixtures: <Tag>{data.fixtures.length}</Tag></div>
                <div>Tile Zones: <Tag>{data.tileZones.length}</Tag></div>
                <div>Damage Zones: <Tag>{data.damageZones.length}</Tag></div>
                <div>Drywall Repair: <Tag color="orange">{(data.drywallRepairZones ?? []).length}</Tag></div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
};

// ── Fixture Properties Sub-Panel ──

const FixturePropertiesPanel: React.FC<{ fixture: BEFixture; api: BESketchStateAPI }> = ({
  fixture,
  api,
}) => {
  const { updateFixtureProperties } = api;
  const p = fixture.properties;

  return (
    <div style={{ fontSize: 12 }}>
      <Text strong style={{ textTransform: 'capitalize' }}>{fixture.type}</Text>
      <Tag style={{ marginLeft: 6 }} color="blue">{fixture.id.slice(0, 12)}</Tag>
      <Divider style={{ margin: '6px 0' }} />

      {/* Dimensions */}
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary">Size (inches):</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <InputNumber
            size="small"
            addonBefore="W"
            value={fixture.dimensions.width}
            min={6}
            max={120}
            onChange={(v) => v && api.updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, width: v } })}
            style={{ width: '50%' }}
          />
          <InputNumber
            size="small"
            addonBefore="D"
            value={fixture.dimensions.height}
            min={6}
            max={120}
            onChange={(v) => v && api.updateFixture(fixture.id, { dimensions: { ...fixture.dimensions, height: v } })}
            style={{ width: '50%' }}
          />
        </div>
      </div>

      {/* Bathtub-specific */}
      {fixture.type === 'bathtub' && (
        <>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Subtype:</Text>
            <Select
              size="small"
              value={p.bathtubSubType ?? 'standard_alcove'}
              onChange={(v: BathtubSubType) => {
                const sd = BATHTUB_SURROUND_DEFAULTS[v];
                // Auto-adjust tub dimensions based on subtype
                const dimMap: Partial<Record<BathtubSubType, { width: number; height: number }>> = {
                  standard_alcove: { width: 60, height: 32 },
                  corner_drop_in: { width: 60, height: 42 },
                  corner_garden: { width: 60, height: 60 },
                  drop_in: { width: 60, height: 32 },
                  freestanding: { width: 60, height: 30 },
                };
                const dims = dimMap[v];
                if (dims) {
                  api.updateFixture(fixture.id, { dimensions: dims });
                }
                updateFixtureProperties(fixture.id, {
                  bathtubSubType: v,
                  hasSurround: sd.surroundWallCount > 0,
                  surroundWallCount: sd.surroundWallCount,
                  surroundHeight: sd.surroundHeight,
                  deckWidth: sd.deckWidth,
                  deckHeight: sd.deckHeight,
                  deckTileSides: sd.deckTileSides,
                  hasFrontPanel: sd.hasFrontPanel,
                });
              }}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="standard_alcove">Standard Alcove (3-wall)</Option>
              <Option value="corner_drop_in">Corner Drop-in (platform)</Option>
              <Option value="corner_garden">Corner / Garden</Option>
              <Option value="drop_in">Drop-in (with deck)</Option>
              <Option value="freestanding">Freestanding</Option>
            </Select>
          </div>

          <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">Tile Surround:</Text>
            <Switch
              size="small"
              checked={p.hasSurround ?? false}
              onChange={(v) => updateFixtureProperties(fixture.id, { hasSurround: v })}
            />
          </div>

          {p.hasSurround && (
            <div style={{ marginLeft: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <InputNumber
                  size="small"
                  addonBefore="Walls"
                  value={p.surroundWallCount ?? 3}
                  min={1}
                  max={3}
                  onChange={(v) => v && updateFixtureProperties(fixture.id, { surroundWallCount: v })}
                  style={{ width: '50%' }}
                />
                <InputNumber
                  size="small"
                  addonBefore="H″"
                  value={p.surroundHeight ?? 60}
                  min={24}
                  max={96}
                  onChange={(v) => v && updateFixtureProperties(fixture.id, { surroundHeight: v })}
                  style={{ width: '50%' }}
                />
              </div>
            </div>
          )}

          {(p.bathtubSubType === 'drop_in' || p.bathtubSubType === 'corner_garden' || p.bathtubSubType === 'corner_drop_in') && (
            <>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Deck / Platform:</Text>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Width″</Text>
                  <InputNumber
                    size="small"
                    value={p.deckWidth ?? 10}
                    min={4}
                    max={24}
                    style={{ width: '100%' }}
                    onChange={(v) => v && updateFixtureProperties(fixture.id, { deckWidth: v })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Height″</Text>
                  <InputNumber
                    size="small"
                    value={p.deckHeight ?? 20}
                    min={12}
                    max={36}
                    style={{ width: '100%' }}
                    onChange={(v) => v && updateFixtureProperties(fixture.id, { deckHeight: v })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ fontSize: 10 }}>Sides</Text>
                  <InputNumber
                    size="small"
                    value={p.deckTileSides ?? 2}
                    min={1}
                    max={4}
                    style={{ width: '100%' }}
                    onChange={(v) => v && updateFixtureProperties(fixture.id, { deckTileSides: v })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary">Front Panel Tile:</Text>
                <Switch
                  size="small"
                  checked={p.hasFrontPanel ?? false}
                  onChange={(v) => updateFixtureProperties(fixture.id, { hasFrontPanel: v })}
                />
              </div>
            </>
          )}
        </>
      )}

      {/* Shower-specific */}
      {fixture.type === 'shower' && (
        <>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Floor Type:</Text>
            <Select
              size="small"
              value={p.showerFloorType ?? 'tile'}
              onChange={(v: ShowerFloorType) => updateFixtureProperties(fixture.id, { showerFloorType: v })}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="tile">Tile</Option>
              <Option value="fiberglass_pan">Fiberglass Pan</Option>
              <Option value="acrylic_pan">Acrylic Pan</Option>
            </Select>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <InputNumber
              size="small"
              addonBefore="Walls"
              value={p.showerWallCount ?? 3}
              min={1}
              max={3}
              onChange={(v) => v && updateFixtureProperties(fixture.id, { showerWallCount: v })}
              style={{ width: '50%' }}
            />
            <InputNumber
              size="small"
              addonBefore="Tile H″"
              value={p.showerTileHeight ?? 96}
              min={48}
              max={120}
              onChange={(v) => v && updateFixtureProperties(fixture.id, { showerTileHeight: v })}
              style={{ width: '50%' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <InputNumber
              size="small"
              addonBefore="Niches"
              value={p.nicheCount ?? 0}
              min={0}
              max={4}
              onChange={(v) => updateFixtureProperties(fixture.id, { nicheCount: v ?? 0 })}
              style={{ width: '50%' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Bench:</Text>
              <Switch
                size="small"
                checked={p.hasBench ?? false}
                onChange={(v) => updateFixtureProperties(fixture.id, { hasBench: v })}
              />
            </div>
          </div>

          <div style={{ marginBottom: 6 }}>
            <InputNumber
              size="small"
              addonBefore="Curb H″"
              value={p.curbHeight ?? 4}
              min={0}
              max={8}
              onChange={(v) => updateFixtureProperties(fixture.id, { curbHeight: v ?? 0 })}
              style={{ width: '50%' }}
            />
            {(p.curbHeight ?? 4) === 0 && <Tag color="blue" style={{ marginLeft: 6 }}>Curbless</Tag>}
          </div>

          <Divider style={{ margin: '6px 0' }} />
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Enclosure:</Text>
            <Select
              size="small"
              value={p.showerLayout ?? 'alcove'}
              onChange={(v: string) => {
                const wallMap: Record<string, number> = {
                  alcove: 3, corner: 2, corner_right: 2,
                  neo_angle: 2, neo_angle_right: 2,
                };
                const isNeo = v === 'neo_angle' || v === 'neo_angle_right';
                updateFixtureProperties(fixture.id, {
                  showerLayout: v as any,
                  showerWallCount: wallMap[v] ?? 3,
                  ...(isNeo ? { showerDoorType: 'neo_angle_pivot' as ShowerDoorType } : {}),
                });
              }}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="alcove">Alcove (3 walls)</Option>
              <Option value="corner">Corner - glass right</Option>
              <Option value="corner_right">Corner - glass left</Option>
              <Option value="neo_angle">Neo-Angle (walls: back+left)</Option>
              <Option value="neo_angle_right">Neo-Angle (walls: back+right)</Option>
            </Select>
          </div>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Door / Opening:</Text>
            <Select
              size="small"
              value={p.showerDoorType ?? 'none'}
              onChange={(v: ShowerDoorType) => updateFixtureProperties(fixture.id, { showerDoorType: v })}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="none">Open (no door)</Option>
              <Option value="curtain">Curtain</Option>
              <Option value="sliding">Sliding glass</Option>
              <Option value="swing">Swing (framed)</Option>
              <Option value="frameless_swing">Swing (frameless)</Option>
              <Option value="bi_fold">Bi-fold</Option>
              <Option value="neo_angle_pivot">Neo-Angle pivot</Option>
            </Select>
          </div>
          {p.showerDoorType && p.showerDoorType !== 'none' && p.showerDoorType !== 'curtain' && (
            <div style={{ marginBottom: 6 }}>
              <InputNumber
                size="small"
                addonBefore="Door W″"
                value={p.showerDoorWidth ?? Math.round(fixture.dimensions.width * 0.5)}
                min={18}
                max={fixture.dimensions.width}
                onChange={(v) => v && updateFixtureProperties(fixture.id, { showerDoorWidth: v })}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Fixed glass panel:</Text>
            <Select
              size="small"
              value={p.fixedPanelConfig ?? 'none'}
              onChange={(v) => updateFixtureProperties(fixture.id, { fixedPanelConfig: v as 'none' | 'left' | 'right' | 'both' })}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="none">None</Option>
              <Option value="left">Left side</Option>
              <Option value="right">Right side</Option>
              <Option value="both">Both sides</Option>
            </Select>
          </div>
          {/* Wall material - especially relevant for neo-angle/corner */}
          {(p.showerLayout === 'neo_angle' || p.showerLayout === 'neo_angle_right'
            || p.showerLayout === 'corner' || p.showerLayout === 'corner_right') && (
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary">Wall material:</Text>
              <Select
                size="small"
                value={p.showerWallMaterial ?? 'tile'}
                onChange={(v: ShowerWallMaterial) => updateFixtureProperties(fixture.id, { showerWallMaterial: v })}
                style={{ width: '100%', marginTop: 4 }}
              >
                <Option value="tile">Custom tile</Option>
                <Option value="prefab_acrylic">Prefab acrylic</Option>
                <Option value="prefab_fiberglass">Prefab fiberglass</Option>
                <Option value="solid_surface">Solid surface</Option>
              </Select>
            </div>
          )}
        </>
      )}

      {/* Vanity / Sink -specific */}
      {fixture.type === 'vanity' && (
        <>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Type:</Text>
            <Select
              size="small"
              value={p.vanitySubType ?? 'cabinet'}
              onChange={(v: VanitySubType) => {
                const sd = VANITY_SUBTYPE_DEFAULTS[v];
                api.updateFixture(fixture.id, { dimensions: { width: sd.width, height: sd.height } });
                updateFixtureProperties(fixture.id, {
                  vanitySubType: v,
                  sinkCount: sd.sinkCount,
                  hasBacksplash: sd.hasBacksplash,
                });
              }}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="cabinet">Cabinet Vanity</Option>
              <Option value="pedestal_sink">Pedestal Sink</Option>
              <Option value="wall_mount_sink">Wall-Mount Sink</Option>
            </Select>
          </div>

          {/* Cabinet vanity options */}
          {(p.vanitySubType ?? 'cabinet') === 'cabinet' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <InputNumber
                size="small"
                addonBefore="Sinks"
                value={p.sinkCount ?? 1}
                min={1}
                max={2}
                onChange={(v) => v && updateFixtureProperties(fixture.id, { sinkCount: v })}
                style={{ width: '50%' }}
              />
            </div>
          )}

          {/* Backsplash (cabinet vanity only) */}
          {(p.vanitySubType ?? 'cabinet') === 'cabinet' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary">Backsplash:</Text>
                <Switch
                  size="small"
                  checked={p.hasBacksplash ?? false}
                  onChange={(v) => updateFixtureProperties(fixture.id, { hasBacksplash: v })}
                />
              </div>
              {p.hasBacksplash && (
                <InputNumber
                  size="small"
                  addonBefore="Backsplash H″"
                  value={p.backsplashHeight ?? 4}
                  min={2}
                  max={24}
                  onChange={(v) => v && updateFixtureProperties(fixture.id, { backsplashHeight: v })}
                  style={{ width: '100%' }}
                />
              )}
            </>
          )}
        </>
      )}

      {/* Light-specific */}
      {fixture.type === 'light' && (
        <>
          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">Light Type:</Text>
            <Select
              size="small"
              value={p.lightType ?? 'standard'}
              onChange={(v) => updateFixtureProperties(fixture.id, { lightType: v })}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="standard">Standard fixture</Option>
              <Option value="recessed">Recessed (1 can)</Option>
              <Option value="recessed_multi">Recessed (multi)</Option>
            </Select>
          </div>
          {p.lightType === 'recessed_multi' && (
            <div style={{ marginBottom: 6 }}>
              <InputNumber
                size="small"
                addonBefore="Cans"
                value={p.lightCount ?? 4}
                min={2}
                max={12}
                onChange={(v) => v && updateFixtureProperties(fixture.id, { lightCount: v })}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </>
      )}

      {/* Rotation */}
      <Divider style={{ margin: '6px 0' }} />
      <InputNumber
        size="small"
        addonBefore="Rotation"
        suffix="°"
        value={fixture.rotation}
        min={0}
        max={360}
        step={15}
        onChange={(v) => v != null && api.updateFixture(fixture.id, { rotation: v })}
        style={{ width: '100%' }}
      />
    </div>
  );
};

// ── Damage Zone Properties Sub-Panel ──

const DamageZonePropertiesPanel: React.FC<{
  zone: BEDamageZone;
  rooms: BERoom[];
  api: BESketchStateAPI;
}> = ({ zone, rooms, api }) => {
  // Find which room contains this damage zone (by centroid)
  const cx = zone.boundary.reduce((s, p) => s + p.x, 0) / zone.boundary.length;
  const cy = zone.boundary.reduce((s, p) => s + p.y, 0) / zone.boundary.length;
  const containingRoom = rooms.find((r) => {
    let inside = false;
    for (let i = 0, j = r.boundary.length - 1; i < r.boundary.length; j = i++) {
      const xi = r.boundary[i].x, yi = r.boundary[i].y;
      const xj = r.boundary[j].x, yj = r.boundary[j].y;
      if ((yi > cy) !== (yj > cy) && cx < (xj - xi) * (cy - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });

  const handleCreateDrywallRepair = useCallback(() => {
    const b = zone.boundary;
    if (b.length < 4) return;

    // Create wall-type drywall repair zones along each edge of the damage rectangle
    // Edges: top (0→1), right (1→2), bottom (2→3), left (3→0)
    const edgeLabels = ['top', 'right', 'bottom', 'left'];
    let created = 0;
    for (let i = 0; i < 4; i++) {
      const p0 = b[i];
      const p1 = b[(i + 1) % 4];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const lenPx = Math.sqrt(dx * dx + dy * dy);
      if (lenPx < 5) continue; // skip degenerate edges
      api.addDrywallRepairZone([p0, p1], containingRoom?.id, 'wall');
      created++;
    }
    if (created > 0) {
      message.success(`${created} drywall repair zones created from damage area`);
    }
  }, [zone.boundary, containingRoom, api]);

  return (
    <div style={{ fontSize: 12 }}>
      <Text strong>Damage Zone</Text>
      {containingRoom && <Tag color="red" style={{ marginLeft: 6 }}>{containingRoom.name}</Tag>}
      <Tag style={{ marginLeft: 4 }} color="blue">{zone.id.slice(0, 12)}</Tag>
      <Divider style={{ margin: '6px 0' }} />

      <div style={{ marginBottom: 6 }}>
        <Text type="secondary">Type:</Text>
        <Select
          size="small"
          value={zone.damageType}
          onChange={(v) => api.updateDamageZone(zone.id, { damageType: v as BEDamageZone['damageType'] })}
          style={{ width: '100%', marginTop: 4 }}
        >
          <Option value="water_damage">Water Damage</Option>
          <Option value="mold">Mold</Option>
          <Option value="cement_board">Cement Board</Option>
        </Select>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div>Area: <strong>{zone.areaSF} SF</strong></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text type="secondary">Needs Demo:</Text>
        <Switch
          size="small"
          checked={zone.needsDemo}
          onChange={(v) => api.updateDamageZone(zone.id, { needsDemo: v })}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text type="secondary">Needs Replace:</Text>
        <Switch
          size="small"
          checked={zone.needsReplace}
          onChange={(v) => api.updateDamageZone(zone.id, { needsReplace: v })}
        />
      </div>

      <Divider style={{ margin: '6px 0' }} />
      <Button
        size="small"
        type="primary"
        block
        onClick={handleCreateDrywallRepair}
        style={{ marginBottom: 4 }}
      >
        Create Drywall Repair (4 walls)
      </Button>
      <Text type="secondary" style={{ fontSize: 10 }}>
        Generates wall-type drywall repair zones along each edge of this damage area.
      </Text>
    </div>
  );
};

// ── Wall Properties Sub-Panel ──

const WallPropertiesPanel: React.FC<{ wall: BEWall; ppf: number; api: BESketchStateAPI }> = ({
  wall,
  ppf,
  api,
}) => {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  const lengthInches = Math.round((lengthPx / ppf) * 12);
  const lengthFt = lengthInches / 12;
  const angle = Math.atan2(dy, dx); // radians

  const handleLengthChange = (newInches: number | null) => {
    if (!newInches || newInches < 1) return;
    const newPx = (newInches / 12) * ppf;
    // Keep same direction (angle), adjust end point
    const newEnd: BEPoint = {
      x: Math.round(wall.start.x + Math.cos(angle) * newPx),
      y: Math.round(wall.start.y + Math.sin(angle) * newPx),
    };
    api.updateWall(wall.id, { end: newEnd });
  };

  const handleHeightChange = (newHeight: number | null) => {
    if (!newHeight || newHeight < 12) return;
    api.updateWall(wall.id, { heightInches: newHeight });
  };

  return (
    <div style={{ fontSize: 12 }}>
      <Text strong>Wall</Text>
      <Tag style={{ marginLeft: 6 }} color="blue">{wall.label || wall.id.slice(0, 12)}</Tag>
      <Divider style={{ margin: '6px 0' }} />

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary">Length:</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <InputNumber
            size="small"
            suffix="in"
            value={lengthInches}
            min={1}
            max={600}
            onChange={handleLengthChange}
            style={{ width: '50%' }}
          />
          <Text type="secondary" style={{ lineHeight: '24px', fontSize: 11 }}>
            {lengthFt.toFixed(1)} ft
          </Text>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary">Wall Height:</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <InputNumber
            size="small"
            suffix="in"
            value={wall.heightInches}
            min={12}
            max={240}
            onChange={handleHeightChange}
            style={{ width: '50%' }}
          />
          <Text type="secondary" style={{ lineHeight: '24px', fontSize: 11 }}>
            {(wall.heightInches / 12).toFixed(1)} ft
          </Text>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary">Finish:</Text>
        <Select
          size="small"
          value={wall.finish ?? 'paint'}
          onChange={(v) => api.updateWall(wall.id, { finish: v })}
          style={{ width: '100%', marginTop: 4 }}
        >
          <Option value="paint">🎨 Paint</Option>
          <Option value="tile">🔲 Tile</Option>
        </Select>
      </div>

      <div style={{ marginBottom: 4 }}>
        <Text type="secondary">Label:</Text>
        <input
          style={{ marginLeft: 8, width: 80, fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 6px' }}
          value={wall.label || ''}
          placeholder="e.g. North"
          onChange={(e) => api.updateWall(wall.id, { label: e.target.value || undefined })}
        />
      </div>

      {/* Wall area display */}
      <Divider style={{ margin: '6px 0' }} />
      <div style={{ fontSize: 11, color: '#888' }}>
        Wall Area: <strong>{Math.round(lengthFt * (wall.heightInches / 12) * 10) / 10} SF</strong>
        <Tag color={wall.finish === 'tile' ? 'blue' : 'default'} style={{ marginLeft: 6, fontSize: 10 }}>
          {wall.finish === 'tile' ? 'Tile' : 'Paint'}
        </Tag>
      </div>
    </div>
  );
};

export default BESketchSidebar;
