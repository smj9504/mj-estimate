import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, pinchView, zoomAround } from './view';

const feetAt = (v: { scale: number; x: number; y: number }, px: { x: number; y: number }) => ({
  x: (px.x - v.x) / v.scale,
  y: (px.y - v.y) / v.scale,
});

describe('zooming', () => {
  it('keeps the spot under the pointer in place', () => {
    const view = { scale: 20, x: 40, y: 30 };
    const at = { x: 300, y: 200 };
    const zoomed = zoomAround(view, 2, at);
    expect(zoomed.scale).toBe(40);
    const before = feetAt(view, at);
    const after = feetAt(zoomed, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('stays within its limits', () => {
    expect(zoomAround({ scale: 100, x: 0, y: 0 }, 5, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAround({ scale: 4, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });
});

describe('two fingers', () => {
  it('zoom by how far they spread and keep what was between them between them', () => {
    const start = { scale: 10, x: 0, y: 0 };
    const startCenter = { x: 100, y: 100 };
    const pinned = feetAt(start, startCenter);
    // Spread to twice the distance and moved 20px right together
    const view = pinchView(start, startCenter, 50, { x: 120, y: 100 }, 100);
    expect(view.scale).toBe(20);
    const now = feetAt(view, { x: 120, y: 100 });
    expect(now.x).toBeCloseTo(pinned.x, 9);
    expect(now.y).toBeCloseTo(pinned.y, 9);
  });
});
