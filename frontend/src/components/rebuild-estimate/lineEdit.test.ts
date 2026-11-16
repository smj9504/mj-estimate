import { describe, expect, it } from 'vitest';
import type { Assembly, XactimateMatch } from '../../types/rebuildEstimate';
import {
  addToRoom, evalQty, typedQty, withItem, asWording, assemblyLines, defaultBasis, describe as words, lineFromXactimate, typedLine, withActivity, withWording,
} from './lineEdit';

const paint: XactimateMatch = {
  code: 'PNTSP', category_code: 'PNT', description: 'Seal/prime (1 coat) then paint (1 coat) {V}', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [{
    activity: '+', label: 'Replace', price: 1.38, marked_up: 1.52, material_share: 0.18,
    wording: '{S} - seal/prime & paint, 1 coat each',
  }],
};
const drywall: XactimateMatch = {
  code: 'DRY1/2', category_code: 'DRY', description: '1/2" drywall - hung, taped, floated, ready for paint', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [
    { activity: '&', label: 'R&R', price: 3.8, marked_up: 4.18, material_share: 0.2, wording: 'Drywall 1/2" - tear out, hang new, tape & finish' },
    { activity: '+', label: 'Replace', price: 3.26, marked_up: 3.59, material_share: 0.2331, wording: 'Drywall 1/2" - hang, tape & finish' },
    { activity: '-', label: 'Remove', price: 0.54, marked_up: 0.59, material_share: 0, wording: 'Drywall 1/2" - tear out' },
  ],
};
const laminate: XactimateMatch = {
  code: 'FCWLAM', category_code: 'FCW', description: 'Snaplock Laminate - simulated wood flooring', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [
    { activity: '&', label: 'R&R', price: 7.7, material_share: 0.43, wording: null },
    { activity: '-', label: 'Remove', price: 1.45, material_share: 0, wording: null },
  ],
};

describe('a repair from the price list', () => {
  it('is written in our words, naming the surface it is on, its quantity following the room', () => {
    const wall = lineFromXactimate(paint, 'k', 'wall');
    expect(wall).toMatchObject({
      room_id: 'k', section: 'wall', description: 'Walls - seal/prime & paint, 1 coat each', xact_words: false,
      unit: 'SF', quantity: null, basis: 'wall_sf', unit_price: null, code: 'PNTSP', activity: '+',
    });
    // The price kept is the list's own; the server marks it up
    expect(wall.activities[0]).toMatchObject({ activity: '+', price: 1.38, material_share: 0.18 });
    expect(lineFromXactimate(paint, 'k', 'ceiling').description).toBe('Ceiling - seal/prime & paint, 1 coat each');
    expect(lineFromXactimate(paint, 'k', 'ceiling').basis).toBe('ceiling_sf');
    // In General there is no room to measure: one, typed
    expect(lineFromXactimate(paint, null, 'other')).toMatchObject({ basis: null, quantity: 1 });
  });

  it('with no words of ours, comes in Xactimate\'s, marked', () => {
    const line = lineFromXactimate(laminate, 'k', 'floor');
    expect(line).toMatchObject({ description: 'R&R Snaplock Laminate - simulated wood flooring', xact_words: true });
    expect(withActivity(line, '-').description).toBe('Remove Snaplock Laminate - simulated wood flooring');
    expect(words('Batt insulation {V}', 'I', 'wall')).toBe('Install Batt insulation the walls');
  });

  it('an R&R item starts as R&R, and its words follow another activity', () => {
    const line = lineFromXactimate(drywall, 'k', 'wall');
    expect(line.description).toBe('Drywall 1/2" - tear out, hang new, tape & finish');
    expect(withActivity(line, '-').description).toBe('Drywall 1/2" - tear out');
  });

  it('words kept for an item are taken by every line of it, the surface left to each', () => {
    const wall = { ...lineFromXactimate(paint, 'k', 'wall'), description: 'Walls - prime and paint' };
    const ceiling = lineFromXactimate(paint, 'k', 'ceiling');
    const kept = asWording(wall.description, wall.section);
    expect(kept).toBe('{S} - prime and paint');
    const [w, c] = withWording([wall, ceiling], 'PNTSP', '+', kept);
    expect([w.description, c.description]).toEqual(['Walls - prime and paint', 'Ceiling - prime and paint']);
    expect(c.activities[0].wording).toBe('{S} - prime and paint');
  });

  it('a quantity follows the surface in its unit', () => {
    expect(defaultBasis('SF', 'floor')).toBe('floor_sf');
    expect(defaultBasis('LF', 'wall')).toBe('perimeter_lf');
    expect(defaultBasis('EA', 'wall')).toBeNull();
    expect(defaultBasis('SF', 'other')).toBeNull();
    expect(typedLine('k', 'wall')).toMatchObject({ quantity: 1, unit: 'EA', unit_price: 0, basis: null });
  });
});

