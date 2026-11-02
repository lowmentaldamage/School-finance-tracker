import type { ReactNode } from 'react';

export interface TooltipRow {
  label: string;
  value: string;
  swatch?: string;
}

/** Shared tooltip card: title plus rows of swatch / label / value. Text uses text tokens only. */
export function TooltipCard({ title, rows, footer }: { title: string; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="pointer-events-none min-w-[160px] rounded-md border border-border bg-surface px-3 py-2 text-[12.5px] shadow-md">
      <div className="mb-1 font-medium text-text">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          {r.swatch && <span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.swatch }} aria-hidden="true" />}
          <span className="text-muted">{r.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-text">{r.value}</span>
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-border pt-1 text-muted">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
