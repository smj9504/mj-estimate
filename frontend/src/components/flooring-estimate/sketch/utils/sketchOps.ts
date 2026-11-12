/**
 * Changes to a flooring sketch, each returning a new sketch. They keep it in
 * the shape the server accepts: every opening and cabinet run refers to a
 * room that is drawn, and sits on that room's wall.
 */

import type {
  FixtureType,
  FlooringSketch,
  FtPoint,
  SketchCabinetRun,
  SketchFixture,
  SketchLevel,
  SketchOpening,
  SketchRoom,
} from '../../../../types/flooringEstimate';
import { pointInPolygon, reattach, translate } from './geometry';

export const DEFAULT_LEVEL_NAME = 'Main Level';

/** Fixture footprints in feet: [width, depth] */
export const FIXTURE_SIZES: Record<FixtureType, [number, number]> = {
  toilet: [1.6, 2.4],
  vanity: [2.5, 1.75],
  island: [6, 3],
  refrigerator: [3, 2.5],
  range: [2.5, 2.2],
  dishwasher: [2, 2],
  washer: [2.25, 2.25],
  dryer: [2.25, 2.25],
  other: [2, 2],
};

export const FIXTURE_LABELS: Record<FixtureType, string> = {
  toilet: 'Toilet',
  vanity: 'Vanity',
  island: 'Island',
  refrigerator: 'Refrigerator',
  range: 'Range',
  dishwasher: 'Dishwasher',
  washer: 'Washer',
  dryer: 'Dryer',
  other: 'Other',
};

let counter = 0;
/** A short id, unique within a sketch */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

export function emptyLevel(name = DEFAULT_LEVEL_NAME, id?: string): SketchLevel {
  return { id: id ?? newId('lvl'), name, rooms: [], openings: [], cabinet_runs: [], fixtures: [] };
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

/** Moves a room with what is on it: its doorways, cabinet runs and the fixtures standing in it */
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
      fixtures: l.fixtures.map((f) => (pointInPolygon(f, room.points) ? { ...f, x: f.x + dx, y: f.y + dy } : f)),
    };
  });
}

/** Removes a room and what can't stand without it: its doorways and cabinet runs */
export function removeRoom(sketch: FlooringSketch, levelId: string, roomId: string): FlooringSketch {
  return onLevel(sketch, levelId, (l) => ({
    ...l,
    rooms: l.rooms
      .filter((r) => r.id !== roomId)
      .map((r) => (r.subroom_of === roomId ? { ...r, subroom_of: null } : r)),
    openings: l.openings.filter((o) => !o.rooms.includes(roomId)),
    cabinet_runs: l.cabinet_runs.filter((c) => c.room_id !== roomId),
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
