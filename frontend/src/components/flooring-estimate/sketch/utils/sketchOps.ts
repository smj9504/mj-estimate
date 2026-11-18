/**
 * Changes to a flooring sketch, each returning a new sketch. They keep it in
 * the shape the server accepts: every opening and cabinet run refers to a
 * room that is drawn, and sits on that room's wall.
 */

import type {
  FixtureType,
  FloorFit,
  FlooringSketch,
  FtPoint,
  SketchCabinetRun,
  SketchFixture,
  SketchLevel,
  SketchOpening,
  SketchRoom,
  SketchWall,
} from '../../../../types/flooringEstimate';
import { WALL_T, edgesOf, pointInPolygon, projectOnSegment, reattach, translate } from './geometry';
import { combinedOutline } from './combine';

export const DEFAULT_LEVEL_NAME = 'Main Level';

/** Fixture footprints in feet: [width, depth] */
export const FIXTURE_SIZES: Record<FixtureType, [number, number]> = {
  toilet: [1.6, 2.4],
  vanity: [2.5, 1.75],
  pedestal_sink: [1.75, 1.5],
  utility_sink: [2, 2],
  island: [6, 3],
  refrigerator: [3, 2.5],
  range: [2.5, 2.2],
  dishwasher: [2, 2],
  washer: [2.25, 2.25],
  dryer: [2.25, 2.25],
  // A 4" x 10" register with its flange
  floor_register: [1, 0.45],
  other: [2, 2],
};

export const FIXTURE_LABELS: Record<FixtureType, string> = {
  toilet: 'Toilet',
  vanity: 'Vanity',
  pedestal_sink: 'Pedestal sink',
  utility_sink: 'Utility sink',
  island: 'Island',
  refrigerator: 'Refrigerator',
  range: 'Range',
  dishwasher: 'Dishwasher',
  washer: 'Washer',
  dryer: 'Dryer',
  floor_register: 'Floor register',
  other: 'Other',
};

/**
 * Whether each type sits on the new floor (set back on top of it) or needs a hole in it, so the floor is
 * cut to fit it, more labor. Every type has to say; a fixture may say its own (floor_fit). The server
 * keeps the same table (flooring_estimate/geometry.py FIXTURE_KINDS), prices the cutting into the room's
 * floor line and notes it in the PDF.
 */
export const FIXTURE_FLOOR_FIT: Record<FixtureType, FloorFit> = {
  // Set on the new floor, over a hole cut for its flange
  toilet: 'cut_to_fit',
  vanity: 'on_top',
  pedestal_sink: 'on_top',
  utility_sink: 'on_top',
  // Detached and reset, it goes on top of the new floor; left in place, the floor stops at it (floor_under)
  island: 'on_top',
  refrigerator: 'on_top',
  range: 'on_top',
  // Goes with the cabinets: nothing to cut around it
  dishwasher: 'on_top',
  washer: 'on_top',
  dryer: 'on_top',
  // Drops into its duct's opening, cut in the new floor
  floor_register: 'cut_to_fit',
  other: 'on_top',
};

export const FLOOR_FIT_LABELS: Record<FloorFit, string> = {
  on_top: 'Sits on top',
  cut_to_fit: 'Floor cut to fit it',
};

/** How this fixture meets the new floor; null for an island left in place (the floor stops at it) */
export function floorFitOf(f: SketchFixture): FloorFit | null {
  if (f.type === 'island') return f.floor_under ? 'on_top' : null;
  return f.floor_fit ?? FIXTURE_FLOOR_FIT[f.type] ?? 'on_top';
}

let counter = 0;
/** A short id, unique within a sketch */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

export function emptyLevel(name = DEFAULT_LEVEL_NAME, id?: string): SketchLevel {
  return { id: id ?? newId('lvl'), name, rooms: [], openings: [], cabinet_runs: [], fixtures: [], walls: [] };
}

export function emptySketch(): FlooringSketch {
  return { version: 1, units: 'ft', levels: [emptyLevel(DEFAULT_LEVEL_NAME, 'main')] };
}

/** A sketch from the server, with every list present */
export function normalizeSketch(raw: unknown): FlooringSketch {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<FlooringSketch>;
  const levels = Array.isArray(data.levels) && data.levels.length ? data.levels : emptySketch().levels;
  return {
    ...data,
    version: 1,
    units: 'ft',
    levels: levels.map((l) => ({
      ...l,
      id: l.id || newId('lvl'),
      name: l.name || DEFAULT_LEVEL_NAME,
      rooms: Array.isArray(l.rooms) ? l.rooms : [],
      openings: Array.isArray(l.openings) ? l.openings : [],
      cabinet_runs: Array.isArray(l.cabinet_runs) ? l.cabinet_runs : [],
      fixtures: Array.isArray(l.fixtures) ? l.fixtures : [],
      walls: Array.isArray(l.walls) ? l.walls : [],
    })),
  };
}

