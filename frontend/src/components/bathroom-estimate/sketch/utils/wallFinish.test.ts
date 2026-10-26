import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BEWall } from '../../../../types/bathroomSketch';
import {
  coveredArea,
  roomWallFinishTotals,
  wallFinishAreas,
  wallFixtureCover,
  wallStartOnLeft,
  wallTileRegions,
} from './wallFinish';

// 40 px to the foot: an 8 ft × 5 ft room drawn from (0,0) to (320,200)
const PPF = 40;
const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<BEWall> = {}): BEWall => ({
  id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 6, heightInches: 96, ...extra,
});
const north = (extra: Partial<BEWall> = {}) => wall('north', 0, 0, 320, 0, extra); // 96" long
const westWall = wall('west', 0, 0, 0, 200); // 60" long
const southWall = wall('south', 0, 200, 320, 200);
const room: BERoom = {
  id: 'r', name: 'Bath', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
  wallIds: ['north', 'west', 'south'], heightInches: 96,
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 0, perimeterLF: 26,
};
const fixture = (type: BEFixture['type'], x: number, y: number, w: number, h: number, extra: Partial<BEFixture> = {}): BEFixture => ({
  id: type, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, properties: {}, ...extra,
});

describe('wallTileRegions', () => {
  it('reads walls saved before regions: a tiled wall is the whole face, existing tile its band', () => {
    expect(wallTileRegions(north({ finish: 'tile' }), 'new', PPF)).toMatchObject([
      { startIn: 0, endIn: 96, bottomIn: 0, topIn: 96 },
    ]);
    expect(wallTileRegions(north({ existingFinish: 'tile', existingTileToInches: 36 }), 'existing', PPF)).toMatchObject([
      { startIn: 0, endIn: 96, bottomIn: 0, topIn: 36 },
    ]);
    // Both heights 0 (or none) is the full height
    expect(wallTileRegions(north({ existingFinish: 'tile', existingTileFromInches: 0, existingTileToInches: 0 }), 'existing', PPF))
      .toMatchObject([{ bottomIn: 0, topIn: 96 }]);
    expect(wallTileRegions(north(), 'existing', PPF)).toEqual([]);
  });

  it('keeps regions to the wall as it is now, and they replace the older fields', () => {
    const shortened = north({
      finish: 'tile',
      tileRegions: [{ id: 'a', startIn: 48, endIn: 120, bottomIn: 0, topIn: 120 }, { id: 'b', startIn: 100, endIn: 110, bottomIn: 0, topIn: 10 }],
    });
    expect(wallTileRegions(shortened, 'new', PPF)).toEqual([{ id: 'a', startIn: 48, endIn: 96, bottomIn: 0, topIn: 96 }]);
    expect(wallTileRegions(north({ finish: 'tile', tileRegions: [] }), 'new', PPF)).toEqual([]);
  });
});

describe('coveredArea', () => {
  it('counts overlapping regions once and leaves out the excluded part', () => {
    const a = { x0: 0, x1: 10, y0: 0, y1: 10 };
    const b = { x0: 5, x1: 15, y0: 0, y1: 10 };
    expect(coveredArea([a, b])).toBe(150);
    expect(coveredArea([a, b], [{ x0: 0, x1: 5, y0: 0, y1: 10 }])).toBe(100);
  });
});

describe('wallFinishAreas', () => {
  it('splits a wall with a door into wainscot tile and paint', () => {
    const door = fixture('door', 160, 0, 32, 32, { wallId: 'north' }); // centred 48" along
    const wainscot = north({ tileRegions: [{ id: 'w', startIn: 0, endIn: 96, bottomIn: 0, topIn: 36 }] });
    expect(wallFinishAreas(wainscot, [door], PPF)).toMatchObject({
      grossSF: 64,
      openingSF: 17.8, // 32" × 80"
      tileSF: 16, // 96" × 36" less the door's 32" × 36"
      paintSF: 30.2,
      existingTileSF: 0,
    });
  });

  it('leaves out the wall behind a tub against it, up to the rim and surround', () => {
    // A 60" × 32" tub in the north-west corner
    const tub = fixture('bathtub', 100, 160 / 3, 60, 32, { properties: { surroundHeight: 60 } });
    expect(wallFixtureCover(north(), [tub], PPF)).toEqual([{ x0: 0, x1: 60, y0: 0, y1: 75 }]);
    expect(wallFixtureCover(westWall, [tub], PPF)[0]).toMatchObject({ x0: 0, y1: 75 });
    expect(wallFixtureCover(southWall, [tub], PPF)).toEqual([]);

    const tiledToday = north({ existingTileRegions: [{ id: 'e', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96 }] });
    const areas = wallFinishAreas(tiledToday, [tub], PPF);
    expect(areas.coveredSF).toBe(31.3); // 60" × 75"
    expect(areas.existingTileSF).toBe(32.8); // the rest of the face
    expect(areas.paintSF).toBe(32.8);
  });

  it('adds up a room', () => {
    const tiled = north({ tileRegions: [{ id: 't', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48 }] });
    expect(roomWallFinishTotals([tiled, southWall], [], PPF)).toEqual({ tileSF: 32, paintSF: 96, existingTileSF: 0 });
  });
});

describe('wallStartOnLeft', () => {
  it('draws a wall as seen from inside its room', () => {
    // Facing the north wall from inside, its west end (the start) is on your left
    expect(wallStartOnLeft(north(), [room])).toBe(true);
    // Facing the south wall, its west end (the start) is on your right
    expect(wallStartOnLeft(southWall, [room])).toBe(false);
    expect(wallStartOnLeft(wall('loose', 0, 0, 10, 0), [room])).toBe(true);
  });
});
