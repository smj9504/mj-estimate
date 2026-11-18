import { describe, expect, it } from 'vitest';
import { borderLf, showerWallRunIn, tubSurroundRunIn } from './decorativeTile';

describe('decorative tile lengths', () => {
  it('runs around a tub surround along the walls it tiles', () => {
    expect(tubSurroundRunIn({ tub_length_in: 60, tub_depth_in: 32, surround_wall_count: 3 } as any)).toBe(124);
    expect(tubSurroundRunIn({ tub_length_in: 60, tub_depth_in: 32, surround_wall_count: 2 } as any)).toBe(92);
    expect(tubSurroundRunIn({ tub_length_in: 60, tub_depth_in: 32, surround_wall_count: 1 } as any)).toBe(60);
    // Length is the longer side however it was entered; a 60x32 three-wall tub when unknown
    expect(tubSurroundRunIn({ tub_length_in: 32, tub_depth_in: 60 } as any)).toBe(124);
    expect(tubSurroundRunIn(null)).toBe(124);
  });

  it('runs around a shower along its back and sides', () => {
    expect(showerWallRunIn({ width_in: 48, depth_in: 36 } as any)).toBe(120);
    expect(showerWallRunIn({ width_in: 48, depth_in: 36, layout: 'corner' } as any)).toBe(84);
    expect(showerWallRunIn(undefined)).toBe(108);
  });

  it('gives the border LF of its rows', () => {
    expect(borderLf(2, 124)).toBe(20.7);
    expect(borderLf(null, 124)).toBe(0);
    expect(borderLf(-1, 124)).toBe(0);
  });
});
