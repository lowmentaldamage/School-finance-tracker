import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function StatTile({ label, value, sub, tone = 'neutral' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'positive' | 'negative' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-sm">
      <div className="truncate text-[12px] font-medium uppercase tracking-[0.04em] text-muted">{label}</div>
      <div
        className={cn(
          'tabular mt-1 truncate text-[21px] font-semibold tracking-[-0.01em]',
          tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-text',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}
