/**
 * Decorative tile marked on the sketch: border (listello) rows across a
 * wall's tile to install, a border round the floor a set way in from the
 * walls, and accent inserts counted on each. They measure what the estimate
 * prices on top of the field tile (walls_spec / floor_spec deco_border_lf,
 * deco_inserts; backend calculator _add_decorative_tile).
 *
 * A wall's border row runs across its tile area at its height, stopping at
 * doors, openings and windows and at a tub or shower surround that stays the
 * fixture's own. The floor's runs round the room that far in from its walls,
 * stopping under the tub, shower, vanity and toilet.
 */

import type { BEFixture, BEPoint, BERoom, BEWall } from '../../../../types/bathroomSketch';
import { pointInPolygon } from './beRoomDetect';
import {
  regionRect,
  surroundsAfterWork,
  wallFixtureCovers,
  wallOpenings,
  wallTileRegions,
  type FaceRect,
} from './wallFinish';

/** A border row's band, inches tall (the 3D view) */
export const BORDER_BAND_IN = 2;
/** A floor border's default way in from the walls, inches */
export const FLOOR_BORDER_INSET_IN = 6;

export interface WallBorderRun {
  /** Across the wall from its start, inches */
  x0: number;
  x1: number;
  /** Up from the floor to the row's middle, inches */
  y: number;
}

/** [x0, x1] at height y, less the blocks across it there */
function rowRuns(x0: number, x1: number, y: number, blocks: FaceRect[]): [number, number][] {
  let runs: [number, number][] = [[x0, x1]];
  for (const b of blocks) {
    if (!(y > b.y0 && y < b.y1)) continue;
    runs = runs.flatMap(([a, c]): [number, number][] => {
      if (b.x1 <= a || b.x0 >= c) return [[a, c]];
      const out: [number, number][] = [];
      if (b.x0 > a) out.push([a, b.x0]);
      if (b.x1 < c) out.push([b.x1, c]);
      return out;
    });
  }
  return runs.filter(([a, c]) => c - a > 0.01);
}

/** A wall's border rows across its tile to install, as runs along it */
export function wallBorderRuns(wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): WallBorderRun[] {
  const regions = wallTileRegions(wall, 'new', pixelsPerFoot);
  if (!regions.some((r) => r.decoBordersAtIn?.length)) return [];
  const kept = surroundsAfterWork(wallFixtureCovers(wall, fixtures, pixelsPerFoot), regions.map(regionRect))
    .kept.map((c) => c.rect);
  const blocks = [...wallOpenings(wall, fixtures, pixelsPerFoot), ...kept];
  return regions.flatMap((r) => (r.decoBordersAtIn ?? [])
    .filter((y) => y >= r.bottomIn && y <= r.topIn)
    .flatMap((y) => rowRuns(r.startIn, r.endIn, y, blocks).map(([x0, x1]) => ({ x0, x1, y }))));
}

export const wallBorderLF = (wall: BEWall, fixtures: BEFixture[], pixelsPerFoot: number): number =>
  wallBorderRuns(wall, fixtures, pixelsPerFoot).reduce((sum, r) => sum + (r.x1 - r.x0), 0) / 12;

export const wallDecoInserts = (wall: BEWall, pixelsPerFoot: number): number =>
  wallTileRegions(wall, 'new', pixelsPerFoot).reduce((sum, r) => sum + (r.decoInserts || 0), 0);

/** Whether a wall's tile carries decorative tile marked on the sketch (so the sketch speaks for it) */
export const wallHasDeco = (wall: BEWall, pixelsPerFoot: number): boolean =>
  wallTileRegions(wall, 'new', pixelsPerFoot).some((r) => r.decoBordersAtIn !== undefined || r.decoInserts !== undefined);

/**
 * The floor border's line: the room's outline moved in from each wall by
 * `insetPx`, its corners where the moved edges meet.
 */
