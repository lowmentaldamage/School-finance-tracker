import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from './Feedback';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none ' +
  'transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-text text-bg hover:opacity-90',
  secondary: 'bg-surface border border-border text-text hover:bg-surface-2 shadow-sm',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-negative text-white hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = 'md', variant = 'ghost', ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn(size === 'sm' ? 'w-7 px-0!' : 'w-9 px-0!', className)}
      {...rest}
    />
  );
});
