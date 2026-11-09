import { describe, it, expect } from 'vitest';

import { XactimateItem } from '../types/xactimate';
import { convertXactimateToLineItem, xactimateActivityPrices } from './xactimateTransform';

// CAB AG as read out of Xactimate (VAAR8X_NOV26): R&R $244.03 = replace $223.64 + remove $20.39
const CABAG: XactimateItem = {
  id: 7,
  item_code: 'CABAG',
  category_code: 'CAB',
  description: 'Cabinetry - appliance garage',
  unit: 'EA',
  activity: '&',
  price_list: 'VAAR8X_NOV26',
  price_year: 2026,
  price_month: 11,
  untaxed_unit_price: 244.03,
  replace_price: 223.64,
  remove_price: 20.39,
  has_life_expectancy_data: true,
};

const DRYWALL_SF: XactimateItem = {
  id: 8,
  item_code: 'DRYPATCH',
  category_code: 'DRY',
  description: 'Drywall patch',
  unit: 'SF',
  activity: '+',
  price_year: 2026,
  price_month: 11,
  untaxed_unit_price: 9.5,
  replace_price: 9.5,
  remove_price: null,
  has_life_expectancy_data: false,
};

describe('Xactimate activity prices', () => {
  it('offers R&R, Replace and Remove for a split & item', () => {
    expect(xactimateActivityPrices(CABAG)).toEqual([
      { activity: '&', price: 244.03 },
      { activity: '+', price: 223.64 },
      { activity: '-', price: 20.39 },
    ]);
  });

  it('prices and words the line by the chosen activity', () => {
    const remove = convertXactimateToLineItem(CABAG, 2, undefined, '-');
    expect(remove.unit_price).toBe(20.39);
    expect(remove.total).toBeCloseTo(40.78);
    expect(remove.description).toBe('Remove Cabinetry - appliance garage');
    expect(remove.xactimate_activity).toBe('-');

    const replace = convertXactimateToLineItem(CABAG, 1, undefined, '+');
    expect(replace.unit_price).toBe(223.64);
    expect(replace.description).toBe('Cabinetry - appliance garage');

    const rr = convertXactimateToLineItem(CABAG);
    expect(rr.unit_price).toBe(244.03);
    expect(rr.description).toBe('R&R Cabinetry - appliance garage');
    expect(rr.note).toContain('R&R $244.03, Replace $223.64, Remove $20.39');
  });

  it('keeps an unsplit item as it is, in its own unit', () => {
    expect(xactimateActivityPrices(DRYWALL_SF)).toEqual([{ activity: '+', price: 9.5 }]);
    const line = convertXactimateToLineItem(DRYWALL_SF, 1, undefined, '-');
    expect(line.unit_price).toBe(9.5);
    expect(line.unit).toBe('SF');
    expect(line.description).toBe('Drywall patch');
  });

  it('treats items imported before the split like before', () => {
    const old: XactimateItem = { ...CABAG, activity: null, replace_price: null, remove_price: null, unit: null };
    expect(xactimateActivityPrices(old)).toEqual([{ activity: null, price: 244.03 }]);
    const line = convertXactimateToLineItem(old);
    expect(line.unit_price).toBe(244.03);
    expect(line.unit).toBe('EA');
    expect(line.description).toBe('Cabinetry - appliance garage');
  });

  it('reads prices that arrive as strings', () => {
    const fromApi = { ...CABAG, untaxed_unit_price: '244.03', replace_price: '223.64', remove_price: '20.39' } as unknown as XactimateItem;
    expect(convertXactimateToLineItem(fromApi, 1, undefined, '+').unit_price).toBe(223.64);
  });
});
