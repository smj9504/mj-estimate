/**
 * Breaking a wall and stepping part of it out, as Xactimate's Break does.
 *
 * - Split: a wall cut in two at a point (clicked, or typed from its left):
 *   two walls in line, each its own from then on (its tile, its finish, its
 *   doors), and the room's outline given a corner there that turns nowhere.
 * - Offset: a wall moved square to itself. Where a wall carries on in line
 *   with it (the other piece of a split), a short wall goes in at the step;
 *   a wall meeting it at a corner stretches to follow. Its doors, windows and
 *   what hangs on it go with it, and so do the rooms' outlines and areas.
 * - Join: two walls in line that meet, with nothing else there, one again.
 */

import type {
  BEFixture,
  BEPoint,
  BERoom,
  BESketchData,
  BEWall,
  BEWallTileRegion,
} from '../../../../types/bathroomSketch';
import { isWallLight } from '../../fixtureRows';
import { pointInPolygon } from './beRoomDetect';
import { roomWallAreaSF } from './beGeometry';
import { newRegionId, wallLengthIn, wallTileRegions, type WallFinishLayer } from './wallFinish';

/** Wall ends this close (px) meet */
const MEET_PX = 4;
/** A door, window or what hangs on a wall this close (px) to its line is on it */
const ON_WALL_PX = 9;
/** No piece of a split shorter than this, inches */
export const MIN_PIECE_IN = 1;

type Seg = Pick<BEWall, 'start' | 'end'>;

const near = (a: BEPoint, b: BEPoint, tol = MEET_PX) => Math.hypot(a.x - b.x, a.y - b.y) < tol;
const round2 = (n: number) => Math.round(n * 100) / 100;
const add = (p: BEPoint, v: BEPoint): BEPoint => ({ x: round2(p.x + v.x), y: round2(p.y + v.y) });

/** Where a point falls along a wall (px from its start) and how far off its line (px) */
function along(seg: Seg, p: BEPoint) {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    t: ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / len,
    off: Math.abs((p.x - seg.start.x) * dy - (p.y - seg.start.y) * dx) / len,
    len,
  };
}

/** Two walls on one line (parallel, and one's start on the other's line) */
export function inLine(a: Seg, b: Seg): boolean {
  const ax = a.end.x - a.start.x;
  const ay = a.end.y - a.start.y;
  const bx = b.end.x - b.start.x;
  const by = b.end.y - b.start.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return false;
  if (Math.abs(ax * by - ay * bx) / (la * lb) > 0.01) return false;
  return along(a, b.start).off < MEET_PX;
}

