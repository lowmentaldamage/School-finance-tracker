import type { TransactionFilter, TxType, PaymentMethod, SortKey, SortDir } from '../../api/types';
import { endOfMonthISO, startOfMonthISO, toISODate } from '../../lib/dates';

export type Period = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';

export interface FilterState {
  q: string;
  period: Period;
  from: string;
  to: string;
  account: string;
  type: '' | TxType;
  category: string; // id, '' (any) or 'none' (uncategorized)
  tag: string;
  min: string;
  max: string;
  method: '' | PaymentMethod;
  sort: SortKey;
  dir: SortDir;
  page: number;
}

export const DEFAULT_FILTERS: FilterState = {
  q: '',
  period: 'all',
  from: '',
  to: '',
  account: '',
  type: '',
  category: '',
  tag: '',
  min: '',
  max: '',
  method: '',
  sort: 'date',
  dir: 'desc',
  page: 0,
};

export function periodRange(p: Period, now = new Date()): { from?: string; to?: string } {
  switch (p) {
    case 'this_month':
      return { from: startOfMonthISO(now), to: endOfMonthISO(now) };
    case 'last_month': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: startOfMonthISO(d), to: endOfMonthISO(d) };
    }
    case 'last_3_months':
      return { from: startOfMonthISO(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: endOfMonthISO(now) };
    case 'this_year':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: toISODate(new Date(now.getFullYear(), 11, 31)) };
    default:
      return {};
  }
}

const KEYS = Object.keys(DEFAULT_FILTERS) as Array<keyof FilterState>;

export function fromSearchParams(sp: URLSearchParams): FilterState {
  const s: FilterState = { ...DEFAULT_FILTERS };
  for (const k of KEYS) {
    const v = sp.get(k === 'account' ? 'account' : k);
    if (v === null) continue;
    if (k === 'page') s.page = Math.max(0, Number.parseInt(v, 10) || 0);
    else (s as unknown as Record<string, string>)[k] = v;
  }
  return s;
}

export function toSearchParams(s: FilterState): URLSearchParams {
  const sp = new URLSearchParams();
  for (const k of KEYS) {
    const v = s[k];
    if (v !== DEFAULT_FILTERS[k] && v !== '') sp.set(k, String(v));
  }
  return sp;
}

/** Number of non-default filters, excluding search, sort and paging. */
export function activeFilterCount(s: FilterState): number {
  return (['period', 'account', 'type', 'category', 'tag', 'min', 'max', 'method'] as const).filter(
    (k) => s[k] !== DEFAULT_FILTERS[k],
  ).length;
}

export function toApiFilter(
  s: FilterState,
  parse: (v: string) => number | null,
  pageSize: number,
): TransactionFilter {
  const f: TransactionFilter = { sort: s.sort, dir: s.dir, limit: pageSize, offset: s.page * pageSize };
  if (s.q.trim()) f.search = s.q.trim();
  const range = s.period === 'custom' ? { from: s.from || undefined, to: s.to || undefined } : periodRange(s.period);
  if (range.from) f.from = range.from;
  if (range.to) f.to = range.to;
  if (s.account) f.account_id = s.account;
  if (s.type) f.types = [s.type];
  if (s.category === 'none') f.uncategorized = true;
  else if (s.category) f.category_ids = [s.category];
  if (s.tag) f.tag_ids = [s.tag];
  const min = s.min ? parse(s.min) : null;
  const max = s.max ? parse(s.max) : null;
  if (min !== null) f.min_amount_minor = min;
  if (max !== null) f.max_amount_minor = max;
  if (s.method) f.payment_method = s.method;
  return f;
}
