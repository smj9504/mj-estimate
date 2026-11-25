import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BESketchData, BEWall } from '../../../../types/bathroomSketch';
import { EMPTY_BE_SKETCH } from '../../../../types/bathroomSketch';
import {
  joinableAt, joinWalls, offsetWall, outwardSign, splitWall, splitWallTwice, wallAt, wallBreaks,
} from './wallSplit';
import { fixtureSidesAgainstWalls, roomWallFinishTotals, wallStripAreaSF, wallTileRegions } from './wallFinish';
import { moveOutlineCorner, resizeRoomEdge } from './beGeometry';

// 40 px to the foot
const PPF = 40;
const ft = (n: number) => n * PPF;
const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<BEWall> = {}): BEWall => ({
  id, start: { x: ft(x0), y: ft(y0) }, end: { x: ft(x1), y: ft(y1) }, thickness: 4, heightInches: 96, ...extra,
});

/** An 8' x 5' bathroom drawn as a room: its walls one per edge, clockwise on screen */
function bath(top: Partial<BEWall> = {}, fixtures: BEFixture[] = []): BESketchData {
  const walls = [
    wall('top', 0, 0, 8, 0, top), wall('right', 8, 0, 8, 5), wall('bottom', 8, 5, 0, 5), wall('left', 0, 5, 0, 0),
  ];
  const room: BERoom = {
    id: 'bath', name: 'Bathroom', roomType: 'bathroom', heightInches: 96,
    boundary: walls.map((w) => ({ ...w.start })), wallIds: walls.map((w) => w.id),
    floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
  };
  return { ...EMPTY_BE_SKETCH, walls, rooms: [room], fixtures };
}

const byId = (d: BESketchData, id: string) => d.walls.find((w) => w.id === id)!;
const pt = (x: number, y: number) => ({ x: ft(x), y: ft(y) });

const door = (over: Partial<BEFixture> = {}): BEFixture => ({
  // A 30" door in the top wall, 6' from its start, swinging into the room
  id: 'door', type: 'door', position: { x: ft(6), y: ft(15 / 12) }, dimensions: { width: 30, height: 30 },
  rotation: 180, wallId: 'top', properties: {}, ...over,
});

// A 60" alcove tub against the top wall, in the corner
const tub: BEFixture = {
  id: 'tub', type: 'bathtub', position: { x: ft(2.5), y: ft(16 / 12) }, dimensions: { width: 60, height: 32 },
  rotation: 0, properties: { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60 },
};

describe('splitting a wall', () => {
  it('cuts it in two in line, the room given a corner there that turns nowhere', () => {
    const d = splitWall(bath(), 'top', 36, 'top2')!;
    expect(byId(d, 'top').end).toEqual(pt(3, 0));
    expect(byId(d, 'top2').start).toEqual(pt(3, 0));
    expect(byId(d, 'top2').end).toEqual(pt(8, 0));
    const [room] = d.rooms;
    expect(room.boundary).toEqual([pt(0, 0), pt(3, 0), pt(8, 0), pt(8, 5), pt(0, 5)]);
    expect(room.wallIds).toEqual(['top', 'top2', 'right', 'bottom', 'left']);
    expect(room.floorAreaSF).toBe(40);
  });

  it('keeps the edge order when the wall runs against the room', () => {
    const d = bath();
    d.walls[0] = wall('top', 8, 0, 0, 0);
    const out = splitWall(d, 'top', 36, 'top2')!;
    // top now runs 8' → 5', top2 5' → 0': the edge from (0,0) is top2's
    expect(out.rooms[0].boundary.slice(0, 3)).toEqual([pt(0, 0), pt(5, 0), pt(8, 0)]);
    expect(out.rooms[0].wallIds.slice(0, 2)).toEqual(['top2', 'top']);
  });

  it('gives each piece its part of the tile, border rows on both, inserts in the larger', () => {
    const d = splitWall(bath({
      tileRegions: [{ id: 'r1', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48, decoBordersAtIn: [36], decoInserts: 4 }],
    }), 'top', 36, 'top2')!;
    const [a] = byId(d, 'top').tileRegions!;
    const [b] = byId(d, 'top2').tileRegions!;
    expect(a).toMatchObject({ id: 'r1', startIn: 0, endIn: 36, decoBordersAtIn: [36], decoInserts: 0 });
    expect(b).toMatchObject({ startIn: 0, endIn: 60, decoBordersAtIn: [36], decoInserts: 4 });
    expect(b.id).not.toBe('r1');
  });

  it('reads a whole-wall finish saved the old way as tile on both pieces', () => {
    const d = splitWall(bath({ finish: 'tile' }), 'top', 36, 'top2')!;
    expect(byId(d, 'top').finish).toBeUndefined();
    expect(wallTileRegions(byId(d, 'top'), 'new', PPF)).toMatchObject([{ startIn: 0, endIn: 36, topIn: 96 }]);
    expect(wallTileRegions(byId(d, 'top2'), 'new', PPF)).toMatchObject([{ startIn: 0, endIn: 60, topIn: 96 }]);
  });

  it('moves a door tied to the wall onto the piece it is in', () => {
    const d = splitWall(bath({}, [door()]), 'top', 36, 'top2')!;
    expect(d.fixtures[0].wallId).toBe('top2');
  });

  it('leaves no piece shorter than an inch', () => {
    expect(splitWall(bath(), 'top', 0.5, 'x')).toBeNull();
    expect(splitWall(bath(), 'top', 95.5, 'x')).toBeNull();
  });

  it('splits out a middle piece with two cuts', () => {
    const d = splitWallTwice(bath(), 'top', 72, 24, 'mid', 'end')!;
    expect(byId(d, 'mid').start).toEqual(pt(2, 0));
    expect(byId(d, 'mid').end).toEqual(pt(6, 0));
    expect(d.rooms[0].wallIds).toEqual(['top', 'mid', 'end', 'right', 'bottom', 'left']);
  });

  it('finds the wall under a point, and the breaks a split leaves', () => {
    expect(wallAt(bath().walls, { x: ft(3), y: 4 }, 10, PPF)).toMatchObject({ wall: { id: 'top' }, alongIn: 36 });
    expect(wallAt(bath().walls, { x: ft(3), y: ft(2) }, 10, PPF)).toBeNull();
    const d = splitWall(bath(), 'top', 36, 'top2')!;
    expect(wallBreaks(d.walls)).toEqual([{ at: pt(3, 0), dir: { x: 1, y: 0 } }]);
    expect(wallBreaks(bath().walls)).toEqual([]);
  });
});

