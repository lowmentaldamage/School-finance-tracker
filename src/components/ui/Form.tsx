import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { Icon } from './Icon';

const control =
  'w-full rounded-md border border-border bg-surface text-text placeholder:text-faint ' +
  'transition-colors duration-100 hover:border-border-strong ' +
  'focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-60 aria-[invalid=true]:border-negative';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-9 px-3 text-sm', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 px-3 py-2 text-sm', className)} {...rest} />;
});

/** Native select: accessible, and uses the platform picker on Android. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, 'h-9 appearance-none pl-3 pr-8 text-sm', className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
    </div>
  );
});

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
  optional?: string | undefined;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + hint/error, with ids wired for screen readers. */
export function Field({ label, error, hint, className, optional, children }: FieldProps) {
  const id = useId();
  const descId = `${id}-desc`;
  const describe = error || hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
        {optional && <span className="ml-1 font-normal text-faint">{optional}</span>}
      </label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(describe ? { 'aria-describedby': descId } : {}),
      })}
      {error ? (
        <p id={descId} className="text-[12px] text-negative" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
      <input type="checkbox" className="size-4 rounded-sm border-border accent-[var(--accent)]" {...rest} />
      {label}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  className?: string;
}

/** Single-choice control rendered as a radio group. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 flex-1 rounded-[5px] px-3 text-[13px] font-medium transition-colors duration-100',
              active ? 'bg-raised text-text shadow-sm' : 'text-muted hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
