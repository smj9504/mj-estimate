import { describe, it, expect } from 'vitest';
import {
  boxKey,
  buildElevations,
  mountHeightsIn,
  perimeterAnchor,
  reconcileCabinets,
  snapCabinetToNeighbors,
  snapCabinetToWall,
  snapDroppedCabinet,
  type PresetCatalog,
  type SketchBoxSource,
} from './cabinetSketchLayout';
import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';

const SCALE = 20; // px per foot
const PRESETS: PresetCatalog = {
  B30: { width: 30, height: 34.5 },
  B15: { width: 15, height: 34.5 },
  SB36: { width: 36, height: 34.5, specialty: 'sink_base' },
  W3030: { width: 30, height: 30 },
  W3015: { width: 30, height: 15 },
  T2484: { width: 24, height: 84 },
};

const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => {
  const p = PRESETS[code];
  const cabType = code.startsWith('W') ? 'wall' : code.startsWith('T') ? 'tall' : 'base';
  return {
    code,
    cab_type: cabType,
    location: 'perimeter',
    width_inches: p?.width ?? 24,
    height_inches: p?.height ?? 34.5,
    specialty_type: p?.specialty ?? null,
    qty: 1,
    ...over,
  };
};

const wall = (sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
  id: `w${sx}${sy}${ex}${ey}`,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  color: '#333',
  length_ft: Math.hypot(ex - sx, ey - sy) / SCALE,
});

describe('reconcileCabinets', () => {
  it('creates one shape per box × qty, laid out in a run', () => {
    const out = reconcileCabinets([], [box('B30', { qty: 2 }), box('B15')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(3);
    // 30" = 50 px at 20 px/ft; run starts at (2 ft, 2 ft) = (40, 40)
    expect(out.map((c) => c.x)).toEqual([40, 90, 140]);
    expect(out.every((c) => c.y === 40 && c.rotation === 0)).toBe(true);
    // Footprint depth is the 24" base depth, not the 34.5" height
    expect(out[0].height).toBeCloseTo(40);
    expect(out[0]).toMatchObject({ width_in: 30, depth_in: 24, height_in: 34.5, location: 'perimeter' });
  });

  it('puts talls after the bases and uppers on the same back line', () => {
    const out = reconcileCabinets(
      [],
      [box('T2484'), box('B30'), box('W3030')],
      [],
      PRESETS,
      SCALE
    )!;
    const byCode = Object.fromEntries(out.map((c) => [c.preset_code, c]));
    expect(byCode.B30.x).toBe(40);
    expect(byCode.T2484.x).toBe(90);
    expect(byCode.W3030.x).toBe(40);
    expect(byCode.W3030.y).toBe(40);
    expect(byCode.W3030.height).toBeCloseTo(20); // 12" deep
  });

  it('returns null when the sketch already matches the boxes', () => {
    const boxes = [box('B30'), box('W3030')];
    const first = reconcileCabinets([], boxes, [], PRESETS, SCALE)!;
    expect(reconcileCabinets(first, boxes, [], PRESETS, SCALE)).toBeNull();
  });

  it('keeps moved shapes where they are and drops the ones whose box is gone', () => {
    const first = reconcileCabinets([], [box('B30', { qty: 2 }), box('B15')], [], PRESETS, SCALE)!;
    const moved = first.map((c, i) => (i === 0 ? { ...c, x: 300, y: 300 } : c));
    const out = reconcileCabinets(moved, [box('B30')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: first[0].id, x: 300, y: 300 });
  });

  it('appends a newly added box after the existing run', () => {
    const first = reconcileCabinets([], [box('B30')], [], PRESETS, SCALE)!;
    const out = reconcileCabinets(first, [box('B30'), box('SB36')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ preset_code: 'SB36', x: 90, y: 40 });
  });

  it('places island boxes on a parallel run 66" in front of the perimeter', () => {
    const out = reconcileCabinets([], [box('B30'), box('B30', { location: 'island' })], [], PRESETS, SCALE)!;
    const island = out.find((c) => c.location === 'island')!;
    expect(island.x).toBe(40);
    expect(island.y).toBeCloseTo(40 + 110); // 66" = 5.5 ft = 110 px
  });

  it('upgrades shapes saved before the sync (no inch fields, height-as-depth)', () => {
    const legacy: CabinetSketchCabinet = {
      id: 'old',
      preset_code: 'B30',
      cab_type: 'base',
      x: 10,
      y: 10,
      width: 50,
      height: 57.5, // 34.5" used as depth
      rotation: 0,
      label: 'B30',
    };
    const out = reconcileCabinets([legacy], [box('B30')], [], PRESETS, SCALE)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'old', x: 10, y: 10, location: 'perimeter', depth_in: 24 });
    expect(out[0].height).toBeCloseTo(40);
  });

  it('treats a custom box of a different size as a different cabinet', () => {
    expect(boxKey(box('CUSTOM', { width_inches: 20 }))).not.toBe(boxKey(box('CUSTOM', { width_inches: 22 })));
  });
});

