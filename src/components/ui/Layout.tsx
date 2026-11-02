import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em] text-text">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1180px] pb-24 md:pb-10">{children}</div>;
}

export function Panel({ children, className, title, actions }: { children: ReactNode; className?: string; title?: string; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          {title && <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
