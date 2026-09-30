import { describe, it, expect } from 'vitest';
import {
  parseDimension,
  formatDimension,
  formatDimensionCompact,
  calcDemoZoneSqft,
  calcPolygonAreaSqft,
  calcContainmentSqft,
  calcFloorProtectionSqft,
  calcContentProtectionSqft,
  pixelsToFeet,
  feetToPixels,
} from './wmCalculations';

/**
 * These functions are the shared vocabulary of the sketch editor: the canvas
 * label, the sidebar field and the inline editor all round-trip through
 * parseDimension / formatDimensionCompact, and every area read-out goes
 * through the sqft helpers. They are pure, so they are cheap to pin down —
 * and pinning them down is the point, because the coordinate layer above them
 * is about to be refactored.
 */

describe('parseDimension', () => {
  it('returns 0 for empty or blank input', () => {
    expect(parseDimension('')).toBe(0);
    expect(parseDimension('   ')).toBe(0);
  });

  it('parses feet and inches', () => {
    expect(parseDimension('3\' 4"')).toBeCloseTo(3 + 4 / 12, 10);
    expect(parseDimension('3\'4"')).toBeCloseTo(3 + 4 / 12, 10);
  });

  it('parses feet and inches without the closing double quote', () => {
    // The inches marker is optional — people stop typing after the number.
    expect(parseDimension("3' 4")).toBeCloseTo(3 + 4 / 12, 10);
  });

  it('parses inches only', () => {
    expect(parseDimension('44"')).toBeCloseTo(44 / 12, 10);
  });

  it('parses decimal and plain feet', () => {
    expect(parseDimension('3.7')).toBeCloseTo(3.7, 10);
    expect(parseDimension("3.7'")).toBeCloseTo(3.7, 10);
    expect(parseDimension("3'")).toBe(3);
    expect(parseDimension('12')).toBe(12);
  });

  it('returns 0 for unparseable input rather than NaN', () => {
    // Callers treat 0 as "leave the value alone"; NaN would silently collapse
    // a wall to nothing.
    expect(parseDimension('abc')).toBe(0);
    expect(parseDimension("3' 4' 5'")).toBe(0);
    expect(parseDimension('-5')).toBe(0);
  });
});

describe('formatDimension', () => {
  it('formats feet and inches with a space', () => {
    expect(formatDimension(6.25)).toBe('6\' 3"');
    expect(formatDimension(3)).toBe('3\' 0"');
    expect(formatDimension(0.5)).toBe('0\' 6"');
  });

  it('carries into the next foot when inches round up to 12', () => {
    expect(formatDimension(11.999)).toBe('12\' 0"');
  });

  it('is defensive about negative and non-finite input', () => {
    expect(formatDimension(-1)).toBe('0\' 0"');
    expect(formatDimension(NaN)).toBe('0\' 0"');
    expect(formatDimension(Infinity)).toBe('0\' 0"');
  });
});

describe('formatDimensionCompact', () => {
  it('drops the inches part when the value is whole feet', () => {
    expect(formatDimensionCompact(3)).toBe("3'");
  });

  it('drops the feet part when the value is under a foot', () => {
    expect(formatDimensionCompact(0.5)).toBe('6"');
  });

  it('shows both parts with no space', () => {
    expect(formatDimensionCompact(6.25)).toBe('6\'3"');
    expect(formatDimensionCompact(12.5)).toBe('12\'6"');
  });

  it('carries into the next foot when inches round up to 12', () => {
    expect(formatDimensionCompact(11.999)).toBe("12'");
  });

  it('is defensive about negative and non-finite input', () => {
    expect(formatDimensionCompact(-1)).toBe("0'");
    expect(formatDimensionCompact(NaN)).toBe("0'");
  });
});

describe('parse / format round trip', () => {
  it('survives a round trip through the compact form', () => {
    // This is the loop the inline canvas editor runs: show a value, let the
    // user retype it, parse it back. Drift here shows up as a wall that
    // changes length just from being opened for editing.
    for (const feet of [3, 6.25, 12.5, 0.5, 15.75]) {
      expect(parseDimension(formatDimensionCompact(feet))).toBeCloseTo(feet, 10);
    }
  });
});

describe('area helpers', () => {
  it('multiplies the two dimensions and rounds to 2dp', () => {
    expect(calcDemoZoneSqft(3, 4)).toBe(12);
    expect(calcDemoZoneSqft(3.333, 3.333)).toBe(11.11);
  });

  it('computes containment, floor protection and content protection areas', () => {
    expect(calcContainmentSqft(10, 8)).toBe(80);
    expect(calcFloorProtectionSqft(3, 10)).toBe(30);
    expect(calcContentProtectionSqft(2.5, 4)).toBe(10);
  });
});

describe('calcPolygonAreaSqft', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];

  it('converts a pixel polygon to square feet using the scale', () => {
    // 40px at 20px/ft is 2ft a side, so 4 sqft.
    expect(calcPolygonAreaSqft(square, 20)).toBe(4);
  });

  it('is independent of winding direction', () => {
    expect(calcPolygonAreaSqft([...square].reverse(), 20)).toBe(4);
  });

  it('returns 0 for degenerate input instead of NaN', () => {
    expect(calcPolygonAreaSqft([], 20)).toBe(0);
    expect(calcPolygonAreaSqft([{ x: 0, y: 0 }, { x: 1, y: 1 }], 20)).toBe(0);
    expect(calcPolygonAreaSqft(square, 0)).toBe(0);
  });
});

describe('pixel / foot conversion', () => {
  it('round trips', () => {
    expect(pixelsToFeet(feetToPixels(7.5, 20), 20)).toBeCloseTo(7.5, 10);
  });

  it('guards against a zero or negative scale', () => {
    // An uncalibrated sketch must not produce Infinity lengths.
    expect(pixelsToFeet(100, 0)).toBe(0);
    expect(pixelsToFeet(100, -5)).toBe(0);
  });
});
