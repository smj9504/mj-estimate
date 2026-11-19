/**
 * Rooms from walls: every area the walls close becomes a room.
 *
 * The walls are read as a plan: where one wall's end lands on another
 * (a T, or a corner) they meet there, and a wall lying along another is
 * one line. Each closed area that isn't a room yet becomes one, however
 * its walls got there (drawn, dragged, typed):
 * - outside every room: a room of its own (the first the Bathroom, the
 *   rest "Room", e.g. a nook built off the bathroom's wall);
 * - inside a room, closed by walls of its own: a closet in it (a sub-room);
 * - inside a room, cut off by walls run to the room's walls: each piece a
 *   room in it but the largest, the rest of the room;
 * - closed round a shower: a shower room ("Shower").
 * Areas already rooms, and slivers, are skipped.
 */

import type { BEFixture, BEPoint, BERoom, BERoomType, BEWall } from '../../../../types/bathroomSketch';

/** Ends this close (px) are one point; a point this close to a wall is on it */
const TOL = 8;
/** An area smaller than this (SF) is a sliver, not a room */
const MIN_ROOM_SF = 1;

export interface WallFace {
  /** Its outline, corners only */
  boundary: BEPoint[];
  /** The wall along each edge of the outline (boundary[i] → boundary[i+1]); several where walls meet along it */
  edgeWalls: string[][];
  areaPx2: number;
}

const dist = (a: BEPoint, b: BEPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function onSegment(p: BEPoint, a: BEPoint, b: BEPoint): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, a), t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const c = Math.max(0, Math.min(1, t));
  return { d: dist(p, { x: a.x + c * dx, y: a.y + c * dy }), t };
}

function signedArea(poly: BEPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    s += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return s / 2;
}

export function pointInPolygon(pt: BEPoint, poly: BEPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point inside the polygon (its centroid when that is inside, else one just in from an edge) */
export function pointInside(poly: BEPoint[]): BEPoint | null {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-6) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const f = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    cx += (poly[i].x + poly[j].x) * f;
    cy += (poly[i].y + poly[j].y) * f;
  }
  const c = { x: cx / (6 * a), y: cy / (6 * a) };
  if (pointInPolygon(c, poly)) return c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const len = dist(p, q);
    if (len < 1e-6) continue;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    for (const s of [2, -2]) {
      const t = { x: m.x + (-(q.y - p.y) / len) * s, y: m.y + ((q.x - p.x) / len) * s };
      if (pointInPolygon(t, poly)) return t;
    }
  }
  return null;
}

/**
 * Every area the walls close, smallest pieces: the plan's faces. Walls are
 * split where another wall's end lands on them, and walls along one line
 * become one edge.
 */
