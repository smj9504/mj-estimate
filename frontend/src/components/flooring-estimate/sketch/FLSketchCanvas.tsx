/**
 * The drawing surface of the flooring sketch.
 *
 * Everything is kept in feet. The stage itself is never scaled or moved:
 * `view` (pixels per foot and an offset) maps feet to pixels as each shape
 * is drawn, so a pointer position, a label's place and an overlaid input
 * box are all in the same plain canvas pixels.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Ellipse, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type {
  FixtureType,
  FtPoint,
  SketchCabinetRun,
  SketchFixture,
  SketchLevel,
  SketchOpening,
  SketchRoom,
  SketchWall,
} from '../../../types/flooringEstimate';
import { formatFeet, formatSf, parseFeet } from './utils/dimensions';
import {
  WALL_T, bbox, centroid, constrainAngle, distance, edgesOf, isWindow, measureRoom, moveVertex, offsetPolygon,
  insertVertex, pointInPolygon, projectOnSegment, rectPoints, removeVertex, resizeEdge, roomAcross, snapLines,
  snapPoint, snapShift, spanOnEdge, translate, wallAt, type Edge,
} from './utils/geometry';
import { FIXTURE_LABELS } from './utils/sketchOps';
import { midpoint, pinchView, spread, zoomAround, type Px, type View as ViewState } from './utils/view';

export type SketchTool =
  | 'select' | 'pan' | 'rect' | 'polygon' | 'opening' | 'window' | 'openwall' | 'wall' | 'cabinet' | 'fixture';

export type Selection =
  | { kind: 'room' | 'opening' | 'cabinet' | 'fixture' | 'wall'; id: string }
  | null;

export type CanvasAction =
  | { type: 'addRoom'; points: FtPoint[] }
  | { type: 'roomPoints'; roomId: string; points: FtPoint[] }
  | { type: 'moveRoom'; roomId: string; dx: number; dy: number }
  | { type: 'addOpening'; opening: Omit<SketchOpening, 'id'> }
  | { type: 'moveOpening'; id: string; a: FtPoint; b: FtPoint }
  | { type: 'addCabinetRun'; run: Omit<SketchCabinetRun, 'id'> }
  | { type: 'moveCabinetRun'; id: string; a: FtPoint; b: FtPoint }
  | { type: 'addWall'; wall: Omit<SketchWall, 'id' | 'thickness'> }
  | { type: 'addFixture'; fixtureType: FixtureType; at: FtPoint }
  | { type: 'moveFixture'; id: string; x: number; y: number };

type View = ViewState;

type Drag =
  | { kind: 'pan'; start: Px; view: View }
  | { kind: 'rect'; start: FtPoint; current: FtPoint }
  | { kind: 'room'; roomId: string; start: FtPoint; dx: number; dy: number; moved: boolean }
  | { kind: 'vertex'; roomId: string; index: number; base: FtPoint[]; points: FtPoint[]; moved: boolean; inserted: boolean }
  | { kind: 'opening'; id: string; edge: Edge; width: number; a: FtPoint; b: FtPoint; moved: boolean }
  | { kind: 'cabinet-new'; roomId: string; edge: Edge; from: number; to: number }
  | { kind: 'wall-new'; roomId: string; edge: Edge; start: FtPoint; end: FtPoint }
  | { kind: 'cabinet'; id: string; edge: Edge; width: number; a: FtPoint; b: FtPoint; moved: boolean }
  | { kind: 'fixture'; id: string; offset: FtPoint; x: number; y: number; moved: boolean };

interface EdgeEdit {
  roomId: string;
  index: number;
  px: Px;
  value: string;
}

export interface FLSketchCanvasProps {
  level: SketchLevel;
  tool: SketchTool;
  fixtureType: FixtureType;
  selection: Selection;
  width: number;
  height: number;
  readOnly?: boolean;
  /** Bumped to fit the drawing in view */
  fitSignal: number;
  /** Bumped with a factor to zoom about the middle */
  zoomRequest: { factor: number; n: number };
  onSelect: (selection: Selection) => void;
  onAction: (action: CanvasAction) => void;
  /** The tool is done with one shape: back to select */
  onToolDone: () => void;
}

// ── Look ──
const COLORS = {
  background: '#ffffff',
  gridMinor: '#f0f0f0',
  gridMajor: '#d9d9d9',
  wall: '#2d3748',
  floor: '#f5f1e8',
  floorHover: '#efe7d6',
  selected: '#1677ff',
  label: '#1a2332',
  dim: '#4a5568',
  cabinet: '#d9d4c7',
  fixture: '#ffffff',
  preview: '#1677ff',
};

const DOOR_KINDS = new Set(['door', 'exterior_door']);
const DEFAULT_OPENING_FT = 3;
const DEFAULT_WINDOW_FT = 3;
/** A wall tool click without a drag: a wall this long, square to the wall clicked */
const DEFAULT_WALL_FT = 2;
const MIN_ROOM_FT = 1;

const flat = (pts: Px[]) => pts.flatMap((p) => [p.x, p.y]);

/** The wall of its first room an opening (or cabinet run) sits on */
function edgeUnder(points: FtPoint[], a: FtPoint, b: FtPoint): Edge | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let best: { edge: Edge; dist: number } | null = null;
  for (const edge of edgesOf(points)) {
    const d = projectOnSegment(mid, edge.a, edge.b).dist;
    if (!best || d < best.dist) best = { edge, dist: d };
  }
  return best?.edge ?? null;
}

const along = (edge: Edge, p: FtPoint) =>
  (p.x - edge.a.x) * edge.dir.x + (p.y - edge.a.y) * edge.dir.y;

