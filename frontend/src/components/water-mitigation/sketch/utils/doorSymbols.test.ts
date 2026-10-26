import { describe, it, expect } from 'vitest';
import type { WMShapeAnnotation } from '../../../../types/wmSketch';
import {
  DOOR_TYPES,
  DOOR_TYPE_ORDER,
  doorSymbol,
  doorTypeOf,
  flipDoor,
  newDoorBox,
  retypeDoor,
  swingSectorPath,
} from './doorSymbols';

const door = (patch: Partial<WMShapeAnnotation> = {}): WMShapeAnnotation => ({
  id: 'd1',
  floor_sketch_id: 'fs1',
  preset_id: 'door',
  shape_type: 'rectangle',
  x: 100,
  y: 200,
  width: 60,
  height: 60,
  rotation: 0,
  fill_color: 'transparent',
  stroke_color: '#6B3410',
  stroke_width: 2,
  opacity: 0.7,
  label: '',
  ...patch,
});

/** Canvas point of a box-local point, the way Konva places a rotated Group */
const local = (s: WMShapeAnnotation, lx: number, ly: number) => {
  const r = (s.rotation * Math.PI) / 180;
  return {
    x: s.x + lx * Math.cos(r) - ly * Math.sin(r),
    y: s.y + lx * Math.sin(r) + ly * Math.cos(r),
  };
};

const closeTo = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('doorTypeOf', () => {
  it('reads doors saved before styles existed as swing doors', () => {
    expect(doorTypeOf({})).toBe('swing');
    expect(doorTypeOf({ door_type: null })).toBe('swing');
    expect(doorTypeOf({ door_type: 'garage' as never })).toBe('swing');
    expect(doorTypeOf({ door_type: 'pocket' })).toBe('pocket');
  });
});

