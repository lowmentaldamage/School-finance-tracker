import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../api/client';
import { useSessionCall } from '../../api/hooks';
import type { AppStatus } from '../../api/types';
import { Button, Input } from '../../components/ui';
import { PinPad } from './PinPad';

/** Shown instead of the app while the database is locked. */
export function LockScreen({ status }: { status: AppStatus }) {
  const { t } = useTranslation();
  const lock = status.lock!;
  const unlock = useSessionCall<{ secret: string }>('session.unlock', { resetSession: true });
  const recover = useSessionCall<{ recovery_key: string }>('session.unlock_recovery', { resetSession: true });
  const bio = useSessionCall<Record<string, never>>('session.unlock_biometric', { resetSession: true });

  const [mode, setMode] = useState<'secret' | 'recovery'>('secret');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(lock.retry_after_secs);
  const bioTried = useRef(false);
  const canBio = lock.biometric && status.biometric_available;

  useEffect(() => {
    if (wait <= 0) return;
    const h = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearInterval(h);
  }, [wait > 0]);

  function handle(e: unknown) {
    setValue('');
    if (e instanceof ApiError) {
      if (e.code === 'throttled' || (e.code === 'wrong_secret' && (e.retryAfterSecs ?? 0) > 0)) setWait(e.retryAfterSecs ?? 30);
      setError(e.code === 'wrong_secret' ? t(mode === 'recovery' ? 'lock.wrong_recovery' : lock.kind === 'pin' ? 'lock.wrong_pin' : 'lock.wrong_password') : e.code === 'throttled' ? null : e.message);
    } else setError(String(e));
  }

  async function submit(secret: string) {
    setError(null);
    try {
      if (mode === 'recovery') await recover.mutateAsync({ recovery_key: secret });
      else await unlock.mutateAsync({ secret });
    } catch (e) {
      handle(e);
    }
  }

  async function biometric() {
    setError(null);
    try {
      await bio.mutateAsync({});
    } catch {
      setError(t('lock.biometric_failed'));
    }
  }

  useEffect(() => {
    if (canBio && !bioTried.current && wait === 0) {
      bioTried.current = true;
      void biometric();
    }
  }, []);

  const busy = unlock.isPending || recover.isPending || bio.isPending;
  const onForm = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) void submit(value);
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg px-6 py-10">
      <img src="/icon.svg" alt="" className="size-12 rounded-[12px]" />
      <h1 className="mt-5 text-[19px] font-semibold">{mode === 'recovery' ? t('lock.recovery_title') : t('lock.title')}</h1>
      <p className="mt-1 text-center text-sm text-muted">
        {mode === 'recovery' ? t('lock.recovery_body') : lock.kind === 'pin' ? t('lock.enter_pin') : t('lock.enter_password')}
      </p>
      <div className="mt-8 w-full max-w-[320px]">
        {mode === 'secret' && lock.kind === 'pin' ? (
          <PinPad value={value} onChange={setValue} onComplete={(v) => void submit(v)} disabled={busy || wait > 0} />
        ) : (
          <form onSubmit={onForm} className="flex flex-col gap-3">
            <Input
              type={mode === 'recovery' ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize={mode === 'recovery' ? 'characters' : 'off'}
              spellCheck={false}
              aria-label={mode === 'recovery' ? t('lock.recovery_key') : t('lock.password')}
              placeholder={mode === 'recovery' ? 'XXXX-XXXX-XXXX-…' : ''}
              className="h-11 text-center tracking-wide"
              disabled={busy || wait > 0}
            />
            <Button type="submit" variant="primary" loading={busy} disabled={wait > 0 || !value.trim()} className="h-11">
              {t('lock.unlock')}
            </Button>
          </form>
        )}
      </div>
      <div className="mt-6 min-h-[44px] text-center text-sm" aria-live="polite">
        {wait > 0 ? <p className="text-warning">{t('lock.wait', { seconds: wait })}</p> : error ? <p className="text-negative">{error}</p> : null}
      </div>
      <div className="mt-2 flex flex-col items-center gap-2">
        {canBio && mode === 'secret' && (
          <Button variant="secondary" onClick={() => void biometric()} disabled={busy}>
            {t('lock.use_biometric')}
          </Button>
        )}
        <button
          type="button"
          className="h-10 text-[13px] text-muted underline-offset-2 hover:text-text hover:underline"
          onClick={() => {
            setMode(mode === 'secret' ? 'recovery' : 'secret');
            setValue('');
            setError(null);
          }}
        >
          {mode === 'secret' ? t(lock.kind === 'pin' ? 'lock.forgot_pin' : 'lock.forgot_password') : t(lock.kind === 'pin' ? 'lock.back_to_pin' : 'lock.back_to_password')}
        </button>
      </div>
    </div>
  );
}
