/**
 * Rooms combined into one: their floors joined across the walls between
 * them, as one outline. Two rooms are joined where their walls face each
 * other a wall's thickness apart (an open side, a doorway, or a wall that
 * comes out); rooms that don't meet can't be combined.
 */

import polygonClipping, { type Polygon as Ring } from 'polygon-clipping';
import type { FtPoint } from '../../../../types/flooringEstimate';
import { edgesOf } from './geometry';

/** How far apart two rooms' facing walls can be and still be one wall between them (the server's EXTERIOR_GAP_FT) */
export const SHARED_WALL_FT = 0.6;
const OVERLAP_FT = 0.05;
const ROUND = 10000;

const ring = (points: FtPoint[]): Ring => [[...points.map((p) => [p.x, p.y] as [number, number]), [points[0].x, points[0].y]]];

/** The strips of wall where two rooms face each other */
export function sharedWalls(a: FtPoint[], b: FtPoint[]): FtPoint[][] {
  const strips: FtPoint[][] = [];
  for (const e1 of edgesOf(a)) {
    for (const e2 of edgesOf(b)) {
      const cross = e1.dir.x * e2.dir.y - e1.dir.y * e2.dir.x;
      const facing = e1.normal.x * e2.normal.x + e1.normal.y * e2.normal.y;
      if (Math.abs(cross) > 1e-3 || facing > -0.99) continue;
      // How far out of room a the other wall stands
      const gap = (e2.a.x - e1.a.x) * e1.normal.x + (e2.a.y - e1.a.y) * e1.normal.y;
      if (gap < -1e-6 || gap > SHARED_WALL_FT) continue;
      const along = (p: FtPoint) => (p.x - e1.a.x) * e1.dir.x + (p.y - e1.a.y) * e1.dir.y;
      const from = Math.max(0, Math.min(along(e2.a), along(e2.b)));
      const to = Math.min(e1.length, Math.max(along(e2.a), along(e2.b)));
      if (to - from < OVERLAP_FT) continue;
      // A hair into both rooms, so the floors join without a seam
      const at = (s: number, off: number) => ({
        x: e1.a.x + e1.dir.x * s + e1.normal.x * off, y: e1.a.y + e1.dir.y * s + e1.normal.y * off,
      });
      strips.push([at(from, -0.001), at(to, -0.001), at(to, gap + 0.001), at(from, gap + 0.001)]);
    }
  }
  return strips;
}

/** The outline without its repeated points or corners that aren't corners (points along a straight wall) */
export function tidyOutline(points: FtPoint[]): FtPoint[] {
  let pts = points.map((p) => ({ x: Math.round(p.x * ROUND) / ROUND, y: Math.round(p.y * ROUND) / ROUND }));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const p = pts[i];
      const next = pts[(i + 1) % pts.length];
      const ux = p.x - prev.x;
      const uy = p.y - prev.y;
      const vx = next.x - p.x;
      const vy = next.y - p.y;
      const same = Math.hypot(ux, uy) < 1e-3;
      const straight = Math.abs(ux * vy - uy * vx) < 1e-4 * Math.max(1, Math.hypot(ux, uy) * Math.hypot(vx, vy))
        && ux * vx + uy * vy > 0;
      if (same || straight) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * One outline for rooms that meet, their floors joined across the walls
 * between them; null when they don't all join up into one room.
 */
export function combinedOutline(rooms: FtPoint[][]): FtPoint[] | null {
  if (rooms.length < 2 || rooms.some((r) => r.length < 3)) return null;
  const parts: Ring[] = rooms.map(ring);
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      for (const strip of sharedWalls(rooms[i], rooms[j])) parts.push(ring(strip));
    }
  }
  const joined = polygonClipping.union(parts[0], ...parts.slice(1));
  if (joined.length !== 1) return null;
  const outer = joined[0][0];
  return tidyOutline(outer.slice(0, -1).map(([x, y]) => ({ x, y })));
}
