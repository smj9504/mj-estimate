import { describe, it, expect } from 'vitest';
import type { BEFixture, BESketchData, BEWall } from '../../../types/bathroomSketch';
import { DEFAULT_BE_SKETCH_SETTINGS } from '../../../types/bathroomSketch';
import { bathroomModel } from './bathroom3dModel';
import { getFixtureShape } from './utils/beFixtureShapes';

// 40 px to the foot: a 10' x 8' bath, a 60" pair of doors in its south wall
const PPF = 40;
const south: BEWall = { id: 's', start: { x: 0, y: 320 }, end: { x: 400, y: 320 }, thickness: 6, heightInches: 96 };
// The box is as deep as one leaf's swing (30"), its bottom edge on the wall
const pair: BEFixture = {
  id: 'door', type: 'door', position: { x: 200, y: 320 - 50 }, dimensions: { width: 60, height: 30 }, rotation: 0,
  roomId: 'r', wallId: 's', properties: { doubleDoor: true },
};
const sketch = (fixtures: BEFixture[]): BESketchData => ({
  version: '1.0.0',
  walls: [south],
  rooms: [{
    id: 'r', name: 'Bath', roomType: 'bathroom',
    boundary: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 320 }, { x: 0, y: 320 }],
    wallIds: ['s'], heightInches: 96, floorAreaSF: 80, netFloorAreaSF: 80, wallAreaSF: 0, perimeterLF: 36,
  }],
  fixtures,
  tileZones: [], damageZones: [], drywallRepairZones: [], insulationZones: [],
  settings: { ...DEFAULT_BE_SKETCH_SETTINGS, pixelsPerFoot: PPF },
});

describe('a double door', () => {
  it('is drawn as two leaves, each swinging from its own jamb', () => {
    const shape = getFixtureShape('door', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null, undefined, { doubleDoor: true });
    expect(shape.label).toBe('Double door');
    expect(shape.paths.filter((p) => p.d.includes(' A0.5,1 '))).toHaveLength(2);
    // With no slab it's an opening, pair or not
    expect(getFixtureShape('door', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null, undefined, { doubleDoor: true, noSlab: true }).label).toBe('Opening');
  });

  it('cuts its whole width out of the wall, and hangs a pair in 3D', () => {
    const w = bathroomModel(sketch([pair])).walls[0];
    expect(w.openings).toMatchObject([{ kind: 'door', double: true, rect: { x0: 30, x1: 90, y0: 0, y1: 80 } }]);
    // An opening is never a pair
    const opening = { ...pair, properties: { doubleDoor: true, noSlab: true } };
    expect(bathroomModel(sketch([opening])).walls[0].openings[0].double).toBeUndefined();
  });
});
