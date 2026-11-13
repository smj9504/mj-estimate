import { describe, expect, it } from 'vitest';
import type { XactimateMatch } from '../../types/rebuildEstimate';
import { defaultBasis, describe as words, lineFromXactimate, typedLine, withActivity } from './lineEdit';

const paint: XactimateMatch = {
  code: 'PNTSP', category_code: 'PNT', description: 'Seal/prime (1 coat) then paint (1 coat) {V}', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [{ activity: '+', label: 'Replace', price: 1.38, marked_up: 1.52, material_share: 0.18 }],
};
const drywall: XactimateMatch = {
  code: 'DRY1/2', category_code: 'DRY', description: '1/2" drywall - hung, taped, floated, ready for paint', unit: 'SF',
  price_list: 'VAAR8X_NOV26',
  activities: [
    { activity: '&', label: 'R&R', price: 3.8, marked_up: 4.18, material_share: 0.2 },
    { activity: '+', label: 'Replace', price: 3.26, marked_up: 3.59, material_share: 0.2331 },
    { activity: '-', label: 'Remove', price: 0.54, marked_up: 0.59, material_share: 0 },
  ],
};

describe('a repair from the Xactimate price list', () => {
  it('reads as Xactimate words it under its section, its quantity following the room', () => {
    const wall = lineFromXactimate(paint, 'k', 'wall');
    expect(wall).toMatchObject({
      room_id: 'k', section: 'wall', description: 'Seal/prime (1 coat) then paint (1 coat) the walls', unit: 'SF',
      quantity: null, basis: 'wall_sf', unit_price: null, code: 'PNTSP', activity: '+',
    });
    // The price kept is the list's own; the server marks it up
    expect(wall.activities[0]).toEqual({ activity: '+', label: 'Replace', price: 1.38, material_share: 0.18 });
    expect(lineFromXactimate(paint, 'k', 'ceiling').description).toBe('Seal/prime (1 coat) then paint (1 coat) the ceiling');
    expect(lineFromXactimate(paint, 'k', 'ceiling').basis).toBe('ceiling_sf');
    // In General there is no room to measure: one, typed
    expect(lineFromXactimate(paint, null, 'other')).toMatchObject({ basis: null, quantity: 1 });
  });

  it('an R&R item starts as R&R, and its words follow another activity', () => {
    const line = lineFromXactimate(drywall, 'k', 'wall');
    expect(line.description).toBe('R&R 1/2" drywall - hung, taped, floated, ready for paint');
    expect(withActivity(line, '-').description).toBe('Remove 1/2" drywall - hung, taped, floated, ready for paint');
    expect(withActivity(withActivity(line, '-'), '+').description).toBe('1/2" drywall - hung, taped, floated, ready for paint');
    expect(words('Batt insulation', 'I', 'wall')).toBe('Install Batt insulation');
  });

  it('a quantity follows the surface in its unit', () => {
    expect(defaultBasis('SF', 'floor')).toBe('floor_sf');
    expect(defaultBasis('LF', 'wall')).toBe('perimeter_lf');
    expect(defaultBasis('EA', 'wall')).toBeNull();
    expect(defaultBasis('SF', 'other')).toBeNull();
    expect(typedLine('k', 'wall')).toMatchObject({ quantity: 1, unit: 'EA', unit_price: 0, basis: null });
  });
});
