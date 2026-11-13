import { describe, expect, it } from 'vitest';
import type { FtPoint, SketchLevel, SketchRoom } from '../../../../types/flooringEstimate';
import {
  WALL_T, centroid, constrainAngle, edgesOf, insertVertex, measureRoom, moveVertex, offsetPolygon, pointInPolygon,
  polygonArea, polygonPerimeter, reattach, rectPoints, removeVertex, resizeEdge, roomAcross, snapPoint, snapShift, wallAt,
  wallFaces, cabinetLayout,
} from './geometry';

const P = (...pts: [number, number][]): FtPoint[] => pts.map(([x, y]) => ({ x, y }));
const room = (id: string, points: FtPoint[], extra: Partial<SketchRoom> = {}): SketchRoom => ({
  id, name: id, height_ft: 8, points, ...extra,
});

const living = room('living', rectPoints(0, 0, 15, 14.1667));
const kitchen = room('kitchen', P([15.375, 0], [29.375, 0], [29.375, 8], [25.375, 8], [25.375, 11.5], [15.375, 11.5]));
const hall = room('hall', rectPoints(15.375, 11.875, 4, 12.1667));

// The same small house the server's tests use
const level: SketchLevel = {
  id: 'main', name: 'Main Level',
  rooms: [living, kitchen, hall],
  openings: [
    { id: 'o1', kind: 'opening', rooms: ['living', 'kitchen'], a: { x: 15, y: 2 }, b: { x: 15, y: 8 } },
    { id: 'o2', kind: 'exterior_door', rooms: ['living', null], a: { x: 5, y: 0 }, b: { x: 8, y: 0 }, swing: 'living' },
    { id: 'o3', kind: 'opening', rooms: ['hall', 'kitchen'], a: { x: 15.875, y: 11.875 }, b: { x: 18.875, y: 11.875 } },
  ],
  cabinet_runs: [{ id: 'c1', room_id: 'kitchen', a: { x: 15.375, y: 0 }, b: { x: 29.375, y: 0 } }],
  fixtures: [],
  walls: [],
};

