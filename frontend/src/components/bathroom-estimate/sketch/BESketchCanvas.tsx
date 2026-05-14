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
  stageRef?: React.MutableRefObject<any>;
  onZoomChange?: (level: number) => void;
}

// ── Helpers ──

function fmtInches(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const remainInches = totalInches % 12;
  const wholeInches = Math.floor(remainInches);
  const frac = remainInches - wholeInches;

  // Snap to nearest 1/4"
  let fracStr = '';
  if (frac >= 0.875) {
    // rounds up to next inch
    return fmtInches(ft * 12 + wholeInches + 1);
  } else if (frac >= 0.625) {
    fracStr = ' 3/4';
  } else if (frac >= 0.375) {
    fracStr = ' 1/2';
  } else if (frac >= 0.125) {
    fracStr = ' 1/4';
  }

  const inchPart = wholeInches > 0 || fracStr ? `${wholeInches > 0 ? wholeInches : ''}${fracStr}"` : '';
  if (ft === 0) return inchPart || '0"';
  if (!inchPart) return `${ft}'`;
  return `${ft}' ${inchPart}`;
}

/**
 * Parse fraction string (e.g. "1/4", "1/2", "3/4") to decimal.
 */
function parseFraction(frac: string): number {
  const parts = frac.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (den !== 0) return num / den;
  }
  return 0;
}

/**
 * Snap a value to the nearest 1/4 inch.
 */
function snapToQuarterInch(inches: number): number {
  return Math.round(inches * 4) / 4;
}

/**
 * Parse dimension input string to total inches (with 1/4" precision).
 * Supports: "7' 2\"", "7'2", "7.5'", "86\"", "86", "7 2",
 *           "7' 3 1/4\"", "5' 6 1/2", "3 3/4\"" (fractional inches)
 */
