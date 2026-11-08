import { describe, expect, it } from 'vitest';
import { parseNumber, parseXactimatePaste, readPrices } from './xactimatePaste';

describe('parseNumber', () => {
  it('reads Xactimate money and negatives', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('(12.30)')).toBe(-12.3);
    expect(parseNumber('<12.30>')).toBe(-12.3);
    expect(parseNumber('$5')).toBe(5);
    expect(parseNumber('1/2"')).toBeNull();
    expect(parseNumber('SF')).toBeNull();
  });
});

describe('readPrices', () => {
  it('prefers the reading whose numbers add up to the total', () => {
    // qty 10: remove 0.50 + replace 2.00 -> 25.00, tax 1.00, O&P 5.20, total 31.20
    const rr = readPrices(10, [0.5, 2, 1, 5.2, 31.2]);
    expect(rr.unitPrice).toBe(2.5);
    expect(rr.remove).toBe(0.5);
    expect(rr.consistent).toBe(true);

    // qty 10: unit price 2.50, tax 1.00, O&P 5.20, RCV 31.20, deprec 0, ACV 31.20
    const up = readPrices(10, [2.5, 1, 5.2, 31.2, 0, 31.2]);
    expect(up.unitPrice).toBe(2.5);
    expect(up.tax).toBe(1);
    expect(up.consistent).toBe(true);
  });

  it('flags a line whose totals do not add up', () => {
    const r = readPrices(10, [2.5, 99]);
    expect(r.unitPrice).toBe(2.5);
    expect(r.warning).toBeTruthy();
  });
});

