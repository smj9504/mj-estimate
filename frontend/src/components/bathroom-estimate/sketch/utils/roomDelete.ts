/**
 * Deleting a room takes its walls with it.
 *
 * - A wall another room lists stays (it's that room's too).
 * - Of the rest, a stretch another room still stands on (its outline runs
 *   along it, as a nook built against the bathroom's wall does) stays, cut
 *   to that stretch and given to that room, unless a wall of its own already
 *   runs there.
 * - Everything else of the room's walls goes, and the doors and windows on it.
 *
 * Its fixtures go; rooms inside it stay, rooms of their own. With its walls
 * gone, the area isn't closed any more, so it doesn't come back as a room
 * when the sketch opens again (utils/beRoomDetect).
 */

import type { BEPoint, BERoom, BESketchData, BEWall } from '../../../../types/bathroomSketch';
import { wallLengthIn } from './wallFinish';
import { inLine, MIN_PIECE_IN, splitWall } from './wallSplit';

/** Ends this close (px) are one point */
const NEAR_PX = 4;

type Seg = Pick<BEWall, 'start' | 'end'>;
/** A stretch along a wall, inches from its start */
interface Span { a: number; b: number }

const near = (p: BEPoint, q: BEPoint) => Math.hypot(p.x - q.x, p.y - q.y) < NEAR_PX;

/** Where a line from p to q runs along the wall, if it lies on the wall's line */
function spanAlong(wall: BEWall, p: BEPoint, q: BEPoint, ppf: number): Span | null {
  if (!inLine(wall, { start: p, end: q })) return null;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const at = (pt: BEPoint) => ((((pt.x - wall.start.x) * dx + (pt.y - wall.start.y) * dy) / len) / ppf) * 12;
  const lengthIn = wallLengthIn(wall, ppf);
  const a = Math.max(0, Math.min(at(p), at(q)));
  const b = Math.min(lengthIn, Math.max(at(p), at(q)));
  return b - a >= MIN_PIECE_IN ? { a, b } : null;
}

/** The spans as one set of stretches, in order, those meeting made one */
function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((x, y) => x.a - y.a)) {
    const last = out[out.length - 1];
    if (last && s.a <= last.b + 0.5) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

/** What of the spans no hole covers */
function minus(spans: Span[], holes: Span[]): Span[] {
  let out = spans;
  for (const h of holes) {
    out = out.flatMap((s) => {
      if (h.b <= s.a || h.a >= s.b) return [s];
      return [{ a: s.a, b: h.a }, { a: h.b, b: s.b }].filter((p) => p.b - p.a >= MIN_PIECE_IN);
    });
  }
  return out;
}

const edgesOf = (r: BERoom): [BEPoint, BEPoint][] =>
  (r.boundary.length >= 3 ? r.boundary.map((p, i) => [p, r.boundary[(i + 1) % r.boundary.length]]) : []);

const onEdge = (w: Seg, p: BEPoint, q: BEPoint) => (near(w.start, p) && near(w.end, q)) || (near(w.start, q) && near(w.end, p));

/**
 * Walls given to a room. As many walls as edges is read as one per edge in
 * order (utils/wallSplit), so a list that long is put in edge order, or the
 * walls aren't listed.
 */
function claim(room: BERoom, ids: string[], walls: BEWall[]): BERoom {
  const all = [...room.wallIds, ...ids.filter((id) => !room.wallIds.includes(id))];
  if (all.length !== room.boundary.length) return { ...room, wallIds: all };
  const byEdge = edgesOf(room).map(([p, q]) => all.filter((id) => {
    const w = walls.find((x) => x.id === id);
    return !!w && onEdge(w, p, q);
  }));
  if (byEdge.every((list) => list.length === 1) && new Set(byEdge.flat()).size === all.length) {
    return { ...room, wallIds: byEdge.flat() };
  }
  return room;
}

/** The sketch with the room deleted and its walls with it; `newWallId` names the pieces of a wall cut short */
export function removeRoomWithWalls(d: BESketchData, roomId: string, newWallId: () => string): BESketchData {
  const room = d.rooms.find((r) => r.id === roomId);
  if (!room) return d;
  const ppf = d.settings.pixelsPerFoot;
  const rooms = d.rooms
    .filter((r) => r.id !== roomId)
    .map((r) => (r.parentRoomId === roomId ? { ...r, parentRoomId: undefined } : r));
  const listed = new Set(rooms.flatMap((r) => r.wallIds));
  const going = new Set(room.wallIds.filter((id) => !listed.has(id) && d.walls.some((w) => w.id === id)));

  let out: BESketchData = { ...d, rooms, fixtures: d.fixtures.filter((f) => f.roomId !== roomId) };
  const drop = new Set<string>();
  const claims = new Map<string, string[]>();

  for (const id of Array.from(going)) {
    const wall = out.walls.find((w) => w.id === id);
    if (!wall) continue;
    const lengthIn = wallLengthIn(wall, ppf);
    // The stretches other rooms stand on, each with its room
    const stands: (Span & { roomId: string })[] = [];
    for (const r of rooms) {
      for (const [p, q] of edgesOf(r)) {
        const s = spanAlong(wall, p, q, ppf);
        if (s) stands.push({ ...s, roomId: r.id });
      }
    }
    // Less where a wall that stays already runs
    const covered = union(out.walls
      .filter((w) => w.id !== id && !going.has(w.id) && !drop.has(w.id))
      .map((w) => spanAlong(wall, w.start, w.end, ppf))
      .filter((s): s is Span => !!s));
    const keep = minus(union(stands), covered);
    if (!keep.length) {
      drop.add(id);
      continue;
    }

    // Cut at each end of what stays, from the far end in: the piece from the
    // start keeps the wall's id
    const cuts = Array.from(new Set(keep.flatMap((s) => [s.a, s.b])))
      .filter((c) => c >= MIN_PIECE_IN && c <= lengthIn - MIN_PIECE_IN)
      .sort((x, y) => y - x);
    const pieces: { id: string; a: number; b: number }[] = [];
    let end = lengthIn;
    for (const c of cuts) {
      const pieceId = newWallId();
      const cut = splitWall(out, id, c, pieceId);
      if (!cut) continue;
      out = cut;
      pieces.push({ id: pieceId, a: c, b: end });
      end = c;
    }
    pieces.push({ id, a: 0, b: end });

    for (const piece of pieces) {
      const mid = (piece.a + piece.b) / 2;
      if (!keep.some((s) => mid > s.a && mid < s.b)) {
        drop.add(piece.id);
        continue;
      }
      const by = stands.find((s) => mid > s.a && mid < s.b);
      if (by) claims.set(by.roomId, [...(claims.get(by.roomId) ?? []), piece.id]);
    }
  }

  const walls = out.walls.filter((w) => !drop.has(w.id));
  return {
    ...out,
    walls,
    fixtures: out.fixtures.filter((f) => !f.wallId || !drop.has(f.wallId)),
    rooms: out.rooms.map((r) => (claims.has(r.id) ? claim(r, claims.get(r.id)!, walls) : r)),
  };
}