describe('perimeterAnchor', () => {
  it('runs along the inside face of the longest wall', () => {
    // A 10 ft × 8 ft room; the top wall (y = 0) is the longest.
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const a = perimeterAnchor(walls, SCALE);
    expect(a.back.y).toBeCloseTo(-1); // backs to the top wall
    expect(a.origin.x).toBeCloseTo(0);
    expect(a.origin.y).toBeCloseTo(2); // inset by half the 4 px thickness
  });
});

describe('snapCabinetToWall', () => {
  it('turns a cabinet dropped by a vertical wall to back onto it', () => {
    const walls = [wall(100, 0, 100, 200)];
    // 30" × 24" cabinet, unrotated, dropped just right of the wall.
    const snapped = snapCabinetToWall({ x: 110, y: 80, width: 50, height: 40, rotation: 0 }, walls, SCALE)!;
    expect(snapped).not.toBeNull();
    // Back must point west, at the wall: back = (sin r, -cos r) = (-1, 0) → r = 270°.
    expect(((snapped.rotation % 360) + 360) % 360).toBeCloseTo(270);
    // Back-left corner sits on the wall's right face (x = 102).
    expect(snapped.x).toBeCloseTo(102);
  });

  it('ignores walls that are far away', () => {
    expect(snapCabinetToWall({ x: 400, y: 400, width: 50, height: 40, rotation: 0 }, [wall(0, 0, 0, 100)], SCALE)).toBeNull();
  });
});

describe('snapCabinetToNeighbors', () => {
  // A B30 backed at y = 40: occupies x 40–90, 40 px (24") deep.
  const b30 = (over: Partial<CabinetSketchCabinet> = {}): CabinetSketchCabinet => ({
    id: 'b30',
    preset_code: 'B30',
    cab_type: 'base',
    x: 40,
    y: 40,
    width: 50,
    height: 40,
    rotation: 0,
    label: 'B30',
    ...over,
  });
  // An 18" base (30 px wide).
  const b18 = (x: number, y: number, over: Partial<CabinetSketchCabinet> = {}) => ({
    id: 'b18',
    cab_type: 'base' as const,
    x,
    y,
    width: 30,
    height: 40,
    rotation: 0,
    ...over,
  });

  it('levels a cabinet dropped a little low and butts it against the right side', () => {
    // 4 px (2.4") off the side, 15 px (9") lower than the B30.
    expect(snapCabinetToNeighbors(b18(94, 55), [b30()], SCALE)).toEqual({ x: 90, y: 40, rotation: 0 });
  });

  it('butts against the left side, pushing out of a small overlap', () => {
    expect(snapCabinetToNeighbors(b18(7, 35), [b30()], SCALE)).toMatchObject({ x: 10, y: 40 });
    expect(snapCabinetToNeighbors(b18(85, 40), [b30()], SCALE)).toMatchObject({ x: 90, y: 40 });
  });

  it('squares up a slightly turned cabinet to its neighbour', () => {
    const snapped = snapCabinetToNeighbors(b18(92, 42, { rotation: 5 }), [b30()], SCALE)!;
    expect(snapped.rotation).toBe(0);
    expect(snapped.x).toBeCloseTo(90);
    expect(snapped.y).toBeCloseTo(40);
  });

  it('works along a rotated run', () => {
    // Run along a vertical line, cabinets advancing down the screen (rotation 90).
    const n = b30({ x: 100, y: 40, rotation: 90 });
    const snapped = snapCabinetToNeighbors(b18(103, 95, { rotation: 90 }), [n], SCALE)!;
    expect(snapped.x).toBeCloseTo(100);
    expect(snapped.y).toBeCloseTo(90);
  });

  it('leaves alone a cabinet set in front, a gap away, or of the other row', () => {
    expect(snapCabinetToNeighbors(b18(90, 80), [b30()], SCALE)).toBeNull(); // 24" in front
    expect(snapCabinetToNeighbors(b18(110, 40), [b30()], SCALE)).toBeNull(); // 12" gap
    expect(snapCabinetToNeighbors(b18(92, 40, { cab_type: 'wall' }), [b30()], SCALE)).toBeNull(); // upper by a base
    expect(snapCabinetToNeighbors(b18(92, 40, { rotation: 90 }), [b30()], SCALE)).toBeNull(); // turned 90°
  });

  it('picks the closer of two neighbours', () => {
    const right = b30({ id: 'r', x: 130 });
    expect(snapCabinetToNeighbors(b18(92, 40), [b30(), right], SCALE)).toMatchObject({ x: 90 });
    expect(snapCabinetToNeighbors(b18(98, 40), [b30(), right], SCALE)).toMatchObject({ x: 100 });
  });

  it('backs onto a wall first, then butts against the cabinet already on it', () => {
    // Vertical wall at x = 100 (face x = 102); a B30 backed onto it, running up from y = 140.
    const walls = [wall(100, 0, 100, 200)];
    const onWall = b30({ x: 102, y: 140, rotation: 270 });
    const placed = snapDroppedCabinet(b18(110, 50, { width: 25 }), [onWall], walls, SCALE);
    expect(placed.rotation).toBe(270);
    expect(placed.x).toBeCloseTo(102);
    expect(placed.y).toBeCloseTo(90);
  });

  it('keeps the drop as is when nothing is close', () => {
    expect(snapDroppedCabinet(b18(300, 300), [b30()], [], SCALE)).toEqual({ x: 300, y: 300, rotation: 0 });
  });
});