/** The unit normal on the wall's left, walking start → end (y runs down the screen) */
export function wallNormal(wall: Seg): BEPoint {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/**
 * Which way is out of the wall's room along wallNormal: -1 when the normal
 * points into the room, 1 when it points out; 1 for a wall in no room.
 */
export function outwardSign(wall: BEWall, rooms: BERoom[]): 1 | -1 {
  const room = wallRoom(wall, rooms);
  if (!room) return 1;
  const n = wallNormal(wall);
  const m = { x: (wall.start.x + wall.end.x) / 2 + n.x * 2, y: (wall.start.y + wall.end.y) / 2 + n.y * 2 };
  return pointInPolygon(m, room.boundary) ? -1 : 1;
}

/** The room the wall bounds: listed on it, or along one of its outline's edges */
export function wallRoom(wall: BEWall, rooms: BERoom[]): BERoom | undefined {
  return rooms.find((r) => r.wallIds.includes(wall.id) && r.boundary.length >= 3)
    ?? rooms.find((r) => r.boundary.length >= 3 && edgeIndex(r.boundary, wall) >= 0);
}

/** The outline's edge from one of the wall's ends to the other, or -1 */
function edgeIndex(boundary: BEPoint[], wall: Seg): number {
  return boundary.findIndex((p, i) => {
    const q = boundary[(i + 1) % boundary.length];
    return (near(p, wall.start) && near(q, wall.end)) || (near(p, wall.end) && near(q, wall.start));
  });
}

/** A room's walls run one per edge of its outline, in order */
const aligned = (room: BERoom) => room.wallIds.length > 0 && room.wallIds.length === room.boundary.length;

/** The wall nearest a plan point, within `tolPx` of it and between its ends; where along it, inches */
export function wallAt(walls: BEWall[], p: BEPoint, tolPx: number, pixelsPerFoot: number): { wall: BEWall; alongIn: number } | null {
  let best: { wall: BEWall; alongIn: number } | null = null;
  let bestOff = tolPx;
  for (const w of walls) {
    const a = along(w, p);
    if (a.t < 0 || a.t > a.len || a.off > bestOff) continue;
    bestOff = a.off;
    best = { wall: w, alongIn: (a.t / pixelsPerFoot) * 12 };
  }
  return best;
}

// ── Split ──

/** A layer's tile as stored regions with ids of their own (older whole-wall fields read as regions) */
function layerRegions(wall: BEWall, layer: WallFinishLayer, ppf: number): BEWallTileRegion[] | undefined {
  const stored = layer === 'new' ? wall.tileRegions : wall.existingTileRegions;
  const legacy = layer === 'new' ? wall.finish : wall.existingFinish;
  if (stored === undefined && legacy === undefined) return undefined;
  return wallTileRegions(wall, layer, ppf).map((r) => (r.id.startsWith('legacy') ? { ...r, id: newRegionId() } : r));
}

/**
 * Regions cut at `atIn`: those before it, and those after it measured from
 * it. A region across the cut is in both, its border rows in both and its
 * inserts in the larger piece.
 */
function cutRegions(regions: BEWallTileRegion[], atIn: number): [BEWallTileRegion[], BEWallTileRegion[]] {
  const before: BEWallTileRegion[] = [];
  const after: BEWallTileRegion[] = [];
  for (const r of regions) {
    const inA = Math.min(r.endIn, atIn) - r.startIn;
    const inB = r.endIn - Math.max(r.startIn, atIn);
    const both = inA > 0.01 && inB > 0.01;
    const insertsHere = (first: boolean) => (r.decoInserts === undefined || !both || (inA >= inB) === first
      ? {} : { decoInserts: 0 });
    if (inA > 0.01) before.push({ ...r, endIn: round2(Math.min(r.endIn, atIn)), ...insertsHere(true) });
    if (inB > 0.01) {
      after.push({
        ...r,
        id: both ? newRegionId() : r.id,
        startIn: round2(Math.max(r.startIn, atIn) - atIn),
        endIn: round2(r.endIn - atIn),
        ...insertsHere(false),
      });
    }
  }
  return [before, after];
}

const LEGACY_NEW = { finish: undefined } as const;
const LEGACY_EXISTING = { existingFinish: undefined, existingTileFromInches: undefined, existingTileToInches: undefined } as const;

/**
 * The wall cut in two `atIn` inches from its start: it keeps its id for the
 * piece from its start, and the piece to its end is `newId`. Null when the
 * cut leaves a piece shorter than MIN_PIECE_IN.
 */
export function splitWall(d: BESketchData, wallId: string, atIn: number, newId: string): BESketchData | null {
  const wall = d.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const ppf = d.settings.pixelsPerFoot;
  const lengthIn = wallLengthIn(wall, ppf);
  if (!(atIn >= MIN_PIECE_IN && atIn <= lengthIn - MIN_PIECE_IN)) return null;
  const k = atIn / lengthIn;
  const p = { x: round2(wall.start.x + (wall.end.x - wall.start.x) * k), y: round2(wall.start.y + (wall.end.y - wall.start.y) * k) };

  let first: BEWall = { ...wall, end: p };
  let second: BEWall = { ...wall, id: newId, start: p };
  const tile = layerRegions(wall, 'new', ppf);
  if (tile) {
    const [a, b] = cutRegions(tile, atIn);
    first = { ...first, ...LEGACY_NEW, tileRegions: a };
    second = { ...second, ...LEGACY_NEW, tileRegions: b };
  }
  const existing = layerRegions(wall, 'existing', ppf);
  if (existing) {
    const [a, b] = cutRegions(existing, atIn);
    first = { ...first, ...LEGACY_EXISTING, existingTileRegions: a };
    second = { ...second, ...LEGACY_EXISTING, existingTileRegions: b };
  }

  const walls = d.walls.flatMap((w) => (w.id === wallId ? [first, second] : [w]));
  // A door or window tied to the wall goes with the piece it's in
  const cutPx = (atIn / 12) * ppf;
  const fixtures = d.fixtures.map((f) => (f.wallId === wallId && along(wall, f.position).t > cutPx ? { ...f, wallId: newId } : f));
  const rooms = d.rooms.map((r) => {
    if (!r.wallIds.includes(wallId)) return r;
    const e = edgeIndex(r.boundary, wall);
    const wasAligned = aligned(r) && e >= 0 && r.wallIds[e] === wallId;
    const wallIds = [...r.wallIds];
    if (wasAligned) {
      // The edge runs start → end or end → start of the wall
      wallIds.splice(e, 1, ...(near(r.boundary[e], wall.start) ? [wallId, newId] : [newId, wallId]));
    } else {
      wallIds.splice(wallIds.indexOf(wallId) + 1, 0, newId);
    }
    if (e < 0) return { ...r, wallIds };
    const boundary = [...r.boundary];
    boundary.splice(e + 1, 0, p);
    return { ...r, boundary, wallIds };
  });
  return { ...d, walls, fixtures, rooms };
}

/** Cut at two points (inches from its start): the middle piece is `middleId`, the end piece `endId` */
export function splitWallTwice(
  d: BESketchData, wallId: string, aIn: number, bIn: number, middleId: string, endId: string,
): BESketchData | null {
  const lo = Math.min(aIn, bIn);
  const hi = Math.max(aIn, bIn);
  if (hi - lo < MIN_PIECE_IN) return null;
  const once = splitWall(d, wallId, hi, endId);
  return once && splitWall(once, wallId, lo, middleId);
}

// ── Join ──

/** The ends of other walls at a point, and whether a wall runs through it */
function wallsAt(walls: BEWall[], p: BEPoint, exceptId: string) {
  const ends: { wall: BEWall; end: 'start' | 'end' }[] = [];
  let through = false;
  for (const w of walls) {
    if (w.id === exceptId) continue;
    if (near(w.start, p)) ends.push({ wall: w, end: 'start' });
    else if (near(w.end, p)) ends.push({ wall: w, end: 'end' });
    else {
      const a = along(w, p);
      if (a.off < MEET_PX && a.t > 0 && a.t < a.len) through = true;
    }
  }
  return { ends, through };
}

/**
 * The wall in line with this one at each end that it can be joined with:
 * the only other wall ending there, carrying on the other way.
 */
export function joinableAt(walls: BEWall[], wall: BEWall): { start?: BEWall; end?: BEWall } {
  const out: { start?: BEWall; end?: BEWall } = {};
  for (const which of ['start', 'end'] as const) {
    const p = wall[which];
    const far = which === 'start' ? wall.end : wall.start;
    const { ends, through } = wallsAt(walls, p, wall.id);
    if (through || ends.length !== 1) continue;
    const other = ends[0].wall;
    const otherFar = ends[0].end === 'start' ? other.end : other.start;
    // In line, and going on past the point rather than back over this wall
    const goesOn = (far.x - p.x) * (otherFar.x - p.x) + (far.y - p.y) * (otherFar.y - p.y) < 0;
    if (inLine(wall, other) && goesOn) out[which] = other;
  }
  return out;
}

/** Fuse regions that meet at `atIn` with the same bottom and top (the two halves of a split region) */
function fuseAt(regions: BEWallTileRegion[], atIn: number): BEWallTileRegion[] {
  const out = [...regions];
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (i === j || !a || !b) continue;
      if (Math.abs(a.endIn - atIn) > 0.05 || Math.abs(b.startIn - atIn) > 0.05) continue;
      if (Math.abs(a.bottomIn - b.bottomIn) > 0.05 || Math.abs(a.topIn - b.topIn) > 0.05) continue;
      const borders = a.decoBordersAtIn || b.decoBordersAtIn
        ? Array.from(new Set([...(a.decoBordersAtIn ?? []), ...(b.decoBordersAtIn ?? [])])).sort((x, y) => x - y)
        : undefined;
      const inserts = a.decoInserts !== undefined || b.decoInserts !== undefined
        ? (a.decoInserts ?? 0) + (b.decoInserts ?? 0) : undefined;
      out[i] = {
        ...a,
        endIn: b.endIn,
        ...(borders ? { decoBordersAtIn: borders } : {}),
        ...(inserts !== undefined ? { decoInserts: inserts } : {}),
      };
      out.splice(j, 1);
      return fuseAt(out, atIn);
    }
  }
  return out;
}