export function allRooms(sketch: FlooringSketch): SketchRoom[] {
  return sketch.levels.flatMap((l) => l.rooms);
}

function onLevel(sketch: FlooringSketch, levelId: string, change: (level: SketchLevel) => SketchLevel): FlooringSketch {
  return { ...sketch, levels: sketch.levels.map((l) => (l.id === levelId ? change(l) : l)) };
}

// ── Levels ──

export function addLevel(sketch: FlooringSketch, name: string): { sketch: FlooringSketch; levelId: string } {
  const level = emptyLevel(name);
  return { sketch: { ...sketch, levels: [...sketch.levels, level] }, levelId: level.id };
}

export const renameLevel = (sketch: FlooringSketch, levelId: string, name: string) =>
  onLevel(sketch, levelId, (l) => ({ ...l, name }));

/** The last level stays: a sketch always has one */
export function removeLevel(sketch: FlooringSketch, levelId: string): FlooringSketch {
  if (sketch.levels.length <= 1) return sketch;
  return { ...sketch, levels: sketch.levels.filter((l) => l.id !== levelId) };
}

// ── Rooms ──

/** The next free "Room N" name */
export function nextRoomName(sketch: FlooringSketch): string {
  const taken = new Set(allRooms(sketch).map((r) => r.name));
  let n = allRooms(sketch).length + 1;
  while (taken.has(`Room ${n}`)) n += 1;
  return `Room ${n}`;
}

export function addRoom(
  sketch: FlooringSketch, levelId: string, points: FtPoint[], fields: Partial<SketchRoom> = {},
): { sketch: FlooringSketch; roomId: string } {
  const room: SketchRoom = {
    id: newId('room'),
    name: nextRoomName(sketch),
    height_ft: 8,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    subroom_of: null,
    ...fields,
  };
  return { sketch: onLevel(sketch, levelId, (l) => ({ ...l, rooms: [...l.rooms, room] })), roomId: room.id };
}

export const updateRoom = (sketch: FlooringSketch, levelId: string, roomId: string, patch: Partial<SketchRoom>) =>
  onLevel(sketch, levelId, (l) => ({ ...l, rooms: l.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) }));

/** A new outline for a room; its doorways and cabinet runs go back onto its walls */
export function setRoomPoints(sketch: FlooringSketch, levelId: string, roomId: string, points: FtPoint[]): FlooringSketch {
  return onLevel(sketch, levelId, (l) => ({
    ...l,
    rooms: l.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)),
    openings: l.openings.map((o) => (o.rooms[0] === roomId ? { ...o, ...reattach(points, o.a, o.b) } : o)),
    cabinet_runs: l.cabinet_runs.map((c) => (c.room_id === roomId ? { ...c, ...reattach(points, c.a, c.b) } : c)),
  }));
}

/** Moves a room with what is on it: its doorways, cabinet runs, walls built out into it and the fixtures standing in it */
export function moveRoom(sketch: FlooringSketch, levelId: string, roomId: string, dx: number, dy: number): FlooringSketch {
  const move = (p: FtPoint) => ({ x: p.x + dx, y: p.y + dy });
  return onLevel(sketch, levelId, (l) => {
    const room = l.rooms.find((r) => r.id === roomId);
    if (!room) return l;
    return {
      ...l,
      rooms: l.rooms.map((r) => (r.id === roomId ? { ...r, points: translate(r.points, dx, dy) } : r)),
      openings: l.openings.map((o) => (o.rooms[0] === roomId ? { ...o, a: move(o.a), b: move(o.b) } : o)),
      cabinet_runs: l.cabinet_runs.map((c) => (c.room_id === roomId ? { ...c, a: move(c.a), b: move(c.b) } : c)),
      walls: l.walls.map((w) => (w.room_id === roomId ? { ...w, a: move(w.a), b: move(w.b) } : w)),
      fixtures: l.fixtures.map((f) => (pointInPolygon(f, room.points) ? { ...f, x: f.x + dx, y: f.y + dy } : f)),
    };
  });
}

/**
 * Rooms combined into one (the first): one outline across the walls between
 * them, keeping the first room's name, height and id, so what is on it stays
 * on it; the others' ids are kept on it (merged_from) for what was on them.
 * Doorways and open sides between them go with the walls; the rest, their
 * cabinet runs and built-out walls are the combined room's, back on its walls.
 */
