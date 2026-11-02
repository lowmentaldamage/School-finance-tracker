import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useLocale } from '../../app/preferences';
import { TooltipCard } from './ChartTooltip';

export interface TrendPoint {
  key: string;
  label: string;
  title: string;
  value: number;
}

/** Single-series trend (line + 10% wash). The surrounding title names the series. */
export function TrendChart({
  data,
  format,
  formatAxis,
  valueLabel,
  ariaLabel,
  height = 220,
}: {
  data: TrendPoint[];
  format: (v: number) => string;
  formatAxis: (v: number) => string;
  valueLabel: string;
  ariaLabel: string;
  height?: number;
}) {
  useLocale();
  const hasNegative = data.some((d) => d.value < 0);
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendWash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} minTickGap={12} />
          <YAxis width={60} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickFormatter={formatAxis} />
          {hasNegative && <ReferenceLine y={0} stroke="var(--border-strong)" />}
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as TrendPoint;
              return <TooltipCard title={d.title} rows={[{ label: valueLabel, value: format(d.value), swatch: 'var(--chart-line)' }]} />;
            }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke="var(--chart-line)"
            strokeWidth={2}
            fill="url(#trendWash)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--chart-line)', stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