/** Regions of a wall placed on a longer one: from `offsetIn`, reversed when the wall runs the other way */
function placeRegions(regions: BEWallTileRegion[], lengthIn: number, offsetIn: number, reversed: boolean): BEWallTileRegion[] {
  return regions.map((r) => (reversed
    ? { ...r, startIn: round2(offsetIn + lengthIn - r.endIn), endIn: round2(offsetIn + lengthIn - r.startIn) }
    : { ...r, startIn: round2(offsetIn + r.startIn), endIn: round2(offsetIn + r.endIn) }));
}

/**
 * The wall and the one in line with it at one end, one wall again: it keeps
 * its id, height and name; the other's tile, doors and windows come onto it.
 */
export function joinWalls(d: BESketchData, wallId: string, otherId: string): BESketchData | null {
  const a = d.walls.find((w) => w.id === wallId);
  const b = d.walls.find((w) => w.id === otherId);
  if (!a || !b) return null;
  const at = joinableAt(d.walls, a);
  const which = at.start?.id === otherId ? 'start' : at.end?.id === otherId ? 'end' : null;
  if (!which) return null;
  const ppf = d.settings.pixelsPerFoot;
  const lenA = wallLengthIn(a, ppf);
  const lenB = wallLengthIn(b, ppf);
  const joint = a[which];
  const bFar = near(b.start, joint) ? b.end : b.start;
  const bFromJoint = near(b.start, joint);

  // Measured along the joined wall, from its start
  let merged: BEWall;
  let aOffset: number;
  let bOffset: number;
  let bReversed: boolean;
  if (which === 'end') {
    merged = { ...a, end: { ...bFar } };
    aOffset = 0;
    bOffset = lenA;
    bReversed = !bFromJoint;
  } else {
    merged = { ...a, start: { ...bFar } };
    aOffset = lenB;
    bOffset = 0;
    bReversed = bFromJoint;
  }
  const jointIn = which === 'end' ? lenA : lenB;
  merged = { ...merged, label: a.label ?? b.label };
  for (const layer of ['new', 'existing'] as const) {
    const ra = layerRegions(a, layer, ppf);
    const rb = layerRegions(b, layer, ppf);
    if (!ra && !rb) continue;
    const regions = fuseAt([
      ...placeRegions(ra ?? [], lenA, aOffset, false),
      ...placeRegions(rb ?? [], lenB, bOffset, bReversed),
    ], jointIn);
    merged = layer === 'new'
      ? { ...merged, ...LEGACY_NEW, tileRegions: regions }
      : { ...merged, ...LEGACY_EXISTING, existingTileRegions: regions };
  }

  const walls = d.walls.filter((w) => w.id !== otherId).map((w) => (w.id === wallId ? merged : w));
  const fixtures = d.fixtures.map((f) => (f.wallId === otherId ? { ...f, wallId } : f));
  const rooms = d.rooms.map((r) => {
    // Rooms of neither wall keep their outline: a corner that turns nowhere is harmless
    if (!r.wallIds.includes(otherId) && !r.wallIds.includes(wallId)) return r;
    const n = r.boundary.length;
    const i = r.boundary.findIndex((p) => near(p, joint));
    const into = (i - 1 + n) % n;
    const straight = i >= 0 && n > 3
      && inLine({ start: r.boundary[into], end: joint }, { start: joint, end: r.boundary[(i + 1) % n] });
    const pair = new Set([r.wallIds[into], r.wallIds[i]]);
    if (straight && aligned(r) && pair.has(wallId) && pair.has(otherId)) {
      // Edge i (from the joint) goes; the edge into the joint runs on to the next corner, the joined wall
      const keep = r.boundary.map((p, k) => ({ p, wall: r.wallIds[k] })).filter((_, k) => k !== i);
      const intoAt = into < i ? into : into - 1;
      keep[intoAt] = { ...keep[intoAt], wall: wallId };
      return { ...r, boundary: keep.map((e) => e.p), wallIds: keep.map((e) => e.wall) };
    }
    const wallIds = r.wallIds.includes(wallId)
      ? r.wallIds.filter((id) => id !== otherId)
      : r.wallIds.map((id) => (id === otherId ? wallId : id));
    const boundary = straight ? r.boundary.filter((_, k) => k !== i) : r.boundary;
    return { ...r, boundary, wallIds };
  });
  return { ...d, walls, fixtures, rooms };
}

