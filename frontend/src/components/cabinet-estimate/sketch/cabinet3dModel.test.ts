import { describe, it, expect } from 'vitest';
import { cabinetSolids, mainFacing, modelBounds, toPlan, wallSolids, type CabinetSolid, type FrontRun } from './cabinet3dModel';
import { reconcileCabinets, type PresetCatalog, type SketchBoxSource } from './cabinetSketchLayout';
import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';

const SCALE = 20; // px per foot
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  W3030: { width: 30, height: 30 },
  T2484: { width: 24, height: 84 },
  RB30S: { width: 30, height: 34.5, specialty: 'range_base_slide_in' },
  LS36: { width: 36, height: 34.5, specialty: 'lazy_susan' },
  DCB36: { width: 36, height: 34.5, specialty: 'diagonal_corner_base' },
  WDC24: { width: 24, height: 30, specialty: 'diagonal_corner_wall' },
  BEC24: { width: 24, height: 34.5, specialty: 'angle_end_base' },
  BBC42: { width: 42, height: 34.5, specialty: 'blind_corner' },
};

const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => {
  const p = PRESETS[code];
  return {
    code,
    cab_type: code.startsWith('W') ? 'wall' : code.startsWith('T') ? 'tall' : 'base',
    location: 'perimeter',
    width_inches: p.width,
    height_inches: p.height,
    specialty_type: p.specialty ?? null,
    qty: 1,
    ...over,
  };
};

/** Each code as a sketch shape, laid out the way the sync lays out the Edit tab. */
const shapes = (...codes: string[]): CabinetSketchCabinet[] =>
  reconcileCabinets([], codes.map((c) => box(c)), [], PRESETS, SCALE)!;

const solidsOf = (cabinets: CabinetSketchCabinet[]) => cabinetSolids(cabinets, PRESETS, SCALE);

const centroid = (s: CabinetSolid) => {
  const n = s.outline.length;
  return s.outline.reduce(([x, z], [px, pz]) => [x + px / n, z + pz / n], [0, 0]);
};
const outward = (run: FrontRun) => {
  const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
  return [-(run.b[1] - run.a[1]) / len, (run.b[0] - run.a[0]) / len];
};

