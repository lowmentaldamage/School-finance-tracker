import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useBudgetHistory, useBudgetMonth } from '../../api/hooks';
import type { BudgetLine } from '../../api/types';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { Meter, StatTile } from '../../components/charts';
import { Badge, Button, EmptyState, ErrorState, Icon, IconButton, LoadingRows, Page, PageHeader, Panel } from '../../components/ui';
import { formatMoney } from '../../lib/money';
import { formatMonth, monthKey, shiftMonth } from '../../lib/period';
import { BudgetForm, type BudgetTarget } from './BudgetForm';

export function BudgetsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const [sp, setSp] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(sp.get('m') ?? '') ? sp.get('m')! : monthKey();
  const setMonth = (m: string) => setSp(m === monthKey() ? {} : { m }, { replace: true });

  const data = useBudgetMonth(month);
  const history = useBudgetHistory(month, 6);
  const [formOpen, setFormOpen] = useState(false);
  const [target, setTarget] = useState<BudgetTarget>({});
  const money = (v: number) => formatMoney(v, base, { locale });

  const open = (tg: BudgetTarget) => {
    setTarget(tg);
    setFormOpen(true);
  };

  const d = data.data;
  const remaining = (d?.total_available_minor ?? 0) - (d?.total_spent_minor ?? 0);
  const empty = d && d.lines.length === 0 && !d.overall;

  const lineRow = (l: BudgetLine) => (
    <li key={l.category_id ?? 'overall'}>
      <button type="button" onClick={() => open({ line: l, categoryId: l.category_id ?? 'overall' })} className="w-full px-4 py-3.5 text-left hover:bg-surface-2/60">
        <div className="flex items-center gap-2">
          {l.color && <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{l.name ?? t('budgets.overall')}</span>
          {l.status !== 'ok' && (
            <Badge tone={l.status === 'over' ? 'negative' : 'warning'}>
              {l.status === 'over' ? '⚠ ' : ''}
              {t(`budgets.status_${l.status}`)}
            </Badge>
          )}
          {l.rollover && <Badge>{t('budgets.rollover_badge')}</Badge>}
        </div>
        <div className="my-2">
          <Meter valueBp={l.used_bp} status={l.status} label={l.name ?? t('budgets.overall')} />
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 text-[12.5px] text-muted">
          <span className="tabular">
            {t('budgets.spent_of', { spent: money(l.spent_minor), available: money(l.available_minor) })}
            {l.carried_minor > 0 && ` · ${t('budgets.carried', { amount: money(l.carried_minor) })}`}
          </span>
          <span className={`tabular ${l.remaining_minor < 0 ? 'text-negative' : ''}`}>
            {l.remaining_minor >= 0 ? t('budgets.left', { amount: money(l.remaining_minor) }) : t('budgets.over_by', { amount: money(-l.remaining_minor) })}
          </span>
        </div>
      </button>
    </li>
  );

  return (
    <Page>
      <PageHeader
        title={t('nav.budgets')}
        actions={
          <Button variant="primary" onClick={() => open({})}>
            <Icon name="plus" />
            {t('budgets.add')}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        <div className="flex items-center gap-2">
          <IconButton label={t('budgets.prev_month')} variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="chevronLeft" />
          </IconButton>
          <h2 className="min-w-[150px] text-center text-[15px] font-semibold capitalize" aria-live="polite">
            {formatMonth(month, locale)}
          </h2>
          <IconButton label={t('budgets.next_month')} variant="secondary" onClick={() => setMonth(shiftMonth(month, 1))}>
            <Icon name="chevronRight" />
          </IconButton>
          {month !== monthKey() && (
            <Button size="sm" variant="ghost" onClick={() => setMonth(monthKey())}>
              {t('budgets.this_month')}
            </Button>
          )}
        </div>

        {data.isLoading ? (
          <Panel>
            <LoadingRows label={t('common.loading')} rows={4} />
          </Panel>
        ) : data.isError ? (
          <Panel>
            <ErrorState title={t('common.load_failed')} message={data.error.message} />
          </Panel>
        ) : empty ? (
          <Panel>
            <EmptyState
              title={t('budgets.empty_title')}
              body={t('budgets.empty_body')}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => open({})}>
                    {t('budgets.add')}
                  </Button>
                  <Button onClick={() => open({ categoryId: 'overall' })}>{t('budgets.set_overall')}</Button>
                </div>
              }
            />
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('budgets.budgeted')} value={money(d!.total_available_minor)} />
              <StatTile label={t('budgets.spent')} value={money(d!.total_spent_minor)} />
              <StatTile label={remaining >= 0 ? t('budgets.remaining') : t('budgets.overspent')} value={money(Math.abs(remaining))} tone={remaining < 0 ? 'negative' : 'neutral'} />
              <StatTile label={t('budgets.unbudgeted')} value={money(d!.unbudgeted_spent_minor)} sub={t('budgets.unbudgeted_hint')} />
            </div>

            {d!.overall ? (
              <Panel title={t('budgets.overall')}>
                <ul>{lineRow(d!.overall)}</ul>
              </Panel>
            ) : (
              <button type="button" onClick={() => open({ categoryId: 'overall' })} className="self-start text-[13px] text-muted underline-offset-2 hover:text-text hover:underline">
                {t('budgets.set_overall')}
              </button>
            )}

            {d!.lines.length > 0 && (
              <Panel title={t('budgets.by_category')}>
                <ul className="divide-y divide-border">{d!.lines.map(lineRow)}</ul>
              </Panel>
            )}
          </>
        )}

        {history.data && history.data.some((h) => h.budgeted_minor > 0) && (
          <Panel title={t('budgets.history')}>
            <ul className="flex flex-col gap-3 p-4">
              {history.data.map((h) => {
                const bp = h.budgeted_minor > 0 ? Math.round((h.spent_minor / h.budgeted_minor) * 10_000) : 0;
                const status = bp >= 10_000 ? 'over' : bp >= 8_000 ? 'warning' : 'ok';
                return (
                  <li key={h.month} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[12.5px]">
                    <button type="button" onClick={() => setMonth(h.month)} className="text-left capitalize text-muted hover:text-text">
                      {formatMonth(h.month, locale, 'short')} {h.month.slice(0, 4)}
                    </button>
                    {h.budgeted_minor > 0 ? <Meter valueBp={bp} status={status} label={h.month} size="sm" /> : <span className="text-faint">{t('budgets.no_budget')}</span>}
                    <span className="tabular text-right text-text">
                      {money(h.spent_minor)} <span className="text-faint">/ {money(h.budgeted_minor)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
      <BudgetForm
        open={formOpen}
        onOpenChange={setFormOpen}
        month={month}
        target={target}
        budgetedIds={(d?.lines ?? []).map((l) => l.category_id!).filter(Boolean)}
      />
    </Page>
  );
}