describe('a set of repairs', () => {
  const set: Assembly = {
    key: 'walls_drywall', label: 'Walls - new drywall, primed & painted', hint: '', asks_cut: true,
    items: [
      { code: 'DRY1/2', activity: '&', section: 'wall', basis: 'wall_sf', cut_part: 'below', only_with_cut: false, match: drywall },
      { code: 'PNTSP', activity: '+', section: 'wall', basis: 'wall_sf', cut_part: 'below', only_with_cut: false, match: paint },
      { code: 'PNTSP', activity: '+', section: 'wall', basis: 'wall_sf', cut_part: 'above', only_with_cut: true, match: paint },
    ],
  };

  it('with a flood cut: the lower part new, the rest painted to match', () => {
    const lines = assemblyLines(set, 'k', 2);
    expect(lines.map((l) => [l.code, l.activity, l.basis, l.cut_height_ft, l.cut_part])).toEqual([
      ['DRY1/2', '&', 'wall_sf', 2, 'below'], ['PNTSP', '+', 'wall_sf', 2, 'below'], ['PNTSP', '+', 'wall_sf', 2, 'above'],
    ]);
    expect(lines[0].description).toBe('Drywall 1/2" - tear out, hang new, tape & finish');
    expect(new Set(lines.map((l) => l.id)).size).toBe(3);
  });

  it('full height: no paint to match', () => {
    const lines = assemblyLines(set, 'k', null);
    expect(lines.map((l) => [l.code, l.cut_height_ft])).toEqual([['DRY1/2', null], ['PNTSP', null]]);
  });
});

describe('a final clean-up with a room\'s first repair', () => {
  const clean: XactimateMatch = {
    code: 'CLNFINALR', category_code: 'CLN', description: 'Final cleaning - construction - Residential', unit: 'SF',
    price_list: 'VAAR8X_NOV26',
    activities: [{ activity: '+', label: 'Replace', price: 0.37, marked_up: 0.41, material_share: 0, wording: 'Final construction clean-up' }],
  };
  const sets: Assembly[] = [{
    key: 'final_clean', label: 'Final construction clean-up', hint: '', asks_cut: false,
    items: [{ code: 'CLNFINALR', activity: '+', section: 'other', basis: 'floor_sf', cut_part: null, only_with_cut: false, match: clean }],
  }];

  it('comes with the first repair, on the room\'s floor', () => {
    const lines = addToRoom([], 'k', [lineFromXactimate(paint, 'k', 'wall')], sets);
    expect(lines.map((l) => [l.code, l.room_id, l.section, l.basis, l.description])).toEqual([
      ['PNTSP', 'k', 'wall', 'wall_sf', 'Walls - seal/prime & paint, 1 coat each'],
      ['CLNFINALR', 'k', 'other', 'floor_sf', 'Final construction clean-up'],
    ]);
  });

  it('once: not with the next repair, nor back once taken off', () => {
    const first = addToRoom([], 'k', [lineFromXactimate(paint, 'k', 'wall')], sets);
    expect(addToRoom(first, 'k', [typedLine('k', 'wall')], sets).filter((l) => l.code === 'CLNFINALR')).toHaveLength(1);
    const without = first.filter((l) => l.code !== 'CLNFINALR');
    expect(addToRoom(without, 'k', [typedLine('k', 'wall')], sets).some((l) => l.code === 'CLNFINALR')).toBe(false);
  });

  it('not twice when the clean-up is the repair added, nor on the general section', () => {
    expect(addToRoom([], 'k', assemblyLines(sets[0], 'k', null), sets)).toHaveLength(1);
    expect(addToRoom([], null, [typedLine(null, 'other')], sets)).toHaveLength(1);
    // Another room's repairs don't count
    const other = addToRoom([], 'b', [typedLine('b', 'wall')], sets);
    expect(addToRoom(other, 'k', [typedLine('k', 'wall')], sets).filter((l) => l.code === 'CLNFINALR')).toHaveLength(2);
  });
});