export function combineRooms(
  sketch: FlooringSketch, levelId: string, keepId: string, otherIds: string[],
): { sketch: FlooringSketch } | { error: string } {
  const level = sketch.levels.find((l) => l.id === levelId);
  const keep = level?.rooms.find((r) => r.id === keepId);
  const others = (level?.rooms || []).filter((r) => otherIds.includes(r.id) && r.id !== keepId);
  if (!level || !keep || others.length === 0) return { error: 'Pick the rooms to combine it with.' };
  const outline = combinedOutline([keep, ...others].map((r) => r.points));
  if (!outline) return { error: "These rooms don't meet: combine rooms with a wall, a doorway or an open side between them." };
  const gone = new Set(others.map((r) => r.id));
  const members = new Set([keepId, ...gone]);
  const swap = (id: string | null | undefined) => (id && gone.has(id) ? keepId : id ?? null);
  const merged = Array.from(new Set([...(keep.merged_from || []), ...others.flatMap((r) => [r.id, ...(r.merged_from || [])])]));
  const between = level.openings.filter((o) => o.rooms.length === 2 && o.rooms.every((id) => !!id && members.has(id)));
  const next = onLevel(sketch, levelId, (l) => ({
    ...l,
    rooms: l.rooms
      .filter((r) => !gone.has(r.id))
      .map((r) => {
        if (r.id === keepId) {
          return {
            ...r,
            merged_from: merged,
            subroom_of: r.subroom_of && members.has(r.subroom_of) ? null : r.subroom_of,
            // As they were, to separate them again
            combined_from: { rooms: [keep, ...others], openings: between },
          };
        }
        return r.subroom_of && gone.has(r.subroom_of) ? { ...r, subroom_of: keepId } : r;
      }),
    openings: l.openings
      .filter((o) => !(o.rooms.length === 2 && o.rooms.every((id) => !!id && members.has(id))))
      .map((o) => ({
        ...o,
        rooms: o.rooms.map((id) => swap(id)) as SketchOpening['rooms'],
        ...(o.swing !== undefined ? { swing: swap(o.swing) } : {}),
      })),
    cabinet_runs: l.cabinet_runs.map((c) => (gone.has(c.room_id) ? { ...c, room_id: keepId } : c)),
    walls: l.walls.map((w) => (gone.has(w.room_id) ? { ...w, room_id: keepId } : w)),
  }));
  return { sketch: setRoomPoints(next, levelId, keepId, outline) };
}

/**
 * A combined room separated again into the rooms it was combined from, as
 * they were (the doorways between them back too). A doorway, cabinet run or
 * wall now on the combined room goes back to the room whose wall or floor
 * it is on.
 */
