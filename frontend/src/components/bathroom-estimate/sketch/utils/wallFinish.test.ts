import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BEWall } from '../../../../types/bathroomSketch';
import {
  openingDoorPosition,
  showerFrontOpening,
  showerFrontTiled,
  showerFrontTiles,
  coveredArea,
  wallOpeningsOf,
  wallStripAreaSF,
  roomWallFinishTotals,
  subtractRects,
  wallFinishAreas,
  wallFixtureCover,
  wallOpenings,
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
    expect(roomWallFinishTotals([tiled, southWall], [], PPF))
      .toEqual({ tileSF: 32, paintSF: 96, existingTileSF: 0, surroundInTile: {} });
  });

  // A 60" × 32" tub in the north-west corner and a 36" shower in the north-east one
  const tub = fixture('bathtub', 100, 160 / 3, 60, 32, { properties: { hasSurround: true, surroundHeight: 60 } });
  const shower = fixture('shower', 260, 60, 36, 36);
  const wholeWall = (endIn = 96) => north({ tileRegions: [{ id: 'w', startIn: 0, endIn, bottomIn: 0, topIn: 96 }] });

  it('makes a wall tiled floor to ceiling one tile, the tub surround and shower walls with it', () => {
    const areas = wallFinishAreas(wholeWall(), [tub, shower], PPF);
    // All of it but the wall behind the tub itself, below its 15" rim
    expect(areas.tileSF).toBe(57.8);
    expect(areas.surroundInTile).toEqual({ bathtub: 25, shower: 24 }); // 60" × 60", 36" × 96"
    expect(areas.surroundInTileSF).toBe(49);
    expect(areas.paintSF).toBe(0);
    // Today's tile behind them still comes off with the tub and shower
    expect(areas.coveredSF).toBe(55.3);

    // Tile a tenth short of the end still runs over the shower
    expect(wallFinishAreas(wholeWall(95.8), [shower], PPF).surroundInTile).toEqual({ shower: 24 });
    expect(roomWallFinishTotals([wholeWall(), westWall], [tub, shower], PPF).surroundInTile).toEqual({ bathtub: 25, shower: 24 });
  });

  it('leaves a surround to its fixture when the tile stops short of it, or it is prefab', () => {
    const wainscot = north({ tileRegions: [{ id: 'w', startIn: 0, endIn: 96, bottomIn: 0, topIn: 48 }] });
    expect(wallFinishAreas(wainscot, [tub], PPF)).toMatchObject({ tileSF: 12, surroundInTileSF: 0, surroundInTile: {} });
    const prefab = { ...shower, properties: { showerWallMaterial: 'prefab_acrylic' as const } };
    expect(wallFinishAreas(wholeWall(), [prefab], PPF)).toMatchObject({ tileSF: 40, surroundInTile: {} });
  });
});

describe('wallOpenings', () => {
  it('finds a door by its closed panel, the edge of its symbol that sits in the wall', () => {
    // As the plan places a door: its symbol inside the room, its bottom edge on the south wall
    const door = fixture('door', 160, 200 - 160 / 3, 32, 32);
    expect(wallOpenings(southWall, [door], PPF)).toEqual([{ x0: 32, x1: 64, y0: 0, y1: 80 }]);
    expect(wallOpenings(north(), [door], PPF)).toEqual([]);
  });

  it('finds a window by its middle line', () => {
    const win = fixture('window', 160, 0, 36, 6);
    expect(wallOpenings(north(), [win], PPF)).toEqual([{ x0: 30, x1: 66, y0: 36, y1: 84 }]);
  });
});