describe('another activity, on words of ours with no words kept for it', () => {
  const quarterRound: XactimateMatch = {
    code: 'FNCQR', category_code: 'FNC', description: 'Quarter round - 3/4"', unit: 'LF', price_list: 'VAAR8X_NOV26',
    activities: [
      { activity: '&', label: 'R&R', price: 2.36, material_share: 0.4, wording: null },
      { activity: '+', label: 'Replace', price: 2.12, material_share: 0.45, wording: null },
      { activity: '-', label: 'Remove', price: 0.24, material_share: 0, wording: null },
      { activity: 'R', label: 'Detach & Reset', price: 1.96, material_share: 0, wording: null },
    ],
  };
  const ours = (description: string, activity: '+' | 'R' | '-') => ({
    ...lineFromXactimate(quarterRound, 'k', 'floor', { activity }), description, xact_words: false,
  });

  it('takes the new activity\'s ending', () => {
    expect(withActivity(ours('Quarter round 3/4" - install', '+'), '-').description).toBe('Quarter round 3/4" - remove');
    expect(withActivity(ours('Quarter round 3/4" - detach & reset', 'R'), '+').description).toBe('Quarter round 3/4" - install');
    expect(withActivity(ours('Quarter round 3/4" - remove', '-'), '&').description).toBe('Quarter round 3/4" - remove & replace');
    expect(withActivity(ours('Quarter round 3/4" - remove & replace', '-'), 'R').description).toBe('Quarter round 3/4" - detach & reset');
  });

  it('mends words a prefix was put on before', () => {
    expect(withActivity(ours('Remove Quarter round 3/4" - install', '-'), '-').description).toBe('Quarter round 3/4" - remove');
    expect(withActivity(ours('Remove Quarter round 3/4" - detach & reset', '-'), 'R').description)
      .toBe('Quarter round 3/4" - detach & reset');
  });

  it('an item that only goes in: plain when installed, its other activities said', () => {
    const paintTrim: XactimateMatch = {
      code: 'PNTBCS', category_code: 'PNT', description: 'Paint baseboard w/cap &/or shoe - one coat', unit: 'LF',
      price_list: 'VAAR8X_NOV26',
      activities: [
        { activity: '+', label: 'Install', price: 1.67, material_share: 0.14, wording: null },
        { activity: 'M', label: 'Material only', price: 0.24, material_share: 1, wording: null },
        { activity: 'I', label: 'Labor only', price: 1.43, material_share: 0, wording: null },
      ],
    };
    const line = { ...lineFromXactimate(paintTrim, 'k', 'floor'), description: 'Baseboard w/ cap or shoe - paint, 1 coat', xact_words: false };
    const labor = withActivity(line, 'I');
    expect(labor.description).toBe('Baseboard w/ cap or shoe - paint, 1 coat - labor only');
    expect(withActivity(labor, 'M').description).toBe('Baseboard w/ cap or shoe - paint, 1 coat - material only');
    expect(withActivity(labor, '+').description).toBe('Baseboard w/ cap or shoe - paint, 1 coat');
  });

  it('leaves Xactimate\'s words to their prefix', () => {
    const xact = lineFromXactimate(quarterRound, 'k', 'floor', { activity: '+' });
    expect(xact.description).toBe('Quarter round - 3/4"');
    expect(withActivity(xact, 'R').description).toBe('Detach & Reset Quarter round - 3/4"');
  });
});

