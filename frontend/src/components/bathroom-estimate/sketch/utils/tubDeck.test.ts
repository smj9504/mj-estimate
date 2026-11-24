import { describe, it, expect } from 'vitest';
import type { BEFixture, BERoom } from '../../../../types/bathroomSketch';
import { generateTileZones } from './beTileZoneGenerator';
import { getFixtureShape } from './beFixtureShapes';
import { tubDeckBySide } from './tubDeck';

const PPF = 40;
// A 9' x 4' tiled platform, the tub dropped in: a 4" lip at the front, 2' ledges at the ends, 1' at the back
const platform = (sides?: BEFixture['properties']['deckSideWidths'], sub: BEFixture['properties']['bathtubSubType'] = 'drop_in'): BEFixture => ({
  id: 'tub', type: 'bathtub', position: { x: 180, y: 80 }, dimensions: { width: 108, height: 48 }, rotation: 0, roomId: 'bath',
  properties: { bathtubSubType: sub, deckHeight: 20, deckSideWidths: sides },
});
const room: BERoom = {
  id: 'bath', name: 'Bath', roomType: 'bathroom',
  boundary: [{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 480, y: 400 }, { x: 0, y: 400 }],
  wallIds: [], heightInches: 96, floorAreaSF: 120, netFloorAreaSF: 120, wallAreaSF: 0, perimeterLF: 44,
};
const SIDES = { back: 12, front: 4, left: 24, right: 24 };

describe("a drop-in tub's deck side by side", () => {
  it('leaves the tub inside the platform, and its deck is the rest', () => {
    const deck = tubDeckBySide(platform(SIDES))!;
    expect(deck.tub).toEqual({ x0: 24, x1: 84, y0: 12, y1: 44 });
    expect([deck.tubLengthIn, deck.tubDepthIn]).toEqual([60, 32]);
    expect(deck.deckSF).toBeCloseTo((108 * 48 - 60 * 32) / 144, 2);
  });

  it('keeps a tub inside however wide the decks are set', () => {
    const deck = tubDeckBySide(platform({ back: 40, front: 40, left: 60, right: 60 }))!;
    expect(deck.tubLengthIn).toBe(24);
    expect(deck.tubDepthIn).toBe(18);
    expect(deck.sides).toEqual({ back: 30, front: 0, left: 60, right: 24 });
  });

  it("is only a drop-in's, and only when set", () => {
    expect(tubDeckBySide(platform())).toBeNull();
    expect(tubDeckBySide(platform(SIDES, 'corner_drop_in'))).toBeNull();
  });

  it('is the deck zone: its area, a strip each side as wide as its deck', () => {
    const zone = generateTileZones([platform(SIDES)], [room], PPF).find((z) => z.type === 'tub_deck')!;
    expect(zone.areaSF).toBeCloseTo((108 * 48 - 60 * 32) / 144, 2);
    expect(zone.subBoundaries).toHaveLength(4);
    // The left ledge: 2' (80 px) wide
    const left = zone.subBoundaries![2];
    expect(left[1].x - left[0].x).toBeCloseTo(80);
  });

  it('draws the tub where the decks leave it', () => {
    const shape = getFixtureShape('bathtub', 'drop_in', undefined, undefined, undefined, undefined, undefined, undefined, undefined, null, undefined,
      { tubInDeck: { x0: 24 / 108, x1: 84 / 108, y0: 12 / 48, y1: 44 / 48, rx: 4 / 108, ry: 4 / 48 } });
    const basin = shape.paths[2].d;
    expect(basin.startsWith(`M${Math.round((28 / 108) * 10000) / 10000},0.25`)).toBe(true);
  });
});