export function wallFaces(walls: BEWall[]): WallFace[] {
  // Points: every wall end, near ones as one
  const nodes: BEPoint[] = [];
  const nodeOf = (p: BEPoint): number => {
    const found = nodes.findIndex((n) => dist(n, p) < TOL);
    if (found >= 0) return found;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };
  const ends = walls.map((w) => [nodeOf(w.start), nodeOf(w.end)] as const);

  // Edges: each wall cut at every point that lies on it, by the walls along it
  const edgeWalls = new Map<string, Set<string>>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  walls.forEach((w, wi) => {
    const [a, b] = ends[wi];
    if (a === b) return;
    const along = [{ i: a, t: 0 }, { i: b, t: 1 }];
    nodes.forEach((n, i) => {
      if (i === a || i === b) return;
      const on = onSegment(n, nodes[a], nodes[b]);
      if (on.d < TOL && on.t > 0 && on.t < 1) along.push({ i, t: on.t });
    });
    along.sort((p, q) => p.t - q.t);
    for (let k = 0; k + 1 < along.length; k++) {
      const u = along[k].i;
      const v = along[k + 1].i;
      if (u === v) continue;
      const kk = key(u, v);
      if (!edgeWalls.has(kk)) edgeWalls.set(kk, new Set());
      edgeWalls.get(kk)!.add(w.id);
    }
  });

  // Around each point, its edges by angle
  const around = new Map<number, number[]>();
  edgeWalls.forEach((_, kk) => {
    const [u, v] = kk.split('-').map(Number);
    if (!around.has(u)) around.set(u, []);
    if (!around.has(v)) around.set(v, []);
    around.get(u)!.push(v);
    around.get(v)!.push(u);
  });
  around.forEach((list, n) => {
    const o = nodes[n];
    list.sort((p, q) => Math.atan2(nodes[p].y - o.y, nodes[p].x - o.x) - Math.atan2(nodes[q].y - o.y, nodes[q].x - o.x));
  });

  // Walk each side of each edge, always taking the next edge round: the faces
  const seen = new Set<string>();
  const faces: WallFace[] = [];
  const limit = edgeWalls.size * 2 + 2;
  edgeWalls.forEach((_, kk) => {
    const [p, q] = kk.split('-').map(Number);
    for (const [u0, v0] of [[p, q], [q, p]]) {
      if (seen.has(`${u0}>${v0}`)) continue;
      let cycle: number[] = [];
      let u = u0;
      let v = v0;
      for (let step = 0; step < limit; step++) {
        seen.add(`${u}>${v}`);
        cycle.push(u);
        const list = around.get(v)!;
        const k = list.indexOf(u);
        const w = list[(k + 1) % list.length];
        u = v;
        v = w;
        if (u === u0 && v === v0) break;
      }
      // Walls that end in the open are walked out and back: leave those spurs off
      let changed = true;
      while (changed && cycle.length >= 3) {
        changed = false;
        for (let i = 0; i < cycle.length; i++) {
          const prev = cycle[(i - 1 + cycle.length) % cycle.length];
          const next = cycle[(i + 1) % cycle.length];
          if (prev === next) {
            const drop = new Set([i, (i + 1) % cycle.length]);
            cycle = cycle.filter((_, j) => !drop.has(j));
            changed = true;
            break;
          }
        }
      }
      if (cycle.length < 3) continue;
      const poly = cycle.map((n) => nodes[n]);
      // Taking the next edge round this way walks each closed area one way
      // round (a negative area on screen, y down) and the open outside of each
      // group of walls the other way
      const area = -signedArea(poly);
      if (area <= 0) continue;
      // Corners only: a straight run through a point is one edge
      const pts: number[] = [];
      const runs: string[][] = [];
      const wallsOf = (a: number, b: number) => Array.from(edgeWalls.get(key(a, b)) ?? []);
      for (let i = 0; i < cycle.length; i++) {
        const prev = nodes[cycle[(i - 1 + cycle.length) % cycle.length]];
        const cur = nodes[cycle[i]];
        const next = nodes[cycle[(i + 1) % cycle.length]];
        const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
        const straight = Math.abs(cross) < 1e-6 * Math.max(1, dist(prev, cur) * dist(cur, next));
        if (!straight) {
          pts.push(i);
        }
      }
      if (pts.length < 3) continue;
      for (let j = 0; j < pts.length; j++) {
        const from = pts[j];
        const to = pts[(j + 1) % pts.length];
        const ids: string[] = [];
        for (let i = from; i !== to; i = (i + 1) % cycle.length) {
          for (const id of wallsOf(cycle[i], cycle[(i + 1) % cycle.length])) if (!ids.includes(id)) ids.push(id);
        }
        runs.push(ids);
      }
      // Clockwise on screen, as the sketch's rooms run (utils/beGeometry): the
      // corners reversed, and each edge's walls with it
      const m = pts.length;
      faces.push({
        boundary: pts.map((i) => ({ ...nodes[cycle[i]] })).reverse(),
        edgeWalls: runs.map((_, j) => runs[(m - 2 - j + m) % m]),
        areaPx2: area,
      });
    }
  });
  return faces;
}

export interface DetectedRoom {
  boundary: BEPoint[];
  wallIds: string[];
  parentRoomId?: string;
  name: string;
  roomType: BERoomType;
}

