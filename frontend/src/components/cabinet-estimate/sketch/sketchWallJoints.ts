/**
 * Walls that meet stay joined. A kitchen sketch rarely closes a room — it
 * is a few stretches of wall — but where two walls meet, end to end at a
 * corner or one ending partway along another (a T), moving one must not
 * pull them apart. Pure functions over the plan's walls, in canvas pixels.
 */

import type { CabinetSketchWall } from '../../../types/cabinetSketch';
import { pixelsToFeet } from './cabinetSketchUtils';

type Pt = { x: number; y: number };
type End = 'start' | 'end';

/** How close (canvas px) a wall end must be to another wall to count as joined to it. */
export const WALL_JOINT_TOL_PX = 0.75;

const endOf = (w: CabinetSketchWall, end: End): Pt =>
  end === 'start' ? { x: w.start_x, y: w.start_y } : { x: w.end_x, y: w.end_y };

const withEnd = (w: CabinetSketchWall, end: End, p: Pt): CabinetSketchWall =>
  end === 'start' ? { ...w, start_x: p.x, start_y: p.y } : { ...w, end_x: p.x, end_y: p.y };

const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) <= WALL_JOINT_TOL_PX;

/** Where `p` sits along wall `w`, 0 at its start and 1 at its end, when it is on it between them; else null. */
function paramOn(p: Pt, w: CabinetSketchWall): number | null {
  const dx = w.end_x - w.start_x;
  const dy = w.end_y - w.start_y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  const t = ((p.x - w.start_x) * dx + (p.y - w.start_y) * dy) / len2;
  if (t <= 0 || t >= 1) return null;
  const q = { x: w.start_x + t * dx, y: w.start_y + t * dy };
  return near(p, q) ? t : null;
}

const pointAt = (w: CabinetSketchWall, t: number): Pt => ({
  x: w.start_x + t * (w.end_x - w.start_x),
  y: w.start_y + t * (w.end_y - w.start_y),
});

/** Where the line through a and b crosses wall w's line, as a parameter along w; null when they run parallel. */
function crossingOn(a: Pt, b: Pt, w: CabinetSketchWall): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = w.end_x - w.start_x;
  const sy = w.end_y - w.start_y;
  // a + u r = w.start + t s; crossing both sides with r leaves t.
  const denom = sx * ry - sy * rx;
  if (Math.abs(denom) < 1e-9) return null;
  return ((a.x - w.start_x) * ry - (a.y - w.start_y) * rx) / denom;
}

const withLength = (w: CabinetSketchWall, scalePixelsPerFoot: number): CabinetSketchWall => ({
  ...w,
  length_ft: pixelsToFeet(Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y), scalePixelsPerFoot),
});

/**
 * The walls after some of them were moved, turned or had an end dragged
 * (`after` holds every wall, the changed ones in their new place), with
 * the walls joined to them brought along:
 * - an unchanged wall's end that met a changed wall's end (a corner) goes
 *   where that end went;
 * - an unchanged wall's end partway along a changed wall stays at the same
 *   point along it;
 * - a changed wall's end that stood partway along an unchanged wall slides
 *   along that wall to where the changed wall's line now crosses it — so
 *   a wall moved off a T stretches to keep touching it. Ends in `free` are
 *   skipped: a dragged end goes where it was dropped.
 * Lengths are recomputed for every wall that changed.
 */
export function keepWallsJoined(
  before: CabinetSketchWall[],
  after: CabinetSketchWall[],
  changedIds: Set<string>,
  scalePixelsPerFoot: number,
  free: { id: string; end: End }[] = []
): CabinetSketchWall[] {
  const old = new Map(before.map((w) => [w.id, w]));
  const now = new Map(after.map((w) => [w.id, w]));
  const changedBefore = before.filter((w) => changedIds.has(w.id));
  const fixedBefore = before.filter((w) => !changedIds.has(w.id));
  const isFree = (id: string, end: End) => free.some((f) => f.id === id && f.end === end);

  const out = after.map((wall) => {
    const was = old.get(wall.id);
    if (!was) return wall;
    let next = wall;
    for (const end of ['start', 'end'] as End[]) {
      const p = endOf(was, end);
      if (!changedIds.has(wall.id)) {
        // Follow a changed wall it is joined to: a shared corner first, else a T onto it.
        let moved: Pt | null = null;
        for (const c of changedBefore) {
          const cNow = now.get(c.id)!;
          if (near(p, endOf(c, 'start'))) moved = endOf(cNow, 'start');
          else if (near(p, endOf(c, 'end'))) moved = endOf(cNow, 'end');
          if (moved) break;
        }
        if (!moved) {
          for (const c of changedBefore) {
            const t = paramOn(p, c);
            if (t !== null) {
              moved = pointAt(now.get(c.id)!, t);
              break;
            }
          }
        }
        if (moved) next = withEnd(next, end, moved);
      } else if (!isFree(wall.id, end)) {
        // A changed wall's end on an unchanged wall's side slides along it.
        const host = fixedBefore.find((f) => paramOn(p, f) !== null);
        if (!host) continue;
        const t = crossingOn(endOf(next, 'start'), endOf(next, 'end'), host);
        if (t === null || t < 0 || t > 1) continue;
        next = withEnd(next, end, pointAt(host, t));
      }
    }
    return next === was ? was : withLength(next, scalePixelsPerFoot);
  });
  return out;
}

/** Every wall after `ids` move by (dx, dy), the walls joined to them following. */
export function moveWallsJoined(
  walls: CabinetSketchWall[],
  ids: Set<string>,
  dx: number,
  dy: number,
  scalePixelsPerFoot: number
): CabinetSketchWall[] {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return walls;
  const after = walls.map((w) =>
    ids.has(w.id)
      ? { ...w, start_x: w.start_x + dx, start_y: w.start_y + dy, end_x: w.end_x + dx, end_y: w.end_y + dy }
      : w
  );
  return keepWallsJoined(walls, after, ids, scalePixelsPerFoot);
}

/**
 * Every wall after one wall's end is dropped at `to`: the walls that met it
 * there (a corner) move with it, and those ending partway along the wall
 * stay on it.
 */
export function moveWallEndJoined(
  walls: CabinetSketchWall[],
  wallId: string,
  end: End,
  to: Pt,
  scalePixelsPerFoot: number
): CabinetSketchWall[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return walls;
  const after = walls.map((w) => (w.id === wallId ? withEnd(w, end, to) : w));
  return keepWallsJoined(walls, after, new Set([wallId]), scalePixelsPerFoot, [{ id: wallId, end }]);
}

/**
 * The ids of the walls whose end meets `wallId`'s `end` there — they move
 * with that end, so a dropped end must not snap onto them.
 */
export function wallsMeetingEnd(walls: CabinetSketchWall[], wallId: string, end: End): string[] {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return [];
  const p = endOf(wall, end);
  return walls
    .filter((w) => w.id !== wallId && (near(p, endOf(w, 'start')) || near(p, endOf(w, 'end'))))
    .map((w) => w.id);
}