const FLSketchCanvas: React.FC<FLSketchCanvasProps> = ({
  level, tool, fixtureType, selection, width, height, readOnly = false,
  fitSignal, zoomRequest, onSelect, onAction, onToolDone,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const [view, setView] = useState<View>({ scale: 20, x: 40, y: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pointer, setPointer] = useState<FtPoint | null>(null);
  const [polygon, setPolygon] = useState<FtPoint[]>([]);
  const [typedLength, setTypedLength] = useState('');
  const [edgeEdit, setEdgeEdit] = useState<EdgeEdit | null>(null);
  const edgeCommitted = useRef<EdgeEdit | null>(null);
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);

  const rooms = level.rooms;
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const toPx = useCallback((p: FtPoint): Px => ({ x: p.x * view.scale + view.x, y: p.y * view.scale + view.y }), [view]);
  const toFt = useCallback((p: Px): FtPoint => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }), [view]);
  const tolerance = 10 / view.scale;
  const grid = view.scale >= 50 ? 1 / 12 : view.scale >= 25 ? 0.25 : 0.5;

  // ── Fit and zoom ──
  const fit = useCallback(() => {
    const pts = rooms.flatMap((r) => offsetPolygon(r.points, WALL_T));
    const box = pts.length ? bbox(pts) : { minX: 0, minY: 0, width: 40, height: 30 };
    const pad = 60;
    const scale = Math.max(4, Math.min(80,
      Math.min((width - pad * 2) / Math.max(box.width, 10), (height - pad * 2) / Math.max(box.height, 8))));
    setView({
      scale,
      x: (width - box.width * scale) / 2 - box.minX * scale,
      y: (height - box.height * scale) / 2 - box.minY * scale,
    });
  }, [rooms, width, height]);

  // Fit when asked, and when another level (or the first drawing) comes in
  const fittedLevel = useRef<string | null>(null);
  useEffect(() => {
    if (fittedLevel.current !== level.id && width > 0) {
      fittedLevel.current = level.id;
      fit();
    }
  }, [level.id, width, fit]);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  const zoomAt = useCallback((factor: number, at: Px) => setView((v) => zoomAround(v, factor, at)), []);

  // ── Two fingers zoom and pan (tracked on the wrapper, ahead of the shapes) ──
  const fingers = useRef(new Map<number, Px>());
  const pinch = useRef<{ view: View; center: Px; distance: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const local = (e: React.PointerEvent): Px => {
    const box = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  };
  const onFingerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    fingers.current.set(e.pointerId, local(e));
    if (fingers.current.size === 2) {
      const [a, b] = Array.from(fingers.current.values());
      pinch.current = { view, center: midpoint(a, b), distance: spread(a, b) };
      // Whatever the first finger started is dropped
      setDrag(null);
    }
  };
  const onFingerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, local(e));
    const start = pinch.current;
    if (start && fingers.current.size >= 2) {
      const [a, b] = Array.from(fingers.current.values());
      setView(pinchView(start.view, start.center, start.distance, midpoint(a, b), spread(a, b)));
    }
  };
  const onFingerUp = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
  };
  useEffect(() => {
    if (zoomRequest.n) zoomAt(zoomRequest.factor, { x: width / 2, y: height / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest.n]);

  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    // Ctrl/Cmd + wheel (and a trackpad pinch) zooms; a plain wheel scrolls the page
    if (!e.evt.ctrlKey && !e.evt.metaKey) return;
    e.evt.preventDefault();
    const at = stageRef.current?.getPointerPosition();
    if (at) zoomAt(e.evt.deltaY < 0 ? 1.1 : 1 / 1.1, at);
  }, [zoomAt]);

  // Leaving a drawing tool drops what was half drawn
  useEffect(() => {
    if (tool !== 'polygon') {
      setPolygon([]);
      setTypedLength('');
    }
  }, [tool]);

  const pointerFt = useCallback((): FtPoint | null => {
    const p = stageRef.current?.getPointerPosition();
    return p ? toFt(p) : null;
  }, [toFt]);

  const snapped = useCallback((p: FtPoint) => snapPoint(p, rooms, tolerance, grid), [rooms, tolerance, grid]);

  // ── Polygon drawing ──
  const nextPolygonPoint = useCallback((raw: FtPoint, free: boolean): FtPoint => {
    const last = polygon[polygon.length - 1];
    let p = snapped(raw);
    if (last && !free) p = constrainAngle(last, p);
    return p;
  }, [polygon, snapped]);

  const closePolygon = useCallback((points: FtPoint[]) => {
    // A double-click lands its first click as a corner too: drop repeats
    const corners = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0.01);
    if (corners.length >= 3) {
      onAction({ type: 'addRoom', points: corners });
      onToolDone();
    }
    setPolygon([]);
    setTypedLength('');
  }, [onAction, onToolDone]);

  const addPolygonPoint = useCallback((p: FtPoint) => {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (last && distance(last, p) <= 0.01) return;
    if (polygon.length >= 3 && first && distance(first, p) <= tolerance * 1.5) {
      closePolygon(polygon);
      return;
    }
    setPolygon((pts) => [...pts, p]);
  }, [polygon, tolerance, closePolygon]);

  /** A typed wall length: the next corner goes that far toward the pointer */
  const applyTypedLength = useCallback(() => {
    const length = parseFeet(typedLength);
    const last = polygon[polygon.length - 1];
    if (!length || !last) return;
    const toward = pointer ? constrainAngle(last, pointer) : { x: last.x + 1, y: last.y };
    const d = distance(last, toward) || 1;
    addPolygonPoint({ x: last.x + ((toward.x - last.x) / d) * length, y: last.y + ((toward.y - last.y) / d) * length });
    setTypedLength('');
  }, [typedLength, polygon, pointer, addPolygonPoint]);

  // Keys while drawing: Enter closes, Escape drops, Backspace takes back a corner
  useEffect(() => {
    if (tool !== 'polygon') return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        setPolygon([]);
        setTypedLength('');
      } else if (e.key === 'Enter' && !typedLength && polygon.length >= 3) {
        closePolygon(polygon);
      } else if (e.key === 'Backspace' && !typing && polygon.length) {
        e.preventDefault();
        setPolygon((pts) => pts.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, polygon, typedLength, closePolygon]);

  // ── Pointer ──
  const startOnBackground = useCallback((e: KonvaEventObject<PointerEvent>) => {
    if (readOnly || fingers.current.size >= 2) return;
    const p = pointerFt();
    const px = stageRef.current?.getPointerPosition();
    if (!p || !px) return;
    setEdgeEdit(null);
    switch (tool) {
      case 'rect': {
        const s = snapped(p);
        setDrag({ kind: 'rect', start: s, current: s });
        return;
      }
      case 'polygon':
        addPolygonPoint(nextPolygonPoint(p, e.evt.altKey));
        return;
      case 'opening': {
        const hit = wallAt(rooms, p, tolerance);
        if (!hit) return;
        const span = spanOnEdge(hit.edge, hit.t * hit.edge.length, DEFAULT_OPENING_FT);
        const other = roomAcross(rooms, hit.roomId, hit.edge, span.a, span.b);
        onAction({
          type: 'addOpening',
          opening: other
            ? { kind: 'door', rooms: [hit.roomId, other], ...span, swing: other, hinge: 'a' }
            : { kind: 'exterior_door', rooms: [hit.roomId, null], ...span, swing: hit.roomId, hinge: 'a' },
        });
        onToolDone();
        return;
      }
      case 'window': {
        // In the wall clicked, between the rooms either side of it (or the outside)
        const hit = wallAt(rooms, p, tolerance);
        if (!hit) return;
        const span = spanOnEdge(hit.edge, hit.t * hit.edge.length, DEFAULT_WINDOW_FT);
        const other = roomAcross(rooms, hit.roomId, hit.edge, span.a, span.b);
        onAction({ type: 'addOpening', opening: { kind: 'window', rooms: [hit.roomId, other], ...span } });
        onToolDone();
        return;
      }
      case 'openwall': {
        // The whole side, with no wall on it
        const hit = wallAt(rooms, p, tolerance);
        if (!hit) return;
        const { a, b } = hit.edge;
        const other = roomAcross(rooms, hit.roomId, hit.edge, a, b);
        onAction({ type: 'addOpening', opening: { kind: 'open_wall', rooms: [hit.roomId, other], a, b } });
        onToolDone();
        return;
      }
      case 'wall': {
        const hit = wallAt(rooms, p, tolerance);
        if (!hit) return;
        setDrag({ kind: 'wall-new', roomId: hit.roomId, edge: hit.edge, start: hit.point, end: hit.point });
        return;
      }
      case 'cabinet': {
        const hit = wallAt(rooms, p, tolerance);
        if (!hit) return;
        const s = hit.t * hit.edge.length;
        setDrag({ kind: 'cabinet-new', roomId: hit.roomId, edge: hit.edge, from: s, to: s });
        return;
      }
      case 'fixture': {
        onAction({ type: 'addFixture', fixtureType, at: { x: snapTo2(p.x), y: snapTo2(p.y) } });
        onToolDone();
        return;
      }
      default:
        // Select or pan: the empty canvas pans, and drops the selection
        if (tool === 'select') onSelect(null);
        setDrag({ kind: 'pan', start: px, view });
    }
  }, [readOnly, pointerFt, tool, snapped, addPolygonPoint, nextPolygonPoint, rooms, tolerance, onAction,
    onToolDone, fixtureType, onSelect, view]);

  const handleMove = useCallback((e: KonvaEventObject<PointerEvent>) => {
    const p = pointerFt();
    if (!p) return;
    setPointer(p);
    if (!drag) {
      if (tool === 'select') {
        setHoverRoom(rooms.find((r) => pointInPolygon(p, r.points))?.id ?? null);
      }
      return;
    }
    switch (drag.kind) {
      case 'pan': {
        const px = stageRef.current?.getPointerPosition();
        if (px) setView({ ...drag.view, x: drag.view.x + px.x - drag.start.x, y: drag.view.y + px.y - drag.start.y });
        return;
      }
      case 'rect':
        setDrag({ ...drag, current: snapped(p) });
        return;
      case 'room': {
        const room = roomById.get(drag.roomId);
        if (!room) return;
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        const lines = snapLines(rooms, room.id);
        const moved = translate(room.points, dx, dy);
        const sx = snapShift(moved.map((q) => q.x), lines.xs, tolerance);
        const sy = snapShift(moved.map((q) => q.y), lines.ys, tolerance);
        dx += sx ?? 0;
        dy += sy ?? 0;
        setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 0.01 });
        return;
      }
      case 'vertex': {
        if (pinch.current) return;
        const others = rooms.filter((r) => r.id !== drag.roomId);
        const q = e.evt.shiftKey ? p : snapPoint(p, others, tolerance, grid);
        setDrag({ ...drag, points: moveVertex(drag.base, drag.index, q), moved: true });
        return;
      }
      case 'opening':
      case 'cabinet': {
        const s = along(drag.edge, p);
        const span = spanOnEdge(drag.edge, s, drag.width);
        setDrag({ ...drag, ...span, moved: true });
        return;
      }
      case 'cabinet-new':
        setDrag({ ...drag, to: Math.max(0, Math.min(drag.edge.length, along(drag.edge, p))) });
        return;
      case 'wall-new': {
        // Level, upright or 45° unless Alt is held; its length on the grid
        const q = e.evt.altKey ? p : constrainAngle(drag.start, p);
        const len = distance(drag.start, q);
        const k = len > 0 ? Math.round(len / grid) * grid / len : 0;
        setDrag({ ...drag, end: { x: drag.start.x + (q.x - drag.start.x) * k, y: drag.start.y + (q.y - drag.start.y) * k } });
        return;
      }
      case 'fixture':
        setDrag({ ...drag, x: snapTo2(p.x - drag.offset.x), y: snapTo2(p.y - drag.offset.y), moved: true });
        return;
      default:
    }
  }, [pointerFt, drag, tool, rooms, roomById, snapped, tolerance, grid]);

  const handleUp = useCallback(() => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    switch (d.kind) {
      case 'rect': {
        const w = Math.abs(d.current.x - d.start.x);
        const h = Math.abs(d.current.y - d.start.y);
        if (w >= MIN_ROOM_FT && h >= MIN_ROOM_FT) {
          onAction({ type: 'addRoom', points: rectPoints(Math.min(d.start.x, d.current.x), Math.min(d.start.y, d.current.y), w, h) });
          onToolDone();
        }
        return;
      }
      case 'room':
        if (d.moved) onAction({ type: 'moveRoom', roomId: d.roomId, dx: d.dx, dy: d.dy });
        return;
      case 'vertex':
        // A corner only clicked (or a wall's middle only tapped) changes nothing
        if (d.moved) onAction({ type: 'roomPoints', roomId: d.roomId, points: d.points });
        return;
      case 'opening':
        if (d.moved) onAction({ type: 'moveOpening', id: d.id, a: d.a, b: d.b });
        return;
      case 'cabinet':
        if (d.moved) onAction({ type: 'moveCabinetRun', id: d.id, a: d.a, b: d.b });
        return;
      case 'cabinet-new': {
        let from = Math.min(d.from, d.to);
        let to = Math.max(d.from, d.to);
        // A click is a 6' run there
        if (to - from < 0.5) {
          const span = spanOnEdge(d.edge, from, 6);
          from = along(d.edge, span.a);
          to = along(d.edge, span.b);
        }
        const at = (s: number) => ({ x: d.edge.a.x + d.edge.dir.x * s, y: d.edge.a.y + d.edge.dir.y * s });
        onAction({ type: 'addCabinetRun', run: { room_id: d.roomId, a: at(from), b: at(to) } });
        onToolDone();
        return;
      }
      case 'fixture':
        if (d.moved) onAction({ type: 'moveFixture', id: d.id, x: d.x, y: d.y });
        return;
      case 'wall-new': {
        let { start, end } = d;
        // A click is a short wall square to the wall clicked, into its room
        if (distance(start, end) < 0.25) {
          end = { x: start.x - d.edge.normal.x * DEFAULT_WALL_FT, y: start.y - d.edge.normal.y * DEFAULT_WALL_FT };
        }
        // It belongs to the room it stands in, which may be the one across the wall clicked
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const inside = rooms.find((r) => pointInPolygon(mid, r.points));
        let roomId = d.roomId;
        if (inside && inside.id !== d.roomId) {
          roomId = inside.id;
          const near = edgesOf(inside.points)
            .map((edge) => projectOnSegment(start, edge.a, edge.b))
            .sort((x, y) => x.dist - y.dist)[0];
          if (near) start = near.point;
        }
        onAction({ type: 'addWall', wall: { room_id: roomId, a: start, b: end } });
        onToolDone();
        return;
      }
      default:
    }
  }, [drag, onAction, onToolDone, rooms]);

  // A drag ends wherever the pointer is let go, on the canvas or not
  useEffect(() => {
    if (!drag) return undefined;
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [drag, handleUp]);

  const handleDblClick = useCallback(() => {
    if (tool === 'polygon' && polygon.length >= 3) closePolygon(polygon);
  }, [tool, polygon, closePolygon]);

  // ── Shape handlers (select mode) ──
  const grabRoom = (room: SketchRoom) => (e: KonvaEventObject<PointerEvent>) => {
    if (tool !== 'select') return;
    e.cancelBubble = true;
    onSelect({ kind: 'room', id: room.id });
    const p = pointerFt();
    if (p && !readOnly) setDrag({ kind: 'room', roomId: room.id, start: p, dx: 0, dy: 0, moved: false });
  };

  const grabVertex = (room: SketchRoom, index: number) => (e: KonvaEventObject<PointerEvent>) => {
    if (tool !== 'select' || readOnly || fingers.current.size >= 2) return;
    e.cancelBubble = true;
    setDrag({ kind: 'vertex', roomId: room.id, index, base: room.points, points: room.points, moved: false, inserted: false });
  };

  /** A wall's middle handle: a new corner there, dragged to bend the wall */
  const grabMidpoint = (room: SketchRoom, edge: Edge) => (e: KonvaEventObject<PointerEvent>) => {
    if (tool !== 'select' || readOnly || fingers.current.size >= 2) return;
    e.cancelBubble = true;
    const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const base = insertVertex(room.points, edge.index, mid);
    setDrag({ kind: 'vertex', roomId: room.id, index: edge.index + 1, base, points: base, moved: false, inserted: true });
  };

  /** Double-click a corner to take it out (a room keeps three) */
  const dropVertex = (room: SketchRoom, index: number) => (e: KonvaEventObject<Event>) => {
    if (readOnly || room.points.length <= 3) return;
    e.cancelBubble = true;
    setDrag(null);
    onAction({ type: 'roomPoints', roomId: room.id, points: removeVertex(room.points, index) });
  };

  const grabSegment = (kind: 'opening' | 'cabinet', id: string, roomId: string, a: FtPoint, b: FtPoint) =>
    (e: KonvaEventObject<PointerEvent>) => {
      if (tool !== 'select') return;
      e.cancelBubble = true;
      onSelect({ kind, id });
      const room = roomById.get(roomId);
      const edge = room ? edgeUnder(room.points, a, b) : null;
      if (!edge || readOnly) return;
      setDrag({ kind, id, edge, width: distance(a, b), a, b, moved: false });
    };

  const grabWall = (w: SketchWall) => (e: KonvaEventObject<PointerEvent>) => {
    if (tool !== 'select') return;
    e.cancelBubble = true;
    onSelect({ kind: 'wall', id: w.id });
  };

  const grabFixture = (f: SketchFixture) => (e: KonvaEventObject<PointerEvent>) => {
    if (tool !== 'select') return;
    e.cancelBubble = true;
    onSelect({ kind: 'fixture', id: f.id });
    const p = pointerFt();
    if (p && !readOnly) setDrag({ kind: 'fixture', id: f.id, offset: { x: p.x - f.x, y: p.y - f.y }, x: f.x, y: f.y, moved: false });
  };

  const startEdgeEdit = (room: SketchRoom, edge: Edge, px: Px) => (e: KonvaEventObject<Event>) => {
    if (readOnly) return;
    e.cancelBubble = true;
    onSelect({ kind: 'room', id: room.id });
    setEdgeEdit({ roomId: room.id, index: edge.index, px, value: formatFeet(edge.length) });
  };

  const commitEdgeEdit = () => {
    // Enter closes the box and its blur follows: only the first counts
    if (!edgeEdit || edgeCommitted.current === edgeEdit) return;
    edgeCommitted.current = edgeEdit;
    const room = roomById.get(edgeEdit.roomId);
    const length = parseFeet(edgeEdit.value);
    setEdgeEdit(null);
    if (!room || !length) return;
    const points = resizeEdge(room.points, edgeEdit.index, length);
    if (points) onAction({ type: 'roomPoints', roomId: room.id, points });
  };

  // ── What is drawn, with any drag applied ──
  const shown = useMemo(() => {
    const roomPoints = new Map<string, FtPoint[]>();
    for (const r of rooms) roomPoints.set(r.id, r.points);
    if (drag?.kind === 'room') {
      const r = roomById.get(drag.roomId);
      if (r) roomPoints.set(r.id, translate(r.points, drag.dx, drag.dy));
    }
    if (drag?.kind === 'vertex') roomPoints.set(drag.roomId, drag.points);
    const shift = (roomId: string, p: FtPoint) =>
      drag?.kind === 'room' && drag.roomId === roomId ? { x: p.x + drag.dx, y: p.y + drag.dy } : p;
    const openings = level.openings.map((o) =>
      drag?.kind === 'opening' && drag.id === o.id ? { ...o, a: drag.a, b: drag.b }
        : { ...o, a: shift(o.rooms[0], o.a), b: shift(o.rooms[0], o.b) });
    const runs = level.cabinet_runs.map((c) =>
      drag?.kind === 'cabinet' && drag.id === c.id ? { ...c, a: drag.a, b: drag.b }
        : { ...c, a: shift(c.room_id, c.a), b: shift(c.room_id, c.b) });
    const fixtures = level.fixtures.map((f) => {
      if (drag?.kind === 'fixture' && drag.id === f.id) return { ...f, x: drag.x, y: drag.y };
      if (drag?.kind === 'room') {
        const r = roomById.get(drag.roomId);
        if (r && pointInPolygon(f, r.points)) return { ...f, x: f.x + drag.dx, y: f.y + drag.dy };
      }
      return f;
    });
    const walls = (level.walls ?? []).map((w) => ({ ...w, a: shift(w.room_id, w.a), b: shift(w.room_id, w.b) }));
    return { roomPoints, openings, runs, fixtures, walls };
  }, [rooms, roomById, drag, level.openings, level.cabinet_runs, level.fixtures, level.walls]);

  // ── Grid ──
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const step = view.scale >= 10 ? 1 : 5;
    const from = toFt({ x: 0, y: 0 });
    const to = toFt({ x: width, y: height });
    for (let x = Math.floor(from.x / step) * step; x <= to.x; x += step) {
      const px = x * view.scale + view.x;
      lines.push(<Line key={`gx${x}`} points={[px, 0, px, height]} stroke={x % 5 === 0 ? COLORS.gridMajor : COLORS.gridMinor} strokeWidth={1} listening={false} />);
    }
    for (let y = Math.floor(from.y / step) * step; y <= to.y; y += step) {
      const py = y * view.scale + view.y;
      lines.push(<Line key={`gy${y}`} points={[0, py, width, py]} stroke={y % 5 === 0 ? COLORS.gridMajor : COLORS.gridMinor} strokeWidth={1} listening={false} />);
    }
    return lines;
  }, [view, width, height, toFt]);

  const selectedRoom = selection?.kind === 'room' ? selection.id : null;

  // ── Openings: a gap in the wall, a leaf and its swing ──
  const renderOpening = (o: SketchOpening) => {
    const host = shown.roomPoints.get(o.rooms[0]);
    if (!host) return null;
    const edge = edgeUnder(host, o.a, o.b);
    if (!edge) return null;
    const n = edge.normal;
    const out = (p: FtPoint, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
    const gap = [o.a, o.b, out(o.b, WALL_T), out(o.a, WALL_T)].map(toPx);
    const isSelected = selection?.kind === 'opening' && selection.id === o.id;
    const w = distance(o.a, o.b);
    if (o.kind === 'open_wall') {
      // No wall: floor through it to the next room (the outside stays white), a dashed line where it would stand
      return (
        <Group key={o.id}>
          <Line points={flat(gap)} closed fill={o.rooms[1] ? COLORS.floor : '#ffffff'}
            stroke={isSelected ? COLORS.selected : undefined} strokeWidth={isSelected ? 2 : 0} hitStrokeWidth={12}
            onPointerDown={grabSegment('opening', o.id, o.rooms[0], o.a, o.b)} />
          <Line points={flat([out(o.a, WALL_T / 2), out(o.b, WALL_T / 2)].map(toPx))} stroke={COLORS.dim}
            strokeWidth={1} dash={[6, 4]} listening={false} />
        </Group>
      );
    }
    const parts: React.ReactNode[] = [
      <Line key="gap" points={flat(gap)} closed fill="#ffffff" stroke={isSelected ? COLORS.selected : COLORS.wall}
        strokeWidth={isSelected ? 2 : 0.75} hitStrokeWidth={12}
        onPointerDown={grabSegment('opening', o.id, o.rooms[0], o.a, o.b)} />,
    ];
    if (isWindow(o)) {
      // The glass, down the middle of the wall
      parts.push(<Line key="pane" points={flat([out(o.a, WALL_T / 2), out(o.b, WALL_T / 2)].map(toPx))}
        stroke={COLORS.wall} strokeWidth={1.25} listening={false} />);
      return <Group key={o.id}>{parts}</Group>;
    }
    // Into the first room, or through the wall into the other one
    const intoOther = o.swing && o.swing !== o.rooms[0];
    const base = (p: FtPoint) => (intoOther ? out(p, WALL_T) : p);
    const inward = intoOther ? n : { x: -n.x, y: -n.y };
    const hinge = base(o.hinge === 'b' ? o.b : o.a);
    const other = base(o.hinge === 'b' ? o.a : o.b);
    const toward = { x: (other.x - hinge.x) / (w || 1), y: (other.y - hinge.y) / (w || 1) };
    if (DOOR_KINDS.has(o.kind)) {
      const leaf = { x: hinge.x + inward.x * w, y: hinge.y + inward.y * w };
      const arc: FtPoint[] = [];
      for (let k = 0; k <= 12; k++) {
        const th = (Math.PI / 2) * (k / 12);
        arc.push({
          x: hinge.x + w * (Math.cos(th) * inward.x + Math.sin(th) * toward.x),
          y: hinge.y + w * (Math.cos(th) * inward.y + Math.sin(th) * toward.y),
        });
      }
      parts.push(<Line key="leaf" points={flat([hinge, leaf].map(toPx))} stroke={COLORS.wall} strokeWidth={1.5} listening={false} />);
      parts.push(<Line key="arc" points={flat(arc.map(toPx))} stroke={COLORS.dim} strokeWidth={0.75} dash={[4, 3]} listening={false} />);
    } else if (o.kind === 'bifold') {
      const zig: FtPoint[] = [];
      for (let k = 0; k <= 4; k++) {
        const s = k / 4;
        const d = k % 2 ? 0.35 : 0;
        zig.push({ x: hinge.x + (other.x - hinge.x) * s + inward.x * d, y: hinge.y + (other.y - hinge.y) * s + inward.y * d });
      }
      parts.push(<Line key="zig" points={flat(zig.map(toPx))} stroke={COLORS.wall} strokeWidth={1.25} listening={false} />);
    } else if (o.kind === 'slider' || o.kind === 'pocket') {
      const mid = out(o.a, WALL_T / 2);
      const end = out(o.b, WALL_T / 2);
      parts.push(<Line key="track" points={flat([mid, end].map(toPx))} stroke={COLORS.wall} strokeWidth={1.25}
        dash={o.kind === 'pocket' ? [4, 3] : undefined} listening={false} />);
    }
    return <Group key={o.id}>{parts}</Group>;
  };

  const renderCabinetRun = (c: SketchCabinetRun) => {
    const host = shown.roomPoints.get(c.room_id);
    if (!host) return null;
    const edge = edgeUnder(host, c.a, c.b);
    if (!edge) return null;
    const depth = 2;
    const inn = (p: FtPoint) => ({ x: p.x - edge.normal.x * depth, y: p.y - edge.normal.y * depth });
    const box = [c.a, c.b, inn(c.b), inn(c.a)].map(toPx);
    const isSelected = selection?.kind === 'cabinet' && selection.id === c.id;
    // Toward the cabinets' front, clear of the wall's length label at the back
    const front = toPx(inn({ x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }));
    const at = { x: front.x + edge.normal.x * 9, y: front.y + edge.normal.y * 9 };
    let angle = (Math.atan2(edge.dir.y, edge.dir.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    const showText = depth * view.scale >= 24 && distance(c.a, c.b) * view.scale >= 60;
    return (
      <Group key={c.id}>
        <Line points={flat(box)} closed fill={COLORS.cabinet} stroke={isSelected ? COLORS.selected : COLORS.dim}
          strokeWidth={isSelected ? 2 : 1} onPointerDown={grabSegment('cabinet', c.id, c.room_id, c.a, c.b)} />
        {showText && (
          <Group x={at.x} y={at.y} rotation={angle} listening={false}>
            <Text x={-60} y={-5} width={120} align="center" text="Base cabinets" fontSize={10} fill={COLORS.dim} />
          </Group>
        )}
      </Group>
    );
  };

  const renderWall = (wall: SketchWall) => {
    const len = distance(wall.a, wall.b);
    if (len < 1e-6) return null;
    const half = (wall.thickness || WALL_T) / 2;
    const n = { x: (-(wall.b.y - wall.a.y) / len) * half, y: ((wall.b.x - wall.a.x) / len) * half };
    const corners = [
      { x: wall.a.x + n.x, y: wall.a.y + n.y }, { x: wall.b.x + n.x, y: wall.b.y + n.y },
      { x: wall.b.x - n.x, y: wall.b.y - n.y }, { x: wall.a.x - n.x, y: wall.a.y - n.y },
    ];
    const isSelected = selection?.kind === 'wall' && selection.id === wall.id;
    return (
      <Line key={wall.id} points={flat(corners.map(toPx))} closed fill={COLORS.wall}
        stroke={isSelected ? COLORS.selected : undefined} strokeWidth={isSelected ? 2 : 0} hitStrokeWidth={10}
        onPointerDown={grabWall(wall)} />
    );
  };

  const renderFixture = (f: SketchFixture) => {
    const c = toPx(f);
    const w = f.w * view.scale;
    const h = f.h * view.scale;
    const isSelected = selection?.kind === 'fixture' && selection.id === f.id;
    return (
      <Group key={f.id} x={c.x} y={c.y} rotation={f.rotation} onPointerDown={grabFixture(f)}>
        {f.type === 'toilet' ? (
          // Tank against the wall, bowl in front: plain to see without a name
          <>
            <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill="rgba(255,255,255,0.01)" />
            <Rect x={-w / 2} y={-h / 2} width={w} height={h * 0.3} fill={COLORS.fixture}
              stroke={isSelected ? COLORS.selected : COLORS.wall} strokeWidth={isSelected ? 2 : 1} cornerRadius={2} />
            <Ellipse x={0} y={h * 0.15} radiusX={w * 0.42} radiusY={h * 0.35} fill={COLORS.fixture}
              stroke={isSelected ? COLORS.selected : COLORS.wall} strokeWidth={isSelected ? 2 : 1} />
          </>
        ) : f.type === 'pedestal_sink' ? (
          // Basin, and the pedestal under it toward the wall
          <>
            <Ellipse x={0} y={0} radiusX={w / 2} radiusY={h / 2} fill={COLORS.fixture}
              stroke={isSelected ? COLORS.selected : COLORS.wall} strokeWidth={isSelected ? 2 : 1} />
            <Ellipse x={0} y={-h * 0.08} radiusX={w * 0.3} radiusY={h * 0.26} stroke={COLORS.wall} strokeWidth={0.75} />
          </>
        ) : f.type === 'floor_register' ? (
          // A grille: the frame and its slats
          <>
            <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={COLORS.fixture}
              stroke={isSelected ? COLORS.selected : COLORS.wall} strokeWidth={isSelected ? 2 : 1} />
            {[1, 2, 3, 4, 5].map((k) => (
              <Line key={k} points={[-w / 2 + (w * k) / 6, -h * 0.32, -w / 2 + (w * k) / 6, h * 0.32]}
                stroke={COLORS.wall} strokeWidth={0.75} listening={false} />
            ))}
          </>
        ) : (
          <>
            <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={COLORS.fixture}
              stroke={isSelected ? COLORS.selected : COLORS.wall} strokeWidth={isSelected ? 2 : 1} cornerRadius={2} />
            {f.type === 'utility_sink' && (
              <Rect x={-w * 0.38} y={-h * 0.24} width={w * 0.76} height={h * 0.62} stroke={COLORS.wall}
                strokeWidth={0.75} cornerRadius={3} listening={false} />
            )}
          </>
        )}
        {/* Its name, where it fits on one line */}
        {!['toilet', 'pedestal_sink', 'floor_register'].includes(f.type)
          && FIXTURE_LABELS[f.type].length * fixtureFont(w) * 0.6 <= w - 4 && (
          <Text x={-w / 2} y={-5} width={w} align="center" text={FIXTURE_LABELS[f.type]} fontSize={fixtureFont(w)}
            wrap="none" fill={COLORS.dim} listening={false} />
        )}
      </Group>
    );
  };

  // ── Rooms ──
  const roomLayer = rooms.map((room) => {
    const pts = shown.roomPoints.get(room.id) ?? room.points;
    const isSelected = selectedRoom === room.id;
    return (
      <Line key={room.id} points={flat(pts.map(toPx))} closed
        fill={hoverRoom === room.id && tool === 'select' && !isSelected ? COLORS.floorHover : COLORS.floor}
        stroke={isSelected ? COLORS.selected : undefined} strokeWidth={isSelected ? 2 : 0} dash={isSelected ? [6, 4] : undefined}
        onPointerDown={grabRoom(room)} />
    );
  });

  const walls = rooms.map((room) => {
    const pts = shown.roomPoints.get(room.id) ?? room.points;
    return <Line key={`w-${room.id}`} points={flat(offsetPolygon(pts, WALL_T).map(toPx))} closed fill={COLORS.wall} listening={false} />;
  });

  const labels = rooms.flatMap((room) => {
    const pts = shown.roomPoints.get(room.id) ?? room.points;
    const c = toPx(centroid(pts));
    const m = measureRoom({ ...level, rooms }, { ...room, points: pts });
    const box = bbox(pts);
    const wPx = box.width * view.scale;
    const hPx = box.height * view.scale;
    const nameSize = Math.max(9, Math.min(13, view.scale * 0.5));
    const areaSize = Math.max(8, nameSize - 2);
    const nodes: React.ReactNode[] = [];
    if (wPx < 100 && hPx > wPx * 1.5) {
      // A hall: the name runs along it
      nodes.push(
        <Group key={`n-${room.id}`} x={c.x} y={c.y} rotation={-90} listening={false}>
          <Text x={-80} y={-nameSize - 1} width={160} align="center" text={room.name} fontSize={nameSize} fontStyle="bold" fill={COLORS.label} />
          <Text x={-80} y={1} width={160} align="center" text={formatSf(m.floorSf)} fontSize={areaSize} fill={COLORS.dim} />
        </Group>,
      );
    } else if (hPx < 64) {
      // A closet: one line, clear of the walls' lengths above and below it
      nodes.push(
        <Text key={`n-${room.id}`} x={c.x - 90} y={c.y - areaSize / 2} width={180} align="center"
          text={`${room.name} · ${formatSf(m.floorSf)}`} fontSize={areaSize} fill={COLORS.label} listening={false} />,
      );
    } else {
      nodes.push(
        <Text key={`n-${room.id}`} x={c.x - 80} y={c.y - nameSize - 1} width={160} align="center" text={room.name}
          fontSize={nameSize} fontStyle="bold" fill={COLORS.label} listening={false} />,
        <Text key={`a-${room.id}`} x={c.x - 80} y={c.y + 2} width={160} align="center" text={formatSf(m.floorSf)}
          fontSize={areaSize} fill={COLORS.dim} listening={false} />,
      );
    }
    // Zoomed far out (a whole house on a phone) only the selected room's walls are labelled
    if (view.scale < 14 && selectedRoom !== room.id) return nodes;
    // Each wall's length, just inside it; double-click (or tap) to type a new one
    for (const edge of edgesOf(pts)) {
      const lenPx = edge.length * view.scale;
      if (lenPx < 40) continue;
      // Across a shallow room (a closet) the two walls' lengths and the name
      // would sit on each other: those show when the room is selected
      const across = Math.abs(edge.dir.x) > Math.abs(edge.dir.y) ? hPx : wPx;
      if (across < 64 && selectedRoom !== room.id) continue;
      const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
      const at = toPx(mid);
      const inset = 11;
      const px = { x: at.x - edge.normal.x * inset, y: at.y - edge.normal.y * inset };
      let angle = (Math.atan2(edge.dir.y, edge.dir.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle <= -90) angle += 180;
      const text = formatFeet(edge.length);
      const onEdit = startEdgeEdit(room, edge, px);
      nodes.push(
        <Group key={`d-${room.id}-${edge.index}`} x={px.x} y={px.y} rotation={angle}
          onDblClick={onEdit} onDblTap={onEdit}>
          <Rect x={-30} y={-7} width={60} height={14} fill="rgba(255,255,255,0.01)" />
          <Text x={-30} y={-6} width={60} align="center" text={text} fontSize={11} fill={COLORS.dim} />
        </Group>,
      );
    }
    return nodes;
  });

  const handles = (() => {
    if (!selectedRoom || readOnly || tool !== 'select') return null;
    const pts = shown.roomPoints.get(selectedRoom);
    const room = roomById.get(selectedRoom);
    if (!pts || !room) return null;
    const mids = drag?.kind === 'vertex' ? [] : edgesOf(pts)
      .filter((edge) => edge.length * view.scale >= 48)
      .map((edge) => {
        const q = toPx({ x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 });
        return (
          <Circle key={`m${edge.index}`} x={q.x} y={q.y} radius={4.5} fill={COLORS.selected} opacity={0.55}
            stroke="#ffffff" strokeWidth={1} name="midpoint-handle" onPointerDown={grabMidpoint(room, edge)} />
        );
      });
    const corners = pts.map((p, i) => {
      const q = toPx(p);
      return (
        <Rect key={`h${i}`} x={q.x - 5} y={q.y - 5} width={10} height={10} fill="#ffffff" stroke={COLORS.selected}
          strokeWidth={1.5} name="corner-handle" onPointerDown={grabVertex(room, i)}
          onDblClick={dropVertex(room, i)} onDblTap={dropVertex(room, i)} />
      );
    });
    return [...mids, ...corners];
  })();

  // ── Previews ──
  const previews: React.ReactNode[] = [];
  if (drag?.kind === 'rect') {
    const x = Math.min(drag.start.x, drag.current.x);
    const y = Math.min(drag.start.y, drag.current.y);
    const w = Math.abs(drag.current.x - drag.start.x);
    const h = Math.abs(drag.current.y - drag.start.y);
    const tl = toPx({ x, y });
    previews.push(
      <Rect key="pr" x={tl.x} y={tl.y} width={w * view.scale} height={h * view.scale} stroke={COLORS.preview}
        dash={[6, 4]} strokeWidth={1.5} listening={false} />,
      <Text key="pt" x={tl.x} y={tl.y - 18} text={`${formatFeet(w)} × ${formatFeet(h)}`} fontSize={12}
        fill={COLORS.preview} listening={false} />,
    );
  }
  if (drag?.kind === 'cabinet-new') {
    const at = (s: number) => toPx({ x: drag.edge.a.x + drag.edge.dir.x * s, y: drag.edge.a.y + drag.edge.dir.y * s });
    previews.push(<Line key="pc" points={flat([at(drag.from), at(drag.to)])} stroke={COLORS.preview} strokeWidth={4} listening={false} />);
  }
  if (tool === 'polygon' && polygon.length) {
    const last = polygon[polygon.length - 1];
    const next = pointer ? nextPolygonPoint(pointer, false) : last;
    previews.push(
      <Line key="pp" points={flat([...polygon, next].map(toPx))} stroke={COLORS.preview} strokeWidth={1.5} dash={[6, 4]} listening={false} />,
      ...polygon.map((p, i) => {
        const q = toPx(p);
        return <Circle key={`pv${i}`} x={q.x} y={q.y} radius={i === 0 ? 6 : 4} stroke={COLORS.preview} fill="#fff" listening={false} />;
      }),
    );
    const q = toPx(next);
    previews.push(<Text key="pl" x={q.x + 10} y={q.y + 8} text={formatFeet(distance(last, next))} fontSize={12} fill={COLORS.preview} listening={false} />);
  }
  if (drag?.kind === 'wall-new') {
    const len = distance(drag.start, drag.end);
    previews.push(<Line key="pw" points={flat([drag.start, drag.end].map(toPx))} stroke={COLORS.preview}
      strokeWidth={Math.max(3, WALL_T * view.scale)} opacity={0.7} listening={false} />);
    if (len > 0) {
      const q = toPx(drag.end);
      previews.push(<Text key="pwl" x={q.x + 10} y={q.y + 8} text={formatFeet(len)} fontSize={12} fill={COLORS.preview} listening={false} />);
    }
  }
  if (['opening', 'window', 'openwall', 'wall', 'cabinet'].includes(tool) && pointer && !drag) {
    const hit = wallAt(rooms, pointer, tolerance);
    if (hit) {
      previews.push(<Line key="hw" points={flat([hit.edge.a, hit.edge.b].map(toPx))} stroke={COLORS.preview} strokeWidth={3} opacity={0.6} listening={false} />);
    }
  }

  const cursor = tool === 'pan' || drag?.kind === 'pan' ? 'grab'
    : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width, height, cursor, touchAction: 'none' }}
      onPointerDownCapture={onFingerDown}
      onPointerMoveCapture={onFingerMove}
      onPointerUpCapture={onFingerUp}
      onPointerCancelCapture={onFingerUp}
      data-testid="flooring-sketch-canvas"
      // Pixels per foot and the offset, so a test can find a spot in feet
      data-scale={view.scale}
      data-offset-x={view.x}
      data-offset-y={view.y}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onPointerDown={startOnBackground}
        onPointerMove={handleMove}
        onPointerLeave={() => setPointer(null)}
        onDblClick={handleDblClick}
        onWheel={handleWheel}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={width} height={height} fill={COLORS.background} />
          {gridLines}
        </Layer>
        <Layer>
          {walls}
          {roomLayer}
          {shown.runs.map(renderCabinetRun)}
          {shown.openings.map(renderOpening)}
          {shown.walls.map(renderWall)}
          {shown.fixtures.map(renderFixture)}
          {labels}
          {handles}
          {previews}
        </Layer>
      </Stage>

      {edgeEdit && (
        <input
          data-testid="edge-length-input"
          autoFocus
          value={edgeEdit.value}
          onChange={(e) => setEdgeEdit({ ...edgeEdit, value: e.target.value })}
          onFocus={(e) => e.target.select()}
          onBlur={commitEdgeEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdgeEdit();
            if (e.key === 'Escape') setEdgeEdit(null);
          }}
          style={{
            position: 'absolute', left: edgeEdit.px.x - 40, top: edgeEdit.px.y - 12, width: 80, height: 24,
            fontSize: 13, textAlign: 'center', border: `2px solid ${COLORS.selected}`, borderRadius: 4,
            outline: 'none', zIndex: 5,
          }}
        />
      )}

      {tool === 'polygon' && (
        <div style={{
          position: 'absolute', left: 8, bottom: 8, background: 'rgba(255,255,255,0.95)', border: '1px solid #d9d9d9',
          borderRadius: 6, padding: '6px 8px', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', zIndex: 4,
        }}>
          {polygon.length ? (
            <>
              <span>Next wall</span>
              <input
                data-testid="polygon-length-input"
                value={typedLength}
                placeholder={`e.g. 12' 6"`}
                onChange={(e) => setTypedLength(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    applyTypedLength();
                  }
                }}
                style={{ width: 90, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4 }}
              />
              <span style={{ color: '#8c8c8c' }}>
                toward the pointer · Enter closes · Backspace undoes a corner
              </span>
            </>
          ) : (
            <span style={{ color: '#8c8c8c' }}>Click the first corner. Walls hold level, upright or 45° (Alt for free).</span>
          )}
        </div>
      )}
    </div>
  );
};

const fixtureFont = (widthPx: number) => Math.min(11, Math.max(8, widthPx / 6));

/** Fixtures land on the inch */
function snapTo2(v: number) {
  return Math.round(v * 12) / 12;
}

export default FLSketchCanvas;
