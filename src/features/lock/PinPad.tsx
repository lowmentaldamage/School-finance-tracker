import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn';

export const PIN_LENGTH = 8;

/** Eight-dot PIN entry with an on-screen keypad. Physical keyboards work too. */
export function PinPad({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();

  const press = (d: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    const next = value + d;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  };
  const back = () => !disabled && onChange(value.slice(0, -1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col items-center gap-7">
      <div className="flex gap-3" role="status" aria-label={t('lock.digits_entered', { count: value.length, total: PIN_LENGTH })}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={cn('size-3 rounded-full border transition-colors duration-100', i < value.length ? 'border-text bg-text' : 'border-border-strong')} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={d} onClick={() => press(d)} disabled={disabled} />
        ))}
        <span />
        <Key label="0" onClick={() => press('0')} disabled={disabled} />
        <button
          type="button"
          onClick={back}
          disabled={disabled || value.length === 0}
          aria-label={t('lock.delete_digit')}
          className="flex size-[68px] items-center justify-center rounded-full text-[13px] text-muted disabled:opacity-30"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

function Key({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tabular flex size-[68px] items-center justify-center rounded-full bg-surface text-[24px] font-medium text-text shadow-sm transition-colors duration-100 active:bg-surface-3 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