describe('mountHeightsIn', () => {
  it('hangs 30" uppers at 54" and tops short uppers to match', () => {
    const cabs = reconcileCabinets([], [box('B30'), box('W3030'), box('W3015')], [], PRESETS, SCALE)!;
    const m = mountHeightsIn(cabs, PRESETS, SCALE);
    const id = (code: string) => cabs.find((c) => c.preset_code === code)!.id;
    expect(m.get(id('B30'))).toBe(0);
    expect(m.get(id('W3030'))).toBe(54);
    expect(m.get(id('W3015'))).toBe(84 - 15);
  });
});

describe('buildElevations', () => {
  it('draws the perimeter and the island as separate elevations', () => {
    const cabs = reconcileCabinets(
      [],
      [box('B30'), box('SB36'), box('W3030'), box('B30', { location: 'island' })],
      [],
      PRESETS,
      SCALE
    )!;
    const runs = buildElevations(cabs, [], PRESETS, SCALE);
    expect(runs.map((r) => r.label)).toEqual(['North wall', 'Island']);
    const north = runs[0];
    expect(north.length_in).toBeCloseTo(66);
    const sink = north.items.find((i) => i.cabinet.preset_code === 'SB36')!;
    expect(sink.left_in).toBeCloseTo(30);
    const upper = north.items.find((i) => i.cabinet.preset_code === 'W3030')!;
    expect(upper.bottom_in).toBe(54);
  });

  it('calls a run standing in front of another an island, not a second wall', () => {
    // All perimeter in the Edit tab, but the second B30 was dragged 4 ft out into the room.
    const [a, b] = reconcileCabinets([], [box('B30', { qty: 2 })], [], PRESETS, SCALE)!;
    const runs = buildElevations([a, { ...b, x: 40, y: 120 }], [], PRESETS, SCALE);
    expect(runs.map((r) => r.label)).toEqual(['North wall', 'Island']);
    expect(runs.map((r) => r.island)).toEqual([false, true]);
  });

  it('draws no wall behind an island in a walled room', () => {
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const cabs = reconcileCabinets([], [box('B30'), box('B30', { location: 'island' })], walls, PRESETS, SCALE)!;
    const runs = buildElevations(cabs, walls, PRESETS, SCALE);
    const island = runs.find((r) => r.island)!;
    expect(island.label).toBe('Island');
    expect(island.wall).toBeUndefined();
    expect(island.length_in).toBeCloseTo(30);
  });

  it('extends the elevation to the wall the run backs onto', () => {
    const walls = [wall(0, 0, 200, 0), wall(200, 0, 200, 160), wall(200, 160, 0, 160), wall(0, 160, 0, 0)];
    const cabs = reconcileCabinets([], [box('B30')], walls, PRESETS, SCALE)!;
    const [run] = buildElevations(cabs, walls, PRESETS, SCALE);
    expect(run.label).toBe('North wall');
    expect(run.length_in).toBeCloseTo(120); // the 10 ft wall
    expect(run.wall).toBeDefined();
  });
});
