import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  useAccounts,
  useBalances,
  useBudgetMonth,
  useByCategory,
  useCashflow,
  useSummary,
  useTransactions,
  useUpcoming,
} from '../../api/hooks';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { CashflowChart, CategoryBars, Meter, StatTile } from '../../components/charts';
import { PeriodPicker, usePeriod } from '../../components/PeriodPicker';
import { Amount, Badge, Button, EmptyState, ErrorState, Icon, Page, PageHeader, Panel, Skeleton } from '../../components/ui';
import { dayLabel } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { monthKey, trailingMonths } from '../../lib/period';
import { useQuickAdd } from '../transactions/QuickAdd';
import { OccurrenceRow } from '../recurring/OccurrenceRow';

function pct(bp: number | null): string {
  return bp === null ? '—' : `${(bp / 100).toFixed(1)}%`;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const quickAdd = useQuickAdd();
  const period = usePeriod('this_month');
  const { range } = period;

  const accounts = useAccounts(false);
  const balances = useBalances();
  const summary = useSummary(range);
  const cashflow = useCashflow(trailingMonths(range.to, 6));
  const cats = useByCategory(range, 'expense');
  const budgets = useBudgetMonth(monthKey());
  const upcoming = useUpcoming(30);
  const recent = useTransactions({ limit: 6, sort: 'date', dir: 'desc' });

  const money = (v: number) => formatMoney(v, base, { locale });
  const missing = [...new Set([...(balances.data?.missing_rates ?? []), ...(summary.data?.missing_rates ?? [])])];

  if (accounts.isSuccess && accounts.data.length === 0) {
    return (
      <Page>
        <PageHeader title={t('nav.overview')} />
        <div className="px-4 md:px-8">
          <Panel>
            <EmptyState
              title={t('dashboard.no_accounts_title')}
              body={t('dashboard.no_accounts_body')}
              action={
                <Link to="/accounts">
                  <Button variant="primary">{t('accounts.new')}</Button>
                </Link>
              }
            />
          </Panel>
        </div>
      </Page>
    );
  }

  const s = summary.data;
  const lines = budgets.data?.lines ?? [];
  const topBudgets = [...lines].sort((a, b) => b.used_bp - a.used_bp).slice(0, 5);

  return (
    <Page>
      <PageHeader title={t('nav.overview')} actions={<PeriodPicker value={period.key} range={range} onChange={period.set} />} />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        {missing.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning">
            <Icon name="alert" />
            {t('dashboard.missing_rates', { currencies: missing.join(', ') })}
            <Link to="/settings#rates" className="font-medium underline underline-offset-2">
              {t('dashboard.add_rates')}
            </Link>
          </div>
        )}

        <section aria-label={t('dashboard.key_figures')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {balances.isLoading || summary.isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
          ) : (
            <>
              <StatTile
                label={t('dashboard.total_balance')}
                value={money(balances.data?.net_minor ?? 0)}
                tone={(balances.data?.net_minor ?? 0) < 0 ? 'negative' : 'neutral'}
                sub={balances.data && balances.data.liabilities_minor > 0 ? t('dashboard.after_debts', { amount: money(balances.data.liabilities_minor) }) : t('dashboard.all_accounts')}
              />
              <StatTile label={t('dashboard.income')} value={money(s?.income_minor ?? 0)} sub={t(`period.${period.key}`)} />
              <StatTile label={t('dashboard.expenses')} value={money(s?.expense_minor ?? 0)} sub={t('dashboard.tx_count', { count: s?.transaction_count ?? 0 })} />
              <StatTile
                label={t('dashboard.net_savings')}
                value={formatMoney(s?.net_minor ?? 0, base, { locale, sign: 'exceptZero' })}
                tone={(s?.net_minor ?? 0) > 0 ? 'positive' : (s?.net_minor ?? 0) < 0 ? 'negative' : 'neutral'}
                sub={t('dashboard.savings_rate', { rate: pct(s?.savings_rate_bp ?? null) })}
              />
            </>
          )}
        </section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <Panel title={t('dashboard.cashflow')} className="lg:col-span-3">
            <div className="p-4">
              {cashflow.isLoading ? (
                <Skeleton className="h-[260px]" />
              ) : cashflow.isError ? (
                <ErrorState title={t('common.load_failed')} message={cashflow.error.message} />
              ) : (
                <CashflowChart data={cashflow.data ?? []} currency={base} />
              )}
            </div>
          </Panel>
          <Panel
            title={t('dashboard.spending_by_category')}
            className="lg:col-span-2"
            actions={
              <Link to={`/analytics?p=${period.key}${period.key === 'custom' ? `&from=${range.from}&to=${range.to}` : ''}`} className="text-[12.5px] text-muted hover:text-text">
                {t('dashboard.details')}
              </Link>
            }
          >
            <div className="p-4">
              {cats.isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : (cats.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">{t('dashboard.no_spending')}</p>
              ) : (
                <CategoryBars data={cats.data ?? []} currency={base} />
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title={t('dashboard.budgets_this_month')}
            actions={
              <Link to="/budgets" className="text-[12.5px] text-muted hover:text-text">
                {t('dashboard.manage')}
              </Link>
            }
          >
            {budgets.isLoading ? (
              <Skeleton className="m-4 h-[140px]" />
            ) : topBudgets.length === 0 && !budgets.data?.overall ? (
              <EmptyState
                className="py-8"
                title={t('dashboard.no_budgets')}
                body={t('dashboard.no_budgets_body')}
                action={
                  <Link to="/budgets">
                    <Button size="sm">{t('budgets.add')}</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="flex flex-col gap-4 p-4">
                {[...(budgets.data?.overall ? [budgets.data.overall] : []), ...topBudgets].map((l) => (
                  <li key={l.category_id ?? 'overall'}>
                    <div className="mb-1.5 flex items-baseline gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate font-medium text-text">{l.name ?? t('budgets.overall')}</span>
                      {l.status !== 'ok' && <Badge tone={l.status === 'over' ? 'negative' : 'warning'}>{t(`budgets.status_${l.status}`)}</Badge>}
                      <span className="tabular text-muted">
                        {money(l.spent_minor)} / {money(l.available_minor)}
                      </span>
                    </div>
                    <Meter valueBp={l.used_bp} status={l.status} label={l.name ?? t('budgets.overall')} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t('dashboard.upcoming')}
            actions={
              <Link to="/recurring" className="text-[12.5px] text-muted hover:text-text">
                {t('dashboard.manage')}
              </Link>
            }
          >
            {upcoming.isLoading ? (
              <Skeleton className="m-4 h-[140px]" />
            ) : (upcoming.data?.items ?? []).length === 0 ? (
              <EmptyState
                className="py-8"
                title={t('dashboard.no_upcoming')}
                body={t('dashboard.no_upcoming_body')}
                action={
                  <Link to="/recurring">
                    <Button size="sm">{t('recurring.new')}</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {(upcoming.data?.items ?? []).slice(0, 5).map((o) => (
                  <OccurrenceRow key={`${o.rule_id}-${o.date}`} o={o} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          title={t('dashboard.recent')}
          actions={
            <Link to="/transactions" className="text-[12.5px] text-muted hover:text-text">
              {t('dashboard.view_all')}
            </Link>
          }
        >
          {recent.isLoading ? (
            <Skeleton className="m-4 h-[160px]" />
          ) : (recent.data?.items ?? []).length === 0 ? (
            <EmptyState
              className="py-8"
              title={t('transactions.empty_title')}
              body={t('transactions.empty_body')}
              action={
                <Button variant="primary" size="sm" onClick={() => quickAdd.open()}>
                  {t('transactions.add')}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {(recent.data?.items ?? []).map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: tx.type === 'transfer' ? 'var(--text-faint)' : tx.category_color ?? 'var(--text-faint)' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">
                      {tx.type === 'transfer'
                        ? t('transactions.transfer_title', { from: tx.account_name, to: tx.to_account_name ?? '' })
                        : tx.payee || tx.description || tx.category_name || t('transactions.uncategorized')}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {dayLabel(tx.date, locale, { today: t('dates.today'), yesterday: t('dates.yesterday') })} · {tx.type === 'transfer' ? t('tx_type.transfer') : tx.category_name ?? t('transactions.uncategorized')}
                    </span>
                  </span>
                  <Amount minor={tx.amount_minor} currency={tx.currency} type={tx.type} className="text-sm font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Page>
  );
}
