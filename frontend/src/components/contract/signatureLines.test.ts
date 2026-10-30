import { describe, expect, it } from 'vitest';

import { canSignForCompany, initialsOf, lineLabel, requiredCustomerLines, slotOf } from './signatureLines';

const line = (fieldType: 'signature' | 'initial' | 'date_signed', signerRole: string) => ({ fieldType, signerRole });

describe('slotOf', () => {
  it('keeps one signer apart from another, and a signature apart from initials', () => {
    expect(slotOf(line('signature', 'homeowner'))).toBe(slotOf(line('signature', 'homeowner')));
    expect(slotOf(line('signature', 'homeowner'))).not.toBe(slotOf(line('signature', 'company_rep')));
    expect(slotOf(line('signature', 'homeowner'))).not.toBe(slotOf(line('initial', 'homeowner')));
  });
});

describe('lineLabel', () => {
  it('says whose line it is', () => {
    expect(lineLabel(line('signature', 'company_rep'))).toBe('Company rep signature');
    expect(lineLabel(line('initial', 'homeowner'))).toBe('Homeowner initials');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of each word', () => {
    expect(initialsOf('  sam   lee ')).toBe('SL');
    expect(initialsOf('')).toBe('');
  });
});

describe('requiredCustomerLines', () => {
  it("doesn't hold the customer up on someone else's line", () => {
    const lines = [line('signature', 'homeowner'), line('initial', 'homeowner'), line('signature', 'company_rep')];
    expect(requiredCustomerLines(lines)).toEqual(lines.slice(0, 2));
  });

  it('never asks for a date, which is not a mark', () => {
    expect(requiredCustomerLines([line('signature', 'homeowner'), line('date_signed', 'homeowner')]))
      .toEqual([line('signature', 'homeowner')]);
  });

  it('needs every line when none is marked as the customer\'s', () => {
    const lines = [line('signature', 'company_rep'), line('date_signed', 'company_rep')];
    expect(requiredCustomerLines(lines)).toEqual(lines.slice(0, 1));
  });
});

describe('canSignForCompany', () => {
  it('is for the issuing company only, or someone across all of them', () => {
    expect(canSignForCompany({ role: 'staff', company_ids: ['a'] }, 'a')).toBe(true);
    expect(canSignForCompany({ role: 'staff', company_ids: ['b'] }, 'a')).toBe(false);
    expect(canSignForCompany({ role: 'staff', all_companies: true }, 'a')).toBe(true);
    expect(canSignForCompany({ role: 'admin' }, 'a')).toBe(true);
    expect(canSignForCompany({ role: 'staff' }, 'a')).toBe(false);
    expect(canSignForCompany(null, 'a')).toBe(false);
  });
});