describe('cabinetSolids', () => {
  it('stands a base on the floor under a countertop, and hangs an upper at 54"', () => {
    const [base, upper] = solidsOf(shapes('B30', 'W3030'));
    expect(base).toMatchObject({ bottom: 0, height: 34.5, toeKick: 4, appliance: false });
    expect(base.counter).toEqual([[0, 0], [30, 0], [30, 25], [0, 25]]); // 1" past the doors
    expect(base.fronts).toHaveLength(1);
    expect(base.fronts[0]).toMatchObject({ a: [0, 24], b: [30, 24] });
    expect(upper).toMatchObject({ bottom: 54, height: 30, toeKick: 0, counter: null });
    expect(upper.fronts[0]).toMatchObject({ a: [0, 12], b: [30, 12] });
  });

  it('places the cabinet at its plan position in inches', () => {
    const [b30] = shapes('B30');
    const [solid] = solidsOf([{ ...b30, x: 100, y: 60, rotation: 90 }]);
    expect(solid).toMatchObject({ x: 60, z: 36, rotation: 90 });
    // Turned a quarter clockwise on screen, its run heads down the screen and its doors face left.
    const [ex, ez] = toPlan(solid, [30, 0]);
    expect(ex).toBeCloseTo(60);
    expect(ez).toBeCloseTo(66);
    const [fx, fz] = toPlan(solid, [0, 24]);
    expect(fx).toBeCloseTo(36);
    expect(fz).toBeCloseTo(36);
  });

  it('draws a range as an appliance level with the counters, with no counter or toe kick', () => {
    const [range] = solidsOf(shapes('RB30S'));
    expect(range).toMatchObject({ appliance: true, height: 36, counter: null, toeKick: 0 });
  });

  it('gives a tall no countertop', () => {
    const [tall] = solidsOf(shapes('T2484'));
    expect(tall.counter).toBeNull();
    expect(tall.toeKick).toBe(4);
  });

  it('gives a lazy susan a door on the inside of each leg', () => {
    const [left] = solidsOf(shapes('LS36'));
    expect(left.outline).toHaveLength(6);
    expect(left.fronts.map((r) => [r.a, r.b])).toEqual([
      [[0, 24], [36, 24]],
      [[24, 36], [24, 24]],
    ]);
    // One door on each leg, across its 12" opening.
    for (const run of left.fronts) {
      const doors = run.faces.filter((f) => f.kind === 'door');
      expect(doors).toHaveLength(1);
    }
    expect(left.fronts[1].faces[0].x).toBeGreaterThanOrEqual(0);
    expect(left.fronts[1].faces[0].x + left.fronts[1].faces[0].w).toBeLessThanOrEqual(12);
  });

  it('puts every front on the outside of its cabinet, on either corner side', () => {
    const cabinets = shapes('B30', 'BBC42', 'LS36', 'DCB36', 'WDC24', 'BEC24');
    const both = [...cabinets, ...cabinets.map((c) => ({ ...c, id: `${c.id}-r`, corner_side: 'right' as const }))];
    for (const solid of solidsOf(both)) {
      const [cx, cz] = centroid(solid);
      for (const run of solid.fronts) {
        const [nx, nz] = outward(run);
        const mid = [(run.a[0] + run.b[0]) / 2, (run.a[1] + run.b[1]) / 2];
        expect(nx * (mid[0] - cx) + nz * (mid[1] - cz)).toBeGreaterThan(0);
        // And its faces fit on it.
        const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
        for (const f of run.faces) {
          expect(f.x).toBeGreaterThanOrEqual(-1e-9);
          expect(f.x + f.w).toBeLessThanOrEqual(len + 1e-9);
        }
      }
    }
  });

  it('stretches a diagonal corner\'s door across its angled face', () => {
    const [dcb] = solidsOf(shapes('DCB36'));
    expect(dcb.fronts).toHaveLength(1);
    const run = dcb.fronts[0];
    const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
    expect(len).toBeCloseTo(12 * Math.SQRT2);
    const door = run.faces.find((f) => f.kind === 'door')!;
    expect(door.w).toBeGreaterThan(12); // wider than the 12" it covers on the Front view
  });

  it('marks a glass-door cabinet', () => {
    const [upper] = solidsOf(shapes('W3030').map((c) => ({ ...c, has_glass_door: true })));
    expect(upper.glass).toBe(true);
  });
});

describe('wallSolids / modelBounds / mainFacing', () => {
  const wall = (sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
    id: `w${sx}${sy}${ex}${ey}`,
    start_x: sx,
    start_y: sy,
    end_x: ex,
    end_y: ey,
    thickness: 4,
    color: '#333',
    length_ft: 0,
  });

  it('converts walls to inches and skips zero-length ones', () => {
    const out = wallSolids([wall(0, 0, 200, 0), wall(10, 10, 10, 10)], SCALE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: [0, 0], b: [120, 0] });
    expect(out[0].thickness).toBeCloseTo(2.4);
  });

  it('spans the cabinets and walls', () => {
    const solids = solidsOf(shapes('B30'));
    expect(modelBounds(solids, wallSolids([wall(0, 0, 200, 0)], SCALE))).toEqual({
      minX: 0,
      maxX: 120,
      minZ: 0,
      maxZ: 48, // the B30 at (2 ft, 2 ft), 24" deep
    });
    expect(modelBounds([], [])).toBeNull();
  });

  it('faces the way most of the doors do', () => {
    const cabinets = shapes('B30', 'B30', 'W3030');
    expect(mainFacing(solidsOf(cabinets))).toEqual([0, 1]);
    const turned = cabinets.map((c) => ({ ...c, rotation: 180 }));
    const [fx, fz] = mainFacing(solidsOf(turned));
    expect(fx).toBeCloseTo(0);
    expect(fz).toBeCloseTo(-1);
  });
});
