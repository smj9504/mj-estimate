import { describe, it, expect } from 'vitest';
import { ARCH_MIN_DOOR_IN, GLASS_STILE_IN, LATTICE_BAR_IN, archOutline, archRiseIn, doorDesign, facesFor } from './cabinetFronts';
import { boxKey, cornerKind, footprintDepthIn, reconcileCabinets, type PresetCatalog, type SketchBoxSource } from './cabinetSketchLayout';

const doors = (faces: ReturnType<typeof facesFor>) => faces.filter((f) => f.kind === 'door');
const drawers = (faces: ReturnType<typeof facesFor>) => faces.filter((f) => f.kind === 'drawer');

describe('facesFor', () => {
  it('keeps two doors up to 48" wide, each under 24", then adds one', () => {
    for (const w of [24, 30, 36, 39, 42, 45, 48]) {
      const faces = doors(facesFor('wall', undefined, w, 30));
      expect(faces).toHaveLength(2);
      for (const f of faces) expect(f.w).toBeLessThan(24);
    }
    expect(doors(facesFor('wall', undefined, 18, 30))).toHaveLength(1);
    const custom = doors(facesFor('wall', undefined, 60, 30));
    expect(custom).toHaveLength(3);
    for (const f of custom) expect(f.w).toBeLessThan(24);
  });

  it('puts a drawer over each door on a wide base', () => {
    const b48 = facesFor('base', undefined, 48, 34.5);
    expect(doors(b48)).toHaveLength(2);
    expect(drawers(b48)).toHaveLength(2);
    const custom = facesFor('base', undefined, 60, 34.5);
    expect(doors(custom)).toHaveLength(3);
    expect(drawers(custom)).toHaveLength(3);
    expect(drawers(facesFor('base', undefined, 24, 34.5))).toHaveLength(1);
  });

  it('keeps every face inside a wide box', () => {
    for (const faces of [facesFor('wall', undefined, 48, 30), facesFor('base', undefined, 48, 34.5)]) {
      for (const f of faces) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w).toBeLessThanOrEqual(48 + 1e-9);
      }
    }
  });

  it('lays out a three-door corner\'s doors on its open part, mirrored for a right corner', () => {
    const left = doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'left'));
    expect(left).toHaveLength(3);
    expect(left[0].x).toBeGreaterThanOrEqual(12);
    expect(left[2].x + left[2].w).toBeLessThanOrEqual(36);
    const right = doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'right'));
    expect(right).toHaveLength(3);
    expect(right.every((f) => f.x + f.w <= 24 + 1e-9)).toBe(true);
    expect(right.every((f) => f.x >= 0)).toBe(true);
  });

  it('makes the front one panel for a lattice over a band, but keeps the doors for a plain lattice', () => {
    expect(doors(facesFor('wall', undefined, 36, 18, 'left', 'lattice_band'))).toHaveLength(1);
    expect(doors(facesFor('wall', undefined, 36, 18, 'left', 'lattice'))).toHaveLength(2);
    expect(doors(facesFor('base', undefined, 36, 34.5, 'left', 'lattice_band'))).toHaveLength(1);
    expect(doors(facesFor('base', 'sink_base', 36, 34.5, 'left', 'lattice_band'))).toHaveLength(1);
    // A corner's doors stay as they are.
    expect(doors(facesFor('wall', 'three_door_corner_wall', 36, 42, 'left', 'lattice_band'))).toHaveLength(3);
    // No door, nothing to change.
    expect(doors(facesFor('base', 'drawer_base', 24, 34.5, 'left', 'lattice_band'))).toHaveLength(0);
  });
});

