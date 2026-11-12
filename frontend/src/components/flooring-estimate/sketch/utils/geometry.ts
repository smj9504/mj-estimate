/**
 * Geometry of the flooring sketch, in feet.
 *
 * A room is the polygon of its finished floor: the interior faces of its
 * walls, wall to wall. Walls are drawn WALL_T thick around it, so two rooms
 * that share a wall sit WALL_T apart. Everything here is pure and works in
 * feet; the canvas maps feet to pixels only to draw.
 */

import type { FtPoint, SketchLevel, SketchRoom } from '../../../../types/flooringEstimate';

/** An interior wall: 2x4 stud and drywall both sides, 4.5" */
export const WALL_T = 0.375;
const EPS = 1e-6;

export interface Edge {
  index: number;
  a: FtPoint;
  b: FtPoint;
  length: number;
  /** Unit direction a → b */
  dir: FtPoint;
  /** Unit normal pointing out of the room */
  normal: FtPoint;
}

export const distance = (a: FtPoint, b: FtPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export function signedArea2(points: FtPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum;
}

export const polygonArea = (points: FtPoint[]) => (points.length < 3 ? 0 : Math.abs(signedArea2(points)) / 2);

export function polygonPerimeter(points: FtPoint[]): number {
  if (points.length < 2) return 0;
  return points.reduce((sum, p, i) => sum + distance(p, points[(i + 1) % points.length]), 0);
}

export function bbox(points: FtPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Area centroid; the box's center for a degenerate outline */
export function centroid(points: FtPoint[]): FtPoint {
  const a2 = signedArea2(points);
  if (Math.abs(a2) < EPS) {
    const b = bbox(points);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const c = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

export function edgesOf(points: FtPoint[]): Edge[] {
  const ccw = signedArea2(points) > 0;
  return points.map((a, index) => {
    const b = points[(index + 1) % points.length];
    const length = distance(a, b) || EPS;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // With a positive area the room is on the left of each edge
    const normal = ccw ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
    return { index, a, b, length, dir, normal };
  });
}

/** The outline moved out by d on every side (mitered corners): a wall's outer face */
export function offsetPolygon(points: FtPoint[], d: number): FtPoint[] {
  const lines = edgesOf(points).map((e) => ({
    p: { x: e.a.x + e.normal.x * d, y: e.a.y + e.normal.y * d },
    dir: e.dir,
  }));
  return lines.map((line, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cross = prev.dir.x * line.dir.y - prev.dir.y * line.dir.x;
    if (Math.abs(cross) < EPS) return line.p;
    const t = ((line.p.x - prev.p.x) * line.dir.y - (line.p.y - prev.p.y) * line.dir.x) / cross;
    return { x: prev.p.x + prev.dir.x * t, y: prev.p.y + prev.dir.y * t };
  });
}

export function pointInPolygon(p: FtPoint, points: FtPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Where p falls on segment ab: t (0..1, clamped), the point, and how far p is from it */
export function projectOnSegment(p: FtPoint, a: FtPoint, b: FtPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, dist: distance(p, point) };
}

export const snapTo = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value);

/** A rectangle, clockwise from its top-left corner */
export function rectPoints(x: number, y: number, w: number, h: number): FtPoint[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

const isHorizontal = (a: FtPoint, b: FtPoint) => Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS;
const isVertical = (a: FtPoint, b: FtPoint) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS;

/**
 * The outline with one wall set to a new length. The wall keeps its left or
 * top end; its other end moves, and the square wall beyond that end moves
 * with it so the room stays square (a rectangle stays a rectangle, an L
 * keeps its notch). A slanted wall just has its end moved. Null when the
 * length isn't a length.
 */
export function resizeEdge(points: FtPoint[], index: number, length: number): FtPoint[] | null {
  if (!(length > 0.05)) return null;
  const n = points.length;
  const i = index;
  const j = (index + 1) % n;
  const a = points[i];
  const b = points[j];
  const horizontal = isHorizontal(a, b);
  const vertical = isVertical(a, b);
  // Grow right or down: anchor the end nearer the top-left
  let fixed = i;
  let moving = j;
  if ((horizontal && b.x < a.x) || (vertical && b.y < a.y)) {
    fixed = j;
    moving = i;
  }
  const f = points[fixed];
  const m = points[moving];
  const len = distance(f, m);
  if (len < EPS) return null;
  const target = { x: f.x + ((m.x - f.x) / len) * length, y: f.y + ((m.y - f.y) / len) * length };
  const delta = { x: target.x - m.x, y: target.y - m.y };
  const next = points.map((p) => ({ ...p }));
  next[moving] = target;
  if (horizontal || vertical) {
    // The neighbour across the moving end's other wall
    const beyond = moving === j ? (j + 1) % n : (i - 1 + n) % n;
    const other = points[beyond];
    const square = horizontal ? isVertical(m, other) : isHorizontal(m, other);
    if (square && beyond !== fixed) {
      next[beyond] = { x: other.x + (horizontal ? delta.x : 0), y: other.y + (vertical ? delta.y : 0) };
    }
  }
  return next;
}

/**
 * The outline with one corner dragged to p. A wall that was square stays
 * square: the corners at its other ends follow along the matching axis.
 * A point in the middle of a straight wall (just added to bend it) moves on
 * its own.
 */
export function moveVertex(points: FtPoint[], index: number, p: FtPoint): FtPoint[] {
  const n = points.length;
  const old = points[index];
  const next = points.map((q) => ({ ...q }));
  next[index] = { ...p };
  const before = points[(index - 1 + n) % n];
  const after = points[(index + 1) % n];
  const straight = Math.abs((old.x - before.x) * (after.y - old.y) - (old.y - before.y) * (after.x - old.x)) < EPS;
  if (straight) return next;
  for (const k of [(index - 1 + n) % n, (index + 1) % n]) {
    const q = points[k];
    if (isVertical(old, q)) next[k] = { ...next[k], x: p.x };
    else if (isHorizontal(old, q)) next[k] = { ...next[k], y: p.y };
  }
  return next;
}

export const translate = (points: FtPoint[], dx: number, dy: number) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** Removes a corner (keeps at least three); a corner on a straight wall goes without changing the room */
export function removeVertex(points: FtPoint[], index: number): FtPoint[] {
  if (points.length <= 3) return points;
  return points.filter((_, i) => i !== index);
}

/** Adds a corner at p on wall `index`, to bend that wall */
export function insertVertex(points: FtPoint[], index: number, p: FtPoint): FtPoint[] {
  const next = [...points];
  next.splice(index + 1, 0, { ...p });
  return next;
}

// ── Snapping ──

/** Lines (x for upright walls, y for level walls) a room may line up with */
export function snapLines(rooms: SketchRoom[], skipRoomId?: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const room of rooms) {
    if (room.id === skipRoomId) continue;
    for (const e of edgesOf(room.points)) {
      if (isVertical(e.a, e.b)) {
        // In line with the wall, or a wall's thickness off it (the next room over)
        xs.push(e.a.x, e.a.x + e.normal.x * WALL_T);
      } else if (isHorizontal(e.a, e.b)) {
        ys.push(e.a.y, e.a.y + e.normal.y * WALL_T);
      }
    }
  }
  return { xs, ys };
}

/** The shift that brings one of `values` onto one of `targets`, if one is within `tolerance` */
export function snapShift(values: number[], targets: number[], tolerance: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= tolerance && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/** One coordinate snapped to a line within tolerance, else to the grid */
export function snapValue(value: number, lines: number[], tolerance: number, grid: number): number {
  const shift = snapShift([value], lines, tolerance);
  return shift !== null ? value + shift : snapTo(value, grid);
}

/** A point snapped onto nearby walls, then the grid */
export function snapPoint(p: FtPoint, rooms: SketchRoom[], tolerance: number, grid: number): FtPoint {
  const { xs, ys } = snapLines(rooms);
  return { x: snapValue(p.x, xs, tolerance, grid), y: snapValue(p.y, ys, tolerance, grid) };
}

/** p moved so the line from `from` is level, upright or at 45°, whichever is nearest */
export function constrainAngle(from: FtPoint, p: FtPoint): FtPoint {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return p;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

// ── Walls ──

export interface WallHit {
  roomId: string;
  edge: Edge;
  /** Where on the wall, 0..1 from its start */
  t: number;
  point: FtPoint;
  dist: number;
}

/** The wall nearest p, within tolerance */
export function wallAt(rooms: SketchRoom[], p: FtPoint, tolerance: number): WallHit | null {
  let best: WallHit | null = null;
  for (const room of rooms) {
    for (const edge of edgesOf(room.points)) {
      const hit = projectOnSegment(p, edge.a, edge.b);
      // The wall's band lies outside the room: count a click on it as on the wall
      const outside = (p.x - hit.point.x) * edge.normal.x + (p.y - hit.point.y) * edge.normal.y;
      const dist = outside > 0 && outside <= WALL_T + tolerance ? Math.max(0, hit.dist - WALL_T) : hit.dist;
      if (dist <= tolerance && (!best || dist < best.dist)) {
        best = { roomId: room.id, edge, t: hit.t, point: hit.point, dist };
      }
    }
  }
  return best;
}

/** The room on the other side of a stretch (a..b) of a room's wall: one whose wall is parallel, a wall's thickness away, and overlaps it */
export function roomAcross(rooms: SketchRoom[], roomId: string, edge: Edge, a: FtPoint, b: FtPoint): string | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const probe = { x: mid.x + edge.normal.x * WALL_T, y: mid.y + edge.normal.y * WALL_T };
  for (const room of rooms) {
    if (room.id === roomId) continue;
    for (const other of edgesOf(room.points)) {
      const parallel = Math.abs(edge.dir.x * other.dir.y - edge.dir.y * other.dir.x) < 1e-3;
      if (!parallel) continue;
      const hit = projectOnSegment(probe, other.a, other.b);
      if (hit.dist < 0.12 && hit.t > 0 && hit.t < 1) return room.id;
    }
  }
  return null;
}

/**
 * A segment (an opening's jambs, a cabinet run) put back on the nearest
 * wall of its room after the room changed shape: same length, same middle
 * as near as the wall allows.
 */
export function reattach(points: FtPoint[], a: FtPoint, b: FtPoint): { a: FtPoint; b: FtPoint } {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const width = distance(a, b);
  let best: { edge: Edge; t: number; dist: number } | null = null;
  for (const edge of edgesOf(points)) {
    const hit = projectOnSegment(mid, edge.a, edge.b);
    if (!best || hit.dist < best.dist) best = { edge, t: hit.t, dist: hit.dist };
  }
  if (!best) return { a, b };
  return spanOnEdge(best.edge, best.t * best.edge.length, width);
}

/** A stretch of `width` centered `at` feet along a wall, kept on the wall */
export function spanOnEdge(edge: Edge, at: number, width: number): { a: FtPoint; b: FtPoint } {
  const w = Math.min(width, edge.length);
  const start = Math.max(0, Math.min(edge.length - w, at - w / 2));
  const pointAt = (s: number) => ({ x: edge.a.x + edge.dir.x * s, y: edge.a.y + edge.dir.y * s });
  return { a: pointAt(start), b: pointAt(start + w) };
}

// ── Measurements (the same as the server's, for the editor to show as it is drawn) ──

export interface RoomMeasure {
  floorSf: number;
  perimeterLf: number;
  openingsLf: number;
  cabinetRunLf: number;
  baseLf: number;
  wallSf: number;
}

export function measureRoom(level: SketchLevel, room: SketchRoom): RoomMeasure {
  let floorSf = polygonArea(room.points);
  const perimeterLf = polygonPerimeter(room.points);
  const openingsLf = level.openings
    .filter((o) => o.rooms.includes(room.id))
    .reduce((sum, o) => sum + distance(o.a, o.b), 0);
  const cabinetRunLf = level.cabinet_runs
    .filter((r) => r.room_id === room.id)
    .reduce((sum, r) => sum + distance(r.a, r.b), 0);
  for (const f of level.fixtures) {
    if (f.type === 'island' && !f.floor_under && pointInPolygon({ x: f.x, y: f.y }, room.points)) {
      floorSf = Math.max(0, floorSf - f.w * f.h);
    }
  }
  return {
    floorSf,
    perimeterLf,
    openingsLf,
    cabinetRunLf,
    baseLf: Math.max(0, perimeterLf - openingsLf - cabinetRunLf),
    wallSf: perimeterLf * (room.height_ft || 8),
  };
}
