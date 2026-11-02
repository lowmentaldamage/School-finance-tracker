import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { isTauri } from '../../api/client';
import { useAppStatus, useSessionCall, useSetSetting, useSettings } from '../../api/hooks';
import type { LockKind } from '../../api/types';
import { Button, Checkbox, Dialog, Field, Input, Panel, Segmented, Select, useToast } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { LockSetup, RecoveryKeyNotice, validSecret } from '../lock/LockSetup';
import { PIN_LENGTH } from '../lock/PinPad';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0 sm:w-[280px]">{children}</div>
    </div>
  );
}

type Dlg = null | 'setup' | 'change' | 'disable' | 'recovery';

export function SecurityPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const status = useAppStatus();
  const settings = useSettings();
  const setSetting = useSetSetting();
  const lock = status.data?.lock ?? null;
  const [dlg, setDlg] = useState<Dlg>(null);
  const enableBio = useSessionCall<Record<string, never>>('session.enable_biometric');
  const disableBio = useSessionCall<Record<string, never>>('session.disable_biometric');
  const protection = status.data?.key_protection;

  async function toggleBio(on: boolean) {
    try {
      if (on) await enableBio.mutateAsync({});
      else await disableBio.mutateAsync({});
      toast(on ? t('security.bio_on') : t('security.bio_off'));
    } catch (e) {
      toast(humanize(fieldError(e).message), 'negative');
    }
  }

  const save = (key: 'security.auto_lock_minutes' | 'security.background_lock_secs' | 'security.hide_in_switcher', value: unknown) =>
    setSetting.mutate({ key, value }, { onSuccess: () => toast(t('settings.saved')), onError: (e) => toast(humanize(e.message), 'negative') });

  return (
    <Panel title={t('settings.security')}>
      <div className="divide-y divide-border">
        <Row label={t('settings.encryption')} hint={t('settings.encryption_hint')}>
          <span className="text-sm text-text">{t('settings.encryption_on')}</span>
        </Row>
        <Row label={t('settings.key_protection')} hint={protection ? t(`settings.key_protection_hint.${protection}`) : undefined}>
          <span className="text-sm text-text">{protection ? t(`settings.key_protection_value.${protection}`) : '—'}</span>
        </Row>
        <Row label={t('security.app_lock')} hint={lock ? t(lock.kind === 'pin' ? 'security.lock_on_pin' : 'security.lock_on_password') : t('security.lock_off_hint')}>
          {lock ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDlg('change')}>
                {t('security.change')}
              </Button>
              <Button size="sm" onClick={() => setDlg('recovery')}>
                {t('security.new_recovery')}
              </Button>
              <Button size="sm" variant="ghost" className="text-negative hover:text-negative" onClick={() => setDlg('disable')}>
                {t('security.turn_off')}
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setDlg('setup')}>
              {t('security.set_up')}
            </Button>
          )}
        </Row>
        {lock && status.data?.biometric_available && (
          <Row label={t('security.biometric')} hint={t('security.biometric_hint')}>
            <Checkbox label={t('security.biometric_use')} checked={lock.biometric} disabled={enableBio.isPending || disableBio.isPending} onChange={(e) => void toggleBio(e.target.checked)} />
          </Row>
        )}
        {lock && (
          <>
            <Row label={t('security.auto_lock')} hint={t('security.auto_lock_hint')}>
              <Select aria-label={t('security.auto_lock')} value={settings.data?.['security.auto_lock_minutes'] ?? 5} onChange={(e) => save('security.auto_lock_minutes', Number(e.target.value))}>
                {[1, 2, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {t('security.minutes', { count: m })}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label={t('security.background')} hint={t('security.background_hint')}>
              <Select aria-label={t('security.background')} value={settings.data?.['security.background_lock_secs'] ?? 0} onChange={(e) => save('security.background_lock_secs', Number(e.target.value))}>
                <option value={0}>{t('security.bg_immediately')}</option>
                <option value={30}>{t('security.bg_seconds', { count: 30 })}</option>
                <option value={60}>{t('security.minutes', { count: 1 })}</option>
                <option value={300}>{t('security.minutes', { count: 5 })}</option>
              </Select>
            </Row>
          </>
        )}
        {isTauri() && (
          <Row label={t('security.hide_switcher')} hint={t('security.hide_switcher_hint')}>
            <Checkbox label={t('security.hide_switcher_use')} checked={settings.data?.['security.hide_in_switcher'] ?? false} onChange={(e) => save('security.hide_in_switcher', e.target.checked)} />
          </Row>
        )}
      </div>

      <Dialog open={dlg === 'setup'} onOpenChange={(o) => !o && setDlg(null)} title={t('security.set_up')}>
        <LockSetup
          doneLabel={t('common.done')}
          onDone={() => {
            setDlg(null);
            toast(t('security.lock_enabled'));
          }}
        />
      </Dialog>
      <ChangeDialog open={dlg === 'change'} onClose={() => setDlg(null)} currentKind={lock?.kind ?? 'pin'} />
      <VerifyDialog
        open={dlg === 'disable'}
        onClose={() => setDlg(null)}
        kind={lock?.kind ?? 'pin'}
        title={t('security.turn_off_title')}
        body={t('security.turn_off_body')}
        cmd="session.disable_lock"
        confirm={t('security.turn_off')}
        danger
        onDone={() => toast(t('security.lock_disabled'))}
      />
      <VerifyDialog
        open={dlg === 'recovery'}
        onClose={() => setDlg(null)}
        kind={lock?.kind ?? 'pin'}
        title={t('security.new_recovery')}
        body={t('security.new_recovery_body')}
        cmd="session.regenerate_recovery"
        confirm={t('security.new_recovery')}
      />
    </Panel>
  );
}

