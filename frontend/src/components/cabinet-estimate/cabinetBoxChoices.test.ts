import { describe, it, expect } from 'vitest';
import { CABINET_PRESETS } from './CabinetBoxEditor';
import { boxChoices, changedBox, type BoxFields } from './cabinetBoxChoices';

const box = (code: string, over: Partial<BoxFields> = {}): BoxFields => {
  const p = CABINET_PRESETS[code];
  return {
    code,
    cab_type: p?.cab_type ?? 'base',
    width_inches: p?.width ?? 30,
    height_inches: p?.height ?? 34.5,
    is_specialty: !!p?.specialty,
    specialty_type: p?.specialty ?? null,
    has_glass_door: false,
    door_pattern: null,
    ...over,
  };
};

describe('boxChoices', () => {
  it('lists an upper\'s other widths at its height and other heights at its width, in its own family', () => {
    const c = boxChoices('W3036', CABINET_PRESETS)!;
    expect(c.widths.map((w) => w.value)).toContain(36);
    expect(c.widths.find((w) => w.value === 36)!.code).toBe('W3636');
    expect(c.widths.every((w) => CABINET_PRESETS[w.code].height === 36 && w.code.startsWith('W'))).toBe(true);
    expect(c.heights.map((h) => h.value)).toEqual(expect.arrayContaining([30, 36, 42]));
    expect(c.heights.find((h) => h.value === 42)!.code).toBe('W3042');
    // Sorted, and the box's own code stands for its own size.
    expect(c.widths.map((w) => w.value)).toEqual([...c.widths.map((w) => w.value)].sort((a, b) => a - b));
    expect(c.widths.find((w) => w.value === 30)!.code).toBe('W3036');
  });

  it('offers the specialties made at a base\'s size, None first', () => {
    const c = boxChoices('B36', CABINET_PRESETS)!;
    expect(c.specialties[0]).toMatchObject({ value: null, label: 'None', code: 'B36' });
    const sink = c.specialties.find((s) => s.value === 'sink_base');
    expect(sink?.code).toBe('SB36');
    expect(sink?.label).toBe('Sink base');
    // Every one is the same size.
    for (const s of c.specialties) {
      expect(CABINET_PRESETS[s.code].width).toBe(36);
      expect(CABINET_PRESETS[s.code].cab_type).toBe('base');
    }
  });

  it('keeps a specialty when changing size: a sink base\'s widths are sink bases', () => {
    const c = boxChoices('SB36', CABINET_PRESETS)!;
    expect(c.widths.length).toBeGreaterThan(1);
    expect(c.widths.every((w) => CABINET_PRESETS[w.code].specialty === 'sink_base')).toBe(true);
  });

  it('has none for a custom box', () => {
    expect(boxChoices('CUSTOM', CABINET_PRESETS)).toBeNull();
  });
});

describe('changedBox', () => {
  it('takes a new code\'s size and specialty, keeping glass and pattern', () => {
    const next = changedBox(box('B36', { has_glass_door: true, door_pattern: 'lattice' }), { code: 'SB36' }, CABINET_PRESETS);
    expect(next).toMatchObject({ code: 'SB36', specialty_type: 'sink_base', is_specialty: true, has_glass_door: true, door_pattern: 'lattice' });
  });

  it('drops glass and pattern on a box with no door', () => {
    const next = changedBox(box('B24', { has_glass_door: true, door_pattern: 'lattice' }), { code: 'DB24' }, CABINET_PRESETS);
    expect(next).toMatchObject({ specialty_type: 'drawer_base', has_glass_door: false, door_pattern: null });
  });

  it('makes a typed size a custom box with no specialty', () => {
    const next = changedBox(box('SB36'), { width: 34 }, CABINET_PRESETS);
    expect(next).toMatchObject({ code: 'CUSTOM', width_inches: 34, height_inches: 34.5, specialty_type: null, is_specialty: false });
  });

  it('ties mullions to their glass', () => {
    const withMullions = changedBox(box('W3036'), { door_pattern: 'mullion' }, CABINET_PRESETS);
    expect(withMullions).toMatchObject({ door_pattern: 'mullion', has_glass_door: true });
    expect(changedBox(withMullions, { has_glass_door: false }, CABINET_PRESETS)).toMatchObject({ door_pattern: null, has_glass_door: false });
    // A lattice keeps its pattern without glass.
    const lattice = changedBox(box('W3036', { has_glass_door: true }), { door_pattern: 'lattice' }, CABINET_PRESETS);
    expect(changedBox(lattice, { has_glass_door: false }, CABINET_PRESETS).door_pattern).toBe('lattice');
  });

  it('gives a tall no glass and no mullions', () => {
    const next = changedBox(box('T2484'), { door_pattern: 'mullion' }, CABINET_PRESETS);
    expect(next).toMatchObject({ has_glass_door: false, door_pattern: null });
    expect(changedBox(box('T2484'), { door_pattern: 'lattice' }, CABINET_PRESETS).door_pattern).toBe('lattice');
  });

  it('sets a slide-in range base\'s panels', () => {
    const next = changedBox(box('B30'), { code: 'RB30S' }, CABINET_PRESETS);
    expect(next.range_panel_count).toBe(2);
  });
});