function parseDimension(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  // "7' 3 1/4\"" or "7' 3 1/2" (feet + inches + fraction)
  const ftInFracMatch = s.match(/^(\d+)\s*['′]\s*(\d+)\s+(\d+\/\d+)\s*["″]?\s*$/);
  if (ftInFracMatch) {
    return snapToQuarterInch(
      parseInt(ftInFracMatch[1], 10) * 12 + parseInt(ftInFracMatch[2], 10) + parseFraction(ftInFracMatch[3])
    );
  }

  // "7' 1/2\"" or "7' 3/4" (feet + fraction only, no whole inches)
  const ftFracMatch = s.match(/^(\d+)\s*['′]\s*(\d+\/\d+)\s*["″]?\s*$/);
  if (ftFracMatch) {
    return snapToQuarterInch(parseInt(ftFracMatch[1], 10) * 12 + parseFraction(ftFracMatch[2]));
  }

  // "7' 2\"" or "7'2\"" or "7' 2" or "7'2"
  const ftInMatch = s.match(/^(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]?\s*$/);
  if (ftInMatch) {
    return snapToQuarterInch(parseFloat(ftInMatch[1]) * 12 + parseFloat(ftInMatch[2]));
  }

  // "7'" or "7.5'"
  const ftOnly = s.match(/^(\d+(?:\.\d+)?)\s*['′]\s*$/);
  if (ftOnly) {
    return snapToQuarterInch(parseFloat(ftOnly[1]) * 12);
  }

  // "3 1/4\"" or "3 1/2" (inches + fraction)
  const inFracMatch = s.match(/^(\d+)\s+(\d+\/\d+)\s*["″]?\s*$/);
  if (inFracMatch) {
    return snapToQuarterInch(parseInt(inFracMatch[1], 10) + parseFraction(inFracMatch[2]));
  }

  // "1/4\"" or "1/2" (fraction only)
  const fracOnly = s.match(/^(\d+\/\d+)\s*["″]?\s*$/);
  if (fracOnly) {
    return snapToQuarterInch(parseFraction(fracOnly[1]));
  }

  // "86\"" or "86""
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*["″]\s*$/);
  if (inOnly) {
    return snapToQuarterInch(parseFloat(inOnly[1]));
  }

  // "7 2" (feet space inches, no symbols)
  const spaceMatch = s.match(/^(\d+)\s+(\d+(?:\.\d+)?)\s*$/);
  if (spaceMatch) {
    return snapToQuarterInch(parseInt(spaceMatch[1], 10) * 12 + parseFloat(spaceMatch[2]));
  }

  // Plain number → inches
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0) return snapToQuarterInch(num);

  return null;
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
  // Snap to horizontal if angle < ~34° (tan≈0.67), vertical if > ~56°
  if (dx > dy * 1.5) return { x: current.x, y: start.y }; // horizontal
  if (dy > dx * 1.5) return { x: start.x, y: current.y }; // vertical
  return current; // diagonal (45° zone)
}

// ── Component ──

const BESketchCanvas: React.FC<BESketchCanvasProps> = ({ api, width, height, stageRef: externalStageRef, onZoomChange }) => {
  const internalStageRef = useRef<Konva.Stage>(null);
  const stageRef = externalStageRef ?? internalStageRef;
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

  // ── Wall inline edit state ──
  const [editingWallId, setEditingWallId] = useState<string | null>(null);
  const [editingWallValue, setEditingWallValue] = useState('');
  const wallInputRef = useRef<HTMLInputElement>(null);

  // ── Room inline edit state ──
  // edgeIdx: index of the first vertex of the edge (edge = boundary[edgeIdx] → boundary[edgeIdx+1])
  const [editingRoomEdge, setEditingRoomEdge] = useState<{ roomId: string; edgeIdx: number; edge: 'width' | 'depth' } | null>(null);
  const [editingRoomValue, setEditingRoomValue] = useState('');
  const roomInputRef = useRef<HTMLInputElement>(null);

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
          setEditingWallId(null);
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
        // Always snap to axis if close (within 5°), Shift forces strict axis lock
        pos = constrainAxis(drawingWall.start, pos);
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
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedId) {
          const fix = fixtures.find((fx) => fx.id === selectedId);
          if (fix) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            api.updateFixture(fix.id, { position: { x: fix.position.x + dx, y: fix.position.y + dy } });
          }
        }
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

  // ── Drawing preview room area (rect mode) ──
  const previewRoomLabel = useMemo(() => {
    if (!drawingRoom) return '';
    const dx = Math.abs(drawingRoom.current.x - drawingRoom.start.x);
    const dy = Math.abs(drawingRoom.current.y - drawingRoom.start.y);
    const wIn = (dx / ppf) * 12;
    const hIn = (dy / ppf) * 12;
    const sf = (wIn * hIn) / 144;
    return `${fmtInches(wIn)} x ${fmtInches(hIn)} = ${sf.toFixed(1)} SF`;
  }, [drawingRoom, ppf]);

  // ── Polygon room: close-snap detection ──
  const polyCloseSnap = useMemo(() => {
    if (!polyRoom || polyRoom.vertices.length < 3) return false;
    return dist(polyRoom.current, polyRoom.vertices[0]) < CLOSE_THRESHOLD;
  }, [polyRoom]);

  // ── Polygon room: preview area ──
  const polyAreaLabel = useMemo(() => {
    if (!polyRoom || polyRoom.vertices.length < 2) return '';
    const verts = [...polyRoom.vertices, polyRoom.current];
    let areaPx2 = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      areaPx2 += verts[i].x * verts[j].y;
      areaPx2 -= verts[j].x * verts[i].y;
    }
    const sf = Math.abs(areaPx2) / 2 / (ppf * ppf);
    return `${sf.toFixed(1)} SF`;
  }, [polyRoom, ppf]);

  // ── Wall inline length edit ──
  const handleWallDblClick = useCallback((wallId: string) => {
    const wall = walls.find(w => w.id === wallId);
    if (!wall) return;
    const lenIn = Math.round((calcWallLengthPx(wall) / ppf) * 12);
    setEditingWallId(wallId);
    setEditingWallValue(fmtInches(lenIn));
    setTimeout(() => { wallInputRef.current?.focus(); wallInputRef.current?.select(); }, 50);
  }, [walls, ppf]);

  const commitWallEdit = useCallback(() => {
    if (!editingWallId) return;
    const wall = walls.find(w => w.id === editingWallId);
    if (!wall) { setEditingWallId(null); return; }
    const newInches = parseDimension(editingWallValue);
    if (!newInches || newInches < 1) { setEditingWallId(null); return; }
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    let angle = Math.atan2(dy, dx);
    // Snap to axis: if within 15° of horizontal or vertical, lock it
    const deg = (angle * 180) / Math.PI;
    if (Math.abs(deg) < 15 || Math.abs(deg) > 165) angle = Math.abs(deg) > 90 ? Math.PI : 0;
    else if (Math.abs(deg - 90) < 15) angle = Math.PI / 2;
    else if (Math.abs(deg + 90) < 15) angle = -Math.PI / 2;
    const newPx = (newInches / 12) * ppf;
    const oldEnd = wall.end;
    const newEnd: BEPoint = {
      x: Math.round(wall.start.x + Math.cos(angle) * newPx),
      y: Math.round(wall.start.y + Math.sin(angle) * newPx),
    };
    api.updateWall(editingWallId, { end: newEnd });

    // Sync room boundaries: move any room vertex that matched oldEnd
    for (const room of rooms) {
      const idx = room.boundary.findIndex(
        p => Math.abs(p.x - oldEnd.x) < 2 && Math.abs(p.y - oldEnd.y) < 2
      );
      if (idx >= 0) {
        const b = [...room.boundary];
        b[idx] = newEnd;
        updateRoom(room.id, b);
      }
    }
    setEditingWallId(null);
  }, [editingWallId, editingWallValue, walls, rooms, ppf, api, updateRoom]);

  // Compute editing wall overlay position
  const editingWall = editingWallId ? walls.find(w => w.id === editingWallId) : null;
  const editOverlayPos = editingWall ? wallMidpoint(editingWall) : null;

  // ── Room inline dimension edit ──
  const handleRoomEdgeEdit = useCallback((roomId: string, edgeIdx: number, edge: 'width' | 'depth') => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    const pt = room.boundary[edgeIdx];
    const npt = room.boundary[(edgeIdx + 1) % room.boundary.length];
    const edgePx = dist(pt, npt);
    const inches = Math.round((edgePx / ppf) * 12);
    setEditingRoomEdge({ roomId, edgeIdx, edge });
    setEditingRoomValue(fmtInches(inches));
    setTimeout(() => { roomInputRef.current?.focus(); roomInputRef.current?.select(); }, 50);
  }, [rooms, ppf]);

  const commitRoomEdit = useCallback(() => {
    if (!editingRoomEdge) return;
    const room = rooms.find(r => r.id === editingRoomEdge.roomId);
    if (!room) { setEditingRoomEdge(null); return; }
    const newInches = parseDimension(editingRoomValue);
    if (!newInches || newInches < 3) { setEditingRoomEdge(null); return; }
    const newPx = (newInches / 12) * ppf;

    const idx = editingRoomEdge.edgeIdx;
    const nIdx = (idx + 1) % room.boundary.length;
    const pt = room.boundary[idx];
    const npt = room.boundary[nIdx];

    // Snap edge direction to axis
    let dx = npt.x - pt.x;
    let dy = npt.y - pt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) { setEditingRoomEdge(null); return; }
    // Force horizontal/vertical if close
    const isH = Math.abs(dy) < Math.abs(dx) * 0.2; // nearly horizontal
    const isV = Math.abs(dx) < Math.abs(dy) * 0.2; // nearly vertical
    if (isH) { dy = 0; dx = dx > 0 ? len : -len; }
    else if (isV) { dx = 0; dy = dy > 0 ? len : -len; }
    const dirLen = Math.sqrt(dx * dx + dy * dy);

    // New end point = start + direction * newPx
    const newNpt: BEPoint = {
      x: Math.round(pt.x + (dx / dirLen) * newPx),
      y: Math.round(pt.y + (dy / dirLen) * newPx),
    };

    const oldB = [...room.boundary];
    const b = [...room.boundary];
    b[nIdx] = newNpt;

    // For rectangular rooms: move any vertex that shared X or Y with old npt
    if (room.boundary.length === 4) {
      for (let i = 0; i < 4; i++) {
        if (i === nIdx) continue;
        if (Math.abs(oldB[i].x - oldB[nIdx].x) < 2) {
          b[i] = { x: newNpt.x, y: b[i].y };
        }
        if (Math.abs(oldB[i].y - oldB[nIdx].y) < 2) {
          b[i] = { x: b[i].x, y: newNpt.y };
        }
      }
    }

    updateRoom(room.id, b);

    // Sync wall endpoints
    for (let i = 0; i < oldB.length; i++) {
      if (Math.abs(oldB[i].x - b[i].x) < 1 && Math.abs(oldB[i].y - b[i].y) < 1) continue;
      for (const w of walls) {
        if (Math.abs(w.start.x - oldB[i].x) < 2 && Math.abs(w.start.y - oldB[i].y) < 2) {
          api.updateWall(w.id, { start: b[i] });
        }
        if (Math.abs(w.end.x - oldB[i].x) < 2 && Math.abs(w.end.y - oldB[i].y) < 2) {
          api.updateWall(w.id, { end: b[i] });
        }
      }
    }
    setEditingRoomEdge(null);
  }, [editingRoomEdge, editingRoomValue, rooms, walls, ppf, updateRoom, api]);

  // Room edit overlay position
  const editingRoom = editingRoomEdge ? rooms.find(r => r.id === editingRoomEdge.roomId) : null;
  const roomEditOverlayPos = (() => {
    if (!editingRoom || !editingRoomEdge) return null;
    const pt = editingRoom.boundary[editingRoomEdge.edgeIdx];
    const npt = editingRoom.boundary[(editingRoomEdge.edgeIdx + 1) % editingRoom.boundary.length];
    return { x: (pt.x + npt.x) / 2, y: (pt.y + npt.y) / 2 };
  })();

  return (
    <div style={{ position: 'relative', cursor, border: '1px solid #d9d9d9', backgroundColor: settings.backgroundColor }}>
      {/* Inline wall length input overlay */}
      {editingWallId && editOverlayPos && (
        <div style={{
          position: 'absolute',
          left: editOverlayPos.x - 40,
          top: editOverlayPos.y - 32,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}>
          <input
            ref={wallInputRef}
            value={editingWallValue}
            onChange={(e) => setEditingWallValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitWallEdit();
              if (e.key === 'Escape') setEditingWallId(null);
            }}
            onBlur={commitWallEdit}
            style={{
              width: 70, height: 24, fontSize: 12, fontWeight: 600,
              textAlign: 'center', border: '2px solid #1890ff',
              borderRadius: 4, outline: 'none', background: '#fff',
            }}
          />
        </div>
      )}
      {/* Inline room dimension input overlay */}
      {editingRoomEdge && roomEditOverlayPos && (
        <div style={{
          position: 'absolute',
          left: roomEditOverlayPos.x - 40,
          top: roomEditOverlayPos.y - 30,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}>
          <input
            ref={roomInputRef}
            value={editingRoomValue}
            onChange={(e) => setEditingRoomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRoomEdit();
              if (e.key === 'Escape') setEditingRoomEdge(null);
            }}
            onBlur={commitRoomEdit}
            style={{
              width: 70, height: 24, fontSize: 12, fontWeight: 600,
              textAlign: 'center', border: '2px solid #1890ff',
              borderRadius: 4, outline: 'none', background: '#fff',
            }}
          />
        </div>
      )}
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        draggable={activeTool === 'select' && !drawingWall && !drawingRoom && !polyRoom}
        onWheel={(e) => {
          e.evt.preventDefault();
          const stage = stageRef.current;
          if (!stage) return;

          if (e.evt.ctrlKey || e.evt.metaKey) {
            // Ctrl+Wheel → Zoom (toward pointer)
            const scaleBy = 1.08;
            const oldScale = stage.scaleX();
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            const mousePointTo = {
              x: (pointer.x - stage.x()) / oldScale,
              y: (pointer.y - stage.y()) / oldScale,
            };
            const direction = e.evt.deltaY > 0 ? -1 : 1;
            const newScale = Math.min(5, Math.max(0.2, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy));
            stage.scale({ x: newScale, y: newScale });
            stage.position({
              x: pointer.x - mousePointTo.x * newScale,
              y: pointer.y - mousePointTo.y * newScale,
            });
            onZoomChange?.(newScale);
          } else {
            // Normal wheel → Pan
            const oldPos = stage.position();
            stage.position({ x: oldPos.x - e.evt.deltaX, y: oldPos.y - e.evt.deltaY });
          }
          stage.batchDraw();
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
      >
        {/* ── Grid Layer ── */}
        {settings.showGrid && (() => {
          // Multi-level grid: minor = gridPx (1/4 ft = 3"), major = 1 ft
          const majorPx = ppf; // 1 foot intervals
          const minorPx = gridPx; // 1/4 foot (3") intervals
          return (
          <Layer listening={false}>
            {/* Minor grid lines (every 1/4 ft = 3") */}
            {Array.from({ length: Math.ceil(width / minorPx) + 1 }, (_, i) => {
              const isMajor = Math.abs(i * minorPx - Math.round(i * minorPx / majorPx) * majorPx) < 1;
              if (isMajor) return null; // drawn separately
              return (
                <Line
                  key={`gv${i}`}
                  points={[i * minorPx, 0, i * minorPx, height]}
                  stroke="#f0f0f0"
                  strokeWidth={0.4}
                />
              );
            })}
            {Array.from({ length: Math.ceil(height / minorPx) + 1 }, (_, i) => {
              const isMajor = Math.abs(i * minorPx - Math.round(i * minorPx / majorPx) * majorPx) < 1;
              if (isMajor) return null;
              return (
                <Line
                  key={`gh${i}`}
                  points={[0, i * minorPx, width, i * minorPx]}
                  stroke="#f0f0f0"
                  strokeWidth={0.4}
                />
              );
            })}
            {/* Major grid lines (every 1 ft) */}
            {Array.from({ length: Math.ceil(width / majorPx) + 1 }, (_, i) => (
              <Line
                key={`gvM${i}`}
                points={[i * majorPx, 0, i * majorPx, height]}
                stroke="#ddd"
                strokeWidth={0.8}
              />
            ))}
            {Array.from({ length: Math.ceil(height / majorPx) + 1 }, (_, i) => (
              <Line
                key={`ghM${i}`}
                points={[0, i * majorPx, width, i * majorPx]}
                stroke="#ddd"
                strokeWidth={0.8}
              />
            ))}
            {/* Scale indicator */}
            <Line points={[10, height - 20, 10 + ppf, height - 20]} stroke="#999" strokeWidth={1.5} />
            <Line points={[10, height - 24, 10, height - 16]} stroke="#999" strokeWidth={1} />
            <Line points={[10 + ppf, height - 24, 10 + ppf, height - 16]} stroke="#999" strokeWidth={1} />
            <Text x={10} y={height - 36} text="1 ft" fontSize={10} fill="#999" />
            {/* 1/4 ft tick marks on scale */}
            {[0.25, 0.5, 0.75].map((frac) => (
              <Line key={`st${frac}`} points={[10 + ppf * frac, height - 22, 10 + ppf * frac, height - 18]} stroke="#bbb" strokeWidth={0.8} />
            ))}
            <Text x={10 + ppf * 0.25 - 4} y={height - 36} text='3"' fontSize={8} fill="#bbb" />
            <Text x={10 + ppf * 0.5 - 4} y={height - 36} text='6"' fontSize={8} fill="#bbb" />
            <Text x={10 + ppf * 0.75 - 4} y={height - 36} text='9"' fontSize={8} fill="#bbb" />
          </Layer>
          );
        })()}

        {/* ── Rooms Layer ── */}
        <Layer>
          {rooms.map((room) => {
            const pts = room.boundary.flatMap((p) => [p.x, p.y]);
            const cx = room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length;
            const cy = room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length;
            const isRoomSelected = selectedId === room.id && activeTool === 'select';
            const isRect = room.boundary.length === 4;
            const xs = room.boundary.map((p) => p.x);
            const ys = room.boundary.map((p) => p.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            return (
              <Group key={room.id}>
                <Line
                  points={pts}
                  closed
                  fill={room.parentRoomId ? 'rgba(255, 235, 200, 0.3)' : 'rgba(200, 230, 255, 0.25)'}
                  stroke={isRoomSelected ? '#1890ff' : room.parentRoomId ? '#d48806' : '#90caf9'}
                  strokeWidth={isRoomSelected ? 2.5 : 1}
                  onClick={() => setSelectedId(room.id)}
                  hitStrokeWidth={6}
                />
                {settings.showAreaLabels && (
                  <Text
                    x={cx - 35} y={cy - 14}
                    text={`${room.name}\n${room.netFloorAreaSF ?? room.floorAreaSF} SF`}
                    fontSize={room.parentRoomId ? 10 : 11}
                    fill={room.parentRoomId ? '#8c6d1f' : '#444'}
                    align="center" fontStyle="bold"
                  />
                )}
                {/* Dimension labels */}
                {/* Room selected dimension labels are now in top-most layer */}
                {/* Vertex handles (all polygon shapes) */}
                {isRoomSelected && room.boundary.map((pt, idx) => (
                  <Circle
                    key={`rv-${room.id}-${idx}`}
                    x={pt.x} y={pt.y}
                    radius={5}
                    fill="#fff" stroke="#1890ff" strokeWidth={2}
                    draggable
                    onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'move'; }}
                    onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                    onDragMove={(e) => {
                      const raw = { x: e.target.x(), y: e.target.y() };
                      const pos = settings.snapToGrid
                        ? snapToGrid(raw, gridPx)
                        : raw;
                      e.target.position(pos);

                      const b = [...room.boundary];
                      if (isRect) {
                        // Rectangular: find which vertices share X or Y with dragged vertex
                        const old = b[idx];
                        b[idx] = pos;
                        for (let i = 0; i < 4; i++) {
                          if (i === idx) continue;
                          // Vertex that shared X with old position → update its X
                          if (Math.abs(b[i].x - old.x) < 2) {
                            b[i] = { x: pos.x, y: b[i].y };
                          }
                          // Vertex that shared Y with old position → update its Y
                          if (Math.abs(b[i].y - old.y) < 2) {
                            b[i] = { x: b[i].x, y: pos.y };
                          }
                        }
                      } else {
                        b[idx] = pos;
                      }
                      updateRoom(room.id, b);
                    }}
                  />
                ))}
                {/* Edge midpoint handles (all rooms) */}
                {isRoomSelected && room.boundary.map((pt, idx) => {
                  const nIdx = (idx + 1) % room.boundary.length;
                  const npt = room.boundary[nIdx];
                  const mx = (pt.x + npt.x) / 2;
                  const my = (pt.y + npt.y) / 2;
                  const edgeDx = npt.x - pt.x;
                  const edgeDy = npt.y - pt.y;
                  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                  if (edgeLen < 15) return null; // skip tiny edges
                  // Edge is horizontal if |dy| < |dx|
                  const isH = Math.abs(edgeDy) < Math.abs(edgeDx);
                  return (
                    <Rect
                      key={`re-${room.id}-${idx}`}
                      x={mx - (isH ? 8 : 3)} y={my - (isH ? 3 : 8)}
                      width={isH ? 16 : 6} height={isH ? 6 : 16}
                      fill="#fff" stroke="#1890ff" strokeWidth={1.5} cornerRadius={2}
                      draggable
                      dragBoundFunc={(pos) => {
                        // Constrain perpendicular to edge direction
                        if (isH) return { x: mx, y: pos.y };
                        return { x: pos.x, y: my };
                      }}
                      onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = isH ? 'ns-resize' : 'ew-resize'; }}
                      onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      onDragMove={(e) => {
                        const raw = { x: e.target.x() + (isH ? 8 : 3), y: e.target.y() + (isH ? 3 : 8) };
                        const pos = settings.snapToGrid ? snapToGrid(raw, gridPx) : raw;
                        const b = [...room.boundary];
                        if (isH) {
                          // Move both endpoints of this edge vertically
                          b[idx] = { x: b[idx].x, y: pos.y };
                          b[nIdx] = { x: b[nIdx].x, y: pos.y };
                        } else {
                          // Move both endpoints horizontally
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

          {/* ── Polygon room drawing preview ── */}
          {polyRoom && polyRoom.vertices.length > 0 && (() => {
            const verts = polyRoom.vertices;
            const allPts = [...verts, polyRoom.current].flatMap((p) => [p.x, p.y]);
            const closedPts = verts.flatMap((p) => [p.x, p.y]);
            const first = verts[0];
            const cx = [...verts, polyRoom.current].reduce((s, p) => s + p.x, 0) / (verts.length + 1);
            const cy = [...verts, polyRoom.current].reduce((s, p) => s + p.y, 0) / (verts.length + 1);
            return (
              <Group>
                {/* Filled preview */}
                <Line
                  points={allPts}
                  closed
                  fill="rgba(24, 144, 255, 0.08)"
                  stroke="#1890ff"
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
                {/* Placed vertices */}
                {verts.map((v, i) => (
                  <Circle
                    key={`pv-${i}`}
                    x={v.x} y={v.y}
                    radius={i === 0 ? 7 : 4}
                    fill={i === 0 ? (polyCloseSnap ? '#52c41a' : '#1890ff') : '#fff'}
                    stroke={i === 0 ? (polyCloseSnap ? '#52c41a' : '#1890ff') : '#1890ff'}
                    strokeWidth={2}
                    listening={false}
                  />
                ))}
                {/* Current mouse position */}
                <Circle
                  x={polyRoom.current.x} y={polyRoom.current.y}
                  radius={4} fill="rgba(24,144,255,0.4)" stroke="#1890ff" strokeWidth={1}
                  listening={false}
                />
                {/* Close snap indicator */}
                {polyCloseSnap && (
                  <Circle
                    x={first.x} y={first.y}
                    radius={12} stroke="#52c41a" strokeWidth={2}
                    fill="rgba(82,196,26,0.15)" listening={false}
                  />
                )}
                {/* Area label */}
                {polyAreaLabel && (
                  <Text
                    x={cx - 25} y={cy - 8}
                    text={polyAreaLabel}
                    fontSize={12} fill="#1890ff" fontStyle="bold"
                    listening={false}
                  />
                )}
                {/* Vertex count hint */}
                <Text
                  x={polyRoom.current.x + 12} y={polyRoom.current.y - 8}
                  text={verts.length < 3 ? `${verts.length}/3+ pts` : (polyCloseSnap ? 'Click to close' : 'Dbl-click to close')}
                  fontSize={10} fill={polyCloseSnap ? '#52c41a' : '#1890ff'}
                  listening={false}
                />
              </Group>
            );
          })()}
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
            const isWallSelected = selectedId === wall.id && activeTool === 'select';
            return (
              <Group key={wall.id}>
                <Line
                  points={[wall.start.x, wall.start.y, wall.end.x, wall.end.y]}
                  stroke={isWallSelected ? '#1890ff' : '#333'}
                  strokeWidth={wall.thickness}
                  lineCap="round"
                  onMouseDown={(e) => { e.cancelBubble = true; }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (isWallSelected) {
                      handleWallDblClick(wall.id);
                    } else {
                      setSelectedId(wall.id);
                    }
                  }}
                  hitStrokeWidth={14}
                />
                {/* Endpoints (static when not selected) */}
                {!isWallSelected && (
                  <>
                    <Circle x={wall.start.x} y={wall.start.y} radius={3} fill="#666" />
                    <Circle x={wall.end.x} y={wall.end.y} radius={3} fill="#666" />
                  </>
                )}
                {/* Draggable endpoint handles (when selected) */}
                {isWallSelected && (
                  <>
                    <Circle
                      x={wall.start.x} y={wall.start.y}
                      radius={6} fill="#fff" stroke="#1890ff" strokeWidth={2}
                      draggable
                      onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'move'; }}
                      onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      onDragMove={(e) => {
                        const oldPos = wall.start;
                        let pos = settings.snapToGrid
                          ? snapToGrid({ x: e.target.x(), y: e.target.y() }, gridPx)
                          : { x: e.target.x(), y: e.target.y() };
                        pos = snapToWallEndpoints(pos, walls, wall.id);
                        e.target.position(pos);
                        api.updateWall(wall.id, { start: pos });
                        // Sync room vertices
                        for (const rm of rooms) {
                          const vi = rm.boundary.findIndex(p => Math.abs(p.x - oldPos.x) < 2 && Math.abs(p.y - oldPos.y) < 2);
                          if (vi >= 0) { const b = [...rm.boundary]; b[vi] = pos; updateRoom(rm.id, b); }
                        }
                      }}
                    />
                    <Circle
                      x={wall.end.x} y={wall.end.y}
                      radius={6} fill="#fff" stroke="#1890ff" strokeWidth={2}
                      draggable
                      onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'move'; }}
                      onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      onDragMove={(e) => {
                        const oldPos = wall.end;
                        let pos = settings.snapToGrid
                          ? snapToGrid({ x: e.target.x(), y: e.target.y() }, gridPx)
                          : { x: e.target.x(), y: e.target.y() };
                        pos = snapToWallEndpoints(pos, walls, wall.id);
                        e.target.position(pos);
                        api.updateWall(wall.id, { end: pos });
                        // Sync room vertices
                        for (const rm of rooms) {
                          const vi = rm.boundary.findIndex(p => Math.abs(p.x - oldPos.x) < 2 && Math.abs(p.y - oldPos.y) < 2);
                          if (vi >= 0) { const b = [...rm.boundary]; b[vi] = pos; updateRoom(rm.id, b); }
                        }
                      }}
                    />
                  </>
                )}
                {/* Dimension label moved to top-most layer */}
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
              isResizable={activeTool === 'select'}
              onSelect={() => setSelectedId(fix.id)}
              onDragEnd={(pos) => api.updateFixture(fix.id, { position: pos })}
              onResize={(w, h) => api.updateFixture(fix.id, { dimensions: { width: w, height: h } })}
              onRotate={(deg) => api.updateFixture(fix.id, { rotation: deg })}
            />
          ))}
        </Layer>

        {/* ── Dimension Labels Layer (top-most, but non-interactive when fixture selected) ── */}
        <Layer listening={!fixtures.some(f => f.id === selectedId)}>
          {/* Wall dimension labels */}
          {walls.map((wall) => {
            const lenIn = (calcWallLengthPx(wall) / ppf) * 12;
            if (!settings.showDimensions || lenIn <= 6 || editingWallId === wall.id) return null;
            const mid = wallMidpoint(wall);
            return (
              <Group key={`wdim-${wall.id}`}>
                <Rect
                  x={mid.x - 30} y={mid.y - 24}
                  width={60} height={20}
                  fill="rgba(255,255,255,0.9)" cornerRadius={3}
                  stroke="#1890ff" strokeWidth={0.5}
                  onMouseDown={(e) => { e.cancelBubble = true; }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedId(wall.id);
                    handleWallDblClick(wall.id);
                  }}
                  onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'text'; }}
                  onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                />
                <Text
                  x={mid.x - 30} y={mid.y - 21}
                  width={60} text={fmtInches(lenIn)}
                  fontSize={11} fill="#1890ff" fontStyle="bold" align="center"
                  listening={false}
                />
              </Group>
            );
          })}
          {/* Room edge dimension labels (when room has no separate walls) */}
          {settings.showDimensions && rooms.map((room) => {
            return room.boundary.map((pt, idx) => {
              const nIdx = (idx + 1) % room.boundary.length;
              const npt = room.boundary[nIdx];
              const edgeLenPx = dist(pt, npt);
              const edgeIn = Math.round((edgeLenPx / ppf) * 12);
              if (edgeIn <= 6) return null;
              // Skip if a wall already covers this edge (within 4px tolerance)
              const hasWall = walls.some(w => {
                const matchStart = (dist(w.start, pt) < 4 && dist(w.end, npt) < 4);
                const matchReverse = (dist(w.start, npt) < 4 && dist(w.end, pt) < 4);
                return matchStart || matchReverse;
              });
              if (hasWall) return null;
              const mx = (pt.x + npt.x) / 2;
              const my = (pt.y + npt.y) / 2;
              const isH = Math.abs(npt.y - pt.y) < Math.abs(npt.x - pt.x);
              // Determine which room edge: top/bottom/left/right
              const edgeType: 'width' | 'depth' = isH ? 'width' : 'depth';
              const isEditing = editingRoomEdge?.roomId === room.id && editingRoomEdge?.edgeIdx === idx;
              if (isEditing) return null;
              const lx = isH ? mx - 30 : mx - 46;
              const ly = isH ? my - 24 : my - 10;
              return (
                <Group key={`rdim-${room.id}-${idx}`}>
                  <Rect
                    x={lx} y={ly}
                    width={60} height={20}
                    fill="rgba(255,255,255,0.9)" cornerRadius={3}
                    stroke="#1890ff" strokeWidth={0.5}
                    onMouseDown={(e) => { e.cancelBubble = true; }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      setSelectedId(room.id);
                      handleRoomEdgeEdit(room.id, idx, edgeType);
                    }}
                    onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = 'text'; }}
                    onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = 'default'; }}
                  />
                  <Text
                    x={lx} y={ly + 3}
                    width={60} text={fmtInches(edgeIn)}
                    fontSize={11} fill="#1890ff" fontStyle="bold" align="center"
                    listening={false}
                  />
                </Group>
              );
            });
          })}
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
  onRotate: (degrees: number) => void;
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
  onRotate,
}) => {
  const trTargetRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const wPx = (fix.dimensions.width / 12) * ppf;
  const hPx = (fix.dimensions.height / 12) * ppf;
  const shape = getFixtureShape(
    fix.type,
    fix.properties.bathtubSubType as BathtubSubType | undefined,
    fix.properties.sinkCount,
  );

  // Attach transformer to the standalone Rect; re-sync on dimension/rotation change
  useEffect(() => {
    if (isSelected && isResizable && trRef.current && trTargetRef.current) {
      // Ensure target rect matches current fixture state
      const node = trTargetRef.current;
      node.position({ x: fix.position.x, y: fix.position.y });
      node.width(wPx);
      node.height(hPx);
      node.offsetX(wPx / 2);
      node.offsetY(hPx / 2);
      node.rotation(fix.rotation);
      node.scaleX(1);
      node.scaleY(1);
      trRef.current.nodes([node]);
      trRef.current.forceUpdate();
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, isResizable, wPx, hPx, fix.position.x, fix.position.y, fix.rotation]);

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
        onDragEnd({ x: e.target.x(), y: e.target.y() });
      }}
    >
      {/* Hit area rect */}
      <Rect
        x={-wPx / 2}
        y={-hPx / 2}
        width={wPx}
        height={hPx}
        fill="transparent"
        stroke="transparent"
      />

      {/* SVG shape paths (normalized 0-1, scaled to fixture pixel size) */}
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
          strokeScaleEnabled={false}
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

      {/* Selection border (non-resizable mode) */}
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

    {/* Transformer target — standalone Rect at absolute coords, outside Group */}
    {isSelected && isResizable && (
      <>
        <Rect
          ref={trTargetRef}
          x={fix.position.x}
          y={fix.position.y}
          width={wPx}
          height={hPx}
          offsetX={wPx / 2}
          offsetY={hPx / 2}
          rotation={fix.rotation}
          fill="transparent"
          stroke="transparent"
          listening={false}
          onTransformEnd={() => {
            const node = trTargetRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newW = Math.round((wPx * scaleX / ppf) * 12);
            const newH = Math.round((hPx * scaleY / ppf) * 12);
            const rawDeg = node.rotation();
            const snappedDeg = Math.round(rawDeg / 15) * 15;
            // Capture the new center position (Transformer may have shifted it)
            const newPos = { x: node.x(), y: node.y() };
            // Reset transform state
            node.scaleX(1);
            node.scaleY(1);
            // Apply rotation
            if (Math.abs(snappedDeg - fix.rotation) > 0.5) {
              onRotate(snappedDeg % 360);
            }
            // Update position to where Transformer left it
            onDragEnd(newPos);
            // Apply resize
            const finalH = (fix.type === 'window' || fix.type === 'mirror') ? fix.dimensions.height : Math.max(12, Math.min(120, newH));
            if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01) {
              onResize(
                Math.max(12, Math.min(120, newW)),
                finalH,
              );
            }
          }}
        />
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          rotationSnaps={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]}
          keepRatio={fix.type === 'toilet' || fix.type === 'light'}
          enabledAnchors={
            fix.type === 'toilet' || fix.type === 'light'
              ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
              : fix.type === 'window' || fix.type === 'mirror'
              ? ['middle-left', 'middle-right']
              : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
          }
          boundBoxFunc={(oldBox, newBox) => {
            const minPx = ppf * 0.5;
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
      </>
    )}
    </>
  );
});

export default BESketchCanvas;
