import { describe, expect, it } from 'vitest';
import { OPENING_RETURN_IN, showerRoomFrontRunIn, showerRoomFrontSF, showerRoomFrontTiled } from './showerRoom';

// A 36" shower, tiled to 84", in its own room: a 24" x 80" opening in its front
const ROOM = { width_in: 36, tile_height_in: 84, front_opening_in: 24, front_opening_height_in: 80 };

describe("a shower room's front, as the estimate prices it", () => {
  it('is tiled beside the opening and round it (head too, the tile going above it)', () => {
    const front = (12 * 84) / 144;
    const returns = ((2 * 80 + 24) * OPENING_RETURN_IN) / 144;
    expect(showerRoomFrontSF({ ...ROOM, front_tiled: true })).toBeCloseTo(front + returns);
    expect(showerRoomFrontRunIn({ ...ROOM, front_tiled: true })).toBe(12);
  });

  it('tiles the jambs only when the tile stops below the head', () => {
    const sf = showerRoomFrontSF({ ...ROOM, tile_height_in: 72, front_tiled: true });
    expect(sf).toBeCloseTo((12 * 72) / 144 + (2 * 72 * OPENING_RETURN_IN) / 144);
  });

  it('is nothing with 3 tiled walls, with no opening, or for a neo-angle', () => {
    expect(showerRoomFrontSF({ ...ROOM, front_tiled: false })).toBe(0);
    expect(showerRoomFrontSF({ ...ROOM, front_opening_in: 0 })).toBe(0);
    expect(showerRoomFrontSF({ ...ROOM, layout: 'neo_angle' })).toBe(0);
    expect(showerRoomFrontRunIn({ ...ROOM, front_tiled: false })).toBe(0);
    // Saved before front_tiled: tiled, as before
    expect(showerRoomFrontTiled(ROOM)).toBe(true);
  });
});
