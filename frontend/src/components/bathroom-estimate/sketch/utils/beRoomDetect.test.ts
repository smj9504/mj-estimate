import { describe, it, expect } from 'vitest';
import type { BERoom, BEWall } from '../../../../types/bathroomSketch';
import { roomsFromWalls, wallFaces } from './beRoomDetect';

// 40 px to the foot
const PPF = 40;
let n = 0;
const wall = (x0: number, y0: number, x1: number, y1: number, id = `w${++n}`): BEWall => ({
  id, start: { x: x0 * PPF, y: y0 * PPF }, end: { x: x1 * PPF, y: y1 * PPF }, thickness: 4, heightInches: 96,
});
const sf = (areaPx2: number) => Math.round((areaPx2 / (PPF * PPF)) * 100) / 100;
const room = (walls: BEWall[], extra: Partial<BERoom> = {}): BERoom => ({
  id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
  boundary: walls.map((w) => w.start), wallIds: walls.map((w) => w.id),
  floorAreaSF: 0, netFloorAreaSF: 0, wallAreaSF: 0, perimeterLF: 0, ...extra,
});
// The bathroom: 4'9" x 6', drawn as a room (its four walls, corner to corner)
const bathWalls = () => [
  wall(0, 0, 4.75, 0, 'top'), wall(4.75, 0, 4.75, 6, 'right'), wall(4.75, 6, 0, 6, 'bottom'), wall(0, 6, 0, 0, 'left'),
];
// The L of the second drawing: 7' across, 3'6" down, back 2'3", down 2'6", 4'9" back, 6' up
const lWalls = () => [
  wall(0, 0, 7, 0), wall(7, 0, 7, 3.5), wall(7, 3.5, 4.75, 3.5), wall(4.75, 3.5, 4.75, 6), wall(4.75, 6, 0, 6), wall(0, 6, 0, 0),
];

describe('wall faces', () => {
  it('finds the area four walls close, and nothing for walls left open', () => {
    expect(wallFaces(bathWalls()).map((f) => sf(f.areaPx2))).toEqual([28.5]);
    expect(wallFaces(bathWalls().slice(0, 3))).toEqual([]);
  });

  it("closes an L, its corners only, clockwise on screen with each edge's wall", () => {
    const walls = lWalls();
    const [face] = wallFaces(walls);
    const b = face.boundary;
    const shoelace = b.reduce((sum, p, i) => sum + p.x * b[(i + 1) % b.length].y - b[(i + 1) % b.length].x * p.y, 0);
    expect(shoelace).toBeGreaterThan(0);
    face.edgeWalls.forEach(([id], i) => {
      const w = walls.find((x) => x.id === id)!;
      const ends = [w.start, w.end].map((p) => `${p.x},${p.y}`).sort();
      expect([b[i], b[(i + 1) % b.length]].map((p) => `${p.x},${p.y}`).sort()).toEqual(ends);
    });
    expect(sf(face.areaPx2)).toBe(36.38);
    expect(face.boundary).toHaveLength(6);
    expect(face.edgeWalls.every((ids) => ids.length === 1)).toBe(true);
  });

  it('meets walls where one ends on another, and reads walls along one line as one', () => {
    // The nook of the first drawing: three walls off the bathroom's right wall, the last ending partway down it
    const nook = [wall(4.75, 0, 7, 0), wall(7, 0, 7, 3.5), wall(7, 3.5, 4.75, 3.5)];
    expect(wallFaces([...bathWalls(), ...nook]).map((f) => sf(f.areaPx2)).sort((a, b) => a - b)).toEqual([7.88, 28.5]);
    // A leftover wall under a longer one still closes
    expect(wallFaces([...lWalls(), wall(0, 0, 4.75, 0)]).map((f) => sf(f.areaPx2))).toEqual([36.38]);
    // A wall ending in the open adds no area
    expect(wallFaces([...bathWalls(), wall(2, 0, 2, 2)]).map((f) => sf(f.areaPx2))).toEqual([28.5]);
  });
});

describe('rooms from walls', () => {
  it('makes the first closed area the bathroom, its walls in the order of its edges', () => {
    const walls = lWalls();
    const [made] = roomsFromWalls(walls, [], PPF);
    expect(made).toMatchObject({ name: 'Bathroom', roomType: 'bathroom' });
    expect(made.wallIds).toHaveLength(6);
    expect(new Set(made.wallIds)).toEqual(new Set(walls.map((w) => w.id)));
  });

  it('makes a nook off the bathroom a room of its own, the shared wall staying the bathroom\'s', () => {
    const walls = bathWalls();
    const nook = [wall(4.75, 0, 7, 0, 'n1'), wall(7, 0, 7, 3.5, 'n2'), wall(7, 3.5, 4.75, 3.5, 'n3')];
    const made = roomsFromWalls([...walls, ...nook], [room(walls)], PPF);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: 'Room', roomType: 'other' });
    expect(made[0].parentRoomId).toBeUndefined();
    expect(made[0].boundary).toHaveLength(4);
    expect(new Set(made[0].wallIds)).toEqual(new Set(['n1', 'n2', 'n3']));
  });

  it('leaves areas that are rooms already, and slivers', () => {
    const walls = bathWalls();
    expect(roomsFromWalls(walls, [room(walls)], PPF)).toEqual([]);
    expect(roomsFromWalls([wall(0, 0, 0.5, 0), wall(0.5, 0, 0.5, 0.5), wall(0.5, 0.5, 0, 0.5), wall(0, 0.5, 0, 0)], [], PPF)).toEqual([]);
  });

  it('makes a closed loop inside the bathroom a closet in it, but not a partition run to its walls', () => {
    const walls = bathWalls();
    const closet = [wall(1, 1, 3, 1), wall(3, 1, 3, 3), wall(3, 3, 1, 3), wall(1, 3, 1, 1)];
    expect(roomsFromWalls([...walls, ...closet], [room(walls)], PPF)).toMatchObject([
      { name: 'Closet', roomType: 'closet', parentRoomId: 'bath' },
    ]);
    const partition = [wall(0, 2, 2, 2), wall(2, 2, 2, 0)];
    expect(roomsFromWalls([...walls, ...partition], [room(walls)], PPF)).toEqual([]);
  });

  it('numbers more rooms', () => {
    const walls = bathWalls();
    const east = [wall(4.75, 0, 7, 0), wall(7, 0, 7, 2), wall(7, 2, 4.75, 2)];
    const west = [wall(0, 0, -2, 0), wall(-2, 0, -2, 2), wall(-2, 2, 0, 2)];
    expect(roomsFromWalls([...walls, ...east, ...west], [room(walls), room([], { id: 'r2', name: 'Room', roomType: 'other', boundary: [] })], PPF)
      .map((r) => r.name)).toEqual(['Room 2', 'Room 3']);
  });
});
