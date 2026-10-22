import { describe, expect, it } from 'vitest';
import { cornerAngle, segmentLabel, traceMetrics } from './roomTrace';
import type { Point } from './roomDimensions';

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

describe('cornerAngle', () => {
  it('reads a square corner as 90°', () => {
    expect(cornerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(90);
  });

  it('reads a straight run as 180°', () => {
    expect(cornerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeCloseTo(180);
  });

  it('reads a 45° miter', () => {
    expect(cornerAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 })).toBeCloseTo(135);
  });
});

describe('segmentLabel', () => {
  it('letters in order, then doubles past Z', () => {
    expect([0, 1, 25, 26, 27].map(segmentLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('traceMetrics', () => {
  it('leaves the closing segment and end-corner angles off an open polyline', () => {
    const m = traceMetrics(square, false);
    expect(m.segments.map(s => s.label)).toEqual(['A', 'B', 'C']);
    expect(m.segments.map(s => Math.round(s.lengthPx))).toEqual([100, 60, 100]);
    expect(m.closed).toBe(false);
    expect(m.areaPx).toBeNull();
    // only the two interior corners have an angle
    expect(m.vertices.map(v => v.angleDeg && Math.round(v.angleDeg))).toEqual([null, 90, 90, null]);
  });

  it('closes the loop: every corner square, area and perimeter filled in', () => {
    const m = traceMetrics(square, true);
    expect(m.segments.map(s => s.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(m.closed).toBe(true);
    expect(m.vertices.every(v => v.isRightAngle)).toBe(true);
    expect(m.perimeterPx).toBeCloseTo(320);
    expect(m.areaPx).toBeCloseTo(6000);
  });

  it('flags a non-square corner on an angled wall', () => {
    const angled: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 60, y: 100 }, // 45° cut
      { x: 0, y: 100 },
    ];
    const m = traceMetrics(angled, true);
    const corner = m.vertices[2];
    expect(Math.round(corner.angleDeg!)).toBe(135);
    expect(corner.isRightAngle).toBe(false);
    expect(m.vertices[3].isRightAngle).toBe(false);
    // the square corners are still flagged square
    expect(m.vertices[0].isRightAngle).toBe(true);
  });

  it('needs three points before it reports any angle', () => {
    const m = traceMetrics([{ x: 0, y: 0 }, { x: 10, y: 0 }], false);
    expect(m.segments).toHaveLength(1);
    expect(m.vertices.every(v => v.angleDeg === null)).toBe(true);
  });
});
