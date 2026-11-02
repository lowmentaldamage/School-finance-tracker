import { useTranslation } from 'react-i18next';

import type { CategoryTotal } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/money';

/**
 * Ranked horizontal bars. Identity is carried by the name text; the category colour marks the bar.
 * Long tails fold into "Other" after `limit` rows.
 */
export function CategoryBars({
  data,
  currency,
  limit = 6,
  onSelect,
}: {
  data: CategoryTotal[];
  currency: string;
  limit?: number;
  onSelect?: (c: CategoryTotal) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const total = data.reduce((s, d) => s + d.amount_minor, 0);
  const head = data.slice(0, limit);
  const tail = data.slice(limit);
  const rows = tail.length
    ? [
        ...head,
        {
          category_id: '__other__',
          name: t('charts.other_categories', { count: tail.length }),
          color: 'var(--text-faint)',
          amount_minor: tail.reduce((s, d) => s + d.amount_minor, 0),
          transaction_count: tail.reduce((s, d) => s + d.transaction_count, 0),
        },
      ]
    : head;
  const max = Math.max(1, ...rows.map((r) => r.amount_minor));

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const share = total > 0 ? Math.round((r.amount_minor / total) * 100) : 0;
        const clickable = onSelect && r.category_id && r.category_id !== '__other__';
        const content = (
          <>
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-text">{r.name ?? t('transactions.uncategorized')}</span>
              <span className="tabular text-faint">{share}%</span>
              <span className="tabular w-[96px] text-right font-medium text-text">{formatMoney(r.amount_minor, currency, { locale })}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-surface-2">
              <div
                className="h-2 rounded-full"
                style={{ width: `${Math.max(2, (r.amount_minor / max) * 100)}%`, background: r.color ?? 'var(--text-faint)' }}
              />
            </div>
          </>
        );
        return (
          <li key={r.category_id ?? 'none'}>
            {clickable ? (
              <button type="button" onClick={() => onSelect(r)} className={cn('w-full rounded-md text-left hover:opacity-80')} title={t('charts.drill_down')}>
                {content}
              </button>
            ) : (
              <div title={t('charts.tx_count', { count: r.transaction_count })}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
