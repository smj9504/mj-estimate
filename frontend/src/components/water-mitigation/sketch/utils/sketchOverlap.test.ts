import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  segmentsProperlyIntersect,
  polygonsOverlap,
} from './sketchGeometry';

/**
 * Overlap detection for "rooms may not overlap".
 *
 * The hard part is not detecting overlap — it is NOT detecting it for rooms
 * that merely share a wall, which is how every adjacent pair is built. Every
 * test below exists to hold that line.
 */

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('pointInPolygon', () => {
  const box = square(0, 0, 10);

  it('finds points strictly inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, box)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.1 }, box)).toBe(true);
  });

  it('rejects points outside', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, box)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, box)).toBe(false);
  });

  it('rejects points on an edge or vertex', () => {
    // Deliberate: shared walls put points exactly on edges, and counting
    // those as inside would flag every adjacent room pair as overlapping.
    expect(pointInPolygon({ x: 0, y: 0 }, box)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 10 }, box)).toBe(false);
  });

  it('rejects degenerate polygons', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('handles a concave polygon', () => {
    // An L-shape; the notch is outside even though it is within the bounds.
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(false);
  });
});

describe('segmentsProperlyIntersect', () => {
  it('detects a clean X crossing', () => {
    expect(
      segmentsProperlyIntersect(
        { x: 0, y: 0 }, { x: 10, y: 10 },
        { x: 0, y: 10 }, { x: 10, y: 0 },
      ),
    ).toBe(true);
  });

  it('rejects segments that only touch at an endpoint', () => {
    // Walls meeting at a corner do this constantly.
    expect(
      segmentsProperlyIntersect(
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 10, y: 0 }, { x: 10, y: 10 },
      ),
    ).toBe(false);
  });

  it('rejects a T junction', () => {
    expect(
      segmentsProperlyIntersect(
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 5, y: 0 }, { x: 5, y: 10 },
      ),
    ).toBe(false);
  });

  it('rejects collinear overlap', () => {
    // A shared wall traced by both rooms.
    expect(
      segmentsProperlyIntersect(
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 5, y: 0 }, { x: 15, y: 0 },
      ),
    ).toBe(false);
  });

  it('rejects parallel segments', () => {
    expect(
      segmentsProperlyIntersect(
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 0, y: 5 }, { x: 10, y: 5 },
      ),
    ).toBe(false);
  });
});

describe('polygonsOverlap', () => {
  it('is false for rooms far apart', () => {
    expect(polygonsOverlap(square(0, 0, 10), square(100, 100, 10))).toBe(false);
  });

  it('is FALSE for rooms sharing a full wall', () => {
    // The whole point. Two rooms side by side, sharing the x=10 edge.
    expect(polygonsOverlap(square(0, 0, 10), square(10, 0, 10))).toBe(false);
  });

  it('is FALSE for rooms sharing only a corner', () => {
    expect(polygonsOverlap(square(0, 0, 10), square(10, 10, 10))).toBe(false);
  });

  it('is FALSE for rooms sharing part of a wall', () => {
    // Offset vertically, so the shared edge is partial — still adjacency.
    expect(polygonsOverlap(square(0, 0, 10), square(10, 5, 10))).toBe(false);
  });

  it('is TRUE when outlines cut through each other', () => {
    expect(polygonsOverlap(square(0, 0, 10), square(5, 5, 10))).toBe(true);
  });

  it('is TRUE for a slight overlap', () => {
    // One pixel of shared area still counts.
    expect(polygonsOverlap(square(0, 0, 10), square(9, 0, 10))).toBe(true);
  });

  it('is TRUE when one room is entirely inside another', () => {
    // No edges cross at all, so this relies on the containment check.
    expect(polygonsOverlap(square(0, 0, 100), square(20, 20, 10))).toBe(true);
    // Order must not matter.
    expect(polygonsOverlap(square(20, 20, 10), square(0, 0, 100))).toBe(true);
  });

  it('is false for degenerate input', () => {
    expect(polygonsOverlap([], square(0, 0, 10))).toBe(false);
    expect(polygonsOverlap(square(0, 0, 10), [{ x: 0, y: 0 }])).toBe(false);
  });

  it('handles an identical pair as overlapping', () => {
    const s = square(0, 0, 10);
    expect(polygonsOverlap(s, [...s])).toBe(true);
  });
});
