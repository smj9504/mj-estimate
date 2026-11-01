import { describe, expect, it } from 'vitest';
import type { DetectedContentItem } from '../../types/packing-estimate';
import {
  confirmItem, countedHours, editItem, isUnconfirmed, mergePlan, needsPlan, needsReview,
  newItem, planSignature, reviewCount, roomItemHours, withUids,
} from './itemEdits';

const item = (fields: Partial<DetectedContentItem> = {}): DetectedContentItem => ({
  name: 'Dresser',
  category: 'Furniture',
  quantity: 1,
  size: 'large',
  weight: 'heavy',
  is_fragile: false,
  is_high_value: false,
  needs_disassembly: false,
  packing_method: 'blanket_wrap',
  packing_locked: false,
  base_labor_hours: 0.13,
  per_unit_labor_hours: 0.98,
  estimated_labor_hours: 1.11,
  uncertain_fields: [],
  ...fields,
});

describe('editItem', () => {
  it('settles the question it answers and keeps the others', () => {
    const edited = editItem(item({ uncertain_fields: ['weight', 'size'], review_note: 'Hard to tell' }), { weight: 'medium' });
    expect(edited.weight).toBe('medium');
    expect(edited.uncertain_fields).toEqual(['size']);
    expect(edited.review_note).toBe('Hard to tell');
  });

  it('drops the note with the last question', () => {
    const edited = editItem(item({ uncertain_fields: ['weight'], review_note: 'Hard to tell' }), { weight: 'medium' });
    expect(needsReview(edited)).toBe(false);
    expect(edited.review_note).toBeNull();
  });

  it('maps fragile and disassembly to their questions', () => {
    const open = item({ uncertain_fields: ['fragile', 'disassembly'] });
    expect(editItem(open, { is_fragile: true }).uncertain_fields).toEqual(['disassembly']);
    expect(editItem(open, { needs_disassembly: true }).uncertain_fields).toEqual(['fragile']);
  });

  it('an edit elsewhere does not settle whether the item is there', () => {
    const edited = editItem(item({ uncertain_fields: ['presence'] }), { size: 'small' });
    expect(isUnconfirmed(edited)).toBe(true);
  });

  it('follows the quantity without asking the server', () => {
    const edited = editItem(item(), { quantity: 4 });
    expect(edited.estimated_labor_hours).toBe(4.05);
    expect(needsPlan({ quantity: 4 })).toBe(false);
  });

  it('adds less for each one more of the same', () => {
    const edited = editItem(item({ quantity_exponent: 0.85 }), { quantity: 4 });
    // 0.13 + 0.98 x 4^0.85, not 0.13 + 0.98 x 4
    expect(edited.estimated_labor_hours).toBe(3.31);
  });

  it('asks the server when an attribute changes', () => {
    expect(needsPlan({ size: 'small' })).toBe(true);
    expect(needsPlan({ is_fragile: true })).toBe(true);
    expect(needsPlan({ packing_method: 'crate', packing_locked: true })).toBe(true);
  });
});

describe('confirmItem', () => {
  it('clears every question, including whether it is there', () => {
    const confirmed = confirmItem(item({ uncertain_fields: ['presence', 'weight'], review_note: 'Blurry' }));
    expect(needsReview(confirmed)).toBe(false);
    expect(confirmed.review_note).toBeNull();
  });
});

describe('mergePlan', () => {
  const planned = item({
    packing_method: 'crate', base_labor_hours: 0.33, per_unit_labor_hours: 1.95, estimated_labor_hours: 2.28,
  });

  it('takes the answer when the item has not moved on', () => {
    const current = item({ size: 'xlarge', packing_method: 'blanket_wrap' });
    const merged = mergePlan(current, planSignature(current), planned);
    expect(merged.packing_method).toBe('crate');
    expect(merged.estimated_labor_hours).toBe(2.28);
  });

  it('prices the quantity on screen, not the one that was sent', () => {
    const sent = item({ size: 'xlarge' });
    const current = { ...sent, quantity: 2 };
    expect(mergePlan(current, planSignature(sent), planned).estimated_labor_hours).toBe(4.23);
  });

  it('keeps how the units add up', () => {
    const current = item({ size: 'xlarge' });
    const merged = mergePlan(current, planSignature(current), { ...planned, quantity_exponent: 0.85 });
    expect(merged.quantity_exponent).toBe(0.85);
  });

  it('ignores a late answer to an older edit', () => {
    const sent = item({ size: 'small' });
    const current = item({ size: 'xlarge', packing_method: 'blanket_wrap' });
    expect(mergePlan(current, planSignature(sent), planned)).toBe(current);
  });
});

describe('room figures', () => {
  it('counts what needs a decision', () => {
    expect(reviewCount([item(), item({ uncertain_fields: ['size'] }), item({ uncertain_fields: ['presence'] })])).toBe(2);
  });

  const plates = (quantity: number, fields: Partial<DetectedContentItem> = {}) => item({
    name: 'Plates', category: 'Kitchenware', size: 'small', weight: 'light', is_fragile: true,
    packing_method: 'dish_pack', quantity, base_labor_hours: 0.33, per_unit_labor_hours: 0.23,
    quantity_exponent: 0.55, ...fields,
  });

  it('prices units of one size packed the same way together, as the estimate does', () => {
    const [split1, split2] = roomItemHours([plates(20), plates(20, { name: 'Bowls' })]);
    const [together] = roomItemHours([plates(40)]);
    // Two lines are one more setup than one line, and no more
    expect((split1 as number) + (split2 as number) - (together as number)).toBeCloseTo(0.33, 1);
    const [alone] = roomItemHours([plates(20)]);
    expect(split1).toBeLessThan(alone as number);
  });

  it('does not pool a different size or method', () => {
    const [alone] = roomItemHours([plates(20)]);
    const [withOthers] = roomItemHours([
      plates(20), plates(20, { size: 'medium' }), plates(20, { packing_method: 'box_fragile' }),
    ]);
    expect(withOthers).toBe(alone);
  });

  it('prices one that may not be there on its own and keeps older saved hours', () => {
    const [counted, unsure] = roomItemHours([plates(20), plates(20, { uncertain_fields: ['presence'] })]);
    expect(counted).toBe(roomItemHours([plates(20)])[0]);
    expect(unsure).toBe(counted);
    expect(roomItemHours([item({ estimated_labor_hours: 7.5 })])).toEqual([7.5]);
  });

  it('leaves unconfirmed items out of the hours', () => {
    expect(countedHours([
      item({ estimated_labor_hours: 1.5 }),
      item({ estimated_labor_hours: 9, uncertain_fields: ['presence'] }),
      item({ estimated_labor_hours: 0.5, uncertain_fields: ['weight'] }),
    ])).toBe(2);
  });
});

describe('uids', () => {
  it('gives each item its own and keeps one it has', () => {
    const [first, second, third] = withUids([item(), item(), item({ uid: 'kept' })]);
    expect(first.uid).toBeTruthy();
    expect(first.uid).not.toBe(second.uid);
    expect(third.uid).toBe('kept');
    expect(newItem().uid).not.toBe(newItem().uid);
  });
});
