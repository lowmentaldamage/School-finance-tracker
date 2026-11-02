import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';

import type { MonthFlow } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { formatMoney } from '../../lib/money';
import { formatMonth } from '../../lib/period';
import { Legend, TooltipCard } from './ChartTooltip';

const INCOME = 'var(--chart-income)';
const EXPENSE = 'var(--chart-expense)';

/** Income vs expenses per month: paired columns on one axis. */
export function CashflowChart({ data, currency, height = 240 }: { data: MonthFlow[]; currency: string; height?: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const compact = (v: number) => formatMoney(v, currency, { locale, compact: true });
  const full = (v: number) => formatMoney(v, currency, { locale });
  const rows = data.map((d) => ({ ...d, label: formatMonth(d.month, locale, 'short') }));

  return (
    <figure className="flex flex-col gap-3">
      <Legend
        items={[
          { label: t('charts.income'), color: INCOME },
          { label: t('charts.expenses'), color: EXPENSE },
        ]}
      />
      <div style={{ height }} role="img" aria-label={t('charts.cashflow_aria')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <YAxis
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
              tickFormatter={(v: number) => compact(v)}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as MonthFlow & { label: string };
                return (
                  <TooltipCard
                    title={formatMonth(d.month, locale)}
                    rows={[
                      { label: t('charts.income'), value: full(d.income_minor), swatch: INCOME },
                      { label: t('charts.expenses'), value: full(d.expense_minor), swatch: EXPENSE },
                    ]}
                    footer={`${t('charts.net')}: ${formatMoney(d.net_minor, currency, { locale, sign: 'exceptZero' })}`}
                  />
                );
              }}
            />
            <Bar dataKey="income_minor" name={t('charts.income')} fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="expense_minor" name={t('charts.expenses')} fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">{t('charts.show_table')}</summary>
        <table className="tabular mt-2 w-full text-left">
          <thead>
            <tr className="text-faint">
              <th className="py-1 font-medium">{t('charts.month')}</th>
              <th className="py-1 text-right font-medium">{t('charts.income')}</th>
              <th className="py-1 text-right font-medium">{t('charts.expenses')}</th>
              <th className="py-1 text-right font-medium">{t('charts.net')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t border-border text-text">
                <td className="py-1">{formatMonth(d.month, locale)}</td>
                <td className="py-1 text-right">{full(d.income_minor)}</td>
                <td className="py-1 text-right">{full(d.expense_minor)}</td>
                <td className="py-1 text-right">{formatMoney(d.net_minor, currency, { locale, sign: 'exceptZero' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
