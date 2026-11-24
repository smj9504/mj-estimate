import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom } from '../../../../types/bathroomSketch';
import { generateTileZones } from './beTileZoneGenerator';

const PPF = 40;
const room: BERoom = {
  id: 'bath', name: 'Bath', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 320 }, { x: 0, y: 320 }],
  wallIds: [], heightInches: 96, floorAreaSF: 80, netFloorAreaSF: 80, wallAreaSF: 0, perimeterLF: 36,
};
const shower = (floor: 'tile' | 'acrylic_pan'): BEFixture => ({
  id: 'shower', type: 'shower', position: { x: 100, y: 53 }, dimensions: { width: 60, height: 32 }, rotation: 0, roomId: 'bath',
  properties: { showerLayout: 'alcove', showerFloorType: floor, curbHeight: 4 },
});
const types = (floor: 'tile' | 'acrylic_pan') => generateTileZones([shower(floor)], [room], PPF).map((z) => z.type);

describe('a shower on a pan', () => {
  it('has no floor tile or tiled curb on the plan, its walls tiled all the same', () => {
    expect(types('tile')).toEqual(expect.arrayContaining(['shower_walls', 'shower_floor', 'shower_curb']));
    const pan = types('acrylic_pan');
    expect(pan).toContain('shower_walls');
    expect(pan).not.toContain('shower_floor');
    expect(pan).not.toContain('shower_curb');
  });
});
