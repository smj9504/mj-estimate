import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom } from '../../../../types/bathroomSketch';
import { lightsFromSketch } from '../../fixtureRows';
import { foundLightLocation, lightLocation } from './lightLocation';

// 40 px to the foot: a 10' x 8' bath, a toilet room off it to the east
const PPF = 40;
const fixture = (id: string, type: BEFixture['type'], x: number, y: number, w: number, h: number, properties: BEFixture['properties'] = {}, rotation = 0): BEFixture => ({
  id, type, position: { x, y }, dimensions: { width: w, height: h }, rotation, roomId: 'bath', properties,
});
const bath: BERoom = {
  id: 'bath', name: 'Bathroom', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 320 }, { x: 0, y: 320 }],
  wallIds: [], heightInches: 96, floorAreaSF: 80, netFloorAreaSF: 80, wallAreaSF: 0, perimeterLF: 36,
};
const toiletRoom: BERoom = {
  ...bath, id: 'wc', name: 'Toilet room', roomType: 'toilet_room',
  boundary: [{ x: 400, y: 0 }, { x: 520, y: 0 }, { x: 520, y: 160 }, { x: 400, y: 160 }],
};
const rooms = [bath, toiletRoom];
// A 36" shower in the north-west corner, a 60" tub along the south wall, a 48" vanity on the north wall
const shower = fixture('shower', 'shower', 60, 60, 36, 36);
const tub = fixture('tub', 'bathtub', 100, 320 - 160 / 3, 60, 32);
const vanity = fixture('vanity', 'vanity', 260, 35, 48, 21);
const fixtures = [shower, tub, vanity];
const can = (id: string, x: number, y: number, props: BEFixture['properties'] = {}) => fixture(id, 'light', x, y, 6, 6, { lightType: 'recessed', ...props });

describe('where a light is', () => {
  it('is what it is over on the plan, or the room of its own it is in', () => {
    expect(foundLightLocation(can('a', 60, 60), fixtures, rooms, PPF)).toBe('In the shower');
    expect(foundLightLocation(can('b', 100, 270), fixtures, rooms, PPF)).toBe('Over the tub');
    expect(foundLightLocation(can('c', 260, 40), fixtures, rooms, PPF)).toBe('Over the vanity');
    expect(foundLightLocation(can('d', 460, 80), fixtures, rooms, PPF)).toBe('Toilet room');
    // Nowhere in particular: the middle of the room
    expect(foundLightLocation(can('e', 260, 180), fixtures, rooms, PPF)).toBeNull();
  });

  it("is said of a vanity bar over its vanity by its kind already, of a sconce beside it as 'by'", () => {
    const bar = fixture('bar', 'light', 260, 3, 24, 5, { lightType: 'vanity_bar', lightBulbs: 3 });
    const sconce = fixture('sconce', 'light', 225, 3, 6, 5, { lightType: 'sconce' });
    expect(foundLightLocation(bar, fixtures, rooms, PPF)).toBeNull();
    expect(foundLightLocation(sconce, fixtures, rooms, PPF)).toBe('By the vanity');
  });

  it('is as typed on it, whatever it is over', () => {
    expect(lightLocation(can('a', 60, 60, { lightLocation: 'Steam shower' }), fixtures, rooms, PPF)).toBe('Steam shower');
    expect(lightLocation(can('a', 60, 60, { lightLocation: '  ' }), fixtures, rooms, PPF)).toBe('In the shower');
  });

  it('makes lights of a kind in different places rows of their own on the estimate', () => {
    const lights = [can('a', 60, 60), can('b', 250, 40), can('c', 270, 40), can('d', 260, 180)];
    const all = [...fixtures, ...lights];
    expect(lightsFromSketch(all, (f) => lightLocation(f, all, rooms, PPF))).toEqual([
      { type: 'recessed', count: 1, from_sketch: true },
      { type: 'recessed', count: 1, location: 'In the shower', from_sketch: true },
      { type: 'recessed', count: 2, location: 'Over the vanity', from_sketch: true },
    ]);
  });
});