export function floorBorderOutline(room: BERoom, insetPx: number): BEPoint[] | null {
  const b = room.boundary;
  if (b.length < 3) return null;
  const lines = b.map((p, i) => {
    const q = b[(i + 1) % b.length];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    let nx = -dy / len;
    let ny = dx / len;
    // Toward the room
    if (!pointInPolygon({ x: (p.x + q.x) / 2 + nx, y: (p.y + q.y) / 2 + ny }, b)) {
      nx = -nx;
      ny = -ny;
    }
    return { p: { x: p.x + nx * insetPx, y: p.y + ny * insetPx }, d: { x: dx / len, y: dy / len } };
  }).filter((l): l is { p: BEPoint; d: BEPoint } => !!l);
  if (lines.length < 3) return null;
  const out: BEPoint[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[(i - 1 + lines.length) % lines.length];
    const c = lines[i];
    const cross = a.d.x * c.d.y - a.d.y * c.d.x;
    if (Math.abs(cross) < 1e-9) {
      out.push(c.p);
      continue;
    }
    const t = ((c.p.x - a.p.x) * c.d.y - (c.p.y - a.p.y) * c.d.x) / cross;
    out.push({ x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t });
  }
  return out;
}

const FLOOR_FIXTURES = new Set(['bathtub', 'shower', 'toilet', 'vanity']);

/** Where p→q runs through a fixture's footprint, as [from, to] fractions of it */
function throughFixture(p: BEPoint, q: BEPoint, fix: BEFixture, pixelsPerFoot: number): [number, number] | null {
  const hw = ((fix.dimensions.width / 12) * pixelsPerFoot) / 2;
  const hh = ((fix.dimensions.height / 12) * pixelsPerFoot) / 2;
  const rad = -((fix.rotation || 0) * Math.PI) / 180;
  const local = (pt: BEPoint) => {
    const x = pt.x - fix.position.x;
    const y = pt.y - fix.position.y;
    return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
  };
  const a = local(p);
  const b = local(q);
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [pp, qq] of [[-dx, a.x + hw], [dx, hw - a.x], [-dy, a.y + hh], [dy, hh - a.y]] as [number, number][]) {
    if (Math.abs(pp) < 1e-12) {
      if (qq < 0) return null;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}

/** The floor border's runs round the room, less where a tub, shower, vanity or toilet stands */
export function floorBorderRuns(room: BERoom, fixtures: BEFixture[], pixelsPerFoot: number): [BEPoint, BEPoint][] {
  if (room.floorBorderInsetIn == null) return [];
  const outline = floorBorderOutline(room, (room.floorBorderInsetIn / 12) * pixelsPerFoot);
  if (!outline) return [];
  const blocks = fixtures.filter((f) => FLOOR_FIXTURES.has(f.type)
    && !(f.type === 'vanity' && f.properties.vanitySubType && f.properties.vanitySubType !== 'cabinet'));
  const at = (p: BEPoint, q: BEPoint, t: number): BEPoint => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const runs: [BEPoint, BEPoint][] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    let keep: [number, number][] = [[0, 1]];
    for (const f of blocks) {
      const cut = throughFixture(p, q, f, pixelsPerFoot);
      if (!cut) continue;
      keep = keep.flatMap(([s, e]): [number, number][] => {
        if (cut[1] <= s || cut[0] >= e) return [[s, e]];
        const out: [number, number][] = [];
        if (cut[0] > s) out.push([s, cut[0]]);
        if (cut[1] < e) out.push([cut[1], e]);
        return out;
      });
    }
    for (const [s, e] of keep) if (e - s > 1e-6) runs.push([at(p, q, s), at(p, q, e)]);
  });
  return runs;
}

export const floorBorderLF = (room: BERoom, fixtures: BEFixture[], pixelsPerFoot: number): number =>
  floorBorderRuns(room, fixtures, pixelsPerFoot).reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0) / pixelsPerFoot;
