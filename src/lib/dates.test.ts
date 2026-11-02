import { describe, expect, it } from 'vitest';

import { endOfMonthISO, parseISODate, startOfMonthISO, toISODate } from './dates';

describe('dates', () => {
  it('round-trips ISO dates without time zone shifts', () => {
    expect(toISODate(parseISODate('2026-03-29'))).toBe('2026-03-29');
    expect(toISODate(parseISODate('2026-10-25'))).toBe('2026-10-25');
  });
  it('computes month bounds', () => {
    expect(startOfMonthISO(new Date(2024, 1, 15))).toBe('2024-02-01');
    expect(endOfMonthISO(new Date(2024, 1, 15))).toBe('2024-02-29');
  });
});