function SecretInput({ kind, value, onChange, label, error, autoFocus }: { kind: LockKind; value: string; onChange: (v: string) => void; label: string; error?: string; autoFocus?: boolean }) {
  return (
    <Field label={label} error={error}>
      {(p) => (
        <Input
          {...p}
          type="password"
          inputMode={kind === 'pin' ? 'numeric' : 'text'}
          maxLength={kind === 'pin' ? PIN_LENGTH : 128}
          value={value}
          onChange={(e) => onChange(kind === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)}
          autoComplete="off"
          autoFocus={autoFocus}
          className="tabular tracking-[0.2em]"
        />
      )}
    </Field>
  );
}

function ChangeDialog({ open, onClose, currentKind }: { open: boolean; onClose: () => void; currentKind: LockKind }) {
  const { t } = useTranslation();
  const toast = useToast();
  const change = useSessionCall<{ current: string; kind: LockKind; secret: string }>('session.change_secret');
  const [cur, setCur] = useState('');
  const [kind, setKind] = useState<LockKind>(currentKind);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCur('');
    setA('');
    setB('');
    setError(null);
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validSecret(kind, a)) return setError(kind === 'pin' ? t('lock.pin_rule') : t('lock.password_rule'));
    if (a !== b) return setError(t('lock.mismatch'));
    try {
      await change.mutateAsync({ current: cur, kind, secret: a });
      toast(t('security.changed'));
      close();
    } catch (err) {
      setError(fieldError(err).field === null && (err as { code?: string }).code === 'wrong_secret' ? t('security.current_wrong') : humanize(fieldError(err).message));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t('security.change')}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="change-secret" loading={change.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="change-secret" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SecretInput kind={currentKind} value={cur} onChange={setCur} label={currentKind === 'pin' ? t('security.current_pin') : t('security.current_password')} autoFocus />
        <Segmented
          label={t('lock.kind')}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setA('');
            setB('');
          }}
          options={[
            { value: 'pin', label: t('lock.kind_pin') },
            { value: 'password', label: t('lock.kind_password') },
          ]}
          className="self-start"
        />
        <SecretInput kind={kind} value={a} onChange={setA} label={kind === 'pin' ? t('lock.new_pin') : t('lock.new_password')} />
        <SecretInput kind={kind} value={b} onChange={setB} label={kind === 'pin' ? t('lock.confirm_pin') : t('lock.confirm_password')} error={error ?? undefined} />
      </form>
    </Dialog>
  );
}

function VerifyDialog({
  open,
  onClose,
  kind,
  title,
  body,
  cmd,
  confirm,
  danger,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  kind: LockKind;
  title: string;
  body: string;
  cmd: string;
  confirm: string;
  danger?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const run = useSessionCall<{ secret: string }, { recovery_key?: string } | null>(cmd);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const close = () => {
    setSecret('');
    setError(null);
    setRecovery(null);
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await run.mutateAsync({ secret });
      setSecret('');
      if (r && r.recovery_key) setRecovery(r.recovery_key);
      else {
        onDone?.();
        close();
      }
    } catch (err) {
      setError((err as { code?: string }).code === 'wrong_secret' ? t('security.current_wrong') : humanize(fieldError(err).message));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={title}
      footer={
        recovery ? undefined : (
          <>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button variant={danger ? 'danger' : 'primary'} type="submit" form={`verify-${cmd}`} loading={run.isPending}>
              {confirm}
            </Button>
          </>
        )
      }
    >
      {recovery ? (
        <RecoveryKeyNotice recoveryKey={recovery} onDone={close} doneLabel={t('common.done')} />
      ) : (
        <form id={`verify-${cmd}`} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted">{body}</p>
          <SecretInput kind={kind} value={secret} onChange={setSecret} label={kind === 'pin' ? t('security.current_pin') : t('security.current_password')} error={error ?? undefined} autoFocus />
        </form>
      )}
    </Dialog>
  );
}
