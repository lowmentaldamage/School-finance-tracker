import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionCall } from '../../api/hooks';
import type { LockKind } from '../../api/types';
import { Button, Checkbox, Field, Input, Segmented } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { PIN_LENGTH } from './PinPad';

export function validSecret(kind: LockKind, s: string): boolean {
  return kind === 'pin' ? new RegExp(`^\\d{${PIN_LENGTH}}$`).test(s) : [...s].length >= 10 && [...s].length <= 128;
}

/** Recovery key display with an explicit acknowledgement. */
export function RecoveryKeyNotice({ recoveryKey, onDone, doneLabel }: { recoveryKey: string; onDone: () => void; doneLabel: string }) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('lock.recovery_explain')}</p>
      <div className="rounded-md border border-border-strong bg-surface-2 px-4 py-4 text-center">
        <code className="tabular select-all break-all font-mono text-[17px] font-semibold tracking-[0.06em] text-text" data-testid="recovery-key">
          {recoveryKey}
        </code>
      </div>
      <Button
        size="sm"
        className="self-center"
        onClick={() => {
          void navigator.clipboard?.writeText(recoveryKey).then(() => setCopied(true));
        }}
      >
        {copied ? t('lock.copied') : t('lock.copy')}
      </Button>
      <p className="rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">{t('lock.recovery_warning')}</p>
      <Checkbox label={t('lock.recovery_ack')} checked={ack} onChange={(e) => setAck(e.target.checked)} />
      <Button variant="primary" disabled={!ack} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

/** Choose PIN or password, confirm it, turn on the lock, then show the recovery key. */
export function LockSetup({ onDone, doneLabel }: { onDone: () => void; doneLabel: string }) {
  const { t } = useTranslation();
  const enable = useSessionCall<{ kind: LockKind; secret: string }, { recovery_key: string }>('session.enable_lock');
  const [kind, setKind] = useState<LockKind>('pin');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validSecret(kind, a)) return setError(kind === 'pin' ? t('lock.pin_rule') : t('lock.password_rule'));
    if (a !== b) return setError(t('lock.mismatch'));
    try {
      const r = await enable.mutateAsync({ kind, secret: a });
      setA('');
      setB('');
      setRecovery(r.recovery_key);
    } catch (err) {
      setError(humanize(fieldError(err).message));
    }
  }

  if (recovery) return <RecoveryKeyNotice recoveryKey={recovery} onDone={onDone} doneLabel={doneLabel} />;

  const pin = kind === 'pin';
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Segmented
        label={t('lock.kind')}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setA('');
          setB('');
          setError(null);
        }}
        options={[
          { value: 'pin', label: t('lock.kind_pin') },
          { value: 'password', label: t('lock.kind_password') },
        ]}
        className="self-start"
      />
      <p className="text-[13px] text-muted">{pin ? t('lock.pin_note') : t('lock.password_note')}</p>
      <Field label={pin ? t('lock.new_pin') : t('lock.new_password')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            inputMode={pin ? 'numeric' : 'text'}
            maxLength={pin ? PIN_LENGTH : 128}
            value={a}
            onChange={(e) => setA(pin ? e.target.value.replace(/\D/g, '') : e.target.value)}
            autoComplete="new-password"
            autoFocus
            className="tabular tracking-[0.2em]"
          />
        )}
      </Field>
      <Field label={pin ? t('lock.confirm_pin') : t('lock.confirm_password')} error={error ?? undefined}>
        {(p) => (
          <Input
            {...p}
            type="password"
            inputMode={pin ? 'numeric' : 'text'}
            maxLength={pin ? PIN_LENGTH : 128}
            value={b}
            onChange={(e) => setB(pin ? e.target.value.replace(/\D/g, '') : e.target.value)}
            autoComplete="new-password"
            className="tabular tracking-[0.2em]"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={enable.isPending}>
        {t('lock.turn_on')}
      </Button>
    </form>
  );
}