// ── Offset ──

/** A point of a fixture in its own frame (px from its centre, before it's turned) */
function fixturePoint(fix: BEFixture, lx: number, ly: number): BEPoint {
  const rad = ((fix.rotation || 0) * Math.PI) / 180;
  return {
    x: fix.position.x + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: fix.position.y + lx * Math.sin(rad) + ly * Math.cos(rad),
  };
}

/**
 * What moves with a wall: a door or window in it (tied to it, or its edge in
 * the wall within the wall's ends), a mirror, cabinet, niche or wall light on
 * it. A tub, shower, vanity or toilet stands on the floor and stays.
 */
export function movesWithWall(fix: BEFixture, wall: BEWall, pixelsPerFoot: number): boolean {
  if (fix.wallId === wall.id) return true;
  const hw = ((fix.dimensions.width / 12) * pixelsPerFoot) / 2;
  const hh = ((fix.dimensions.height / 12) * pixelsPerFoot) / 2;
  let pts: BEPoint[];
  if (fix.type === 'door') pts = [fixturePoint(fix, -hw, hh), fixturePoint(fix, hw, hh)];
  else if (fix.type === 'window') pts = [fixturePoint(fix, -hw, 0), fixturePoint(fix, hw, 0)];
  else if (fix.type === 'mirror' || fix.type === 'cabinet' || fix.type === 'niche'
    || (fix.type === 'light' && isWallLight(fix.properties.lightType))) {
    pts = [fixturePoint(fix, 0, -hh)];
  } else return false;
  const ats = pts.map((p) => along(wall, p));
  if (ats.some((a) => a.off > ON_WALL_PX)) return false;
  const mid = ats.reduce((s, a) => s + a.t, 0) / ats.length;
  return mid >= 0 && mid <= ats[0].len;
}