describe('a quantity typed as a sum', () => {
  it('works it out, times before plus, brackets first', () => {
    expect(evalQty('16.25*2 + 4.25*2')).toBe(41);
    expect(evalQty('(12+8)*2')).toBe(40);
    expect(evalQty('12 x 8 - 2.5*6.67')).toBe(79.33);
    expect(evalQty('10/3')).toBe(3.33);
    expect(evalQty('243.98')).toBe(243.98);
  });

  it('refuses what is not a sum, or comes to less than nothing', () => {
    expect(evalQty('12 +')).toBeNull();
    expect(evalQty('2*(3+4')).toBeNull();
    expect(evalQty('alert(1)')).toBeNull();
    expect(evalQty('4/0')).toBeNull();
    expect(evalQty('2-5')).toBeNull();
  });

  it('keeps the sum on the line, a plain number alone, and nothing goes back to the room', () => {
    expect(typedQty('16.25*2 + 4.25*2')).toEqual({ quantity: 41, qty_formula: '16.25*2 + 4.25*2' });
    expect(typedQty('72.18')).toEqual({ quantity: 72.18, qty_formula: null });
    expect(typedQty('  ')).toEqual({ quantity: null, qty_formula: null });
    expect(typedQty('12*')).toBeUndefined();
  });
});

describe('another item in a line\'s place', () => {
  const perSpec: XactimateMatch = {
    code: 'FCVNFCPPLK', category_code: 'FCV', description: 'Vinyl plank flooring - per specs from ind. vinyl analysis',
    unit: 'SF', price_list: 'VAAR8X_NOV26',
    activities: [
      { activity: '&', label: 'Remove & replace', price: 4.47, material_share: 0.3, wording: null },
      { activity: '+', label: 'Install', price: 3.02, material_share: 0.02, wording: null },
    ],
  };
  const standard: XactimateMatch = {
    code: 'FCVPLK-', category_code: 'FCV', description: 'Vinyl plank flooring - Standard grade', unit: 'SF',
    price_list: 'VAAR8X_NOV26',
    activities: [
      { activity: '&', label: 'Remove & replace', price: 6.42, material_share: 0.3, wording: null },
      { activity: '+', label: 'Install', price: 4.97, material_share: 0.4, wording: 'Vinyl plank flooring - install' },
    ],
  };

  it('takes the item\'s code, prices and words, and keeps the room, section, quantity and note', () => {
    const line = {
      ...lineFromXactimate(perSpec, 'k', 'floor', { activity: '+' }),
      quantity: 40, qty_formula: '20*2', unit_price: 4.74, notes: 'Less the blocks',
    };
    const next = withItem(line, standard);
    expect(next).toMatchObject({
      id: line.id, room_id: 'k', section: 'floor', code: 'FCVPLK-', activity: '+', unit: 'SF',
      quantity: 40, qty_formula: '20*2', unit_price: null, notes: 'Less the blocks',
      description: 'Vinyl plank flooring - install', xact_words: false,
    });
    expect(next.activities.map((a) => a.price)).toEqual([6.42, 4.97]);
  });

  it('another unit: the quantity follows the new unit\'s measure', () => {
    const line = { ...lineFromXactimate(perSpec, 'k', 'floor', { activity: '+' }), quantity: 40 };
    const trim: XactimateMatch = { ...standard, code: 'FNCQR', unit: 'LF', description: 'Quarter round - 3/4"' };
    expect(withItem(line, trim)).toMatchObject({ unit: 'LF', quantity: null, basis: 'perimeter_lf', qty_formula: null });
  });
});
