import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/** Centered dialog on desktop, bottom sheet on small screens. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: DialogProps) {
  const { t } = useTranslation();
  const widths = { sm: 'md:max-w-[400px]', md: 'md:max-w-[520px]', lg: 'md:max-w-[680px]' };
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)] data-[state=open]:animate-[fade-in_120ms_ease-out]" />
        <RD.Content
          className={cn(
            'fixed z-50 flex max-h-[92dvh] w-full flex-col border border-border bg-surface shadow-lg focus:outline-none',
            'inset-x-0 bottom-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]',
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[12vh] md:-translate-x-1/2 md:rounded-lg md:pb-0',
            widths[size],
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RD.Title className="text-[15px] font-semibold text-text">{title}</RD.Title>
              {description && <RD.Description className="mt-0.5 text-sm text-muted">{description}</RD.Description>}
            </div>
            <RD.Close asChild>
              <IconButton label={t('common.close')} size="sm" className="-mr-1.5 -mt-0.5">
                <Icon name="close" />
              </IconButton>
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  danger?: boolean;
  error?: string | null;
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, onConfirm, loading, danger = true, error }: ConfirmProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{body}</div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </Dialog>
  );
}
