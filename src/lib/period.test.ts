import { describe, expect, it } from 'vitest';

import { periodToRange, shiftMonth, trailingMonths } from './period';

describe('periods', () => {
  const now = new Date(2026, 10, 2);
  it('maps presets to ranges', () => {
    expect(periodToRange('this_month', undefined, now)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodToRange('last_6_months', undefined, now)).toEqual({ from: '2026-06-01', to: '2026-11-30' });
    expect(periodToRange('last_year', undefined, now)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodToRange('custom', { from: '2026-03-01', to: '2026-02-01' }, now).from).toBe('2026-11-01');
  });
  it('computes trailing months and shifts', () => {
    expect(trailingMonths('2026-02-15', 3)).toEqual({ from: '2025-12-01', to: '2026-02-28' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
