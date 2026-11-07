import { describe, it, expect } from 'vitest';
import type { CabinetSketchWall } from '../../../types/cabinetSketch';
import { keepWallsJoined, moveWallEndJoined, moveWallsJoined, wallsMeetingEnd } from './sketchWallJoints';

const SCALE = 20; // px per foot
const wall = (id: string, sx: number, sy: number, ex: number, ey: number): CabinetSketchWall => ({
  id,
  start_x: sx,
  start_y: sy,
  end_x: ex,
  end_y: ey,
  thickness: 4,
  color: '#333',
  length_ft: Math.hypot(ex - sx, ey - sy) / SCALE,
});
const byId = (walls: CabinetSketchWall[], id: string) => walls.find((w) => w.id === id)!;

// An L: a back wall along the top and a side wall down from its right end, and a stub T-ing into the back wall.
const back = wall('back', 0, 0, 200, 0);
const side = wall('side', 200, 0, 200, 120);
const stub = wall('stub', 80, 0, 80, 60);
const loose = wall('loose', 0, 300, 100, 300);
const plan = [back, side, stub, loose];

describe('moveWallsJoined', () => {
  it('stretches a wall joined at a corner, keeping its far end', () => {
    const out = moveWallsJoined(plan, new Set(['back']), 0, 30, SCALE);
    expect(byId(out, 'back')).toMatchObject({ start_y: 30, end_y: 30 });
    // The side wall's top end goes with the corner; its bottom end stays.
    expect(byId(out, 'side')).toMatchObject({ start_x: 200, start_y: 30, end_x: 200, end_y: 120 });
    expect(byId(out, 'side').length_ft).toBeCloseTo(90 / SCALE);
  });

  it('carries a wall that Ts into the moved one, at the same point along it', () => {
    const out = moveWallsJoined(plan, new Set(['back']), 10, 30, SCALE);
    expect(byId(out, 'stub')).toMatchObject({ start_x: 90, start_y: 30, end_x: 80, end_y: 60 });
  });

  it('slides the moved wall\'s T end along the wall it stops on', () => {
    // Moving the stub sideways: its top end stays on the back wall.
    const out = moveWallsJoined(plan, new Set(['stub']), 25, 15, SCALE);
    const s = byId(out, 'stub');
    expect([s.start_x, s.start_y, s.end_x, s.end_y].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([105, 0, 105, 75]);
    expect(byId(out, 'back')).toBe(back);
  });

  it('leaves walls that touch nothing moved alone, and moves several as a block', () => {
    const out = moveWallsJoined(plan, new Set(['back', 'side']), 5, 5, SCALE);
    expect(byId(out, 'loose')).toBe(loose);
    expect(byId(out, 'back')).toMatchObject({ start_x: 5, start_y: 5, end_x: 205, end_y: 5 });
    expect(byId(out, 'side')).toMatchObject({ start_x: 205, start_y: 5, end_x: 205, end_y: 125 });
    // The stub's top went with the back wall; its free end stayed.
    expect(byId(out, 'stub')).toMatchObject({ start_x: 85, start_y: 5, end_x: 80, end_y: 60 });
  });

  it('is a no-op for nothing moved', () => {
    expect(moveWallsJoined(plan, new Set(), 10, 10, SCALE)).toBe(plan);
    expect(moveWallsJoined(plan, new Set(['back']), 0, 0, SCALE)).toBe(plan);
  });
});

describe('moveWallEndJoined', () => {
  it('drags a corner: both walls meeting there follow it', () => {
    const out = moveWallEndJoined(plan, 'back', 'end', { x: 240, y: -20 }, SCALE);
    expect(byId(out, 'back')).toMatchObject({ end_x: 240, end_y: -20 });
    expect(byId(out, 'side')).toMatchObject({ start_x: 240, start_y: -20, end_x: 200, end_y: 120 });
  });

  it('keeps a T on the wall whose end moved, at the same point along it', () => {
    const out = moveWallEndJoined(plan, 'back', 'start', { x: 0, y: 100 }, SCALE);
    // The stub sat 40% along the back wall; it stays 40% along the turned wall.
    const b = byId(out, 'back');
    const s = byId(out, 'stub');
    expect(s.start_x).toBeCloseTo(b.start_x + 0.4 * (b.end_x - b.start_x));
    expect(s.start_y).toBeCloseTo(b.start_y + 0.4 * (b.end_y - b.start_y));
  });

  it('puts the dragged end where it was dropped, even off the wall it was on', () => {
    const out = moveWallEndJoined(plan, 'stub', 'start', { x: 80, y: -40 }, SCALE);
    expect(byId(out, 'stub')).toMatchObject({ start_x: 80, start_y: -40 });
    expect(byId(out, 'back')).toBe(back);
  });
});

describe('wallsMeetingEnd', () => {
  it('names the walls sharing an end, not the ones it Ts into', () => {
    expect(wallsMeetingEnd(plan, 'back', 'end')).toEqual(['side']);
    expect(wallsMeetingEnd(plan, 'stub', 'start')).toEqual([]);
  });
});

describe('keepWallsJoined', () => {
  it('follows a turned wall\'s corner', () => {
    // Back wall turned 90° about its left end: its right end goes to (0, 200).
    const turned = plan.map((w) => (w.id === 'back' ? { ...w, end_x: 0, end_y: 200 } : w));
    const out = keepWallsJoined(plan, turned, new Set(['back']), SCALE);
    expect(byId(out, 'side')).toMatchObject({ start_x: 0, start_y: 200 });
  });
});
