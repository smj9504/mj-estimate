import { describe, expect, it } from 'vitest';
import { getFixtureShape } from './beFixtureShapes';

// A shower's plan symbol: tile bands inside its tiled walls
const shower = (extras: Parameters<typeof getFixtureShape>[11]) => getFixtureShape(
  'shower', undefined, undefined, 'swing', 'alcove', 'none', 0.5, undefined, undefined, null, 'center', extras,
);
// The band's line along the front, either side of a door hung 20%-80% across
const frontBand = (paths: { d: string }[]) => paths.filter((p) => /^M[\d.]+,0\.955 L[\d.]+,0\.955$/.test(p.d)).map((p) => p.d);

describe('a shower on the plan', () => {
  it('bands its back and sides with tile', () => {
    const d = shower({}).paths.map((p) => p.d);
    expect(d).toContain('M0,0.045 L1,0.045');
    expect(d).toContain('M0.045,0 L0.045,1');
    expect(d).toContain('M0.955,0 L0.955,1');
  });

  it("bands a shower room's door side only when it's one of the tiled walls", () => {
    expect(frontBand(shower({ showerOpeningSpan: [0.2, 0.8], showerFrontTiled: true }).paths))
      .toEqual(['M0,0.955 L0.2,0.955', 'M0.8,0.955 L1,0.955']);
    expect(frontBand(shower({ showerOpeningSpan: [0.2, 0.8], showerFrontTiled: false }).paths)).toEqual([]);
    // Nor are the walls beside its opening drawn as the shower's own tiled returns
    expect(shower({ showerOpeningSpan: [0.2, 0.8] }).paths.map((p) => p.d)).not.toContain('M0,1 L0.2,1');
    // An open-front shower keeps its tiled returns beside a swing door
    expect(shower({}).paths.map((p) => p.d)).toContain('M0,1 L0.25,1');
  });
});