function measured(room: BERoom, ppf: number): BERoom {
  const b = room.boundary;
  let per = 0;
  let area2 = 0;
  for (let i = 0; i < b.length; i++) {
    const j = (i + 1) % b.length;
    per += Math.hypot(b[j].x - b[i].x, b[j].y - b[i].y);
    area2 += b[i].x * b[j].y - b[j].x * b[i].y;
  }
  const floorAreaSF = Math.round((Math.abs(area2) / 2 / (ppf * ppf)) * 100) / 100;
  const perimeterLF = Math.round((per / ppf) * 100) / 100;
  return {
    ...room,
    floorAreaSF,
    netFloorAreaSF: floorAreaSF,
    perimeterLF,
    wallAreaSF: roomWallAreaSF(perimeterLF, room.heightInches),
  };
}

function withNetAreas(rooms: BERoom[]): BERoom[] {
  return rooms.map((room) => {
    const sub = rooms.filter((r) => r.parentRoomId === room.id).reduce((s, r) => s + r.floorAreaSF, 0);
    return { ...room, netFloorAreaSF: Math.round((room.floorAreaSF - sub) * 100) / 100 };
  });
}

/** The arrays turned so that index `k` comes first, and back */
const turn = <T,>(xs: T[], k: number): T[] => xs.slice(k).concat(xs.slice(0, k));
const unturn = <T,>(xs: T[], k: number): T[] => turn(xs, (xs.length - (k % xs.length)) % xs.length);

/**
 * The wall moved `offsetPx` square to itself, toward its left normal
 * (wallNormal) when positive. At each end: a wall carrying on in line with
 * it gets a short wall at the step (`stepIds`, for its start's and its
 * end's), walls meeting it at a corner stretch. A wall's end landing partway
 * along another slides along it. Its doors, windows and what hangs on it
 * move with it, as do drywall and insulation drawn along it; the rooms'
 * outlines follow, re-measured.
 */
