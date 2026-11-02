/**
 * Money helpers. Amounts are integer minor units end to end.
 * Parsing never goes through floating point.
 */

export const MAX_AMOUNT_MINOR = 10_000_000_000_000;

const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, KWD: 3 };

export function currencyExponent(code: string): number {
  return EXPONENTS[code] ?? 2;
}

const GROUP_CHARS = /[\s  '’]/g;

/**
 * Parse user input into minor units. Accepts both "." and "," as decimal separator:
 * the last separator followed by 1..exp digits at the end is the decimal point; every
 * other separator is a group separator. Returns null for invalid input.
 *
 * parseAmount("1.234,56", 2) === 123456; parseAmount("1,5", 2) === 150; parseAmount("1,234", 2) === 123400
 */
export function parseAmount(input: string, exp: number): number | null {
  let s = input.trim().replace(GROUP_CHARS, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

  let intPart = s;
  let fracPart = '';
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep >= 0) {
    const tail = s.slice(lastSep + 1);
    if (exp > 0 && tail.length >= 1 && tail.length <= exp && /^\d+$/.test(tail)) {
      intPart = s.slice(0, lastSep);
      fracPart = tail;
    } else if (tail.length !== 3) {
      return null; // a separator that is neither decimal nor a valid thousands group
    }
  }
  // Remaining separators must be grouping between 3-digit groups.
  const groups = intPart.split(/[.,]/);
  if (groups.length > 1) {
    if (groups[0] === '' || groups[0]!.length > 3 || groups.slice(1).some((g) => g.length !== 3)) return null;
  }
  const digits = groups.join('');
  if (digits === '' && fracPart === '') return null;
  if (!/^\d*$/.test(digits)) return null;

  const minorStr = (digits === '' ? '0' : digits) + fracPart.padEnd(exp, '0');
  const trimmed = minorStr.replace(/^0+(?=\d)/, '');
  if (trimmed.length > 16) return null;
  const minor = Number(trimmed);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Render minor units as a plain decimal string suitable for an input field, e.g. 1234.5 -> "1234.50". */
export function minorToInput(minor: number, exp: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor).toString().padStart(exp + 1, '0');
  const int = exp === 0 ? abs : abs.slice(0, -exp);
  const frac = exp === 0 ? '' : '.' + abs.slice(-exp);
  return (neg ? '-' : '') + int + frac;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, signDisplay: 'auto' | 'always' | 'exceptZero', compact: boolean) {
  const key = `${locale}|${currency}|${signDisplay}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    const exp = currencyExponent(currency);
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      signDisplay,
      currencyDisplay: 'narrowSymbol',
      ...(compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : { minimumFractionDigits: exp, maximumFractionDigits: exp }),
    });
    formatters.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  locale?: string;
  sign?: 'auto' | 'always' | 'exceptZero';
  compact?: boolean;
}

/**
 * Format minor units for display. Converting to a JS number is display-only; amounts are
 * bounded by MAX_AMOUNT_MINOR so the value is exact at the displayed precision.
 */
export function formatMoney(minor: number, currency: string, opts: FormatOptions = {}): string {
  const exp = currencyExponent(currency);
  const value = minor / 10 ** exp;
  return formatter(opts.locale ?? defaultLocale(), currency, opts.sign ?? 'auto', opts.compact ?? false).format(value);
}

export function defaultLocale(): string {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-IE';
}

/** Like parseAmount, but accepts a leading minus sign. */
export function parseSignedAmount(input: string, exp: number): number | null {
  const s = input.trim();
  const neg = s.startsWith('-') || s.startsWith('−');
  const v = parseAmount(neg ? s.slice(1) : s, exp);
  if (v === null) return null;
  return neg ? -v : v;
}