describe('measuring a room', () => {
  it('measures area, perimeter and baseboard as the server does', () => {
    const l = measureRoom(level, living);
    expect(l.floorSf).toBeCloseTo(212.5, 2);
    expect(l.perimeterLf).toBeCloseTo(58.33, 2);
    expect(l.baseLf).toBeCloseTo(49.33, 2);
    const k = measureRoom(level, kitchen);
    expect(k.floorSf).toBeCloseTo(147, 6);
    expect(k.perimeterLf).toBeCloseTo(51, 6);
    expect(k.baseLf).toBeCloseTo(28, 6);
  });

  it('takes an island out of the floor unless the floor runs under it', () => {
    const withIsland: SketchLevel = {
      ...level,
      fixtures: [{ id: 'f', type: 'island', x: 20, y: 5, w: 6, h: 3, rotation: 0 }],
    };
    expect(measureRoom(withIsland, kitchen).floorSf).toBeCloseTo(129, 6);
    withIsland.fixtures[0].floor_under = true;
    expect(measureRoom(withIsland, kitchen).floorSf).toBeCloseTo(147, 6);
  });

  it('gives a wall built out into the room baseboard on both faces and its end, as the server does', () => {
    const wall = { id: 'w1', room_id: 'living', a: { x: 6, y: 14.1667 }, b: { x: 6, y: 10.1667 }, thickness: WALL_T };
    const l = measureRoom({ ...level, walls: [wall] }, living);
    expect(l.perimeterLf).toBeCloseTo(58.33 + 8 + 0.375, 2);
    expect(l.baseLf).toBeCloseTo(49.33 + 8.375, 2);
    expect(l.floorSf).toBeCloseTo(212.5 - 1.5, 2);
    // Wall to wall: no end shows
    expect(wallFaces({ x: 6, y: 14.1667 }, { x: 6, y: 0 }, WALL_T, living.points).exposedLf).toBeCloseTo(2 * 14.1667, 3);
  });

  it('counts an open wall off the baseboard like a doorway as wide as the side', () => {
    const open = {
      ...level,
      openings: [
        { id: 'o1', kind: 'open_wall' as const, rooms: ['living', 'kitchen'] as [string, string],
          a: { x: 15, y: 0 }, b: { x: 15, y: 11.5 } },
        level.openings[1],
      ],
    };
    expect(measureRoom(open, living).baseLf).toBeCloseTo(58.33 - 11.5 - 3, 2);
  });

  it('measures cabinet fronts less the corner and finds the sides that show, as the server does', () => {
    const k = room('k', rectPoints(0, 0, 14, 12));
    const kitchenLevel: SketchLevel = {
      id: 'main', name: 'Main Level', rooms: [k], openings: [], walls: [],
      cabinet_runs: [
        { id: 'top', room_id: 'k', a: { x: 4, y: 0 }, b: { x: 14, y: 0 } },
        { id: 'right', room_id: 'k', a: { x: 14, y: 0 }, b: { x: 14, y: 8 } },
      ],
      fixtures: [],
    };
    const runs = Object.fromEntries(cabinetLayout(kitchenLevel, 'k').map((r) => [r.id, r]));
    expect(runs.top.frontLf).toBeCloseTo(8, 1);
    expect(runs.right.frontLf).toBeCloseTo(6, 1);
    expect([runs.top.sideA, runs.top.sideB, runs.right.sideA, runs.right.sideB]).toEqual([true, false, false, true]);

    // A fridge beside the top run's end hides it; a side set on the run is taken as set
    const withFridge = {
      ...kitchenLevel,
      fixtures: [{ id: 'f', type: 'refrigerator' as const, x: 2.5, y: 1.25, w: 3, h: 2.5, rotation: 0 }],
      cabinet_runs: [kitchenLevel.cabinet_runs[0], { ...kitchenLevel.cabinet_runs[1], side_b: false }],
    };
    const after = Object.fromEntries(cabinetLayout(withFridge, 'k').map((r) => [r.id, r]));
    expect([after.top.sideA, after.right.sideB]).toEqual([false, false]);
  });

  it('finds a centroid inside an L', () => {
    expect(pointInPolygon(centroid(kitchen.points), kitchen.points)).toBe(true);
  });
});

describe('walls', () => {
  it('puts the wall face a wall thickness out on every side', () => {
    const outer = offsetPolygon(rectPoints(0, 0, 10, 12), WALL_T);
    expect(polygonArea(outer)).toBeCloseTo((10 + 2 * WALL_T) * (12 + 2 * WALL_T), 6);
    // The same whichever way the outline was drawn
    const reversed = offsetPolygon(rectPoints(0, 0, 10, 12).reverse(), WALL_T);
    expect(polygonArea(reversed)).toBeCloseTo(polygonArea(outer), 6);
  });

  it('points every normal out of the room', () => {
    for (const e of edgesOf(kitchen.points)) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const out = { x: mid.x + e.normal.x * 0.1, y: mid.y + e.normal.y * 0.1 };
      expect(pointInPolygon(out, kitchen.points)).toBe(false);
    }
  });

  it('finds the wall under a click, on the floor side or on the wall itself', () => {
    const inside = wallAt([living], { x: 7, y: 0.1 }, 0.3);
    expect(inside?.edge.index).toBe(0);
    const onWall = wallAt([living], { x: 7, y: -0.3 }, 0.1);
    expect(onWall?.edge.index).toBe(0);
    expect(wallAt([living], { x: 7, y: 5 }, 0.3)).toBeNull();
  });

  it('knows the room on the other side of a wall', () => {
    const right = edgesOf(living.points)[1];
    expect(roomAcross([living, kitchen, hall], 'living', right, { x: 15, y: 2 }, { x: 15, y: 8 })).toBe('kitchen');
    const top = edgesOf(living.points)[0];
    expect(roomAcross([living, kitchen, hall], 'living', top, { x: 5, y: 0 }, { x: 8, y: 0 })).toBeNull();
  });
});