export function offsetWall(d: BESketchData, wallId: string, offsetPx: number, stepIds: [string, string]): BESketchData {
  const wall = d.walls.find((w) => w.id === wallId);
  if (!wall || Math.abs(offsetPx) < 0.01) return d;
  const ppf = d.settings.pixelsPerFoot;
  const n = wallNormal(wall);
  const v = { x: n.x * offsetPx, y: n.y * offsetPx };

  const ends = (['start', 'end'] as const).map((which, i) => {
    const p = wall[which];
    const at = wallsAt(d.walls, p, wall.id).ends;
    const step = at.some((e) => inLine(e.wall, wall));
    return { which, p, at, step, stepId: stepIds[i] };
  });

  // The walls: this one moved, corner walls stretched, a short wall at each step
  const stretched = new Map<string, Partial<BEWall>>();
  const steps: BEWall[] = [];
  for (const e of ends) {
    if (e.step) {
      steps.push({ id: e.stepId, start: { ...e.p }, end: add(e.p, v), thickness: wall.thickness, heightInches: wall.heightInches });
    } else {
      for (const { wall: w, end } of e.at) stretched.set(w.id, { ...stretched.get(w.id), [end]: add(e.p, v) });
    }
  }
  const walls = d.walls
    .map((w) => {
      if (w.id === wallId) return { ...w, start: add(w.start, v), end: add(w.end, v) };
      const s = stretched.get(w.id);
      return s ? { ...w, ...s } : w;
    })
    .concat(steps);

  const fixtures = d.fixtures.map((f) => (movesWithWall(f, wall, ppf) ? { ...f, position: add(f.position, v) } : f));
  const alongIt = (line: BEPoint[]) => line.length === 2 && line.every((p) => {
    const a = along(wall, p);
    return a.off <= ON_WALL_PX && a.t >= -ON_WALL_PX && a.t <= a.len + ON_WALL_PX;
  });
  const drywallRepairZones = (d.drywallRepairZones ?? []).map((z) => (z.surface === 'wall' && alongIt(z.boundary)
    ? { ...z, boundary: z.boundary.map((p) => add(p, v)) } : z));
  const insulationZones = (d.insulationZones ?? []).map((z) => (z.surface === 'wall' && alongIt(z.boundary)
    ? { ...z, boundary: z.boundary.map((p) => add(p, v)) } : z));

  const endAt = (p: BEPoint) => ends.find((e) => near(e.p, p))!;
  const rooms = withNetAreas(d.rooms.map((r) => {
    const k = edgeIndex(r.boundary, wall);
    const owns = r.wallIds.includes(wallId);
    if (k < 0 || (!owns && d.walls.some((w) => r.wallIds.includes(w.id) && edgeIndex(r.boundary, w) === k))) {
      // Not along this wall (or along a wall of its own on the same line): a
      // corner on a wall that stretched follows it
      let moved = false;
      const boundary = r.boundary.map((p) => {
        const e = ends.find((x) => !x.step && x.at.length && near(x.p, p));
        if (!e) return p;
        moved = true;
        return add(p, v);
      });
      return moved ? measured({ ...r, boundary }, ppf) : r;
    }
    // The outline from this wall's edge on: its first corner, its second, the rest
    const b = turn(r.boundary, k);
    const first = endAt(b[0]);
    const second = endAt(b[1]);
    const boundary = [
      ...(first.step ? [b[0], add(b[0], v)] : [add(b[0], v)]),
      ...(second.step ? [add(b[1], v), b[1]] : [add(b[1], v)]),
      ...b.slice(2),
    ];
    // The step walls are the room's that owns the wall; a room that only
    // shares its line has its outline follow
    let wallIds = r.wallIds;
    if (owns && aligned(r) && r.wallIds[k] === wallId) {
      const ids = turn(r.wallIds, k);
      wallIds = unturn([
        ...(first.step ? [first.stepId] : []),
        wallId,
        ...(second.step ? [second.stepId] : []),
        ...ids.slice(1),
      ], k);
    } else if (owns) {
      wallIds = [...r.wallIds, ...steps.map((s) => s.id)];
    }
    return measured({ ...r, boundary: unturn(boundary, k), wallIds }, ppf);
  }));

  return { ...d, walls, fixtures, rooms, drywallRepairZones, insulationZones };
}

/**
 * Where two walls meet in line with nothing else there: the breaks a split
 * leaves, to mark on the plan. Each with the direction of its walls.
 */
export function wallBreaks(walls: BEWall[]): { at: BEPoint; dir: BEPoint }[] {
  const out: { at: BEPoint; dir: BEPoint }[] = [];
  for (const w of walls) {
    const at = joinableAt(walls, w);
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
    const dir = { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
    if (at.start) out.push({ at: w.start, dir });
    if (at.end) out.push({ at: w.end, dir });
  }
  // Each break is found from both its walls
  return out.filter((b, i) => out.findIndex((c) => near(c.at, b.at)) === i);
}