describe('doorDesign', () => {
  const inRect = (o: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
    px >= o.x - 1e-9 && px <= o.x + o.w + 1e-9 && py >= o.y - 1e-9 && py <= o.y + o.h + 1e-9;

  it('frames the lattice, its bars at 45° and cut off at the opening', () => {
    const { opening, bars, band } = doorDesign({ w: 15, h: 30 }, 'lattice');
    expect(band).toBeNull();
    expect(opening).toEqual({ x: GLASS_STILE_IN, y: GLASS_STILE_IN, w: 15 - 2 * GLASS_STILE_IN, h: 30 - 2 * GLASS_STILE_IN });
    expect(bars.length).toBeGreaterThan(3);
    for (const [x0, y0, x1, y1] of bars) {
      expect(inRect(opening, x0, y0)).toBe(true);
      expect(inRect(opening, x1, y1)).toBe(true);
      expect(Math.abs(y1 - y0)).toBeCloseTo(Math.abs(x1 - x0));
    }
  });

  it('crosses bars at the opening\'s middle', () => {
    const { opening, bars } = doorDesign({ w: 30, h: 30 }, 'lattice');
    const [cx, cy] = [opening.x + opening.w / 2, opening.y + opening.h / 2];
    const through = bars.filter(([x0, y0, x1, y1]) => Math.abs((y1 - y0) * (cx - x0) - (x1 - x0) * (cy - y0)) < 1e-6);
    expect(through).toHaveLength(2);
  });

  it('keeps diamonds a sensible size: about 7" on a wide panel, never under 3.5"', () => {
    const across = (w: number, h: number) => {
      const { bars } = doorDesign({ w, h }, 'lattice');
      const ups = bars.filter(([x0, y0, x1, y1]) => (y1 - y0) * (x1 - x0) > 0).map(([x0, y0]) => x0 - y0);
      const sorted = [...ups].sort((a, b) => a - b);
      return sorted[1] - sorted[0];
    };
    expect(across(40, 24)).toBeCloseTo(7);
    expect(across(10, 30)).toBeCloseTo(3.5);
    // Wider than the bars, so a diamond is really open.
    expect(across(10, 30) / Math.SQRT2).toBeGreaterThan(LATTICE_BAR_IN);
  });

  it('sets a band of ovals under the lattice, with a diamond between each two', () => {
    const { opening, band } = doorDesign({ w: 34.5, h: 22.5 }, 'lattice_band');
    expect(band).not.toBeNull();
    expect(band!.ovals).toHaveLength(3); // as in the photo: three ovals across a wide panel
    expect(band!.diamonds).toHaveLength(2);
    for (const o of band!.ovals) {
      expect(o.cy + o.ry).toBeLessThan(opening.y);
      expect(o.cy - o.ry).toBeGreaterThan(GLASS_STILE_IN - 1e-9);
      expect(o.cx - o.rx).toBeGreaterThan(GLASS_STILE_IN);
      expect(o.cx + o.rx).toBeLessThan(34.5 - GLASS_STILE_IN);
    }
    // No two cut-outs touch, or the band would fall apart.
    for (const d of band!.diamonds) {
      for (const o of band!.ovals) expect(Math.abs(d.cx - o.cx)).toBeGreaterThan(d.r + o.rx);
    }
    expect(opening.y + opening.h).toBeCloseTo(22.5 - GLASS_STILE_IN);
  });

  it('still fits on a small door', () => {
    const { opening, band, bars } = doorDesign({ w: 7, h: 11 }, 'lattice_band');
    expect(opening.h).toBeGreaterThan(0);
    expect(band!.ovals.length).toBeGreaterThanOrEqual(1);
    expect(band!.diamonds).toHaveLength(band!.ovals.length - 1);
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe('archOutline', () => {
  it('runs across the bottom and over an arched top, staying in its box', () => {
    const pts = archOutline(8, 30);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([8, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(30);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(8 + 1e-9);
      expect(y).toBeLessThanOrEqual(30 + 1e-9);
    }
    // Its top is highest in the middle, and the shoulders start down by the rise.
    const rise = archRiseIn(8, 30);
    expect(rise).toBeCloseTo(1.76);
    expect(pts[2]).toEqual([8, 30 - rise]);
    expect(pts[pts.length - 1][1]).toBeCloseTo(30 - rise);
  });

  it('winds counter-clockwise, as a solid shape expects', () => {
    const pts = archOutline(8, 30);
    let area = 0;
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length];
      area += x * ny - nx * y;
    });
    expect(area).toBeGreaterThan(0);
  });

  it('has a smallest door that still leaves room for its panel, and takes a 30" corner\'s doors on the Front view', () => {
    const inner = ARCH_MIN_DOOR_IN - 2 * Math.min(GLASS_STILE_IN, ARCH_MIN_DOOR_IN / 4);
    expect(inner).toBeGreaterThan(0);
    for (const door of doors(facesFor('wall', 'three_door_corner_wall', 30, 30))) {
      expect(door.w).toBeGreaterThanOrEqual(ARCH_MIN_DOOR_IN);
    }
  });
});

describe('three-door corner and patterns on the plan', () => {
  const PRESETS: PresetCatalog = {
    WTD3642: { width: 36, height: 42, specialty: 'three_door_corner_wall' },
    W3030: { width: 30, height: 30 },
    W4830: { width: 48, height: 30 },
  };
  const box = (code: string, over: Partial<SketchBoxSource> = {}): SketchBoxSource => ({
    code,
    cab_type: 'wall',
    location: 'perimeter',
    width_inches: PRESETS[code].width,
    height_inches: PRESETS[code].height,
    specialty_type: PRESETS[code].specialty ?? null,
    qty: 1,
    ...over,
  });

  it('gives a three-door corner a square footprint, like a diagonal', () => {
    expect(cornerKind('three_door_corner_wall')).toBe('bay');
    expect(footprintDepthIn('wall', 'three_door_corner_wall', 36)).toBe(36);
    const [shape] = reconcileCabinets([], [box('WTD3642')], [], PRESETS, 20)!;
    expect(shape.depth_in).toBe(36);
    expect(shape.width).toBeCloseTo(60);
    expect(shape.height).toBeCloseTo(60);
  });

  it('treats a patterned box as a different cabinet, without changing plain keys', () => {
    expect(boxKey(box('W3030'))).toBe('perimeter|W3030|wall|30x30');
    expect(boxKey(box('W3030', { door_pattern: null }))).toBe('perimeter|W3030|wall|30x30');
    expect(boxKey(box('W3030', { door_pattern: 'lattice' }))).toBe('perimeter|W3030|wall|30x30|lattice');
    expect(boxKey(box('W3030', { door_pattern: 'lattice', has_glass_door: true }))).toBe('perimeter|W3030|wall|30x30|glass|lattice');
  });

  it('gives each of 1 lattice + 1 plain its own shape, and a plain one no pattern in its JSON', () => {
    const out = reconcileCabinets([], [box('W3030', { door_pattern: 'lattice' }), box('W3030')], [], PRESETS, 20)!;
    expect(out.map((c) => c.door_pattern ?? null)).toEqual(['lattice', null]);
    expect(out[1].door_pattern).toBeUndefined();
  });

  it('keeps a shape where it was dragged when its pattern changes', () => {
    const [placed] = reconcileCabinets([], [box('W3030')], [], PRESETS, 20)!;
    const moved = { ...placed, x: 321, y: 123, rotation: 90 };
    const [changed] = reconcileCabinets([moved], [box('W3030', { door_pattern: 'lattice_band' })], [], PRESETS, 20)!;
    expect(changed).toMatchObject({ id: placed.id, x: 321, y: 123, rotation: 90, door_pattern: 'lattice_band' });
    const [back] = reconcileCabinets([changed], [box('W3030')], [], PRESETS, 20)!;
    expect(back).toMatchObject({ id: placed.id, x: 321, y: 123 });
    expect(back.door_pattern).toBeUndefined();
  });

  it('settles: nothing to change once a patterned shape matches its box', () => {
    const boxes = [box('W3030', { door_pattern: 'lattice' }), box('W4830')];
    const first = reconcileCabinets([], boxes, [], PRESETS, 20)!;
    expect(reconcileCabinets(first, boxes, [], PRESETS, 20)).toBeNull();
  });
});