describe('parseXactimatePaste - report text', () => {
  const report = [
    'MJ Restoration LLC',
    'SMITH_JOHN',
    'Kitchen                                                     Height: 8\'',
    '389.33 SF Walls                144.00 SF Ceiling            533.33 SF Walls & Ceiling',
    '144.00 SF Floor                16.00 SY Flooring            48.67 LF Floor Perimeter',
    'DESCRIPTION                     QUANTITY UNIT PRICE      TAX      O&P      RCV    DEPREC.      ACV',
    '1. Remove Drywall - 1/2" - hung, taped, ready for texture   128.00 SF   0.52   0.00   13.31   79.87   (0.00)   79.87',
    '2. R&R Baseboard - 3 1/4"   45.33 LF   3.07   2.65   28.36   170.17   <0.00>   170.17',
    '3. Seal/prime then paint the walls (2 coats)   389.33 SF   1.08   4.21   84.94   509.63   0.00   509.63',
    'Totals: Kitchen                                    6.86   126.61   759.67   0.00   759.67',
    'CONTINUED - Kitchen',
    'DESCRIPTION                     QUANTITY UNIT PRICE      TAX      O&P      RCV    DEPREC.      ACV',
    '4. Content Manipulation charge - per hour   2.00 HR   45.62   0.00   18.25   109.49   0.00   109.49',
    'Bathroom                                                    Height: 8\'',
    '210.67 SF Walls                40.00 SF Ceiling             250.67 SF Walls & Ceiling',
    'DESCRIPTION                     QUANTITY UNIT PRICE      TAX      O&P      RCV    DEPREC.      ACV',
    '5. Tear out wet non-salvageable carpet, cut & bag for',
    'disposal                      40.00 SF   0.60   0.00   4.80   28.80   0.00   28.80',
    '6. Toilet - Detach & reset   1.00 EA   245.18   0.00   49.04   294.22   0.00   294.22',
    'Includes: supply line and wax ring.',
  ].join('\n');

  const result = parseXactimatePaste(report);

  it('reads every item with quantity, unit and pre-tax unit price', () => {
    expect(result.format).toBe('report');
    expect(result.items.map((i) => i.lineNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    const [drywall, base] = result.items;
    expect(drywall.description).toBe('Remove Drywall - 1/2" - hung, taped, ready for texture');
    expect(drywall.quantity).toBe(128);
    expect(drywall.unit).toBe('SF');
    expect(drywall.unitPrice).toBe(0.52);
    expect(drywall.xactimateTotal).toBe(79.87);
    expect(base.unitPrice).toBe(3.07);
    expect(base.tax).toBe(2.65);
    expect(result.items.every((i) => i.warnings.length === 0)).toBe(true);
  });

  it('keeps rooms from headings and CONTINUED lines, ignoring page headers', () => {
    expect(result.rooms).toEqual(['Kitchen', 'Bathroom']);
    expect(result.items.map((i) => i.room)).toEqual(['Kitchen', 'Kitchen', 'Kitchen', 'Kitchen', 'Bathroom', 'Bathroom']);
  });

  it('joins a description that wrapped onto the next line', () => {
    expect(result.items[4].description).toBe('Tear out wet non-salvageable carpet, cut & bag for disposal');
    expect(result.items[4].quantity).toBe(40);
  });

  it('keeps notes printed under an item', () => {
    expect(result.items[5].note).toBe('Includes: supply line and wax ring.');
  });

  it('reads remove/replace columns', () => {
    const text = [
      'DESCRIPTION   QTY   REMOVE   REPLACE   TAX   O&P   TOTAL',
      '1. R&R Carpet pad   144.00 SF   0.12   0.68   3.10   23.66   141.96',
    ].join('\n');
    const [pad] = parseXactimatePaste(text).items;
    expect(pad.remove).toBe(0.12);
    expect(pad.replace).toBe(0.68);
    expect(pad.unitPrice).toBe(0.8);
    expect(pad.warnings).toEqual([]);
  });

  it('reads a few lines selected without any headings', () => {
    const text = [
      'Drywall installer / finisher - per hour   4.00 HR   78.50   314.00',
      'Air mover (per 24 hour period) - No monitoring   9.00 EA   28.67   258.03',
    ].join('\n');
    const r = parseXactimatePaste(text);
    expect(r.items).toHaveLength(2);
    expect(r.items[1].description).toBe('Air mover (per 24 hour period) - No monitoring');
    expect(r.items[1].unitPrice).toBe(28.67);
    expect(r.rooms).toEqual([]);
  });

  it('reads depreciation age/life columns without taking them as prices', () => {
    const text = '7. Interior door unit   1.00 EA   312.45   18.20   66.13   396.78   10/30 yrs   Avg.   33.33%   (132.26)   264.52';
    const [door] = parseXactimatePaste(text).items;
    expect(door.unitPrice).toBe(312.45);
    expect(door.xactimateTotal).toBe(396.78);
    expect(door.warnings).toEqual([]);
  });
});

describe('parseXactimatePaste - grid copy', () => {
  it('maps tab-separated cells by the header row', () => {
    const text = [
      ['#', 'Cat', 'Sel', 'Act', 'Description', 'Qty', 'Unit', 'Remove', 'Replace', 'Tax', 'O&P', 'Total'].join('\t'),
      ['1', 'DRY', '1/2', '&', 'Drywall - 1/2"', '128.00', 'SF', '0.52', '1.78', '5.10', '59.90', '359.40'].join('\t'),
      ['2', 'PNT', 'P', '+', 'Seal/prime then paint the walls (2 coats)', '389.33', 'SF', '0.00', '1.08', '4.21', '84.94', '509.63'].join('\t'),
    ].join('\n');
    const r = parseXactimatePaste(text);
    expect(r.format).toBe('grid');
    expect(r.items).toHaveLength(2);
    const [dry, pnt] = r.items;
    expect(dry.category).toBe('DRY');
    expect(dry.selector).toBe('1/2');
    expect(dry.description).toBe('R&R Drywall - 1/2"');
    expect(dry.unitPrice).toBeCloseTo(2.3);
    expect(dry.warnings).toEqual([]);
    expect(pnt.description).toBe('Seal/prime then paint the walls (2 coats)');
    expect(pnt.unitPrice).toBe(1.08);
  });

  it('takes a lone cell as the room for the rows below it', () => {
    const text = [
      'Description\tQty\tUnit\tUnit Price\tTotal',
      'Living Room',
      'Carpet pad\t200.00\tSF\t0.68\t136.00',
    ].join('\n');
    const r = parseXactimatePaste(text);
    expect(r.items[0].room).toBe('Living Room');
    expect(r.rooms).toEqual(['Living Room']);
  });

  it('reads rows copied without a header', () => {
    const text = [
      ['WTR', 'DRYM', 'Air mover (per 24 hour period) - No monitoring', '9.00', 'EA', '28.67', '258.03'].join('\t'),
      ['WTR', 'EQ', 'Equipment setup, take down, and monitoring (hourly charge)', '3.00 HR', '56.20', '168.60'].join('\t'),
    ].join('\n');
    const r = parseXactimatePaste(text);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ category: 'WTR', selector: 'DRYM', quantity: 9, unit: 'EA', unitPrice: 28.67 });
    expect(r.items[1]).toMatchObject({ category: 'WTR', selector: 'EQ', quantity: 3, unit: 'HR', unitPrice: 56.2 });
  });

  it('returns nothing for empty text', () => {
    expect(parseXactimatePaste('   \n ').format).toBe('empty');
  });
});
