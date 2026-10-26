import { describe, it, expect } from 'vitest';
import { resizeRoomEdge } from './beGeometry';

// 40 px to the foot: a 5 ft × 8 ft room, corners listed top-left, clockwise
const room = [{ x: 60, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 360 }, { x: 60, y: 360 }];
const FT = 40;

describe('resizeRoomEdge', () => {
  it('widens a rectangle from its top edge: the right side moves out with the corner', () => {
    expect(resizeRoomEdge(room, 0, 6 * FT)).toEqual([
      { x: 60, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 360 }, { x: 60, y: 360 },
    ]);
  });

  it('lengthens a rectangle from its right edge: the bottom moves down', () => {
    expect(resizeRoomEdge(room, 1, 9 * FT)).toEqual([
      { x: 60, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 400 }, { x: 60, y: 400 },
    ]);
  });

  it('moves the far end of an edge drawn right to left (the bottom edge grows to the left)', () => {
    expect(resizeRoomEdge(room, 2, 6 * FT)).toEqual([
      { x: 20, y: 40 }, { x: 260, y: 40 }, { x: 260, y: 360 }, { x: 20, y: 360 },
    ]);
  });

  it('moves only the end corner of a room that is not four-cornered', () => {
    const ell = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    const b = resizeRoomEdge(ell, 0, 240)!;
    expect(b[1]).toEqual({ x: 240, y: 0 });
    expect(b.filter((p, i) => i !== 1)).toEqual(ell.filter((p, i) => i !== 1));
  });

  it('squares up an edge that is nearly level', () => {
    const skewed = [{ x: 0, y: 0 }, { x: 200, y: 6 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
    expect(resizeRoomEdge(skewed, 0, 240)![1]).toEqual({ x: 240, y: 0 });
  });

  it('gives up on an edge with no length', () => {
    expect(resizeRoomEdge([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }], 0, 40)).toBeNull();
  });
});