describe('subtractRects', () => {
  it('cuts a hole out of a face as rectangles that cover the rest once', () => {
    const face = { x0: 0, x1: 10, y0: 0, y1: 10 };
    const hole = { x0: 4, x1: 6, y0: 0, y1: 8 };
    const pieces = subtractRects([face], [hole]);
    expect(pieces).toEqual([
      { x0: 0, x1: 4, y0: 0, y1: 10 },
      { x0: 4, x1: 6, y0: 8, y1: 10 },
      { x0: 6, x1: 10, y0: 0, y1: 10 },
    ]);
    expect(coveredArea(pieces)).toBe(coveredArea([face], [hole]));
  });

  it('keeps one rectangle for a face with nothing taken out', () => {
    expect(subtractRects([{ x0: 0, x1: 96, y0: 0, y1: 96 }])).toEqual([{ x0: 0, x1: 96, y0: 0, y1: 96 }]);
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

describe('a shower in its own room', () => {
  // A 36" shower against the north wall, its front on a wall 36" out; a 24" door's opening in it, 6" from the left
  const front = wall('front', 0, 120, 120, 120);
  const shower = fixture('shower', 60, 60, 36, 36, { properties: { showerLayout: 'alcove', showerDoorType: 'swing' } });
  const opening = { ...fixture('door', 60, 80, 24, 24), id: 'opening', properties: { noSlab: true } };

  it("hangs its door in the wall's opening", () => {
    const found = showerFrontOpening(shower, [north(), front], [shower, opening], PPF)!;
    expect(found).toMatchObject({ widthIn: 24, heightIn: 80, wallId: 'front', openingId: 'opening' });
    expect(found.span[0]).toBeCloseTo(6 / 36);
    expect(found.span[1]).toBeCloseTo(30 / 36);
    expect(openingDoorPosition(found.span)).toBe('center');
    // A door with its slab is an opening too
    expect(showerFrontOpening(shower, [front], [shower, { ...opening, properties: {} }], PPF)?.widthIn).toBe(24);
  });

  it('is an open-front shower with no wall or no opening at its front', () => {
    expect(showerFrontOpening(shower, [north()], [shower, opening], PPF)).toBeNull();
    expect(showerFrontOpening(shower, [front], [shower], PPF)).toBeNull();
    // A door elsewhere on the wall isn't the shower's
    expect(showerFrontOpening(shower, [wall('long', 0, 120, 400, 120)], [shower, { ...opening, position: { x: 300, y: 80 } }], PPF)).toBeNull();
    // Nor is a neo-angle's front a wall
    expect(showerFrontOpening({ ...shower, properties: { showerLayout: 'neo_angle' } }, [front], [shower, opening], PPF)).toBeNull();
  });

  it('tiles its front as a 4th wall only when it says so, and only in its own room', () => {
    const four = { ...shower, properties: { ...shower.properties, showerWallCount: 4, showerTileHeight: 84 } };
    expect(showerFrontTiled(shower, [front], [shower, opening], PPF)).toBe(false);
    expect(showerFrontTiled(four, [front], [four, opening], PPF)).toBe(true);
    // No opening at its front: the front is glass, never tiled
    expect(showerFrontTiled(four, [north()], [four, opening], PPF)).toBe(false);
    // A prefab surround has no tile to carry round
    const prefab = { ...four, properties: { ...four.properties, showerWallMaterial: 'prefab_acrylic' as const } };
    expect(showerFrontTiled(prefab, [front], [prefab, opening], PPF)).toBe(false);

    // The front's stretch of the wall, to the tile height (the opening is cut from it later)
    expect(showerFrontTiles(front, [four, opening], PPF)).toMatchObject([{ rect: { x0: 0, x1: 36, y0: 0, y1: 84 }, fixture: { id: 'shower' } }]);
    expect(showerFrontTiles(front, [shower, opening], PPF)).toEqual([]);
    expect(showerFrontTiles(north(), [four, opening], PPF)).toEqual([]);
  });

  it('reads a door against one side as there', () => {
    expect(openingDoorPosition([0, 0.6])).toBe('left');
    expect(openingDoorPosition([0.4, 1])).toBe('right');
    expect(openingDoorPosition([0, 1])).toBe('center');
  });
});

describe('an opening in walls drawn one on the other', () => {
  // The bathroom's 5' wall, and the 4' wall of the room off it along the same line, drawn the other way
  const bath = wall('a', 0, 200, 200, 200);
  const room = wall('b', 160, 200, 0, 200);
  const opening = (x: number) => ({
    ...fixture('door', x, 190, 24, 6), id: `o${x}`, wallId: 'a', properties: { noSlab: true },
  });

  it('cuts through both, each along its own length', () => {
    expect(wallOpeningsOf(bath, [opening(60)], PPF).map((o) => o.rect)).toEqual([{ x0: 6, x1: 30, y0: 0, y1: 80 }]);
    expect(wallOpeningsOf(room, [opening(60)], PPF).map((o) => o.rect)).toEqual([{ x0: 18, x1: 42, y0: 0, y1: 80 }]);
  });

  it('cuts each only as far as it reaches', () => {
    expect(wallOpeningsOf(bath, [opening(180)], PPF).map((o) => o.rect)).toEqual([{ x0: 42, x1: 60, y0: 0, y1: 80 }]);
    expect(wallOpeningsOf(room, [opening(180)], PPF).map((o) => o.rect)).toEqual([{ x0: 0, x1: 6, y0: 0, y1: 80 }]);
  });

  it('leaves a wall across it alone', () => {
    expect(wallOpeningsOf(wall('c', 100, 0, 100, 200), [opening(60)], PPF)).toEqual([]);
    expect(wallOpeningsOf(wall('d', 0, 260, 200, 260), [opening(60)], PPF)).toEqual([]);
  });
});

describe('drywall repair or insulation drawn along a wall', () => {
  // The north wall, 96" long; a 30" opening in it from 33" to 63" (80" high), a 30" window from 0 to 30" (sill 36", 48" high)
  const opening = { ...fixture('door', 160, -10, 30, 6), id: 'opening', properties: { noSlab: true } };
  const window = fixture('window', 50, 0, 30, 6);
  const along = [{ x: 0, y: 0 }, { x: 320, y: 0 }];

  it('leaves out the doors, openings and windows in it, up to its height', () => {
    expect(wallStripAreaSF(along, 96, [north()], [], PPF)).toBe(64);
    expect(wallStripAreaSF(along, 96, [north()], [opening], PPF)).toBeCloseTo(64 - (30 * 80) / 144, 2);
    expect(wallStripAreaSF(along, 96, [north()], [opening, window], PPF)).toBeCloseTo(64 - (30 * 80) / 144 - (30 * 48) / 144, 2);
    // 4' high: the window's lower foot of glass only, and the opening's bottom 4'
    expect(wallStripAreaSF(along, 48, [north()], [opening, window], PPF)).toBeCloseTo(32 - (30 * 48) / 144 - (30 * 12) / 144, 2);
  });

  it('takes out only the part of an opening in its stretch', () => {
    expect(wallStripAreaSF([{ x: 0, y: 0 }, { x: 160, y: 0 }], 96, [north()], [opening], PPF)).toBeCloseTo(32 - (15 * 80) / 144, 2);
  });

  it('is its whole length along no wall', () => {
    expect(wallStripAreaSF([{ x: 0, y: 100 }, { x: 160, y: 100 }], 96, [north()], [opening], PPF)).toBe(32);
  });
});
