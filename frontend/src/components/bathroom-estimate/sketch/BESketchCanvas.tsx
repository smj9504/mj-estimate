/**
 * BESketchCanvas - Bathroom Estimate Sketch Konva canvas (Phase 2)
 *
 * Renders walls, rooms, fixtures (with SVG shapes), tile zones, damage zones.
 * Supports: wall endpoint snap, drag fixtures, keyboard shortcuts, grid snapping.
 */

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Stage, Layer, Rect, Line, Circle, Text, Group, Path, Transformer } from 'react-konva';
import type Konva from 'konva';
import type {
  BEPoint,
  BEWall,
  BEFixture,
  BEFixtureType,
  BathtubSubType,
} from '../../../types/bathroomSketch';
import type { BESketchStateAPI } from './hooks/useBESketchState';
import { getFixtureShape } from './utils/beFixtureShapes';

interface BESketchCanvasProps {
  api: BESketchStateAPI;
  width: number;
  height: number;
}

// ── Helpers ──

function fmtInches(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (ft === 0) return `${inches}"`;
  if (inches === 0) return `${ft}'`;
  return `${ft}' ${inches}"`;
}

function calcWallLengthPx(wall: BEWall): number {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function wallMidpoint(w: BEWall): BEPoint {
  return { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
}

function snapToGrid(p: BEPoint, gridPx: number): BEPoint {
  return {
    x: Math.round(p.x / gridPx) * gridPx,
    y: Math.round(p.y / gridPx) * gridPx,
  };
}

function dist(a: BEPoint, b: BEPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

const WALL_SNAP_RADIUS = 12; // px

/**
 * Snap a point to the nearest existing wall endpoint within WALL_SNAP_RADIUS.
 */
function snapToWallEndpoints(p: BEPoint, walls: BEWall[], excludeId?: string): BEPoint {
  let closest = p;
  let minDist = WALL_SNAP_RADIUS;
  for (const w of walls) {
    if (w.id === excludeId) continue;
    for (const ep of [w.start, w.end]) {
      const d = dist(p, ep);
      if (d < minDist) {
        minDist = d;
        closest = ep;
      }
    }
  }
  return closest;
}

/**
 * Constrain to axis: if close to horizontal or vertical, lock to axis.
 */
function constrainAxis(start: BEPoint, current: BEPoint): BEPoint {
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  if (dx > dy * 2) return { x: current.x, y: start.y }; // horizontal
  if (dy > dx * 2) return { x: start.x, y: current.y }; // vertical
  return current;
}

// ── Component ──

const BESketchCanvas: React.FC<BESketchCanvasProps> = ({ api, width, height }) => {
  const stageRef = useRef<Konva.Stage>(null);
  const {
    data,
    activeTool,
    selectedId,
    setSelectedId,
    addWall,
    addRoom,
    updateRoom,
  } = api;

  const { settings, walls, rooms, fixtures, tileZones, damageZones } = data;
  const ppf = settings.pixelsPerFoot;
  const gridPx = ppf * settings.gridSizeFt;

  // ── Drawing state ──
  const [drawingWall, setDrawingWall] = useState<{ start: BEPoint; current: BEPoint } | null>(null);
  // Rectangle room (shift+drag)
  const [drawingRoom, setDrawingRoom] = useState<{ start: BEPoint; current: BEPoint } | null>(null);
  // Polygon room (click-to-place vertices)
  const [polyRoom, setPolyRoom] = useState<{ vertices: BEPoint[]; current: BEPoint } | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<BEPoint | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const CLOSE_THRESHOLD = 15; // px to snap-close polygon

  // Track shift key
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ── Mouse pos → stage coords with snap ──
  const getStagePoint = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>, applyWallSnap = false): BEPoint => {
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos) return { x: 0, y: 0 };
      let p = { x: pos.x, y: pos.y };
      if (settings.snapToGrid) p = snapToGrid(p, gridPx);
      if (applyWallSnap) p = snapToWallEndpoints(p, walls);
      return p;
    },
    [settings.snapToGrid, gridPx, walls],
  );

  // ── Mouse handlers ──
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = getStagePoint(e, activeTool === 'wall');

      if (activeTool === 'wall') {
        setDrawingWall({ start: pos, current: pos });
      } else if (activeTool === 'room') {
        if (shiftHeld) {
          // Shift+drag → rectangle mode
          setDrawingRoom({ start: pos, current: pos });
        } else {
          // Click → polygon mode: add vertex
          if (!polyRoom) {
            // Start new polygon
            setPolyRoom({ vertices: [pos], current: pos });
          } else {
            // Check if clicking near start point → close polygon
            const first = polyRoom.vertices[0];
            if (polyRoom.vertices.length >= 3 && dist(pos, first) < CLOSE_THRESHOLD) {
              addRoom(polyRoom.vertices, []);
              setPolyRoom(null);
            } else {
              // Add vertex
              setPolyRoom({ vertices: [...polyRoom.vertices, pos], current: pos });
            }
          }
        }
      } else if (activeTool === 'select') {
        if (e.target === e.target.getStage()) {
          setSelectedId(null);
        }
      }
    },
    [activeTool, getStagePoint, setSelectedId, shiftHeld, polyRoom, addRoom],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (drawingWall) {
        let pos = getStagePoint(e, true);
        if (shiftHeld) pos = constrainAxis(drawingWall.start, pos);
        setDrawingWall((prev) => prev ? { ...prev, current: pos } : null);

        // Show snap indicator
        const rawPos = e.target.getStage()?.getPointerPosition();
        if (rawPos) {
          const snapped = snapToWallEndpoints({ x: rawPos.x, y: rawPos.y }, walls);
          if (snapped !== rawPos && dist(snapped, { x: rawPos.x, y: rawPos.y }) < WALL_SNAP_RADIUS) {
            setSnapIndicator(snapped);
          } else {
            setSnapIndicator(null);
          }
        }
      } else if (drawingRoom) {
        const pos = getStagePoint(e);
        setDrawingRoom((prev) => prev ? { ...prev, current: pos } : null);
      } else if (polyRoom) {
        const pos = getStagePoint(e);
        setPolyRoom((prev) => prev ? { ...prev, current: pos } : null);
      } else {
        setSnapIndicator(null);
      }
    },
    [drawingWall, drawingRoom, polyRoom, getStagePoint, walls, shiftHeld],
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === 'wall' && drawingWall) {
        let pos = getStagePoint(e, true);
        if (shiftHeld) pos = constrainAxis(drawingWall.start, pos);
        const lenPx = dist(drawingWall.start, pos);
        if (lenPx > 8) {
          addWall(drawingWall.start, pos);
        }
        setDrawingWall(null);
        setSnapIndicator(null);
      }

      // Rectangle room (shift+drag)
      if (activeTool === 'room' && drawingRoom) {
        const pos = getStagePoint(e);
        const dx = Math.abs(pos.x - drawingRoom.start.x);
        const dy = Math.abs(pos.y - drawingRoom.start.y);
        if (dx > 10 && dy > 10) {
          const s = drawingRoom.start;
          const boundary: BEPoint[] = [
            { x: Math.min(s.x, pos.x), y: Math.min(s.y, pos.y) },
            { x: Math.max(s.x, pos.x), y: Math.min(s.y, pos.y) },
            { x: Math.max(s.x, pos.x), y: Math.max(s.y, pos.y) },
            { x: Math.min(s.x, pos.x), y: Math.max(s.y, pos.y) },
          ];
          addRoom(boundary, []);
        }
        setDrawingRoom(null);
      }
    },
    [activeTool, drawingWall, drawingRoom, addWall, addRoom, getStagePoint, shiftHeld],
  );

  // ── Double-click to close polygon ──
  const handleDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === 'room' && polyRoom && polyRoom.vertices.length >= 3) {
        addRoom(polyRoom.vertices, []);
        setPolyRoom(null);
      }
    },
    [activeTool, polyRoom, addRoom],
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        api.undo();
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        api.redo();
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        // Trigger save via parent (BESketchTab handles this)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          if (fixtures.find((fx) => fx.id === selectedId)) api.removeFixture(selectedId);
          else if (walls.find((w) => w.id === selectedId)) api.removeWall(selectedId);
          else if (rooms.find((r) => r.id === selectedId)) api.removeRoom(selectedId);
          else if (damageZones.find((d) => d.id === selectedId)) api.removeDamageZone(selectedId);
        }
      } else if (e.key === 'Escape') {
        setDrawingWall(null);
        setDrawingRoom(null);
        setPolyRoom(null);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [api, selectedId, fixtures, walls, rooms, damageZones, setSelectedId]);

  // ── Cursor ──
  const cursor = useMemo(() => {
    switch (activeTool) {
      case 'wall': return 'crosshair';
      case 'room': return 'crosshair';
      case 'fixture': return 'copy';
      case 'measure': return 'crosshair';
      case 'damage_zone': return 'crosshair';
      default: return 'default';
    }
  }, [activeTool]);

  // ── Drawing preview wall length ──
  const previewWallLabel = useMemo(() => {
    if (!drawingWall) return '';
    const lenPx = dist(drawingWall.start, drawingWall.current);
    const lenIn = (lenPx / ppf) * 12;
    return fmtInches(lenIn);
  }, [drawingWall, ppf]);

  // ── Drawing preview room area ──
  const previewRoomLabel = useMemo(() => {
    if (!drawingRoom) return '';
    const dx = Math.abs(drawingRoom.current.x - drawingRoom.start.x);
    const dy = Math.abs(drawingRoom.current.y - drawingRoom.start.y);
    const wFt = dx / ppf;
    const hFt = dy / ppf;
    return `${wFt.toFixed(1)}' x ${hFt.toFixed(1)}' = ${(wFt * hFt).toFixed(1)} SF`;
  }, [drawingRoom, ppf]);

  return (
    <div style={{ cursor, border: '1px solid #d9d9d9', backgroundColor: settings.backgroundColor }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* ── Grid Layer ── */}
        {settings.showGrid && (
          <Layer listening={false}>
            {/* Minor grid */}
            {Array.from({ length: Math.ceil(width / gridPx) + 1 }, (_, i) => (
              <Line
                key={`gv${i}`}
                points={[i * gridPx, 0, i * gridPx, height]}
                stroke={i % 5 === 0 ? '#ddd' : '#f0f0f0'}
                strokeWidth={i % 5 === 0 ? 0.8 : 0.4}
              />
            ))}
            {Array.from({ length: Math.ceil(height / gridPx) + 1 }, (_, i) => (
              <Line
                key={`gh${i}`}
                points={[0, i * gridPx, width, i * gridPx]}
                stroke={i % 5 === 0 ? '#ddd' : '#f0f0f0'}
                strokeWidth={i % 5 === 0 ? 0.8 : 0.4}
              />
            ))}
            {/* Scale indicator */}
            <Line points={[10, height - 20, 10 + ppf, height - 20]} stroke="#999" strokeWidth={1.5} />
            <Line points={[10, height - 24, 10, height - 16]} stroke="#999" strokeWidth={1} />
            <Line points={[10 + ppf, height - 24, 10 + ppf, height - 16]} stroke="#999" strokeWidth={1} />
            <Text x={10} y={height - 36} text="1 ft" fontSize={10} fill="#999" />
          </Layer>
        )}

        {/* ── Rooms Layer ── */}
        <Layer>
          {rooms.map((room) => {
            const pts = room.boundary.flatMap((p) => [p.x, p.y]);
            const cx = room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length;
            const cy = room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length;
            const isRoomSelected = selectedId === room.id && activeTool === 'select';
            // Bounding box for dimension labels
            const xs = room.boundary.map((p) => p.x);
            const ys = room.boundary.map((p) => p.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const roomWFt = (maxX - minX) / ppf;
            const roomDFt = (maxY - minY) / ppf;
            return (
              <Group key={room.id}>
                <Line
                  points={pts}
                  closed
                  fill="rgba(200, 230, 255, 0.25)"
                  stroke={isRoomSelected ? '#1890ff' : '#90caf9'}
                  strokeWidth={isRoomSelected ? 2.5 : 1}
                  onClick={() => setSelectedId(room.id)}
                  hitStrokeWidth={6}
                />
                {settings.showAreaLabels && (
                  <Text
                    x={cx - 35}
                    y={cy - 14}
                    text={`${room.name}\n${room.floorAreaSF} SF`}
                    fontSize={11}
                    fill="#444"
                    align="center"
                    fontStyle="bold"
                  />
                )}
                {/* Room dimension labels when selected */}
                {isRoomSelected && (
                  <>
                    {/* Width label (top) */}
                    <Rect x={minX + (maxX - minX) / 2 - 30} y={minY - 22} width={60} height={16} fill="rgba(24,144,255,0.9)" cornerRadius={3} listening={false} />
                    <Text x={minX + (maxX - minX) / 2 - 30} y={minY - 20} width={60} text={`${roomWFt.toFixed(1)}'`} fontSize={11} fill="#fff" fontStyle="bold" align="center" listening={false} />
                    {/* Depth label (left) */}
                    <Rect x={minX - 50} y={minY + (maxY - minY) / 2 - 8} width={44} height={16} fill="rgba(24,144,255,0.9)" cornerRadius={3} listening={false} />
                    <Text x={minX - 50} y={minY + (maxY - minY) / 2 - 6} width={44} text={`${roomDFt.toFixed(1)}'`} fontSize={11} fill="#fff" fontStyle="bold" align="center" listening={false} />
                  </>
                )}
                {/* Corner resize handles */}
                {isRoomSelected && room.boundary.map((pt, idx) => (
                  <Circle
                    key={`rh-${room.id}-${idx}`}
                    x={pt.x}
                    y={pt.y}
                    radius={6}
                    fill="#fff"
                    stroke="#1890ff"
                    strokeWidth={2}
                    draggable
                    onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'nwse-resize'; }}
                    onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                    onDragMove={(e) => {
                      // Live update the boundary during drag
                      const raw = { x: e.target.x(), y: e.target.y() };
                      const pos = settings.snapToGrid
                        ? { x: Math.round(raw.x / gridPx) * gridPx, y: Math.round(raw.y / gridPx) * gridPx }
                        : raw;
                      e.target.position(pos);
                      // For rectangular rooms: dragging one corner moves the two adjacent corners
                      const b = [...room.boundary];
                      const prev = (idx + 3) % 4;
                      const next = (idx + 1) % 4;
                      // Corners: TL(0) TR(1) BR(2) BL(3) — share x or y with neighbors
                      if (b.length === 4) {
                        b[idx] = pos;
                        // Adjacent corners share one axis
                        b[prev] = { x: b[prev].x, y: pos.y };  // same row
                        b[next] = { x: pos.x, y: b[next].y };  // same col
                        // Wait — TL(0)-TR(1) share Y, TR(1)-BR(2) share X, etc.
                        // For standard rect: 0=TL, 1=TR, 2=BR, 3=BL
                        // Corner 0 (TL): neighbors are 3(BL) shares X, 1(TR) shares Y
                        // Corner 1 (TR): neighbors are 0(TL) shares Y, 2(BR) shares X
                        // Corner 2 (BR): neighbors are 1(TR) shares X, 3(BL) shares Y
                        // Corner 3 (BL): neighbors are 2(BR) shares Y, 0(TL) shares X
                        // Pattern: prev shares X if idx is even, Y if idx is odd
                        if (idx % 2 === 0) {
                          // TL or BR: prev shares X, next shares Y
                          b[prev] = { x: pos.x, y: b[prev].y };
                          b[next] = { x: b[next].x, y: pos.y };
                        } else {
                          // TR or BL: prev shares Y, next shares X
                          b[prev] = { x: b[prev].x, y: pos.y };
                          b[next] = { x: pos.x, y: b[next].y };
                        }
                        updateRoom(room.id, b);
                      }
                    }}
                    onDragEnd={() => {
                      // Final snap already applied in onDragMove
                    }}
                  />
                ))}
                {/* Edge midpoint resize handles (for rectangular rooms) */}
                {isRoomSelected && room.boundary.length === 4 && room.boundary.map((pt, idx) => {
                  const next = room.boundary[(idx + 1) % 4];
                  const mx = (pt.x + next.x) / 2;
                  const my = (pt.y + next.y) / 2;
                  const isHoriz = Math.abs(pt.y - next.y) < 2;
                  return (
                    <Rect
                      key={`re-${room.id}-${idx}`}
                      x={mx - (isHoriz ? 8 : 3)}
                      y={my - (isHoriz ? 3 : 8)}
                      width={isHoriz ? 16 : 6}
                      height={isHoriz ? 6 : 16}
                      fill="#fff"
                      stroke="#1890ff"
                      strokeWidth={1.5}
                      cornerRadius={2}
                      draggable
                      dragBoundFunc={(pos) => {
                        // Constrain to one axis
                        if (isHoriz) return { x: mx, y: pos.y };
                        return { x: pos.x, y: my };
                      }}
                      onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = isHoriz ? 'ns-resize' : 'ew-resize'; }}
                      onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      onDragMove={(e) => {
                        const raw = { x: e.target.x() + (isHoriz ? 8 : 3), y: e.target.y() + (isHoriz ? 3 : 8) };
                        const pos = settings.snapToGrid
                          ? { x: Math.round(raw.x / gridPx) * gridPx, y: Math.round(raw.y / gridPx) * gridPx }
                          : raw;
                        const b = [...room.boundary];
                        const nIdx = (idx + 1) % 4;
                        if (isHoriz) {
                          // Move both endpoints of this edge vertically
                          b[idx] = { x: b[idx].x, y: pos.y };
                          b[nIdx] = { x: b[nIdx].x, y: pos.y };
                        } else {
                          // Move both endpoints of this edge horizontally
                          b[idx] = { x: pos.x, y: b[idx].y };
                          b[nIdx] = { x: pos.x, y: b[nIdx].y };
                        }
                        updateRoom(room.id, b);
                      }}
                    />
                  );
                })}
              </Group>
            );
          })}
        </Layer>

        {/* ── Tile Zone Overlays ── */}
        {settings.showTileZones && tileZones.length > 0 && (
          <Layer listening={false}>
            {tileZones.map((zone) => {
              const pts = zone.boundary.flatMap((p) => [p.x, p.y]);
              const cx = zone.boundary.reduce((s, p) => s + p.x, 0) / zone.boundary.length;
              const cy = zone.boundary.reduce((s, p) => s + p.y, 0) / zone.boundary.length;
              return (
                <Group key={zone.id}>
                  <Line points={pts} closed fill={zone.color} stroke="rgba(0,0,0,0.15)" strokeWidth={1} dash={[4, 4]} />
                  <Text x={cx - 20} y={cy - 6} text={`${zone.label}\n${zone.areaSF} SF`} fontSize={9} fill="#555" />
                </Group>
              );
            })}
          </Layer>
        )}

        {/* ── Damage Zone Overlays ── */}
        {settings.showDamageZones && damageZones.length > 0 && (
          <Layer>
            {damageZones.map((zone) => {
              const pts = zone.boundary.flatMap((p) => [p.x, p.y]);
              const cx = zone.boundary.reduce((s, p) => s + p.x, 0) / zone.boundary.length;
              const cy = zone.boundary.reduce((s, p) => s + p.y, 0) / zone.boundary.length;
              return (
                <Group key={zone.id}>
                  <Line
                    points={pts}
                    closed
                    fill="rgba(244, 67, 54, 0.15)"
                    stroke={selectedId === zone.id ? '#d32f2f' : '#ef5350'}
                    strokeWidth={selectedId === zone.id ? 3 : 2}
                    dash={[6, 3]}
                    onClick={() => setSelectedId(zone.id)}
                    hitStrokeWidth={8}
                  />
                  <Text x={cx - 25} y={cy - 6} text={`${zone.damageType.replace(/_/g, ' ')}\n${zone.areaSF} SF`} fontSize={9} fill="#c62828" fontStyle="bold" />
                </Group>
              );
            })}
          </Layer>
        )}

        {/* ── Walls Layer ── */}
        <Layer>
          {walls.map((wall) => {
            const lenIn = (calcWallLengthPx(wall) / ppf) * 12;
            const mid = wallMidpoint(wall);
            const isSelected = selectedId === wall.id;
            return (
              <Group key={wall.id}>
                <Line
                  points={[wall.start.x, wall.start.y, wall.end.x, wall.end.y]}
                  stroke={isSelected ? '#1890ff' : '#333'}
                  strokeWidth={wall.thickness}
                  lineCap="round"
                  onClick={() => setSelectedId(wall.id)}
                  hitStrokeWidth={14}
                />
                {/* Endpoints */}
                <Circle x={wall.start.x} y={wall.start.y} radius={isSelected ? 5 : 3} fill={isSelected ? '#1890ff' : '#666'} />
                <Circle x={wall.end.x} y={wall.end.y} radius={isSelected ? 5 : 3} fill={isSelected ? '#1890ff' : '#666'} />
                {/* Dimension label */}
                {settings.showDimensions && lenIn > 6 && (
                  <>
                    {/* Background for readability */}
                    <Rect
                      x={mid.x - 22}
                      y={mid.y - 20}
                      width={44}
                      height={14}
                      fill="rgba(255,255,255,0.85)"
                      cornerRadius={2}
                    />
                    <Text
                      x={mid.x - 22}
                      y={mid.y - 19}
                      width={44}
                      text={fmtInches(lenIn)}
                      fontSize={10}
                      fill="#1890ff"
                      fontStyle="bold"
                      align="center"
                    />
                  </>
                )}
              </Group>
            );
          })}

          {/* Drawing preview wall */}
          {drawingWall && (
            <Group>
              <Line
                points={[drawingWall.start.x, drawingWall.start.y, drawingWall.current.x, drawingWall.current.y]}
                stroke="#1890ff"
                strokeWidth={4}
                dash={[8, 4]}
                lineCap="round"
              />
              <Circle x={drawingWall.start.x} y={drawingWall.start.y} radius={5} fill="#1890ff" />
              <Circle x={drawingWall.current.x} y={drawingWall.current.y} radius={5} fill="#1890ff" opacity={0.6} />
              {/* Preview length */}
              {previewWallLabel && (
                <Text
                  x={(drawingWall.start.x + drawingWall.current.x) / 2 - 20}
                  y={(drawingWall.start.y + drawingWall.current.y) / 2 - 20}
                  text={previewWallLabel}
                  fontSize={12}
                  fill="#1890ff"
                  fontStyle="bold"
                />
              )}
            </Group>
          )}

          {/* Drawing preview room */}
          {drawingRoom && (() => {
            const x = Math.min(drawingRoom.start.x, drawingRoom.current.x);
            const y = Math.min(drawingRoom.start.y, drawingRoom.current.y);
            const w = Math.abs(drawingRoom.current.x - drawingRoom.start.x);
            const h = Math.abs(drawingRoom.current.y - drawingRoom.start.y);
            return (
              <Group>
                <Rect
                  x={x} y={y} width={w} height={h}
                  stroke="#1890ff"
                  strokeWidth={2}
                  dash={[6, 4]}
                  fill="rgba(24, 144, 255, 0.08)"
                />
                {previewRoomLabel && (
                  <Text
                    x={x + w / 2 - 40}
                    y={y + h / 2 - 8}
                    text={previewRoomLabel}
                    fontSize={11}
                    fill="#1890ff"
                    fontStyle="bold"
                  />
                )}
              </Group>
            );
          })()}

          {/* Snap indicator */}
          {snapIndicator && (
            <Circle
              x={snapIndicator.x}
              y={snapIndicator.y}
              radius={8}
              stroke="#52c41a"
              strokeWidth={2}
              fill="rgba(82, 196, 26, 0.2)"
              listening={false}
            />
          )}
        </Layer>

        {/* ── Fixtures Layer ── */}
        <Layer>
          {fixtures.map((fix) => (
            <FixtureNode
              key={fix.id}
              fixture={fix}
              ppf={ppf}
              gridPx={gridPx}
              isSelected={selectedId === fix.id}
              isDraggable={activeTool === 'select'}
              snapToGrid={settings.snapToGrid}
              isResizable={activeTool === 'select' && (fix.type === 'bathtub' || fix.type === 'shower' || fix.type === 'vanity')}
              onSelect={() => setSelectedId(fix.id)}
              onDragEnd={(pos) => api.updateFixture(fix.id, { position: pos })}
              onResize={(w, h) => api.updateFixture(fix.id, { dimensions: { width: w, height: h } })}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
};

// ── Fixture Node with SVG shape rendering ──

interface FixtureNodeProps {
  fixture: BEFixture;
  ppf: number;
  gridPx: number;
  isSelected: boolean;
  isDraggable: boolean;
  snapToGrid: boolean;
  isResizable: boolean;
  onSelect: () => void;
  onDragEnd: (pos: BEPoint) => void;
  onResize: (widthInches: number, heightInches: number) => void;
}

const FixtureNode: React.FC<FixtureNodeProps> = React.memo(({
  fixture: fix,
  ppf,
  gridPx,
  isSelected,
  isDraggable,
  snapToGrid: doSnap,
  isResizable,
  onSelect,
  onDragEnd,
  onResize,
}) => {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const shape = getFixtureShape(
    fix.type,
    fix.properties.bathtubSubType as BathtubSubType | undefined,
    fix.properties.sinkCount,
  );

  // Attach transformer to the resize-target rect
  useEffect(() => {
    if (isSelected && isResizable && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.forceUpdate();
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, isResizable, wPx, hPx]);

  return (
    <>
    <Group
      x={fix.position.x}
      y={fix.position.y}
      rotation={fix.rotation}
      draggable={isDraggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        const raw = { x: e.target.x(), y: e.target.y() };
        const snapped = doSnap
          ? { x: Math.round(raw.x / gridPx) * gridPx, y: Math.round(raw.y / gridPx) * gridPx }
          : raw;
        onDragEnd(snapped);
        e.target.position(snapped);
      }}
    >
      {/* Resize-target rect: Transformer attaches here */}
      <Rect
        ref={shapeRef}
        x={-wPx / 2}
        y={-hPx / 2}
        width={wPx}
        height={hPx}
        fill="transparent"
        stroke="transparent"
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          const newW = Math.round((wPx * scaleX / ppf) * 12);
          const newH = Math.round((hPx * scaleY / ppf) * 12);
          // Reset scale & position
          node.scaleX(1);
          node.scaleY(1);
          node.position({ x: -wPx / 2, y: -hPx / 2 });
          node.width(wPx);
          node.height(hPx);
          onResize(
            Math.max(12, Math.min(120, newW)),
            Math.max(12, Math.min(120, newH)),
          );
        }}
      />

      {/* SVG shape paths (scaled to fixture pixel size) */}
      {shape.paths.map((p, i) => (
        <Path
          key={i}
          x={-wPx / 2}
          y={-hPx / 2}
          data={p.d}
          fill={p.fill === 'none' ? undefined : p.fill}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          scaleX={wPx}
          scaleY={hPx}
          listening={false}
        />
      ))}

      {/* Label */}
      <Text
        x={-wPx / 2}
        y={hPx / 2 + 2}
        width={wPx}
        text={fix.label ?? shape.label}
        fontSize={Math.max(8, Math.min(11, wPx / 5))}
        fill="#555"
        align="center"
        listening={false}
      />

      {/* Surround indicator for bathtub */}
      {fix.type === 'bathtub' && fix.properties.hasSurround && (
        <Rect
          x={-wPx / 2 - 6}
          y={-hPx / 2 - 6}
          width={wPx + 12}
          height={hPx + 12}
          stroke="#999"
          strokeWidth={1.5}
          dash={[5, 3]}
          fill="transparent"
          cornerRadius={4}
          listening={false}
        />
      )}

      {/* Shower tile wall indicator */}
      {fix.type === 'shower' && (fix.properties.showerWallCount ?? 3) > 0 && (
        <Rect
          x={-wPx / 2 - 4}
          y={-hPx / 2 - 4}
          width={wPx + 8}
          height={hPx + 8}
          stroke="#888"
          strokeWidth={1}
          dash={[3, 3]}
          fill="transparent"
          cornerRadius={2}
          listening={false}
        />
      )}

      {/* Niche indicators for shower */}
      {fix.type === 'shower' && (fix.properties.nicheCount ?? 0) > 0 && (
        <Text
          x={-wPx / 2 + 2}
          y={-hPx / 2 - 14}
          text={`${fix.properties.nicheCount} niche${(fix.properties.nicheCount ?? 0) > 1 ? 's' : ''}`}
          fontSize={8}
          fill="#666"
          listening={false}
        />
      )}

      {/* Bench indicator for shower */}
      {fix.type === 'shower' && fix.properties.hasBench && (
        <Rect
          x={-wPx / 2 + 2}
          y={hPx / 2 - hPx * 0.25}
          width={wPx - 4}
          height={hPx * 0.2}
          fill="rgba(0, 0, 0, 0.08)"
          stroke="#888"
          strokeWidth={1}
          cornerRadius={2}
          listening={false}
        />
      )}

      {/* Selection border */}
      {isSelected && !isResizable && (
        <Rect
          x={-wPx / 2 - 2}
          y={-hPx / 2 - 2}
          width={wPx + 4}
          height={hPx + 4}
          stroke="#1890ff"
          strokeWidth={1.5}
          dash={[4, 4]}
          fill="transparent"
          listening={false}
        />
      )}
    </Group>

    {/* Transformer for resize */}
    {isSelected && isResizable && (
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        keepRatio={false}
        enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']}
        boundBoxFunc={(oldBox, newBox) => {
          const minPx = ppf;
          const maxPx = ppf * 10;
          if (newBox.width < minPx || newBox.height < minPx) return oldBox;
          if (newBox.width > maxPx || newBox.height > maxPx) return oldBox;
          return newBox;
        }}
        borderStroke="#1890ff"
        borderStrokeWidth={1.5}
        anchorFill="#fff"
        anchorStroke="#1890ff"
        anchorSize={7}
        anchorCornerRadius={1}
      />
    )}
    </>
  );
});

export default BESketchCanvas;
