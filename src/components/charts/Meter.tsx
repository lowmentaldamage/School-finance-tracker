import type { BudgetStatus } from '../../api/types';
import { cn } from '../../lib/cn';

/** Progress meter. Over 100% the bar is full and the status colour + label carry the overspend. */
export function Meter({ valueBp, status = 'ok', label, size = 'md' }: { valueBp: number; status?: BudgetStatus; label: string; size?: 'sm' | 'md' }) {
  const pct = Math.min(100, Math.max(0, valueBp / 100));
  const tone = status === 'over' ? 'bg-negative' : status === 'warning' ? 'bg-warning' : 'bg-text/80';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(valueBp / 100)}
      className={cn('w-full overflow-hidden rounded-full bg-surface-2', size === 'sm' ? 'h-1.5' : 'h-2')}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-200', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}
