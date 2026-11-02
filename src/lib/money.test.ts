import { describe, expect, it } from 'vitest';

import { formatMoney, minorToInput, parseAmount } from './money';

describe('parseAmount', () => {
  it.each([
    ['12', 2, 1200],
    ['12.5', 2, 1250],
    ['12,5', 2, 1250],
    ['12.34', 2, 1234],
    ['0,01', 2, 1],
    ['.5', 2, 50],
    ['1,234', 2, 123400],
    ['12.345', 2, 1234500], // three digits after the last separator = thousands group
    ['1.234', 2, 123400],
    ['1.234,56', 2, 123456],
    ['1,234.56', 2, 123456],
    ['1 234,56', 2, 123456],
    ["1'234.56", 2, 123456],
    ['1234567.89', 2, 123456789],
    ['+5', 2, 500],
    ['1000', 0, 1000],
    ['1.000', 0, 1000],
    ['1.5', 3, 1500],
    ['0.001', 3, 1],
  ])('parses %s (exp %i) as %i', (input, exp, expected) => {
    expect(parseAmount(input, exp)).toBe(expected);
  });

  it.each([[''], ['abc'], ['-5'], ['1.2.3'], ['1,23,456'], ['1.5e3'], ['12,'], ['1.5'], ['99999999999999999']])(
    'rejects %s',
    (input) => {
      const exp = input === '1.5' ? 0 : 2;
      expect(parseAmount(input, exp)).toBeNull();
    },
  );

  it('avoids floating point error', () => {
    expect(parseAmount('0.29', 2)).toBe(29);
    expect(parseAmount('1.15', 2)).toBe(115);
    expect(parseAmount('4.35', 2)).toBe(435);
  });
});

describe('minorToInput', () => {
  it('formats minor units as plain decimals', () => {
    expect(minorToInput(123456, 2)).toBe('1234.56');
    expect(minorToInput(5, 2)).toBe('0.05');
    expect(minorToInput(-150, 2)).toBe('-1.50');
    expect(minorToInput(1000, 0)).toBe('1000');
    expect(minorToInput(1, 3)).toBe('0.001');
  });
});

describe('formatMoney', () => {
  it('formats with currency precision', () => {
    expect(formatMoney(123456, 'EUR', { locale: 'en-IE' })).toBe('€1,234.56');
    expect(formatMoney(123456, 'EUR', { locale: 'de-DE' })).toBe('1.234,56 €');
    expect(formatMoney(1000, 'JPY', { locale: 'en-US' })).toBe('¥1,000');
    expect(formatMoney(-500, 'EUR', { locale: 'en-IE' })).toBe('-€5.00');
    expect(formatMoney(500, 'EUR', { locale: 'en-IE', sign: 'always' })).toBe('+€5.00');
  });
});
