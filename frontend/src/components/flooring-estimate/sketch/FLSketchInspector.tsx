/**
 * The side panel of the flooring sketch: what is selected and its sizes,
 * a room added by typing its size, and every room of the level with its
 * floor area.
 */

import React, { useState } from 'react';
import { Button, Divider, Input, Popconfirm, Select, Space, Switch, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, RotateRightOutlined, SwapOutlined } from '@ant-design/icons';
import type { FlooringSketch, FixtureType, OpeningKind, SketchLevel } from '../../../types/flooringEstimate';
import FeetInput from './FeetInput';
import type { Selection } from './FLSketchCanvas';
import { formatFeet, formatSf } from './utils/dimensions';
import {
  WALL_T, bbox, distance, edgesOf, measureRoom, offsetPolygon, rectPoints, resizeEdge, spanOnEdge,
} from './utils/geometry';
import {
  FIXTURE_LABELS, addRoom, removeCabinetRun, removeFixture, removeOpening, removeRoom, setRoomPoints,
  updateCabinetRun, updateFixture, updateOpening, updateRoom,
} from './utils/sketchOps';

const { Text } = Typography;

export const OPENING_LABELS: Record<OpeningKind, string> = {
  opening: 'Opening (no door)',
  door: 'Door',
  bifold: 'Bifold door',
  pocket: 'Pocket door',
  slider: 'Sliding door',
  exterior_door: 'Exterior door',
};

interface InspectorProps {
  sketch: FlooringSketch;
  level: SketchLevel;
  selection: Selection;
  readOnly?: boolean;
  onApply: (next: FlooringSketch) => void;
  onSelect: (selection: Selection) => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    <div>{children}</div>
  </div>
);

const Figure: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
    <Text type="secondary">{label}</Text>
    <Text strong>{value}</Text>
  </div>
);