export function separateRoom(sketch: FlooringSketch, levelId: string, roomId: string): FlooringSketch {
  const level = sketch.levels.find((l) => l.id === levelId);
  const room = level?.rooms.find((r) => r.id === roomId);
  const before = room?.combined_from;
  if (!level || !room || !before?.rooms?.length) return sketch;
  const parts = before.rooms;
  const near = (p: FtPoint) => {
    let best = parts[0];
    let bestD = Infinity;
    for (const part of parts) {
      if (pointInPolygon(p, part.points)) return part.id;
      for (const e of edgesOf(part.points)) {
        const d = projectOnSegment(p, e.a, e.b).dist;
        if (d < bestD) {
          bestD = d;
          best = part;
        }
      }
    }
    return best.id;
  };
  const mid = (a: FtPoint, b: FtPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const back = (id: string | null, a: FtPoint, b: FtPoint) => (id === roomId ? near(mid(a, b)) : id);
  return onLevel(sketch, levelId, (l) => ({
    ...l,
    rooms: l.rooms.flatMap((r) => (r.id === roomId ? parts : [r])),
    openings: [
      ...l.openings.map((o) => {
        if (!o.rooms.includes(roomId)) return o;
        const rooms = o.rooms.map((id) => back(id, o.a, o.b)) as SketchOpening['rooms'];
        return { ...o, rooms, ...(o.swing === roomId ? { swing: rooms[0] } : {}) };
      }),
      ...(before.openings || []),
    ],
    cabinet_runs: l.cabinet_runs.map((c) => (c.room_id === roomId ? { ...c, room_id: near(mid(c.a, c.b)) } : c)),
    walls: l.walls.map((w) => (w.room_id === roomId ? { ...w, room_id: near(w.a) } : w)),
  }));
}

/** Removes a room and what can't stand without it: its doorways, cabinet runs and walls */
export function removeRoom(sketch: FlooringSketch, levelId: string, roomId: string): FlooringSketch {
  return onLevel(sketch, levelId, (l) => ({
    ...l,
    rooms: l.rooms
      .filter((r) => r.id !== roomId)
      .map((r) => (r.subroom_of === roomId ? { ...r, subroom_of: null } : r)),
    openings: l.openings.filter((o) => !o.rooms.includes(roomId)),
    cabinet_runs: l.cabinet_runs.filter((c) => c.room_id !== roomId),
    walls: l.walls.filter((w) => w.room_id !== roomId),
  }));
}

// ── Openings, cabinet runs, fixtures ──

export function addOpening(sketch: FlooringSketch, levelId: string, opening: Omit<SketchOpening, 'id'>) {
  const full: SketchOpening = { id: newId('open'), ...opening };
  return { sketch: onLevel(sketch, levelId, (l) => ({ ...l, openings: [...l.openings, full] })), openingId: full.id };
}

export const updateOpening = (sketch: FlooringSketch, levelId: string, id: string, patch: Partial<SketchOpening>) =>
  onLevel(sketch, levelId, (l) => ({ ...l, openings: l.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

export const removeOpening = (sketch: FlooringSketch, levelId: string, id: string) =>
  onLevel(sketch, levelId, (l) => ({ ...l, openings: l.openings.filter((o) => o.id !== id) }));

export function addCabinetRun(sketch: FlooringSketch, levelId: string, run: Omit<SketchCabinetRun, 'id'>) {
  const full: SketchCabinetRun = { id: newId('cab'), ...run };
  return { sketch: onLevel(sketch, levelId, (l) => ({ ...l, cabinet_runs: [...l.cabinet_runs, full] })), runId: full.id };
}

export const updateCabinetRun = (sketch: FlooringSketch, levelId: string, id: string, patch: Partial<SketchCabinetRun>) =>
  onLevel(sketch, levelId, (l) => ({
    ...l,
    cabinet_runs: l.cabinet_runs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  }));

export const removeCabinetRun = (sketch: FlooringSketch, levelId: string, id: string) =>
  onLevel(sketch, levelId, (l) => ({ ...l, cabinet_runs: l.cabinet_runs.filter((c) => c.id !== id) }));

export function addWall(sketch: FlooringSketch, levelId: string, wall: Omit<SketchWall, 'id' | 'thickness'> & { thickness?: number }) {
  const full: SketchWall = { id: newId('wall'), thickness: WALL_T, ...wall };
  return { sketch: onLevel(sketch, levelId, (l) => ({ ...l, walls: [...l.walls, full] })), wallId: full.id };
}

export const updateWall = (sketch: FlooringSketch, levelId: string, id: string, patch: Partial<SketchWall>) =>
  onLevel(sketch, levelId, (l) => ({ ...l, walls: l.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));

export const removeWall = (sketch: FlooringSketch, levelId: string, id: string) =>
  onLevel(sketch, levelId, (l) => ({ ...l, walls: l.walls.filter((w) => w.id !== id) }));

export function addFixture(sketch: FlooringSketch, levelId: string, type: FixtureType, at: FtPoint) {
  const [w, h] = FIXTURE_SIZES[type];
  const fixture: SketchFixture = { id: newId('fix'), type, x: at.x, y: at.y, w, h, rotation: 0, floor_under: false };
  return { sketch: onLevel(sketch, levelId, (l) => ({ ...l, fixtures: [...l.fixtures, fixture] })), fixtureId: fixture.id };
}

export const updateFixture = (sketch: FlooringSketch, levelId: string, id: string, patch: Partial<SketchFixture>) =>
  onLevel(sketch, levelId, (l) => ({ ...l, fixtures: l.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

export const removeFixture = (sketch: FlooringSketch, levelId: string, id: string) =>
  onLevel(sketch, levelId, (l) => ({ ...l, fixtures: l.fixtures.filter((f) => f.id !== id) }));

// ── Undo / redo ──

export const HISTORY_LIMIT = 50;

export interface SketchHistory {
  past: FlooringSketch[];
  present: FlooringSketch;
  future: FlooringSketch[];
}

export type HistoryAction =
  | { type: 'apply'; sketch: FlooringSketch }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; sketch: FlooringSketch };

export function historyReducer(state: SketchHistory, action: HistoryAction): SketchHistory {
  switch (action.type) {
    case 'apply':
      if (action.sketch === state.present) return state;
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.sketch,
        future: [],
      };
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case 'reset':
      return { past: [], present: action.sketch, future: [] };
    default:
      return state;
  }
}
