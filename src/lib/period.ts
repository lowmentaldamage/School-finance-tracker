import type { DateRange } from '../api/types';
import { endOfMonthISO, startOfMonthISO, todayISO, toISODate } from './dates';

export type PeriodKey = 'this_month' | 'last_month' | 'last_3_months' | 'last_6_months' | 'last_12_months' | 'this_year' | 'last_year' | 'custom';

export const PERIOD_KEYS: PeriodKey[] = [
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'last_12_months',
  'this_year',
  'last_year',
  'custom',
];

function monthsBack(n: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - n, 1);
}

export function periodToRange(p: PeriodKey, custom?: DateRange, now = new Date()): DateRange {
  switch (p) {
    case 'this_month':
      return { from: startOfMonthISO(now), to: endOfMonthISO(now) };
    case 'last_month': {
      const d = monthsBack(1, now);
      return { from: startOfMonthISO(d), to: endOfMonthISO(d) };
    }
    case 'last_3_months':
      return { from: startOfMonthISO(monthsBack(2, now)), to: endOfMonthISO(now) };
    case 'last_6_months':
      return { from: startOfMonthISO(monthsBack(5, now)), to: endOfMonthISO(now) };
    case 'last_12_months':
      return { from: startOfMonthISO(monthsBack(11, now)), to: endOfMonthISO(now) };
    case 'this_year':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: toISODate(new Date(now.getFullYear(), 11, 31)) };
    case 'last_year':
      return { from: toISODate(new Date(now.getFullYear() - 1, 0, 1)), to: toISODate(new Date(now.getFullYear() - 1, 11, 31)) };
    case 'custom':
      return custom && custom.from && custom.to && custom.from <= custom.to ? custom : { from: startOfMonthISO(now), to: todayISO() };
  }
}

/** The `n` whole months ending with the month that contains `isoDate`. */
export function trailingMonths(isoDate: string, n: number): DateRange {
  const [y, m] = isoDate.split('-').map(Number);
  const end = new Date(y!, m! - 1, 1);
  return { from: startOfMonthISO(new Date(end.getFullYear(), end.getMonth() - (n - 1), 1)), to: endOfMonthISO(end) };
}

export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y!, m! - 1 + delta, 1));
}

export function formatMonth(month: string, locale: string, style: 'short' | 'long' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' }).format(
    new Date(y!, m! - 1, 1),
  );
}