describe('doorSymbol', () => {
  it('draws a swing door exactly as the canvas always has', () => {
    expect(doorSymbol('swing', 60, 60, false)).toEqual([
      { kind: 'line', points: [0, 60, 60, 60], weight: 'panel' },
      { kind: 'swing', x: 0, y: 60, radius: 60, rotation: -90 },
      { kind: 'hinge', x: 0, y: 60 },
    ]);
    // Flipped: hinge on the right, sector rotated 180° (same as the old -180)
    expect(doorSymbol('swing', 60, 60, true)).toEqual([
      { kind: 'line', points: [60, 60, 0, 60], weight: 'panel' },
      { kind: 'swing', x: 60, y: 60, radius: 60, rotation: 180 },
      { kind: 'hinge', x: 60, y: 60 },
    ]);
  });

  it('keeps every style inside its box, flipped or not', () => {
    const w = 80;
    const h = 30;
    const inside = (x: number, y: number) => {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(w + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(h + 1e-9);
    };
    for (const type of DOOR_TYPE_ORDER) {
      for (const flipped of [false, true]) {
        for (const p of doorSymbol(type, w, h, flipped)) {
          if (p.kind === 'line') {
            for (let i = 0; i < p.points.length; i += 2) inside(p.points[i], p.points[i + 1]);
          } else if (p.kind === 'rect') {
            inside(p.x, p.y);
            inside(p.x + p.width, p.y + p.height);
          } else if (p.kind === 'swing') {
            for (const deg of [p.rotation, p.rotation + 45, p.rotation + 90]) {
              const a = (deg * Math.PI) / 180;
              inside(p.x + p.radius * Math.cos(a), p.y + p.radius * Math.sin(a));
            }
          } else {
            inside(p.x, p.y);
          }
        }
      }
    }
  });

  it('draws the styles that cannot flip the same both ways', () => {
    // Same set of strokes; a line may run the other way, a sector's angle may wrap
    const canon = (p: ReturnType<typeof doorSymbol>[number]) => {
      if (p.kind === 'line') {
        const pairs: number[][] = [];
        for (let i = 0; i < p.points.length; i += 2) pairs.push([p.points[i], p.points[i + 1]]);
        const fwd = JSON.stringify(pairs);
        const rev = JSON.stringify([...pairs].reverse());
        return `line ${p.weight} ${fwd < rev ? fwd : rev}`;
      }
      if (p.kind === 'swing') return JSON.stringify({ ...p, rotation: ((p.rotation % 360) + 360) % 360 });
      return JSON.stringify(p);
    };
    for (const type of DOOR_TYPE_ORDER.filter((t) => !DOOR_TYPES[t].flippable)) {
      expect(doorSymbol(type, 60, 30, true).map(canon).sort())
        .toEqual(doorSymbol(type, 60, 30, false).map(canon).sort());
    }
  });
});

describe('newDoorBox', () => {
  it('sizes a new door from its opening and the floor scale', () => {
    expect(newDoorBox('swing', 20)).toEqual({ width: 60, height: 60 });
    expect(newDoorBox('double', 20)).toEqual({ width: 100, height: 50 });
    expect(newDoorBox('sliding', 20)).toEqual({ width: 120, height: 10 });
    // Pocket box holds the pocket and the 2.5 ft opening
    expect(newDoorBox('pocket', 20)).toEqual({ width: 100, height: 10 });
    expect(newDoorBox('barn', 40)).toEqual({ width: 240, height: 30 });
  });

  it('falls back to 20 px/ft on an uncalibrated floor', () => {
    expect(newDoorBox('swing', 0)).toEqual({ width: 60, height: 60 });
  });

  it('never makes a box the transformer cannot resize', () => {
    expect(newDoorBox('sliding', 8).height).toBe(10);
  });
});

describe('retypeDoor', () => {
  for (const rotation of [0, 90, 37]) {
    it(`keeps the opening's jamb on the wall at ${rotation}°`, () => {
      const swing = door({ rotation });
      const jamb = local(swing, 0, swing.height); // swing: left jamb on the bottom edge

      const sliding = { ...swing, ...retypeDoor(swing, 'sliding', 20) };
      expect(sliding.door_type).toBe('sliding');
      expect(sliding.width).toBeCloseTo(60);
      expect(sliding.height).toBeCloseTo(10);
      closeTo(local(sliding, 0, sliding.height / 2), jamb); // sliding: wall through the middle

      const pocket = { ...sliding, ...retypeDoor(sliding, 'pocket', 20) };
      expect(pocket.width).toBeCloseTo(120); // pocket + 60 px opening
      closeTo(local(pocket, pocket.width / 2, pocket.height / 2), jamb);

      const back = { ...pocket, ...retypeDoor(pocket, 'swing', 20) };
      expect(back.width).toBeCloseTo(60);
      expect(back.height).toBeCloseTo(60);
      expect(back.x).toBeCloseTo(swing.x, 6);
      expect(back.y).toBeCloseTo(swing.y, 6);
    });
  }

  it('keeps the opening when a flipped pocket door becomes a barn door', () => {
    const pocket = door({ door_type: 'pocket', flip_x: true, width: 100, height: 10, rotation: 30 });
    const jamb = local(pocket, 0, 5); // flipped: opening on the left half
    const barn = { ...pocket, ...retypeDoor(pocket, 'barn', 20) };
    expect(barn.width).toBeCloseTo(100);
    closeTo(local(barn, 0, barn.height), jamb);
  });
});

describe('flipDoor', () => {
  it('flips a swing door in place', () => {
    const d = door({ rotation: 45 });
    expect(flipDoor(d)).toEqual({ flip_x: true, x: 100, y: 200 });
  });

  it('moves a pocket to the other side of a fixed opening', () => {
    const d = door({ door_type: 'pocket', width: 100, height: 10, rotation: 90 });
    const opening = [local(d, 50, 5), local(d, 100, 5)];
    const flipped = { ...d, ...flipDoor(d) };
    expect(flipped.flip_x).toBe(true);
    closeTo(local(flipped, 0, 5), opening[0]);
    closeTo(local(flipped, 50, 5), opening[1]);
    const again = { ...flipped, ...flipDoor(flipped) };
    expect(again.x).toBeCloseTo(d.x, 6);
    expect(again.y).toBeCloseTo(d.y, 6);
  });
});

describe('swingSectorPath', () => {
  it('runs pivot → arc start → clockwise arc → close', () => {
    expect(swingSectorPath({ kind: 'swing', x: 0, y: 13, radius: 13, rotation: -90 }))
      .toBe('M 0 13 L 0 0 A 13 13 0 0 1 13 13 Z');
  });
});