const FLSketchInspector: React.FC<InspectorProps> = ({ sketch, level, selection, readOnly, onApply, onSelect }) => {
  const [newName, setNewName] = useState('');
  const [newLength, setNewLength] = useState(12);
  const [newWidth, setNewWidth] = useState(12);
  const roomName = (id: string | null | undefined) =>
    (id && level.rooms.find((r) => r.id === id)?.name) || 'Outside';

  /** A room of the typed size, a wall's thickness to the right of what is drawn */
  const addSizedRoom = () => {
    const drawn = level.rooms.flatMap((r) => offsetPolygon(r.points, WALL_T));
    const box = drawn.length ? bbox(drawn) : null;
    const x = box ? box.maxX : 0;
    const y = box ? box.minY + WALL_T : 0;
    const { sketch: next, roomId } = addRoom(sketch, level.id, rectPoints(x, y, newLength, newWidth),
      newName.trim() ? { name: newName.trim() } : {});
    onApply(next);
    onSelect({ kind: 'room', id: roomId });
    setNewName('');
  };

  const roomPanel = () => {
    const room = level.rooms.find((r) => r.id === selection?.id);
    if (!room) return null;
    const m = measureRoom(level, room);
    const others = level.rooms.filter((r) => r.id !== room.id && !r.subroom_of);
    return (
      <div data-testid="room-inspector">
        <Row label="Name">
          {/* Committed when done typing, so a name is one undo step and one save */}
          <Input key={`${room.id}:${room.name}`} size="small" defaultValue={room.name} disabled={readOnly}
            style={{ width: 160 }} aria-label="Room name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== room.name) onApply(updateRoom(sketch, level.id, room.id, { name }));
            }}
            onPressEnter={(e) => (e.target as HTMLInputElement).blur()} />
        </Row>
        <Row label="Ceiling height">
          <FeetInput value={room.height_ft} disabled={readOnly} min={1} aria-label="Ceiling height"
            onCommit={(ft) => onApply(updateRoom(sketch, level.id, room.id, { height_ft: ft }))} />
        </Row>
        <Row label="Closet of">
          <Select size="small" style={{ width: 160 }} allowClear disabled={readOnly} placeholder="— (a room of its own)"
            value={room.subroom_of || undefined}
            options={others.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(v) => onApply(updateRoom(sketch, level.id, room.id, { subroom_of: v || null }))} />
        </Row>
        <Divider style={{ margin: '8px 0' }} />
        <Figure label="Floor" value={formatSf(m.floorSf)} />
        <Figure label="Floor perimeter" value={`${m.perimeterLf.toFixed(2)} LF`} />
        <Figure label="Baseboard, less openings" value={`${m.baseLf.toFixed(2)} LF`} />
        <Figure label="Walls" value={formatSf(m.wallSf)} />
        <Divider style={{ margin: '8px 0' }} />
        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          On the sketch: drag a corner to move it, drag a wall&apos;s middle dot to bend the wall at a new corner,
          double-click a corner to take it out.
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>Walls, clockwise from the first corner</Text>
        <div style={{ marginTop: 6 }}>
          {edgesOf(room.points).map((edge) => (
            <Row key={edge.index} label={`Wall ${edge.index + 1}`}>
              <FeetInput value={edge.length} disabled={readOnly} aria-label={`Wall ${edge.index + 1} length`}
                data-testid={`wall-length-${edge.index}`}
                onCommit={(ft) => {
                  const points = resizeEdge(room.points, edge.index, ft);
                  if (points) onApply(setRoomPoints(sketch, level.id, room.id, points));
                }} />
            </Row>
          ))}
        </div>
        {!readOnly && (
          <Popconfirm title={`Delete ${room.name}?`} description="Its doorways and cabinet runs go with it."
            okText="Delete" okButtonProps={{ danger: true }}
            onConfirm={() => {
              onApply(removeRoom(sketch, level.id, room.id));
              onSelect(null);
            }}>
            <Button danger size="small" icon={<DeleteOutlined />} block style={{ marginTop: 8 }}>Delete room</Button>
          </Popconfirm>
        )}
      </div>
    );
  };

  const openingPanel = () => {
    const o = level.openings.find((x) => x.id === selection?.id);
    if (!o) return null;
    const host = level.rooms.find((r) => r.id === o.rooms[0]);
    const width = distance(o.a, o.b);
    const between = o.rooms.filter((r): r is string => !!r);
    const setWidth = (ft: number) => {
      if (!host) return;
      const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
      let best: { edge: ReturnType<typeof edgesOf>[number]; s: number; d: number } | null = null;
      for (const edge of edgesOf(host.points)) {
        const s = (mid.x - edge.a.x) * edge.dir.x + (mid.y - edge.a.y) * edge.dir.y;
        const foot = { x: edge.a.x + edge.dir.x * s, y: edge.a.y + edge.dir.y * s };
        const d = distance(mid, foot);
        if (s >= 0 && s <= edge.length && (!best || d < best.d)) best = { edge, s, d };
      }
      if (best) onApply(updateOpening(sketch, level.id, o.id, spanOnEdge(best.edge, best.s, ft)));
    };
    return (
      <div data-testid="opening-inspector">
        <Row label="Kind">
          <Select size="small" style={{ width: 160 }} value={o.kind} disabled={readOnly}
            options={(Object.keys(OPENING_LABELS) as OpeningKind[])
              .filter((k) => (o.rooms[1] ? k !== 'exterior_door' : true))
              .map((k) => ({ value: k, label: OPENING_LABELS[k] }))}
            onChange={(kind) => onApply(updateOpening(sketch, level.id, o.id, { kind }))} />
        </Row>
        <Row label="Width">
          <FeetInput value={width} disabled={readOnly} aria-label="Opening width" onCommit={setWidth} />
        </Row>
        <Figure label="Between" value={`${roomName(o.rooms[0])} ↔ ${roomName(o.rooms[1])}`} />
        {o.kind !== 'opening' && (
          <>
            <Row label="Swings into">
              <Select size="small" style={{ width: 160 }} disabled={readOnly} value={o.swing || o.rooms[0]}
                options={between.map((id) => ({ value: id, label: roomName(id) }))}
                onChange={(swing) => onApply(updateOpening(sketch, level.id, o.id, { swing }))} />
            </Row>
            {!readOnly && (
              <Button size="small" icon={<SwapOutlined />} block style={{ marginBottom: 8 }}
                onClick={() => onApply(updateOpening(sketch, level.id, o.id, { hinge: o.hinge === 'b' ? 'a' : 'b' }))}>
                Hinge on the other side
              </Button>
            )}
          </>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Its width comes off the baseboard of both rooms; where the floor changes, it takes a transition.
        </Text>
        {!readOnly && (
          <Button danger size="small" icon={<DeleteOutlined />} block style={{ marginTop: 8 }}
            onClick={() => {
              onApply(removeOpening(sketch, level.id, o.id));
              onSelect(null);
            }}>Delete opening</Button>
        )}
      </div>
    );
  };

  const cabinetPanel = () => {
    const c = level.cabinet_runs.find((x) => x.id === selection?.id);
    if (!c) return null;
    const host = level.rooms.find((r) => r.id === c.room_id);
    const length = distance(c.a, c.b);
    return (
      <div data-testid="cabinet-inspector">
        <Figure label="Room" value={host?.name ?? ''} />
        <Row label="Length">
          <FeetInput value={length} disabled={readOnly} aria-label="Cabinet run length" onCommit={(ft) => {
            const dir = { x: (c.b.x - c.a.x) / (length || 1), y: (c.b.y - c.a.y) / (length || 1) };
            onApply(updateCabinetRun(sketch, level.id, c.id, { b: { x: c.a.x + dir.x * ft, y: c.a.y + dir.y * ft } }));
          }} />
        </Row>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No baseboard along base cabinets; the run is what a toe kick detach &amp; reset is measured from.
        </Text>
        {!readOnly && (
          <Button danger size="small" icon={<DeleteOutlined />} block style={{ marginTop: 8 }}
            onClick={() => {
              onApply(removeCabinetRun(sketch, level.id, c.id));
              onSelect(null);
            }}>Delete cabinet run</Button>
        )}
      </div>
    );
  };

  const fixturePanel = () => {
    const f = level.fixtures.find((x) => x.id === selection?.id);
    if (!f) return null;
    return (
      <div data-testid="fixture-inspector">
        <Row label="Type">
          <Select size="small" style={{ width: 150 }} value={f.type} disabled={readOnly}
            options={(Object.keys(FIXTURE_LABELS) as FixtureType[]).map((t) => ({ value: t, label: FIXTURE_LABELS[t] }))}
            onChange={(type) => onApply(updateFixture(sketch, level.id, f.id, { type }))} />
        </Row>
        <Row label="Width">
          <FeetInput value={f.w} disabled={readOnly} aria-label="Fixture width"
            onCommit={(w) => onApply(updateFixture(sketch, level.id, f.id, { w }))} />
        </Row>
        <Row label="Depth">
          <FeetInput value={f.h} disabled={readOnly} aria-label="Fixture depth"
            onCommit={(h) => onApply(updateFixture(sketch, level.id, f.id, { h }))} />
        </Row>
        {f.type === 'island' && (
          <Row label="Floor runs under it">
            <Switch size="small" checked={!!f.floor_under} disabled={readOnly}
              onChange={(floor_under) => onApply(updateFixture(sketch, level.id, f.id, { floor_under }))} />
          </Row>
        )}
        {!readOnly && (
          <Space style={{ width: '100%' }} direction="vertical" size={8}>
            <Button size="small" icon={<RotateRightOutlined />} block
              onClick={() => onApply(updateFixture(sketch, level.id, f.id, { rotation: ((f.rotation || 0) + 90) % 360 }))}>
              Turn 90°
            </Button>
            <Button danger size="small" icon={<DeleteOutlined />} block
              onClick={() => {
                onApply(removeFixture(sketch, level.id, f.id));
                onSelect(null);
              }}>Delete</Button>
          </Space>
        )}
      </div>
    );
  };

  const panel = selection?.kind === 'room' ? roomPanel()
    : selection?.kind === 'opening' ? openingPanel()
      : selection?.kind === 'cabinet' ? cabinetPanel()
        : selection?.kind === 'fixture' ? fixturePanel() : null;

  const total = level.rooms.reduce((sum, r) => sum + measureRoom(level, r).floorSf, 0);

  return (
    <div style={{ fontSize: 13 }} data-testid="flooring-sketch-inspector">
      {panel && (
        <>
          <Text strong>
            {selection?.kind === 'room' ? 'Room' : selection?.kind === 'opening' ? 'Opening'
              : selection?.kind === 'cabinet' ? 'Cabinet run' : 'Fixture'}
          </Text>
          <div style={{ marginTop: 8 }}>{panel}</div>
          <Divider style={{ margin: '12px 0' }} />
        </>
      )}

      {!readOnly && (
        <>
          <Text strong>Add a room by size</Text>
          <div style={{ marginTop: 8 }}>
            <Row label="Name">
              <Input size="small" style={{ width: 160 }} value={newName} placeholder="e.g. Living Room"
                aria-label="New room name" onChange={(e) => setNewName(e.target.value)} />
            </Row>
            <Row label="Length × width">
              <Space size={4}>
                <FeetInput value={newLength} min={1} onCommit={setNewLength} aria-label="New room length" style={{ width: 80 }} />
                <span>×</span>
                <FeetInput value={newWidth} min={1} onCommit={setNewWidth} aria-label="New room width" style={{ width: 80 }} />
              </Space>
            </Row>
            <Button size="small" type="primary" icon={<PlusOutlined />} block onClick={addSizedRoom} data-testid="add-sized-room">
              Add room
            </Button>
          </div>
          <Divider style={{ margin: '12px 0' }} />
        </>
      )}

      <Text strong>Rooms on {level.name}</Text>
      <div style={{ marginTop: 6 }}>
        {level.rooms.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>None drawn yet.</Text>}
        {level.rooms.map((r) => (
          <div key={r.id} role="button" tabIndex={0}
            onClick={() => onSelect({ kind: 'room', id: r.id })}
            onKeyDown={(e) => e.key === 'Enter' && onSelect({ kind: 'room', id: r.id })}
            style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 6px', borderRadius: 4, cursor: 'pointer',
              background: selection?.kind === 'room' && selection.id === r.id ? '#f0f5ff' : undefined,
            }}>
            <span>{r.subroom_of ? `↳ ${r.name}` : r.name}</span>
            <Text type="secondary">{formatSf(measureRoom(level, r).floorSf)}</Text>
          </div>
        ))}
        {level.rooms.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 6px 0', borderTop: '1px solid #f0f0f0', marginTop: 4 }}>
            <Text strong>Total</Text>
            <Text strong>{formatSf(total)}</Text>
          </div>
        )}
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
        Draw rooms wall to wall, inside the walls. Lengths: {formatFeet(12.5)} can be typed as 12 6, 12&apos;6&quot; or 150&quot;.
      </Text>
    </div>
  );
};

export default FLSketchInspector;
