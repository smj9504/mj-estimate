import { describe, expect, it } from 'vitest';
import type { Assembly, XactimateMatch } from '../../types/rebuildEstimate';
import {
  asWording, assemblyLines, defaultBasis, describe as words, lineFromXactimate, typedLine, withActivity, withWording,
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