/**
 * The rooms the walls close that aren't rooms yet (see the file's comment).
 * A room's walls are its own: a wall another room already has (the wall a
 * nook shares with the bathroom) stays that room's.
 */
export function roomsFromWalls(
  walls: BEWall[], rooms: BERoom[], pixelsPerFoot: number, fixtures: BEFixture[] = [],
): DetectedRoom[] {
  const minArea = MIN_ROOM_SF * pixelsPerFoot * pixelsPerFoot;
  const taken = new Set(rooms.flatMap((r) => r.wallIds));
  const roomArea = (r: BERoom) => Math.abs(signedArea(r.boundary));
  const out: DetectedRoom[] = [];
  const names = new Set(rooms.map((r) => r.name));
  let hasBathroom = rooms.some((r) => !r.parentRoomId && r.roomType === 'bathroom');
  // Pieces of a room cut off by walls run to its walls, by the room
  const pieces = new Map<string, { face: WallFace; shower: boolean; ownWalls: string[] }[]>();

  for (const face of wallFaces(walls)) {
    if (face.areaPx2 < minArea) continue;
    const inside = pointInside(face.boundary);
    if (!inside) continue;
    // Walls closed round a shower: a shower room
    const shower = fixtures.some((f) => f.type === 'shower' && pointInPolygon(f.position, face.boundary));
    const holders = rooms.filter((r) => r.boundary.length >= 3 && pointInPolygon(inside, r.boundary));
    // Already a room
    if (holders.some((r) => Math.abs(roomArea(r) - face.areaPx2) <= 0.05 * face.areaPx2)) continue;
    const ownWalls = face.edgeWalls.flat().filter((id, i, all) => all.indexOf(id) === i && !taken.has(id));
    const parent = holders.find((r) => !r.parentRoomId);
    if (parent) {
      // Inside a room, cut off by walls run to the room's walls: a piece of it
      if (face.edgeWalls.flat().some((id) => taken.has(id))) {
        if (!pieces.has(parent.id)) pieces.set(parent.id, []);
        pieces.get(parent.id)!.push({ face, shower, ownWalls });
        continue;
      }
      // Closed by walls of its own: a closet in it
      out.push({
        boundary: face.boundary, wallIds: ownWalls, parentRoomId: parent.id,
        name: shower ? 'Shower' : 'Closet', roomType: shower ? 'shower' : 'closet',
      });
      continue;
    }
    if (holders.length) continue;
    // Over a room it doesn't match (a room drawn apart from its walls): leave it
    if (rooms.some((r) => {
      const p = r.boundary.length >= 3 ? pointInside(r.boundary) : null;
      return !!p && pointInPolygon(p, face.boundary);
    })) continue;
    let name = !hasBathroom ? 'Bathroom' : shower ? 'Shower' : 'Room';
    if (name === 'Room') {
      for (let n = 2; names.has(name); n++) name = `Room ${n}`;
    }
    names.add(name);
    // Its walls, in the order of its edges when each edge is one wall of its own
    const oneEach = face.edgeWalls.every((ids) => ids.length === 1 && !taken.has(ids[0]));
    out.push({
      boundary: face.boundary,
      wallIds: oneEach ? face.edgeWalls.map((ids) => ids[0]) : ownWalls,
      name,
      roomType: !hasBathroom ? 'bathroom' : shower ? 'shower' : 'other',
    });
    hasBathroom = true;
  }

  // A room cut into pieces: each is a room in it but the largest, the rest of
  // the room (one without a shower: a shower room is its own however big)
  pieces.forEach((list, parentId) => {
    const rest = list.slice().sort((a, b) => Number(a.shower) - Number(b.shower) || b.face.areaPx2 - a.face.areaPx2)[0];
    for (const piece of list) {
      if (piece === rest) continue;
      out.push({
        boundary: piece.face.boundary, wallIds: piece.ownWalls, parentRoomId: parentId,
        name: piece.shower ? 'Shower' : 'Closet', roomType: piece.shower ? 'shower' : 'closet',
      });
    }
  });
  return out;
}
