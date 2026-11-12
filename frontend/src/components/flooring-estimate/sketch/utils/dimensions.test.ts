import { describe, expect, it } from 'vitest';
import { formatFeet, formatSf, parseFeet } from './dimensions';

describe('parseFeet', () => {
  it.each([
    [`12' 6"`, 12.5],
    [`12'6"`, 12.5],
    [`12'6`, 12.5],
    ['12 6', 12.5],
    ['12-6', 12.5],
    [`12' - 6"`, 12.5],
    [`12′ 6″`, 12.5],
    ['12.5', 12.5],
    [`12.5'`, 12.5],
    [`12'`, 12],
    ['12', 12],
    [`150"`, 12.5],
    [`6 1/2"`, 6.5 / 12],
    [`12' 6 1/2"`, 12 + 6.5 / 12],
    ['12 6 1/2', 12 + 6.5 / 12],
    [`12' 1/2"`, 12 + 0.5 / 12],
  ])('reads %s', (input, feet) => {
    expect(parseFeet(input)).toBeCloseTo(feet, 6);
  });

  it.each(['', '   ', 'abc', `12' 6" 3`, '1/0"', '-3'])('refuses %s', (input) => {
    expect(parseFeet(input)).toBeNull();
  });
});

describe('formatFeet', () => {
  it('shows feet and inches to the quarter inch', () => {
    expect(formatFeet(12.5)).toBe(`12' 6"`);
    expect(formatFeet(14.1667)).toBe(`14' 2"`);
    expect(formatFeet(12 + 6.5 / 12)).toBe(`12' 6 1/2"`);
    expect(formatFeet(0.25 / 12)).toBe(`0' 0 1/4"`);
    // 11' 11.99" rounds up to the next foot, not 11' 12"
    expect(formatFeet(11.9999)).toBe(`12' 0"`);
  });

  it('round-trips what it shows', () => {
    for (const ft of [3, 7.75, 12.5417, 29.375]) {
      expect(parseFeet(formatFeet(ft))).toBeCloseTo(ft, 2);
    }
  });
});

describe('formatSf', () => {
  it('prints two places with thousands', () => {
    expect(formatSf(1212.5)).toBe('1,212.50 SF');
  });
});
