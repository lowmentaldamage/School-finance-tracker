import { describe, expect, it } from 'vitest';

import { activeFilterCount, DEFAULT_FILTERS, fromSearchParams, periodRange, toApiFilter, toSearchParams } from './filters';

describe('transaction filters', () => {
  it('round-trips through URL params, omitting defaults', () => {
    const s = { ...DEFAULT_FILTERS, q: 'rent', type: 'expense' as const, page: 2 };
    const sp = toSearchParams(s);
    expect(sp.toString()).toBe('q=rent&type=expense&page=2');
    expect(fromSearchParams(sp)).toEqual(s);
  });

  it('computes period ranges', () => {
    const now = new Date(2026, 2, 15);
    expect(periodRange('this_month', now)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodRange('last_month', now)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('last_3_months', now)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRange('last_month', new Date(2026, 0, 10))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('maps to the API filter', () => {
    const f = toApiFilter(
      { ...DEFAULT_FILTERS, category: 'none', min: '10', period: 'custom', from: '2026-01-01', page: 1 },
      (v) => Number(v) * 100,
      50,
    );
    expect(f).toEqual({ sort: 'date', dir: 'desc', limit: 50, offset: 50, uncategorized: true, min_amount_minor: 1000, from: '2026-01-01' });
  });

  it('counts active filters', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: 'x', account: 'a', type: 'income' })).toBe(2);
  });
});