describe('joining walls in line', () => {
  it('undoes a split: one wall, its tile one region again, the room as it was', () => {
    const before = bath({
      tileRegions: [{ id: 'r1', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48, decoInserts: 4 }],
    });
    const split = splitWall(before, 'top', 36, 'top2')!;
    expect(joinableAt(split.walls, byId(split, 'top'))).toMatchObject({ end: { id: 'top2' } });
    const d = joinWalls(split, 'top', 'top2')!;
    expect(d.walls.map((w) => w.id)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(byId(d, 'top').end).toEqual(pt(8, 0));
    expect(byId(d, 'top').tileRegions).toEqual([{ id: 'r1', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48, decoInserts: 4 }]);
    expect(d.rooms[0].boundary).toEqual(before.rooms[0].boundary);
    expect(d.rooms[0].wallIds).toEqual(before.rooms[0].wallIds);
  });

  it('joins from either piece, whichever way each runs', () => {
    const split = splitWall(bath(), 'top', 36, 'top2')!;
    const d = joinWalls(split, 'top2', 'top')!;
    expect(d.walls.map((w) => w.id)).toEqual(['top2', 'right', 'bottom', 'left']);
    expect(byId(d, 'top2').start).toEqual(pt(0, 0));
    expect(byId(d, 'top2').end).toEqual(pt(8, 0));
    expect(d.rooms[0].wallIds).toEqual(['top2', 'right', 'bottom', 'left']);
  });

  it('won’t join across a corner, or where a third wall meets the break', () => {
    expect(joinWalls(bath(), 'top', 'right')).toBeNull();
    const split = splitWall(bath(), 'top', 36, 'top2')!;
    const tee = { ...split, walls: [...split.walls, wall('stub', 3, 0, 3, 2)] };
    expect(joinableAt(tee.walls, byId(tee, 'top'))).toEqual({});
    expect(joinWalls(tee, 'top', 'top2')).toBeNull();
  });
});

describe('moving a wall out or in', () => {
  it('stretches the corner walls when the whole wall moves', () => {
    const d = bath();
    const out = outwardSign(byId(d, 'top'), d.rooms);
    const moved = offsetWall(d, 'top', out * ft(1), ['s1', 's2']);
    expect(moved.walls).toHaveLength(4);
    expect(byId(moved, 'top').start).toEqual(pt(0, -1));
    expect(byId(moved, 'right').start).toEqual(pt(8, -1));
    expect(byId(moved, 'left').end).toEqual(pt(0, -1));
    // 28' of 8' walls: 224 SF (not 28 x 96 / 144)
    expect(moved.rooms[0]).toMatchObject({ floorAreaSF: 48, perimeterLF: 28, wallAreaSF: 224 });
  });

  it('bumps a split-out piece out with a short wall at each step (Xactimate’s Break)', () => {
    const d = splitWallTwice(bath(), 'top', 24, 72, 'mid', 'end')!;
    const out = outwardSign(byId(d, 'mid'), d.rooms);
    const moved = offsetWall(d, 'mid', out * ft(2), ['s1', 's2']);
    expect(byId(moved, 's1')).toMatchObject({ start: pt(2, 0), end: pt(2, -2) });
    expect(byId(moved, 's2')).toMatchObject({ start: pt(6, 0), end: pt(6, -2) });
    expect(byId(moved, 'mid')).toMatchObject({ start: pt(2, -2), end: pt(6, -2) });
    const [room] = moved.rooms;
    expect(room.boundary).toEqual([pt(0, 0), pt(2, 0), pt(2, -2), pt(6, -2), pt(6, 0), pt(8, 0), pt(8, 5), pt(0, 5)]);
    expect(room.wallIds).toEqual(['top', 's1', 'mid', 's2', 'end', 'right', 'bottom', 'left']);
    expect(room).toMatchObject({ floorAreaSF: 48, perimeterLF: 30, wallAreaSF: 240 });
  });

  it('pushes a piece in, and none at all is no change', () => {
    const d = splitWallTwice(bath(), 'top', 24, 72, 'mid', 'end')!;
    const out = outwardSign(byId(d, 'mid'), d.rooms);
    expect(offsetWall(d, 'mid', -out * ft(1), ['s1', 's2']).rooms[0].floorAreaSF).toBe(36);
    expect(offsetWall(d, 'mid', 0, ['s1', 's2'])).toBe(d);
  });

  it('takes its door and drywall along; a tub stays where it stands', () => {
    const d = bath({}, [door(), tub]);
    d.drywallRepairZones = [{
      id: 'dw', surface: 'wall', boundary: [pt(1, 0), pt(3, 0)], areaSF: 16, repairHeightInches: 96,
      includeGluing: true, textureType: 'smooth', paintCoats: 2,
      drywallMaterialCostPerSF: 1, drywallLaborCostPerSF: 1, textureCostPerSF: 1, paintCostPerSF: 1,
    }];
    const moved = offsetWall(d, 'top', -ft(1), ['s1', 's2']);
    expect(moved.fixtures.find((f) => f.id === 'door')!.position.y).toBeCloseTo(ft(15 / 12) - ft(1));
    expect(moved.fixtures.find((f) => f.id === 'tub')!.position).toEqual(tub.position);
    expect(moved.drywallRepairZones[0].boundary).toEqual([pt(1, -1), pt(3, -1)]);
  });
});

describe('a split wall still prices as one', () => {
  it('a tub across the split keeps its surround, and the walls the same paint', () => {
    const d = bath({}, [tub]);
    const split = splitWall(d, 'top', 36, 'top2')!;
    expect(roomWallFinishTotals(split.walls, split.fixtures, PPF)).toEqual(roomWallFinishTotals(d.walls, d.fixtures, PPF));
    expect(fixtureSidesAgainstWalls(tub, split.walls, PPF)).toEqual(fixtureSidesAgainstWalls(tub, d.walls, PPF));
    expect(fixtureSidesAgainstWalls(tub, split.walls, PPF).north).toBe(true);
  });

  it('drywall along both pieces still has the door taken out', () => {
    const d = bath({}, [door({ wallId: undefined })]);
    const strip = [pt(0, 0), pt(8, 0)];
    const whole = wallStripAreaSF(strip, 96, d.walls, d.fixtures, PPF);
    const split = splitWall(d, 'top', 36, 'top2')!;
    expect(wallStripAreaSF(strip, 96, split.walls, split.fixtures, PPF)).toBe(whole);
    expect(whole).toBeLessThan(64);
  });
});

describe('a split rectangle stays a rectangle', () => {
  const outline = [pt(0, 0), pt(3, 0), pt(8, 0), pt(8, 5), pt(0, 5)];

  it('dragging a corner moves the corners in line with it', () => {
    expect(moveOutlineCorner(outline, 2, pt(9, -1))).toEqual([pt(0, -1), pt(3, -1), pt(9, -1), pt(9, 5), pt(0, 5)]);
  });

  it('a piece given a length moves its end, the rest following', () => {
    // The piece from the break to the corner: the room grows
    expect(resizeRoomEdge(outline, 1, ft(6))).toEqual([pt(0, 0), pt(3, 0), pt(9, 0), pt(9, 5), pt(0, 5)]);
    // The piece from the corner to the break: the break slides
    expect(resizeRoomEdge(outline, 0, ft(4))).toEqual([pt(0, 0), pt(4, 0), pt(8, 0), pt(8, 5), pt(0, 5)]);
  });

  it('an L still moves one corner alone, as before', () => {
    const l = [pt(0, 0), pt(7, 0), pt(7, 3), pt(4, 3), pt(4, 6), pt(0, 6)];
    expect(moveOutlineCorner(l, 3, pt(5, 4))).toEqual([pt(0, 0), pt(7, 0), pt(7, 3), pt(5, 4), pt(4, 6), pt(0, 6)]);
  });
});
