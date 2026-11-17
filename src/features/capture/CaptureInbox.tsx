import { useTranslation } from 'react-i18next';

import { useCaptures, useDismissCaptures } from '../../api/hooks';
import type { Capture } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { Amount, Button, Panel } from '../../components/ui';
import { useQuickAdd } from '../transactions/QuickAdd';

function when(c: Capture, locale: string) {
  const d = new Date(c.posted_at);
  if (Number.isNaN(d.getTime())) return c.date;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Bank notifications waiting to be added. Hidden when there are none. */
export function CaptureInbox({ limit = 5 }: { limit?: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const captures = useCaptures();
  const dismiss = useDismissCaptures();
  const quickAdd = useQuickAdd();
  const items = captures.data ?? [];
  if (items.length === 0) return null;

  function add(c: Capture) {
    quickAdd.open({
      capture_id: c.id,
      type: c.type ?? 'expense',
      ...(c.account_id ? { account_id: c.account_id } : {}),
      ...(c.amount_minor ? { amount_minor: c.amount_minor } : {}),
      ...(c.currency ? { currency: c.currency } : {}),
      date: c.date,
      ...(c.payee ? { payee: c.payee } : {}),
      ...(c.category_id ? { category_id: c.category_id } : {}),
      ...(c.type === 'expense' ? { payment_method: 'card' as const } : {}),
    });
  }

  return (
    <Panel
      title={`${t('capture.inbox')} · ${t('capture.inbox_count', { count: items.length })}`}
      actions={
        items.length > 1 ? (
          <button type="button" className="text-[12.5px] text-muted hover:text-text" onClick={() => dismiss.mutate(items.map((c) => c.id))}>
            {t('capture.dismiss_all')}
          </button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border" aria-label={t('capture.inbox')}>
        {items.slice(0, limit).map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-text">{c.payee ?? (c.title || c.source_app)}</span>
                {c.amount_minor && c.currency ? (
                  <Amount minor={c.amount_minor} currency={c.currency} type={c.type ?? 'expense'} className="text-sm font-medium" />
                ) : (
                  <span className="text-[12px] text-muted">{t('capture.no_amount')}</span>
                )}
              </div>
              <p className="truncate text-[12px] text-muted" title={`${c.title}\n${c.body}`}>
                {c.source_app} · {when(c, locale)} · {c.body}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="primary" onClick={() => add(c)}>
                {t('capture.add')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss.mutate([c.id])} aria-label={`${t('capture.dismiss')}: ${c.payee ?? c.title}`}>
                {t('capture.dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {items.length > limit && <p className="border-t border-border px-4 py-2 text-[12px] text-muted">+{items.length - limit}</p>}
    </Panel>
  );
}
