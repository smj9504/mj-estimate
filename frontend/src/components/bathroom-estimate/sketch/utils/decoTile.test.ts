import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BEWall } from '../../../../types/bathroomSketch';
import { floorBorderLF, floorBorderOutline, wallBorderLF, wallDecoInserts, wallHasDeco } from './decoTile';
import { bathroomModel } from '../bathroom3dModel';
import { DEFAULT_BE_SKETCH_SETTINGS } from '../../../../types/bathroomSketch';

// 40 px to the foot: an 8 ft x 5 ft room drawn from (0,0) to (320,200)
const PPF = 40;
const wall = (extra: Partial<BEWall> = {}): BEWall => ({
  id: 'north', start: { x: 0, y: 0 }, end: { x: 320, y: 0 }, thickness: 6, heightInches: 96, ...extra,
});
const tiled = (decoBordersAtIn?: number[], decoInserts?: number) => wall({
  tileRegions: [{ id: 't', startIn: 0, endIn: 96, bottomIn: 0, topIn: 96, decoBordersAtIn, decoInserts }],
});
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, properties,
});
// A 30" opening in the north wall from 33" to 63", 80" high
const opening = fixture('opening', 'door', 160, -10, 30, 6, { noSlab: true });
const room = (extra: Partial<BERoom> = {}): BERoom => ({
  id: 'r', name: 'Bath', roomType: 'bathroom', heightInches: 96, wallIds: [],
  boundary: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 200 }, { x: 0, y: 200 }],
  floorAreaSF: 40, netFloorAreaSF: 40, wallAreaSF: 0, perimeterLF: 26, ...extra,
});

describe("a wall's decorative border", () => {
  it('runs across its tile at each row, stopping at a door or opening it crosses', () => {
    expect(wallBorderLF(tiled([48]), [], PPF)).toBe(8);
    // At 4' the row stops either side of the opening; above it at 7' it runs right across
    expect(wallBorderLF(tiled([48]), [opening], PPF)).toBeCloseTo((33 + 33) / 12);
    expect(wallBorderLF(tiled([48, 84]), [opening], PPF)).toBeCloseTo((66 + 96) / 12);
  });

  it('counts its inserts, and says when the sketch marks any', () => {
    expect(wallDecoInserts(tiled([48], 6), PPF)).toBe(6);
    expect(wallHasDeco(tiled(), PPF)).toBe(false);
    expect(wallHasDeco(tiled([]), PPF)).toBe(true);
    expect(wallBorderLF(wall(), [], PPF)).toBe(0);
  });
});

describe("the floor's decorative border", () => {
  it('runs round the room the set way in from its walls', () => {
    const outline = floorBorderOutline(room(), 20)!;
    expect(outline.map((p) => [Math.round(p.x), Math.round(p.y)]).sort()).toEqual([[20, 180], [20, 20], [300, 180], [300, 20]].sort());
    // 6" in: 7' x 4' round
    expect(floorBorderLF(room({ floorBorderInsetIn: 6 }), [], PPF)).toBeCloseTo(22);
    expect(floorBorderLF(room(), [], PPF)).toBe(0);
  });

  it('stops under a vanity cabinet, not a pedestal sink', () => {
    // A 36" x 21" vanity in the north-west corner
    const vanity = fixture('v', 'vanity', 60, 35, 36, 21, { vanitySubType: 'cabinet' });
    expect(floorBorderLF(room({ floorBorderInsetIn: 6 }), [vanity], PPF)).toBeCloseTo(22 - 2.5 - 1.25);
    const pedestal = fixture('p', 'vanity', 60, 35, 36, 21, { vanitySubType: 'pedestal_sink' });
    expect(floorBorderLF(room({ floorBorderInsetIn: 6 }), [pedestal], PPF)).toBeCloseTo(22);
  });

  it('follows an L', () => {
    const l = room({
      floorBorderInsetIn: 6,
      boundary: [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 140 }, { x: 190, y: 140 }, { x: 190, y: 240 }, { x: 0, y: 240 }],
    });
    // The L 7' x 6' with a 2'3" x 2'6" notch: 6" in all round
    const outline = floorBorderOutline(l, 20)!;
    expect(outline).toHaveLength(6);
    // 26' round the walls; 6" in, each outside corner a foot shorter, the inside one a foot longer
    expect(floorBorderLF(l, [], PPF)).toBeCloseTo(26 - 5 + 1);
  });
});

describe('decorative tile in 3D', () => {
  it("bands a wall's border rows across its tile, and runs the floor's round the room, after the work only", () => {
    const sketch = {
      version: '1.0.0', walls: [tiled([48])], rooms: [room({ floorBorderInsetIn: 6 })], fixtures: [],
      tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
      settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: PPF },
    };
    const after = bathroomModel(sketch);
    expect(after.walls[0].borders).toEqual([{ x0: 0, x1: 96, y0: 47, y1: 49 }]);
    expect(after.floorBorders).toHaveLength(4);
    const today = bathroomModel(sketch, null, 'today');
    expect(today.walls[0].borders).toEqual([]);
    expect(today.floorBorders).toEqual([]);
  });
});
