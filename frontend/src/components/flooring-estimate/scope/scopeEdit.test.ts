import { describe, expect, it } from 'vitest';
import type { TakeoffItem } from '../../../types/flooringEstimate';
import {
  addCustom, removeCustom, resetRoomItem, setGeneralItem, setJobDefaults, setJobRoomItem, setRoomField,
  setRoomItem, shownItem, updateCustom,
} from './scopeEdit';

const item = (over: Partial<TakeoffItem> = {}): TakeoffItem => ({
  key: 'shoe_molding', label: 'Shoe molding - install & paint', group: 'Trim', category: 'trim', unit: 'LF',
  basis: 'base_lf', on: false, default_on: false, on_source: 'default', auto_qty: 49.33, qty: 49.33,
  qty_typed: false, unit_price: 3.75, price_typed: false, price_key: 'TRIM_RATES.shoe_molding_per_lf',
  notes: null, source: 'item', estimated_total: 0, ...over,
});

describe('room choices', () => {
  it('keeps only what was chosen', () => {
    let scopes = setRoomField({}, 'living', { new_material: 'lvp' });
    expect(scopes).toEqual({ living: { new_material: 'lvp' } });
    scopes = setRoomItem(scopes, 'living', 'shoe_molding', { on: true });
    expect(scopes.living.items).toEqual({ shoe_molding: { on: true } });
  });

  it('goes back to the default when a choice is cleared', () => {
    let scopes = setRoomItem({}, 'living', 'shoe_molding', { on: true, qty: 40 });
    scopes = setRoomItem(scopes, 'living', 'shoe_molding', { qty: null });
    expect(scopes.living.items).toEqual({ shoe_molding: { on: true } });
    scopes = resetRoomItem(scopes, 'living', 'shoe_molding');
    // Nothing left chosen for the room: it isn't kept at all
    expect(scopes).toEqual({});
  });

  it('keeps a room left out, and forgets the default of being in', () => {
    let scopes = setRoomField({}, 'bath', { included: false });
    expect(scopes.bath).toEqual({ included: false });
    scopes = setRoomField(scopes, 'bath', { included: true });
    expect(scopes).toEqual({});
  });

  it('does not touch the other rooms', () => {
    const before = { hall: { new_material: 'carpet' as const } };
    const after = setRoomField(before, 'living', { new_material: 'lvp' });
    expect(after.hall).toBe(before.hall);
    expect(before).toEqual({ hall: { new_material: 'carpet' } });
  });
});

describe('job choices', () => {
  it('sets defaults for every room', () => {
    const job = setJobDefaults({}, { new_material: 'lvp', pattern: null });
    expect(job.defaults).toEqual({ new_material: 'lvp' });
  });

  it('switches an item for every room, never with a quantity', () => {
    const job = setJobRoomItem({}, 'shoe_molding', { on: true, qty: 12 });
    expect(job.room_items).toEqual({ shoe_molding: { on: true } });
    expect(setJobRoomItem(job, 'shoe_molding', { on: null }).room_items).toBeUndefined();
  });

  it('sets the General items', () => {
    expect(setGeneralItem({}, 'dumpster', { on: true }).items).toEqual({ dumpster: { on: true } });
  });
});

describe('custom lines', () => {
  it('adds, edits and removes', () => {
    let list = addCustom(undefined);
    expect(list).toHaveLength(1);
    const id = list[0].id!;
    list = updateCustom(list, id, { description: 'Permit', unit_price: 150 });
    expect(list[0]).toMatchObject({ description: 'Permit', unit_price: 150 });
    expect(removeCustom(list, id)).toEqual([]);
  });
});

describe('what an item shows', () => {
  it('follows the room, then the job, then the default', () => {
    expect(shownItem(item({ default_on: true }), undefined, undefined, 3.75)).toMatchObject({ on: true, onSource: 'default' });
    expect(shownItem(item(), undefined, { on: true }, 3.75)).toMatchObject({ on: true, onSource: 'job' });
    expect(shownItem(item(), { on: false }, { on: true }, 3.75)).toMatchObject({ on: false, onSource: 'room' });
  });

  it('prices what it shows with a typed quantity and price', () => {
    const shown = shownItem(item(), { on: true, qty: 40, unit_price: 3.1 }, undefined, 3.75);
    expect(shown).toMatchObject({ qty: 40, qtyTyped: true, unitPrice: 3.1, priceTyped: true, total: 124 });
  });

  it('uses the measured quantity and the catalog price otherwise, and counts nothing switched off', () => {
    const on = shownItem(item(), { on: true }, undefined, 3.75);
    expect(on.total).toBeCloseTo(49.33 * 3.75, 2);
    expect(shownItem(item(), undefined, undefined, 3.75).total).toBe(0);
  });
});
