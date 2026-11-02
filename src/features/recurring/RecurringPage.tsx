import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRecurring, useUpcoming } from '../../api/hooks';
import type { RecurringRule } from '../../api/types';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { StatTile } from '../../components/charts';
import { Amount, Badge, Button, EmptyState, ErrorState, Icon, LoadingRows, Page, PageHeader, Panel } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { OccurrenceRow } from './OccurrenceRow';
import { RecurringForm } from './RecurringForm';

export function RecurringPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const rules = useRecurring();
  const upcoming = useUpcoming(30);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const open = (r: RecurringRule | null) => {
    setEditing(r);
    setFormOpen(true);
  };

  const items = upcoming.data?.items ?? [];
  const due = items.filter((o) => o.due);
  const next = items.filter((o) => !o.due);
  const freq = (r: RecurringRule) => t(`recurring.freq_${r.freq_unit}`, { count: r.freq_interval });

  return (
    <Page>
      <PageHeader
        title={t('nav.recurring')}
        actions={
          <Button variant="primary" onClick={() => open(null)}>
            <Icon name="plus" />
            {t('recurring.new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        {rules.isLoading ? (
          <Panel>
            <LoadingRows label={t('common.loading')} rows={4} />
          </Panel>
        ) : rules.isError ? (
          <Panel>
            <ErrorState title={t('common.load_failed')} message={rules.error.message} />
          </Panel>
        ) : (rules.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              title={t('recurring.empty_title')}
              body={t('recurring.empty_body')}
              action={
                <Button variant="primary" onClick={() => open(null)}>
                  {t('recurring.new')}
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatTile label={t('recurring.due_now')} value={String(upcoming.data?.due_count ?? 0)} sub={t('recurring.due_hint')} />
              <StatTile label={t('recurring.next_30_out')} value={formatMoney(upcoming.data?.expense_minor ?? 0, base, { locale })} />
              <StatTile label={t('recurring.next_30_in')} value={formatMoney(upcoming.data?.income_minor ?? 0, base, { locale })} />
            </div>

            {due.length > 0 && (
              <Panel title={t('recurring.due_now')}>
                <ul className="divide-y divide-border">
                  {due.map((o) => (
                    <OccurrenceRow key={`${o.rule_id}-${o.date}`} o={o} />
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title={t('recurring.next_30')}>
              {next.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">{t('recurring.nothing_upcoming')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {next.map((o) => (
                    <OccurrenceRow key={`${o.rule_id}-${o.date}`} o={o} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('recurring.all')}>
              <ul className="divide-y divide-border">
                {(rules.data ?? []).map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => open(r)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60', !r.active && 'opacity-60')}>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.category_color ?? 'var(--text-faint)' }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-text">
                            {r.type === 'transfer' ? t('transactions.transfer_title', { from: r.account_name, to: r.to_account_name ?? '' }) : r.payee || r.description}
                          </span>
                          {!r.active && <Badge>{t('recurring.paused')}</Badge>}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {freq(r)} ·{' '}
                          {r.next_due_date ? t('recurring.next_on', { date: formatDate(r.next_due_date, locale) }) : t('recurring.finished')}
                          {r.type !== 'transfer' && ` · ${r.category_name ?? t('transactions.uncategorized')}`}
                        </span>
                      </span>
                      <Amount minor={r.amount_minor} currency={r.currency} type={r.type} className="text-sm font-medium" />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </div>
      <RecurringForm open={formOpen} onOpenChange={setFormOpen} rule={editing} />
    </Page>
  );
}
