import { describe, expect, it } from 'vitest';
import { rectPoints } from './geometry';
import {
  FIXTURE_FLOOR_FIT, FIXTURE_LABELS, FIXTURE_SIZES, HISTORY_LIMIT, addCabinetRun, addFixture, addLevel, addOpening, addRoom, addWall,
  emptySketch, floorFitOf, historyReducer, moveRoom, normalizeSketch, removeLevel, removeRoom, removeWall, setRoomPoints,
  updateWall,
} from './sketchOps';

function twoRooms() {
  let s = emptySketch();
  const a = addRoom(s, 'main', rectPoints(0, 0, 12, 10), { name: 'Living Room' });
  s = a.sketch;
  const b = addRoom(s, 'main', rectPoints(12.375, 0, 10, 10));
  s = b.sketch;
  const door = addOpening(s, 'main', {
    kind: 'door', rooms: [a.roomId, b.roomId], a: { x: 12, y: 3 }, b: { x: 12, y: 6 }, swing: b.roomId,
  });
  s = addCabinetRun(door.sketch, 'main', { room_id: b.roomId, a: { x: 12.375, y: 0 }, b: { x: 22.375, y: 0 } }).sketch;
  s = addFixture(s, 'main', 'refrigerator', { x: 20, y: 2 }).sketch;
  return { sketch: s, living: a.roomId, kitchen: b.roomId };
}

describe('rooms', () => {
  it('names new rooms in turn', () => {
    const { sketch } = twoRooms();
    expect(sketch.levels[0].rooms.map((r) => r.name)).toEqual(['Living Room', 'Room 2']);
  });

  it('moves a room with its cabinets and what stands in it', () => {
    const { sketch, kitchen } = twoRooms();
    const moved = moveRoom(sketch, 'main', kitchen, 1, 2).levels[0];
    expect(moved.rooms[1].points[0]).toEqual({ x: 13.375, y: 2 });
    expect(moved.cabinet_runs[0].a).toEqual({ x: 13.375, y: 2 });
    expect(moved.fixtures[0]).toMatchObject({ x: 21, y: 4 });
    // The doorway is on the living room's wall: it stays
    expect(moved.openings[0].a).toEqual({ x: 12, y: 3 });
  });

  it('keeps doorways on the wall when a room is reshaped', () => {
    const { sketch, living } = twoRooms();
    const reshaped = setRoomPoints(sketch, 'main', living, rectPoints(0, 0, 11, 10)).levels[0];
    expect(reshaped.openings[0].a.x).toBeCloseTo(11, 6);
  });

  it('takes a removed room\'s doorways and cabinets with it', () => {
    const { sketch, kitchen } = twoRooms();
    const level = removeRoom(sketch, 'main', kitchen).levels[0];
    expect(level.rooms).toHaveLength(1);
    expect(level.openings).toHaveLength(0);
    expect(level.cabinet_runs).toHaveLength(0);
  });

  it('frees a closet when its room goes', () => {
    let s = emptySketch();
    const bed = addRoom(s, 'main', rectPoints(0, 0, 12, 10));
    s = addRoom(bed.sketch, 'main', rectPoints(0, 10.375, 5, 2), { subroom_of: bed.roomId }).sketch;
    const level = removeRoom(s, 'main', bed.roomId).levels[0];
    expect(level.rooms[0].subroom_of).toBeNull();
  });
});

describe('walls built out into a room', () => {
  it('start 4.5" thick, move with their room and go with it', () => {
    const { sketch, kitchen } = twoRooms();
    const added = addWall(sketch, 'main', { room_id: kitchen, a: { x: 16, y: 10 }, b: { x: 16, y: 8 } });
    expect(added.sketch.levels[0].walls).toEqual([
      { id: added.wallId, room_id: kitchen, a: { x: 16, y: 10 }, b: { x: 16, y: 8 }, thickness: 0.375 },
    ]);
    const moved = moveRoom(added.sketch, 'main', kitchen, 1, 2).levels[0].walls[0];
    expect([moved.a, moved.b]).toEqual([{ x: 17, y: 12 }, { x: 17, y: 10 }]);
    const thicker = updateWall(added.sketch, 'main', added.wallId, { thickness: 0.5 }).levels[0].walls[0];
    expect(thicker.thickness).toBe(0.5);
    expect(removeWall(added.sketch, 'main', added.wallId).levels[0].walls).toEqual([]);
    expect(removeRoom(added.sketch, 'main', kitchen).levels[0].walls).toEqual([]);
  });
});

describe('fixtures', () => {
  it('has the floor register, pedestal sink and utility sink to place', () => {
    for (const type of ['floor_register', 'pedestal_sink', 'utility_sink'] as const) {
      expect(FIXTURE_LABELS[type]).toBeTruthy();
      expect(FIXTURE_SIZES[type][0]).toBeGreaterThan(0);
    }
  });

  it('says for every type whether it sits on top of the new floor or the floor is cut to fit it', () => {
    expect(Object.keys(FIXTURE_FLOOR_FIT).sort()).toEqual(Object.keys(FIXTURE_LABELS).sort());
    const base = { id: 'f', x: 0, y: 0, w: 2, h: 2, rotation: 0 };
    expect(floorFitOf({ ...base, type: 'toilet' })).toBe('cut_to_fit');
    expect(floorFitOf({ ...base, type: 'floor_register' })).toBe('cut_to_fit');
    expect(floorFitOf({ ...base, type: 'dishwasher' })).toBe('on_top');
    // Its own say over its type's
    expect(floorFitOf({ ...base, type: 'vanity', floor_fit: 'cut_to_fit' })).toBe('cut_to_fit');
    expect(floorFitOf({ ...base, type: 'vanity', floor_fit: null })).toBe('on_top');
    // An island detached and reset goes on top; left in place the floor stops at it
    expect(floorFitOf({ ...base, type: 'island', floor_under: true })).toBe('on_top');
    expect(floorFitOf({ ...base, type: 'island', floor_fit: 'on_top' })).toBeNull();
  });
});

describe('levels', () => {
  it('always keeps one level', () => {
    const one = emptySketch();
    expect(removeLevel(one, 'main').levels).toHaveLength(1);
    const { sketch, levelId } = addLevel(one, 'Basement');
    expect(removeLevel(sketch, levelId).levels.map((l) => l.name)).toEqual(['Main Level']);
  });

  it('fills in what a saved sketch left out', () => {
    expect(normalizeSketch(null).levels[0].rooms).toEqual([]);
    const s = normalizeSketch({ levels: [{ id: 'b', name: 'Basement', rooms: [] }] });
    expect(s.levels[0]).toMatchObject({ id: 'b', openings: [], cabinet_runs: [], fixtures: [] });
  });
});

describe('undo and redo', () => {
  it('steps back and forward, and a new change drops the redo', () => {
    const a = emptySketch();
    const b = addRoom(a, 'main', rectPoints(0, 0, 10, 10)).sketch;
    const c = addRoom(b, 'main', rectPoints(20, 0, 10, 10)).sketch;
    let h = historyReducer({ past: [], present: a, future: [] }, { type: 'apply', sketch: b });
    h = historyReducer(h, { type: 'apply', sketch: c });
    h = historyReducer(h, { type: 'undo' });
    expect(h.present).toBe(b);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present).toBe(c);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'apply', sketch: a });
    expect(h.future).toEqual([]);
  });

  it('keeps a limited history', () => {
    let h = { past: [], present: emptySketch(), future: [] } as ReturnType<typeof historyReducer>;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = historyReducer(h, { type: 'apply', sketch: { ...h.present } });
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
