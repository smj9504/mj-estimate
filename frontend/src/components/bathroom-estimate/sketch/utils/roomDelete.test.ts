import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BESketchData, BEWall } from '../../../../types/bathroomSketch';
import { EMPTY_BE_SKETCH } from '../../../../types/bathroomSketch';
import { removeRoomWithWalls } from './roomDelete';
import { roomsFromWalls } from './beRoomDetect';

const PPF = 40;
const ft = (n: number) => n * PPF;
const pt = (x: number, y: number) => ({ x: ft(x), y: ft(y) });
const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<BEWall> = {}): BEWall => ({
  id, start: pt(x0, y0), end: pt(x1, y1), thickness: 4, heightInches: 96, ...extra,
});
const room = (id: string, walls: BEWall[], over: Partial<BERoom> = {}): BERoom => ({
  id, name: id, roomType: 'bathroom', heightInches: 96,
  boundary: walls.map((w) => ({ ...w.start })), wallIds: walls.map((w) => w.id),
  floorAreaSF: 0, netFloorAreaSF: 0, wallAreaSF: 0, perimeterLF: 0, ...over,
});
const sketch = (walls: BEWall[], rooms: BERoom[], fixtures: BEFixture[] = []): BESketchData => ({
  ...EMPTY_BE_SKETCH, walls, rooms, fixtures, settings: { ...EMPTY_BE_SKETCH.settings, pixelsPerFoot: PPF },
});
let n = 0;
const ids = () => `piece${++n}`;
const wallIds = (d: BESketchData) => d.walls.map((w) => w.id).sort();

// An 8' x 5' bathroom drawn as a room, its walls one per edge, clockwise on screen
const BATH_WALLS = [wall('top', 0, 0, 8, 0), wall('right', 8, 0, 8, 5), wall('bottom', 8, 5, 0, 5), wall('left', 0, 5, 0, 0)];
const BATH = room('bath', BATH_WALLS);
// A 3' x 3' nook off its right wall, 1' to 4' down it: three walls of its own
const NOOK_WALLS = [wall('n1', 8, 1, 11, 1), wall('n2', 11, 1, 11, 4), wall('n3', 11, 4, 8, 4)];
const nookRoom = (): BERoom => {
  const [found] = roomsFromWalls([...BATH_WALLS, ...NOOK_WALLS], [BATH], PPF);
  return { ...room('nook', []), ...found, id: 'nook' };
};

describe('deleting a room', () => {
  it('takes its walls, and the doors and windows on them', () => {
    const door: BEFixture = {
      id: 'door', type: 'door', position: pt(4, 0), dimensions: { width: 30, height: 30 }, rotation: 0,
      wallId: 'top', properties: {},
    };
    const tub: BEFixture = {
      id: 'tub', type: 'bathtub', position: pt(2.5, 1.3), dimensions: { width: 60, height: 32 }, rotation: 0,
      roomId: 'bath', properties: {},
    };
    const d = removeRoomWithWalls(sketch(BATH_WALLS, [BATH], [door, tub]), 'bath', ids);
    expect(d.rooms).toEqual([]);
    expect(d.walls).toEqual([]);
    expect(d.fixtures).toEqual([]);
  });

  it('leaves the walls of other rooms and free walls alone', () => {
    const free = wall('free', 20, 0, 24, 0);
    const d = removeRoomWithWalls(sketch([...BATH_WALLS, ...NOOK_WALLS, free], [BATH, nookRoom()]), 'nook', ids);
    expect(wallIds(d)).toEqual(['bottom', 'free', 'left', 'right', 'top']);
    expect(d.rooms.map((r) => r.id)).toEqual(['bath']);
    // Nothing left closed that isn't a room: it doesn't come back when the sketch opens
    expect(roomsFromWalls(d.walls, d.rooms, PPF)).toEqual([]);
  });

  it("keeps the stretch of a wall a nook still stands on, cut to it and the nook's own", () => {
    const nook = nookRoom();
    expect(nook.wallIds).toEqual(expect.arrayContaining(['n1', 'n2', 'n3']));
    expect(nook.wallIds).toHaveLength(3);
    const d = removeRoomWithWalls(sketch([...BATH_WALLS, ...NOOK_WALLS], [BATH, nook]), 'bath', ids);

    expect(d.rooms).toHaveLength(1);
    const kept = d.walls.filter((w) => !['n1', 'n2', 'n3'].includes(w.id));
    expect(kept).toHaveLength(1);
    // Down the bathroom's right wall from 1' to 4', where the nook meets it
    expect(kept[0].start).toEqual(pt(8, 1));
    expect(kept[0].end).toEqual(pt(8, 4));
    // The nook's now: one wall per edge, in the order of its edges
    const [left] = d.rooms;
    expect(left.wallIds).toHaveLength(4);
    left.boundary.forEach((p, i) => {
      const q = left.boundary[(i + 1) % left.boundary.length];
      const w = d.walls.find((x) => x.id === left.wallIds[i])!;
      const ends = [w.start, w.end].map((e) => `${e.x},${e.y}`).sort();
      expect(ends).toEqual([p, q].map((e) => `${e.x},${e.y}`).sort());
    });
    expect(roomsFromWalls(d.walls, d.rooms, PPF)).toEqual([]);
  });

  it('keeps a door on the stretch that stays, and drops one on what goes', () => {
    const onKept: BEFixture = {
      id: 'kept', type: 'door', position: pt(8, 2.5), dimensions: { width: 30, height: 30 }, rotation: 90,
      wallId: 'right', properties: {},
    };
    const onGone: BEFixture = { ...onKept, id: 'gone', position: pt(8, 4.6) };
    const d = removeRoomWithWalls(sketch([...BATH_WALLS, ...NOOK_WALLS], [BATH, nookRoom()], [onKept, onGone]), 'bath', ids);
    const kept = d.walls.find((w) => w.start.y === ft(1) && w.start.x === ft(8))!;
    expect(d.fixtures.map((f) => [f.id, f.wallId])).toEqual([['kept', kept.id]]);
  });

  it("drops a wall a room inside stands on when that room has its own wall there, and the room stays", () => {
    // A 3' x 2' closet drawn as a room in the bathroom's top left corner, with walls on every side
    const closetWalls = [wall('c1', 0, 0, 3, 0), wall('c2', 3, 0, 3, 2), wall('c3', 3, 2, 0, 2), wall('c4', 0, 2, 0, 0)];
    const closet = room('closet', closetWalls, { roomType: 'closet', parentRoomId: 'bath' });
    const d = removeRoomWithWalls(sketch([...BATH_WALLS, ...closetWalls], [BATH, closet]), 'bath', ids);
    expect(wallIds(d)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(d.rooms).toEqual([{ ...closet, parentRoomId: undefined }]);
  });

  it('takes a shower room cut off by walls run to the bathroom walls, the bathroom whole again', () => {
    const showerWalls = [wall('s1', 3, 0, 3, 3), wall('s2', 3, 3, 0, 3)];
    const [found] = roomsFromWalls([...BATH_WALLS, ...showerWalls], [BATH], PPF);
    const shower = { ...room('shower', []), ...found, id: 'shower' };
    expect(shower.wallIds.sort()).toEqual(['s1', 's2']);
    const d = removeRoomWithWalls(sketch([...BATH_WALLS, ...showerWalls], [BATH, shower]), 'shower', ids);
    expect(wallIds(d)).toEqual(['bottom', 'left', 'right', 'top']);
    expect(d.rooms).toEqual([BATH]);
    expect(roomsFromWalls(d.walls, d.rooms, PPF)).toEqual([]);
  });
});
