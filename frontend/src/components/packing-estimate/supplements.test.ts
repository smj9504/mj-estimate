import { describe, expect, it } from 'vitest';
import type { DetectedContentItem } from '../../types/packing-estimate';
import { supplementSignals, type SupplementRoom } from './supplements';

const tv = (fields: Partial<DetectedContentItem> = {}): DetectedContentItem => ({
  name: 'Flat Screen TV', category: 'Electronics', quantity: 1,
  is_fragile: true, is_high_value: true, needs_disassembly: false, ...fields,
});

const room = (fields: Partial<SupplementRoom> = {}): SupplementRoom => ({
  name: 'Bedroom', floor: '1st', density: 'normal', contamination: 'clean', items: [], ...fields,
});

describe('supplementSignals', () => {
  it('shows nothing for an ordinary job', () => {
    expect(Object.values(supplementSignals([room(), room({ name: 'Kitchen' })]))).toEqual([null, null, null, null]);
  });

  it('names the rooms that show what a supplement is for', () => {
    const signals = supplementSignals([
      room({ name: 'Kitchen', contamination: 'gray_water' }),
      room({ name: 'Attic Bedroom', floor: '3rd', density: 'extreme' }),
    ]);
    expect(signals.hidden_damage).toBe('Kitchen (gray water)');
    expect(signals.difficult_access).toBe('Attic Bedroom (3rd floor)');
    expect(signals.heavy_contents).toBe('Attic Bedroom (extreme contents)');
  });

  it('counts rooms that have no names', () => {
    const signals = supplementSignals([
      room({ name: undefined, contamination: 'gray_water' }),
      room({ name: undefined, contamination: 'black_water' }),
    ]);
    expect(signals.hidden_damage).toBe('2 rooms (gray water, black water)');
  });

  it('wants three high-value items, and only ones that count', () => {
    expect(supplementSignals([room({ items: [tv({ quantity: 2 })] })]).high_value_documentation).toBeNull();
    expect(supplementSignals([room({
      items: [tv({ quantity: 2 }), tv({ uncertain_fields: ['presence'] })],
    })]).high_value_documentation).toBeNull();
    expect(supplementSignals([room({ items: [tv({ quantity: 2 }), tv()] })]).high_value_documentation)
      .toBe('3 high-value items');
  });
});
