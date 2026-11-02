import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin text-current', className)}
      role="presentation"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden="true" />;
}

export function LoadingRows({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <p className="text-[15px] font-medium text-text">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <Icon name="alert" size={20} className="text-negative" />
      <p className="mt-3 text-[15px] font-medium text-text">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'warning' }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    positive: 'bg-positive-soft text-positive',
    negative: 'bg-negative-soft text-negative',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium', tones[tone])}>
      {children}
    </span>
  );
}
