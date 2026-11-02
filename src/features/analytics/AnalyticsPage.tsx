import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useByCategory, useCashflow, useNetWorth, useSummary } from '../../api/hooks';
import type { CategoryTotal } from '../../api/types';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { CashflowChart, CategoryBars, StatTile, TrendChart } from '../../components/charts';
import { PeriodPicker, usePeriod } from '../../components/PeriodPicker';
import { Button, ErrorState, Icon, Page, PageHeader, Panel, Segmented, Skeleton } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { formatMonth } from '../../lib/period';

function YearComparison({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const y = new Date().getFullYear();
  const cur = useCashflow({ from: `${y}-01-01`, to: `${y}-12-31` });
  const prev = useCashflow({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31` });
  const [measure, setMeasure] = useState<'expense' | 'income' | 'net'>('expense');
  if (cur.isLoading || prev.isLoading) return <Skeleton className="m-4 h-[200px]" />;
  const pick = (m: { income_minor: number; expense_minor: number; net_minor: number }) =>
    measure === 'expense' ? m.expense_minor : measure === 'income' ? m.income_minor : m.net_minor;
  const rows = (cur.data ?? []).map((c, i) => ({ month: c.month, a: pick((prev.data ?? [])[i] ?? { income_minor: 0, expense_minor: 0, net_minor: 0 }), b: pick(c) }));
  const sumA = rows.reduce((s, r) => s + r.a, 0);
  const sumB = rows.reduce((s, r) => s + r.b, 0);
  const money = (v: number) => formatMoney(v, currency, { locale });
  const change = (a: number, b: number) => (a === 0 ? '—' : `${b - a >= 0 ? '+' : ''}${(((b - a) / Math.abs(a)) * 100).toFixed(0)}%`);
  return (
    <div className="p-4">
      <Segmented
        label={t('analytics.measure')}
        value={measure}
        onChange={setMeasure}
        options={[
          { value: 'expense', label: t('charts.expenses') },
          { value: 'income', label: t('charts.income') },
          { value: 'net', label: t('charts.net') },
        ]}
        className="mb-3"
      />
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[420px] text-left text-[13px]">
          <thead>
            <tr className="text-faint">
              <th className="py-1.5 font-medium">{t('charts.month')}</th>
              <th className="py-1.5 text-right font-medium">{y - 1}</th>
              <th className="py-1.5 text-right font-medium">{y}</th>
              <th className="py-1.5 text-right font-medium">{t('analytics.change')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-border">
                <td className="py-1.5 capitalize text-muted">{formatMonth(r.month, locale, 'short')}</td>
                <td className="py-1.5 text-right text-text">{money(r.a)}</td>
                <td className="py-1.5 text-right text-text">{money(r.b)}</td>
                <td className="py-1.5 text-right text-muted">{change(r.a, r.b)}</td>
              </tr>
            ))}
            <tr className="border-t border-border-strong font-semibold">
              <td className="py-1.5">{t('analytics.total')}</td>
              <td className="py-1.5 text-right">{money(sumA)}</td>
              <td className="py-1.5 text-right">{money(sumB)}</td>
              <td className="py-1.5 text-right text-muted">{change(sumA, sumB)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const period = usePeriod('last_12_months');
  const { range } = period;
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [parent, setParent] = useState<CategoryTotal | null>(null);

  const summary = useSummary(range);
  const cashflow = useCashflow(range);
  const cats = useByCategory(range, kind, parent?.category_id ?? null);
  const netWorth = useNetWorth(range);

  const money = (v: number) => formatMoney(v, base, { locale });
  const compact = (v: number) => formatMoney(v, base, { locale, compact: true });
  const months = cashflow.data?.length ?? 1;
  const s = summary.data;

  const savingsTrend = useMemo(
    () =>
      (cashflow.data ?? [])
        .filter((m) => m.income_minor > 0)
        .map((m) => ({
          key: m.month,
          label: formatMonth(m.month, locale, 'short'),
          title: formatMonth(m.month, locale),
          value: Math.round((m.net_minor / m.income_minor) * 1000) / 10,
        })),
    [cashflow.data, locale],
  );
  const nwTrend = useMemo(
    () => (netWorth.data ?? []).map((p) => ({ key: p.date, label: formatMonth(p.date.slice(0, 7), locale, 'short'), title: formatDate(p.date, locale), value: p.net_minor })),
    [netWorth.data, locale],
  );

  return (
    <Page>
      <PageHeader title={t('nav.analytics')} actions={<PeriodPicker value={period.key} range={range} onChange={(k, c) => { setParent(null); period.set(k, c); }} />} />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t('dashboard.income')} value={money(s?.income_minor ?? 0)} sub={t('analytics.avg_month', { amount: money(Math.round((s?.income_minor ?? 0) / months)) })} />
          <StatTile label={t('dashboard.expenses')} value={money(s?.expense_minor ?? 0)} sub={t('analytics.avg_month', { amount: money(Math.round((s?.expense_minor ?? 0) / months)) })} />
          <StatTile
            label={t('dashboard.net_savings')}
            value={formatMoney(s?.net_minor ?? 0, base, { locale, sign: 'exceptZero' })}
            tone={(s?.net_minor ?? 0) > 0 ? 'positive' : (s?.net_minor ?? 0) < 0 ? 'negative' : 'neutral'}
          />
          <StatTile label={t('analytics.savings_rate')} value={s?.savings_rate_bp == null ? '—' : `${(s.savings_rate_bp / 100).toFixed(1)}%`} sub={t('dashboard.tx_count', { count: s?.transaction_count ?? 0 })} />
        </div>

        <Panel title={t('dashboard.cashflow')}>
          <div className="p-4">
            {cashflow.isLoading ? <Skeleton className="h-[260px]" /> : cashflow.isError ? <ErrorState title={t('common.load_failed')} message={cashflow.error.message} /> : <CashflowChart data={cashflow.data ?? []} currency={base} height={260} />}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title={parent ? (parent.name ?? '') : kind === 'expense' ? t('dashboard.spending_by_category') : t('analytics.income_by_category')}
            actions={
              parent ? (
                <Button size="sm" variant="ghost" onClick={() => setParent(null)}>
                  <Icon name="chevronLeft" size={14} />
                  {t('analytics.all_categories')}
                </Button>
              ) : (
                <Segmented
                  label={t('analytics.kind')}
                  value={kind}
                  onChange={(k) => setKind(k)}
                  options={[
                    { value: 'expense', label: t('charts.expenses') },
                    { value: 'income', label: t('charts.income') },
                  ]}
                />
              )
            }
          >
            <div className="p-4">
              {cats.isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : (cats.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">{t('analytics.no_data')}</p>
              ) : (
                <CategoryBars data={cats.data ?? []} currency={base} limit={parent ? 12 : 8} onSelect={parent ? undefined : (c) => setParent(c)} />
              )}
            </div>
          </Panel>
          <Panel title={t('analytics.savings_rate_trend')}>
            <div className="p-4">
              {savingsTrend.length < 2 ? (
                <p className="py-10 text-center text-sm text-muted">{t('analytics.need_two_months')}</p>
              ) : (
                <TrendChart
                  data={savingsTrend}
                  format={(v) => `${v.toFixed(1)}%`}
                  formatAxis={(v) => `${v}%`}
                  valueLabel={t('analytics.savings_rate')}
                  ariaLabel={t('analytics.savings_rate_trend')}
                />
              )}
            </div>
          </Panel>
        </div>

        <Panel title={t('analytics.net_worth')}>
          <div className="p-4">
            {netWorth.isLoading ? (
              <Skeleton className="h-[220px]" />
            ) : nwTrend.length < 2 ? (
              <p className="py-10 text-center text-sm text-muted">{t('analytics.need_two_months')}</p>
            ) : (
              <TrendChart data={nwTrend} format={money} formatAxis={compact} valueLabel={t('analytics.net_worth')} ariaLabel={t('analytics.net_worth')} />
            )}
          </div>
        </Panel>

        <Panel title={t('analytics.year_comparison')}>
          <YearComparison currency={base} />
        </Panel>
      </div>
    </Page>
  );
}