describe('changing a room', () => {
  it('sets a wall length and keeps a rectangle a rectangle', () => {
    const wider = resizeEdge(rectPoints(0, 0, 12, 10), 0, 15)!;
    expect(wider).toEqual(rectPoints(0, 0, 15, 10));
    // The bottom wall runs right to left; it still grows to the right
    const alsoWider = resizeEdge(rectPoints(0, 0, 12, 10), 2, 15)!;
    expect(alsoWider).toEqual(rectPoints(0, 0, 15, 10));
    const deeper = resizeEdge(rectPoints(0, 0, 12, 10), 3, 11.5)!;
    expect(polygonArea(deeper)).toBeCloseTo(12 * 11.5, 6);
  });

  it('keeps an L an L', () => {
    const wider = resizeEdge(kitchen.points, 0, 16)!;
    expect(polygonArea(wider)).toBeCloseTo(16 * 8 + 10 * 3.5, 6);
    expect(polygonPerimeter(wider)).toBeCloseTo(55, 6);
  });

  it('refuses a length that is not one', () => {
    expect(resizeEdge(rectPoints(0, 0, 12, 10), 0, 0)).toBeNull();
    expect(resizeEdge(rectPoints(0, 0, 12, 10), 0, NaN)).toBeNull();
  });

  it('drags a corner and keeps square walls square', () => {
    const moved = moveVertex(rectPoints(0, 0, 12, 10), 2, { x: 14, y: 11 });
    expect(moved).toEqual(rectPoints(0, 0, 14, 11));
  });

  it('bends a wall at a point added in its middle, moving that point alone', () => {
    const withPoint = insertVertex(rectPoints(0, 0, 12, 10), 0, { x: 6, y: 0 });
    const bent = moveVertex(withPoint, 1, { x: 6, y: -2 });
    expect(bent).toHaveLength(5);
    expect(bent[0]).toEqual({ x: 0, y: 0 });
    expect(bent[2]).toEqual({ x: 12, y: 0 });
    expect(polygonArea(bent)).toBeCloseTo(120 + 12, 6);
    expect(removeVertex(bent, 1)).toEqual(rectPoints(0, 0, 12, 10));
    // A triangle keeps its three corners
    expect(removeVertex(rectPoints(0, 0, 4, 4).slice(0, 3), 0)).toHaveLength(3);
  });

  it('puts a doorway back on its wall after the room changes', () => {
    const narrower = rectPoints(0, 0, 14.5, 14.1667);
    const { a, b } = reattach(narrower, { x: 15, y: 2 }, { x: 15, y: 8 });
    expect(a.x).toBeCloseTo(14.5, 6);
    expect(b.x).toBeCloseTo(14.5, 6);
    expect(Math.abs(b.y - a.y)).toBeCloseTo(6, 6);
  });
});

describe('snapping', () => {
  it('lines a point up with a neighbour a wall thickness away', () => {
    const p = snapPoint({ x: 15.3, y: 3.1 }, [living], 0.2, 0.5);
    expect(p.x).toBeCloseTo(15 + WALL_T, 6);
    expect(p.y).toBeCloseTo(3, 6); // nothing near: the half-foot grid
  });

  it('picks the smallest shift', () => {
    expect(snapShift([10, 20], [10.1, 19.95], 0.2)).toBeCloseTo(-0.05, 6);
    expect(snapShift([10], [11], 0.2)).toBeNull();
  });

  it('holds a line level, upright or at 45 degrees', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 0.6 });
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(Math.hypot(10, 0.6), 6);
    const d = constrainAngle({ x: 0, y: 0 }, { x: 5, y: 4.6 });
    expect(d.x).toBeCloseTo(d.y, 6);
  });
});
