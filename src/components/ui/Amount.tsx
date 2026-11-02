import type { TxType } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/money';

/**
 * Displays an amount. Direction is shown by sign *and* colour, never colour alone.
 * For transactions pass `type`; for balances pass a signed value with `signed`.
 */
export function Amount({
  minor,
  currency,
  type,
  signed,
  className,
  muted,
}: {
  minor: number;
  currency: string;
  type?: TxType;
  signed?: boolean;
  className?: string;
  muted?: boolean;
}) {
  const locale = useLocale();
  let value = minor;
  let tone = 'text-text';
  let sign: 'auto' | 'always' | 'exceptZero' = 'auto';
  if (type === 'income') {
    tone = 'text-positive';
    sign = 'always';
  } else if (type === 'expense') {
    value = -Math.abs(minor);
    sign = 'always';
  } else if (type === 'transfer') {
    tone = 'text-muted';
  } else if (signed) {
    tone = minor < 0 ? 'text-negative' : 'text-text';
  }
  if (muted) tone = 'text-muted';
  return <span className={cn('tabular whitespace-nowrap', tone, className)}>{formatMoney(value, currency, { locale, sign })}</span>;
}
