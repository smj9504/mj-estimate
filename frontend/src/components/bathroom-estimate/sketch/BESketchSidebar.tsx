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
  ShowerFloorType,
  BEFixture,
  BEPoint,
} from '../../../types/bathroomSketch';
import {
  BE_FIXTURE_DEFAULTS,
  BATHTUB_SURROUND_DEFAULTS,
} from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { BATHROOM_PRESETS, type BathroomPreset } from './utils/bePresets';
import BETileCalculationPanel from './BETileCalculationPanel';

const { Title, Text } = Typography;
const { Panel } = Collapse;
const { Option } = Select;

interface BESketchSidebarProps {
  api: BESketchStateAPI;
  width?: number;
}

// ── Fixture palette ──

const FIXTURE_PALETTE: { type: BEFixtureType; label: string; icon: string }[] = [
  { type: 'bathtub', label: 'Bathtub', icon: '🛁' },
  { type: 'shower', label: 'Shower', icon: '🚿' },
  { type: 'vanity', label: 'Vanity', icon: '🪞' },
  { type: 'toilet', label: 'Toilet', icon: '🚽' },
  { type: 'door', label: 'Door', icon: '🚪' },
  { type: 'window', label: 'Window', icon: '🪟' },
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
    }
  }, [selectedId, selectedFixture, selectedRoom, data.walls, data.damageZones, removeFixture, removeRoom, removeWall, removeDamageZone]);

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
        api.addFixture(f.type, pos, undefined, undefined, f.properties);
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
      >
        {/* ── Quick Start Presets ── */}
        <Panel header={<Text strong>Quick Start</Text>} key="presets">
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
        </Panel>

        {/* ── Fixture Palette ── */}
        <Panel header={<Text strong>Fixtures</Text>} key="fixtures">
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
        </Panel>

        {/* ── Rooms ── */}
        <Panel header={<Text strong>Rooms ({data.rooms.length})</Text>} key="rooms">
          {data.rooms.length === 0 ? (
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
          )}
        </Panel>

        {/* ── Selected Element Properties ── */}
        <Panel header={<Text strong>Properties</Text>} key="properties">
          {!selectedId ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Select an element to view its properties.
            </Text>
          ) : selectedFixture ? (
            <FixturePropertiesPanel fixture={selectedFixture} api={api} />
          ) : selectedRoom ? (
            <div>
              <Text strong>{selectedRoom.name}</Text>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ fontSize: 12 }}>
                <div>Floor Area: <strong>{selectedRoom.floorAreaSF} SF</strong></div>
                <div>Wall Area: <strong>{selectedRoom.wallAreaSF} SF</strong></div>
                <div>Perimeter: <strong>{selectedRoom.perimeterLF} LF</strong></div>
                <div>Height: <strong>{selectedRoom.heightInches}"</strong> ({(selectedRoom.heightInches / 12).toFixed(1)} ft)</div>
              </div>
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Wall or damage zone selected.
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
        </Panel>

        {/* ── Tile Calculation ── */}
        <Panel
          header={
            <Text strong>
              Tile Estimate ({data.tileZones.length} zones)
            </Text>
          }
          key="tile_calc"
        >
          <BETileCalculationPanel api={api} />
        </Panel>

        {/* ── Summary ── */}
        <Panel header={<Text strong>Summary</Text>} key="summary">
          <div style={{ fontSize: 12 }}>
            <div>Walls: <Tag>{data.walls.length}</Tag></div>
            <div>Rooms: <Tag>{data.rooms.length}</Tag></div>
            <div>Fixtures: <Tag>{data.fixtures.length}</Tag></div>
            <div>Tile Zones: <Tag>{data.tileZones.length}</Tag></div>
            <div>Damage Zones: <Tag>{data.damageZones.length}</Tag></div>
          </div>
        </Panel>
      </Collapse>
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
                updateFixtureProperties(fixture.id, {
                  bathtubSubType: v,
                  hasSurround: sd.surroundWallCount > 0,
                  surroundWallCount: sd.surroundWallCount,
                  surroundHeight: sd.surroundHeight,
                  deckWidth: sd.deckWidth,
                  deckHeight: sd.deckHeight,
                });
              }}
              style={{ width: '100%', marginTop: 4 }}
            >
              <Option value="standard_alcove">Standard Alcove (3-wall)</Option>
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

          {(p.bathtubSubType === 'drop_in' || p.bathtubSubType === 'corner_garden') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <InputNumber
                size="small"
                addonBefore="Deck W″"
                value={p.deckWidth ?? 10}
                min={4}
                max={24}
                onChange={(v) => v && updateFixtureProperties(fixture.id, { deckWidth: v })}
                style={{ width: '50%' }}
              />
              <InputNumber
                size="small"
                addonBefore="Deck H″"
                value={p.deckHeight ?? 20}
                min={12}
                max={36}
                onChange={(v) => v && updateFixtureProperties(fixture.id, { deckHeight: v })}
                style={{ width: '50%' }}
              />
            </div>
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
        </>
      )}

      {/* Vanity-specific */}
      {fixture.type === 'vanity' && (
        <>
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

      {/* Rotation */}
      <Divider style={{ margin: '6px 0' }} />
      <InputNumber
        size="small"
        addonBefore="Rotation"
        addonAfter="°"
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

export default BESketchSidebar;
