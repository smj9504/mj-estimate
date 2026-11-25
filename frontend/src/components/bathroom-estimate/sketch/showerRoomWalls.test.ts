import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom, BESketchData, BEWall } from '../../../types/bathroomSketch';
import { DEFAULT_BE_SKETCH_SETTINGS } from '../../../types/bathroomSketch';
import { bathroomModel } from './bathroom3dModel';
import { showerGlassFrontSpans, wallFinishAreas, wallOpeningsOf, wallRoomNormal, wallStartOnLeft } from './utils/wallFinish';

// 40 px to the foot, walls 8' high
const PPF = 40;
const wall = (id: string, x0: number, y0: number, x1: number, y1: number): BEWall => ({
  id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 6, heightInches: 96,
});
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation: 0, roomId: 'bath', properties,
});
const room = (id: string, boundary: [number, number][], wallIds: string[]): BERoom => ({
  id, name: id, roomType: 'bathroom', boundary: boundary.map(([x, y]) => ({ x, y })), wallIds,
  heightInches: 96, floorAreaSF: 0, netFloorAreaSF: 0, wallAreaSF: 0, perimeterLF: 0,
});
const sketch = (walls: BEWall[], rooms: BERoom[], fixtures: BEFixture[]): BESketchData => ({
  version: '1.0.0', walls, rooms, fixtures,
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: PPF },
});

// A 36" x 36" shower in the corner of a shower room, its front on a wall 3' out
// running on 2' past it: the shower's glass door and panel stand on that line
const shower = fixture('shower', 'shower', 60, 60, 36, 36, { showerLayout: 'alcove', showerDoorType: 'swing', fixedPanelConfig: 'left' });
const front = wall('front', 0, 120, 200, 120);

describe("a wall along a shower's glass front", () => {
  it('is open across the front, floor to ceiling', () => {
    expect(showerGlassFrontSpans(front, [shower], PPF)).toEqual([{ x0: 0, x1: 36, fixture: shower }]);
    expect(wallOpeningsOf(front, [shower], PPF)).toEqual([{ rect: { x0: 0, x1: 36, y0: 0, y1: 96 }, fixture: shower }]);
    // A shower a couple of inches short of the line is still against it
    const short = { ...shower, position: { x: 60, y: 54 } };
    expect(showerGlassFrontSpans(front, [short], PPF)).toHaveLength(1);
  });

  it("isn't when it's a shower room's front with its door in it, or a neo-angle shower's", () => {
    const opening = fixture('opening', 'door', 60, 80, 24, 24, { noSlab: true });
    expect(showerGlassFrontSpans(front, [shower, opening], PPF)).toEqual([]);
    expect(wallOpeningsOf(front, [shower, opening], PPF).map((o) => o.fixture.id)).toEqual(['opening']);
    const neo = { ...shower, properties: { ...shower.properties, showerLayout: 'neo_angle' as const } };
    expect(showerGlassFrontSpans(front, [neo], PPF)).toEqual([]);
    // A wall the shower's back or side stands on isn't its front
    expect(showerGlassFrontSpans(wall('back', 0, 0, 200, 0), [shower], PPF)).toEqual([]);
  });

  it("isn't painted, and isn't wall in 3D: no jambs, no wall over it", () => {
    // 60" of wall less the 36" front: 24" x 96" to paint
    expect(wallFinishAreas(front, [shower], PPF).paintSF).toBeCloseTo((24 * 96) / 144, 1);
    const bath = room('bath', [[0, 0], [320, 0], [320, 200], [0, 200]], ['front']);
    const w = bathroomModel(sketch([front], [bath], [shower])).walls[0];
    expect(w.openings).toEqual([{ rect: { x0: 0, x1: 36, y0: 0, y1: 96 }, kind: 'open', fixtureId: 'shower', hingeAtStart: true, swingsIn: true }]);
    expect(w.pieces).toEqual([{ x0: 36, x1: 60, y0: 0, y1: 96 }]);
  });
});

describe('a shower room whose walls are the bathroom\'s', () => {
  // An L-shaped bathroom round a 3' x 3' shower room in its north-west corner:
  // the shower room's east and south walls are the bathroom's
  const east = wall('east', 120, 0, 120, 120);
  const south = wall('south', 0, 120, 120, 120);
  const bath = room('bath', [[120, 0], [320, 0], [320, 200], [0, 200], [0, 120], [120, 120]], ['east', 'south']);
  // The shower filling the room, its front (south) a wall with an opening in it
  const opening = fixture('opening', 'door', 60, 80, 24, 24, { noSlab: true });
  const niche = { ...fixture('niche', 'niche', 120 - 20 / 3, 60, 12, 4, { nicheType: 'tile' }), rotation: 90 };

  it("tiles the shower's side on the face the shower is on, not the bathroom's", () => {
    const model = bathroomModel(sketch([east, south], [bath], [shower, opening]));
    const e = model.walls.find((w) => w.id === 'east')!;
    // The wall's room is the bathroom (east of it); the shower's west of it
    expect(e.inward![0]).toBeCloseTo(1);
    expect(e.inward![1]).toBeCloseTo(0);
    expect(e.surrounds).toEqual([]);
    expect(e.backSurrounds).toEqual([{ rect: { x0: 0, x1: 36, y0: 0, y1: 96 }, finish: 'tile', fixtureId: 'shower' }]);
  });

  it('sets a niche in that face too', () => {
    const model = bathroomModel(sketch([east, south], [bath], [shower, opening, niche]));
    const e = model.walls.find((w) => w.id === 'east')!;
    expect(e.niches).toMatchObject([{ face: 'back', lining: 'shower' }]);
    // Cut through the wall's body, out of the shower's tile, not the bathroom side's
    const n = e.niches[0].rect;
    const inIt = (r: { x0: number; x1: number; y0: number; y1: number }) => r.x0 < (n.x0 + n.x1) / 2 && r.x1 > (n.x0 + n.x1) / 2 && r.y0 < 50 && r.y1 > 50;
    expect(e.pieces.some(inIt)).toBe(false);
    expect(e.backSurrounds.some((s) => inIt(s.rect))).toBe(false);
  });
});

describe("a wall's room side", () => {
  // An L whose corner-average lies outside it, below the inner wall's line
  const inner = wall('inner', 40, 40, 400, 40);
  const ell = room('ell', [[0, 0], [400, 0], [400, 40], [40, 40], [40, 400], [0, 400]], ['inner']);

  it('is the side its outline is on, wherever its middle is', () => {
    const n = wallRoomNormal(inner, [ell])!;
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-1);
    expect(bathroomModel(sketch([inner], [ell], [])).walls[0].inward![1]).toBeCloseTo(-1);
    // From inside, facing it (north of it, looking south): its start, at the west, on your right
    expect(wallStartOnLeft(inner, [ell])).toBe(false);
  });
});
