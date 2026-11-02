/** Dates are calendar dates `YYYY-MM-DD` with no time zone. */

export function todayISO(): string {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function formatDate(iso: string, locale: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const key = `${locale}|${style}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: style });
    fmtCache.set(key, f);
  }
  return f.format(parseISODate(iso));
}

/** Human group label for a list header: Today, Yesterday, or a full date. */
export function dayLabel(iso: string, locale: string, labels: { today: string; yesterday: string }): string {
  const today = todayISO();
  if (iso === today) return labels.today;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISODate(y)) return labels.yesterday;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(
    parseISODate(iso),
  );
}

export function startOfMonthISO(d = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthISO(d = new Date()): string {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
