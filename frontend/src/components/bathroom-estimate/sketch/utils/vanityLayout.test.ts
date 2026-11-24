import { describe, it, expect } from 'vitest';
import { buildCabinetVanity } from './beFixtureShapes';
import { kneeSpaceIn, vanityLayout } from './vanityLayout';

describe('a cabinet vanity along its width', () => {
  it('has its sink over the cabinet, the knee space open beside it', () => {
    // A 96" top, one sink, 36" open at its left: the cabinet the 60" at the right
    expect(vanityLayout(96, 1, 36, 'left')).toEqual({ widthIn: 96, cabinet: [36, 96], knee: [0, 36], sinks: [66] });
    expect(vanityLayout(96, 1, 36, 'right')).toEqual({ widthIn: 96, cabinet: [0, 60], knee: [60, 96], sinks: [30] });
    // Two sinks share the cabinet
    expect(vanityLayout(96, 2, 36, 'left').sinks).toEqual([51, 81]);
    // None: the cabinet all along, its sink in the middle
    expect(vanityLayout(96, 1)).toEqual({ widthIn: 96, cabinet: [0, 96], knee: null, sinks: [48] });
  });

  it('leaves 12" of cabinet under the sink at least', () => {
    expect(kneeSpaceIn(30, 36)).toBe(18);
    expect(kneeSpaceIn(30, -4)).toBe(0);
    expect(vanityLayout(30, 1, 36).cabinet).toEqual([18, 30]);
  });

  it("draws a long one-sink vanity's basin a basin's size, over the cabinet, the knee space's front dashed", () => {
    const shape = buildCabinetVanity(96, 21, 1, 36, 'left');
    const basins = shape.paths.filter((p) => p.d.includes('Q'));
    expect(basins).toHaveLength(1);
    // 16" wide round 66": from 58" to 74" of 96"
    const xs = basins[0].d.match(/M([\d.]+),/)!;
    expect(Number(xs[1])).toBeCloseTo(58 / 96, 3);
    expect(shape.paths.some((p) => p.dash)).toBe(true);
    // No knee space: nothing dashed
    expect(buildCabinetVanity(36, 21, 1).paths.some((p) => p.dash)).toBe(false);
  });
});
