import { describe, it, expect } from 'vitest';
import type { BEFixture, BESketchData, BEWall } from '../../../../types/bathroomSketch';
import { BE_FIXTURE_DEFAULTS, DEFAULT_BE_SKETCH_SETTINGS } from '../../../../types/bathroomSketch';
import { nichesFromSketch } from '../../fixtureRows';
import { bathroomModel } from '../bathroom3dModel';
import { placeFor } from './hangOnWall';
import { nichesIn, showerNicheCount, wallNichesOf } from './wallFinish';
import { movesWithWall } from './wallSplit';

// 40 px to the foot: an 8' x 5' bath drawn from (0,0) to (320,200), walls 8' high
const PPF = 40;
const px = (inches: number) => (inches / 12) * PPF;
const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<BEWall> = {}): BEWall => ({
  id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 6, heightInches: 96, ...extra,
});
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, roomId: 'r', properties,
});
const north = wall('north', 0, 0, 320, 0);
const west = wall('west', 0, 200, 0, 0);
const south = wall('south', 320, 200, 0, 200);
// A 60" x 32" tub in the north-west corner, its surround 60" over its rim
const tub = fixture('tub', 'bathtub', px(30), px(16), 60, 32, { bathtubSubType: 'standard_alcove', hasSurround: true, surroundHeight: 60 });
// A niche as the plan's Add puts it: on the wall behind the tub, in the middle
const niche = (id: string, props: BEFixture['properties'] = {}): BEFixture => {
  const n = fixture(id, 'niche', 0, 0, 12, 4, { nicheType: 'tile', nicheHeight: 24, nicheBottom: 42, ...props });
  const spot = placeFor([tub], n, 'niche', BE_FIXTURE_DEFAULTS.niche, PPF)!;
  return { ...n, ...spot };
};
const sketch = (walls: BEWall[], fixtures: BEFixture[]): BESketchData => ({
  version: '1.0.0',
  walls,
  rooms: [{
    id: 'r', name: 'Bath', roomType: 'bathroom',
    boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
    wallIds: walls.map((w) => w.id), heightInches: 96, floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 208, perimeterLF: 26,
  }],
  fixtures,
  tileZones: [],
  damageZones: [],
  drywallRepairZones: [],
  insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: PPF },
});

describe('a niche in a wall', () => {
  it('goes on the wall behind the tub when added, clear of its valve, its opening up the wall from its bottom', () => {
    // The tub's valve is in the middle of that wall: the niche is in the middle of its right half
    const n = niche('n');
    expect(n.position.y).toBeCloseTo(px(2));
    expect(wallNichesOf(north, [n], PPF)).toEqual([{ rect: { x0: 39, x1: 51, y0: 42, y1: 66 }, fixture: n }]);
    // The valve at the tub's right end: the niche in the middle of the wall
    const valveEast = { ...tub, properties: { ...tub.properties, faucetPos: { x: 1, y: 0.5 } } };
    const spot = placeFor([valveEast], n, 'niche', BE_FIXTURE_DEFAULTS.niche, PPF)!;
    expect(spot.position.x).toBeCloseTo(px(30));
    // In no other wall
    expect(wallNichesOf(west, [n], PPF)).toEqual([]);
    expect(wallNichesOf(south, [n], PPF)).toEqual([]);
    // A niche off every wall is in none
    expect(wallNichesOf(north, [{ ...n, position: { x: 160, y: 100 } }], PPF)).toEqual([]);
    // It moves with its wall (wallSplit offset)
    expect(movesWithWall(n, north, PPF)).toBe(true);
  });

  it("is in the tub's wall, and a shower's own niche count gives way to niches drawn in its walls", () => {
    const n = niche('n');
    expect(nichesIn(tub, [tub, n], PPF)).toEqual([n]);
    const shower = { ...tub, id: 'shower', type: 'shower' as const, properties: { nicheCount: 2 } };
    expect(showerNicheCount(shower, [shower], PPF)).toBe(2);
    expect(showerNicheCount(shower, [shower, n], PPF)).toBe(0);
    // A niche across the room isn't in its walls
    const across = { ...n, id: 'across', position: { x: 160, y: 200 - px(2) }, rotation: 180 };
    expect(showerNicheCount(shower, [shower, across], PPF)).toBe(2);
  });

  it('is a row by kind and opening on the estimate, as each size is priced by its edge', () => {
    const long = { ...niche('d'), dimensions: { width: 48, height: 4 }, properties: { ...niche('d').properties, nicheHeight: 12 } };
    expect(nichesFromSketch([niche('a'), long, niche('b'), niche('c', { nicheType: 'drywall' }), tub])).toEqual([
      { type: 'tile', count: 2, width: 12, height: 24, from_sketch: true },
      { type: 'tile', count: 1, width: 48, height: 12, from_sketch: true },
      { type: 'drywall', count: 1, width: 12, height: 24, from_sketch: true },
    ]);
    // To the quarter inch, as the backend prices it
    const odd = { ...niche('e'), dimensions: { width: 13.1, height: 4 }, properties: { ...niche('e').properties, nicheHeight: 23.9 } };
    expect(nichesFromSketch([odd])).toEqual([{ type: 'tile', count: 1, width: 13, height: 24, from_sketch: true }]);
  });
});

describe('a niche in 3D', () => {
  it("is cut out of its wall and the tub's surround, lined with the surround's tile", () => {
    const model = bathroomModel(sketch([north, west, south], [tub, niche('n')]));
    const n = model.walls.find((w) => w.id === 'north')!;
    expect(n.niches).toEqual([{ rect: { x0: 39, x1: 51, y0: 42, y1: 66 }, fixtureId: 'n', depthIn: 3.5, lining: 'tub', face: 'room' }]);
    const inIt = (r: { x0: number; x1: number; y0: number; y1: number }) => r.x0 < 45 && r.x1 > 45 && r.y0 < 54 && r.y1 > 54;
    expect(n.pieces.some(inIt)).toBe(false);
    expect(n.surrounds.some((s) => inIt(s.rect))).toBe(false);
    // Built in the wall, not as a fixture standing in the room
    expect(model.fixtures.map((f) => f.fixture.id)).toEqual(['tub']);
  });

  it("is painted when it's a drywall niche, and lined with the wall's tile on a tiled wall with no tub", () => {
    const tiled = { tileRegions: [{ id: 't', startIn: 0, endIn: 999, bottomIn: 0, topIn: 96 }] };
    const drywall = { ...niche('d', { nicheType: 'drywall' }) };
    expect(bathroomModel(sketch([north, west, south], [tub, drywall])).walls[0].niches[0].lining).toBe('paint');
    const onTile = { ...niche('t'), position: { x: px(78), y: px(2) } };
    const model = bathroomModel(sketch([wall('north', 0, 0, 320, 0, tiled), west, south], [tub, onTile]));
    expect(model.walls[0].niches[0]).toMatchObject({ rect: { x0: 72, x1: 84 }, lining: 'wall' });
    expect(model.walls[0].tile.some((r) => r.x0 < 78 && r.x1 > 78 && r.y0 < 54 && r.y1 > 54)).toBe(false);
  });
});
