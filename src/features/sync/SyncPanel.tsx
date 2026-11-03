import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { call } from '../../api/client';
import { useSettings } from '../../api/hooks';
import { useLocale } from '../../app/preferences';
import { Button, ConfirmDialog, Dialog, Field, Input, Panel, useToast } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { download, dropboxAvailable, finishSignIn, forgetToken, remoteRev, startSignIn } from './dropbox';
import { syncNow, type SyncOutcome } from './syncEngine';

type Setup = null | { kind: 'new' } | { kind: 'existing' };

export function SyncPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<Setup>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [connected, setConnected] = useState(false);
  const s = settings.data ?? {};
  const enabled = s['sync.enabled'] === true;

  useEffect(() => {
    if (!dropboxAvailable()) return;
    void call<{ refresh_token: string | null }>('sync.get_token').then((r) => setConnected(!!r.refresh_token));
  }, [s['sync.account_name'], enabled]);

  // Pick up the sign-in result when the user comes back from the browser.
  useEffect(() => {
    if (!dropboxAvailable()) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        if (await finishSignIn()) {
          setConnected(true);
          await settings.refetch();
          setSetup((await remoteRev()) ? { kind: 'existing' } : { kind: 'new' });
        }
      } catch (e) {
        toast(humanize(fieldError(e).message), 'negative');
      }
    };
    void check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  if (!dropboxAvailable()) return null;

  async function run(force?: 'keep_local' | 'keep_remote') {
    setBusy(true);
    try {
      const r: SyncOutcome = await syncNow(force);
      if (r === 'conflict') setConflict(true);
      else {
        setConflict(false);
        toast(t(`sync.result_${r}`));
      }
      await qc.invalidateQueries();
    } catch (e) {
      toast(humanize(fieldError(e).message), 'negative');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await call('sync.disconnect');
    forgetToken();
    setConnected(false);
    setConfirmOff(false);
    await settings.refetch();
  }

  const last = s['sync.last_at'];
  return (
    <Panel title={t('sync.title')}>
      <div className="flex flex-col gap-3 px-4 py-4">
        {!connected ? (
          <>
            <p className="text-[13px] text-muted">{t('sync.intro')}</p>
            <Button variant="primary" className="self-start" onClick={() => void startSignIn()}>
              {t('sync.connect')}
            </Button>
          </>
        ) : !enabled ? (
          <>
            <p className="text-sm text-text">{t('sync.connected_as', { account: s['sync.account_name'] || 'Dropbox' })}</p>
            <Button
              variant="primary"
              className="self-start"
              loading={busy}
              onClick={() => void remoteRev().then((r) => setSetup(r ? { kind: 'existing' } : { kind: 'new' }))}
            >
              {t('sync.finish_setup')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-text">{t('sync.connected_as', { account: s['sync.account_name'] || 'Dropbox' })}</p>
            <p className="text-[12.5px] text-muted">
              {last ? t('sync.last', { when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(last)) }) : t('sync.never')}
              {s['sync.dirty'] ? ` · ${t('sync.pending')}` : ''}
            </p>
            {conflict && (
              <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning">
                <p>{t('sync.conflict')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void run('keep_local')}>
                    {t('sync.keep_local')}
                  </Button>
                  <Button size="sm" onClick={() => void run('keep_remote')}>
                    {t('sync.keep_remote')}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void run()}>
                {t('sync.now')}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmOff(true)}>
                {t('sync.disconnect')}
              </Button>
            </div>
            <p className="text-[12px] text-faint">{t('sync.rule')}</p>
          </>
        )}
      </div>
      <SetupDialog
        setup={setup}
        onClose={() => setSetup(null)}
        onDone={async () => {
          setSetup(null);
          await qc.invalidateQueries();
          toast(t('sync.enabled'));
        }}
      />
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('sync.disconnect')}
        body={t('sync.disconnect_body')}
        confirmLabel={t('sync.disconnect')}
        onConfirm={() => void disconnect()}
      />
    </Panel>
  );
}

function SetupDialog({ setup, onClose, onDone }: { setup: Setup; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = setup?.kind === 'new';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if ([...a].length < 10) return setError(t('lock.password_rule'));
    if (isNew && a !== b) return setError(t('lock.mismatch'));
    setBusy(true);
    try {
      if (isNew) {
        await call('sync.setup_new', { password: a });
        await syncNow('keep_local');
      } else {
        const f = await download();
        await call('sync.setup_from_remote', { data_b64: f.data, rev: f.rev, password: a });
      }
      setA('');
      setB('');
      await onDone();
    } catch (err) {
      const fe = fieldError(err);
      setError(fe.field === 'password' ? t('data.wrong_backup_password') : humanize(fe.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!setup}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? t('sync.new_title') : t('sync.existing_title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={isNew ? 'primary' : 'danger'} type="submit" form="sync-setup" loading={busy}>
            {isNew ? t('sync.start') : t('sync.use_dropbox')}
          </Button>
        </>
      }
    >
      <form id="sync-setup" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">{isNew ? t('sync.new_body') : t('sync.existing_body')}</p>
        <Field label={t('sync.password')}>{(p) => <Input {...p} type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" autoFocus />}</Field>
        {isNew && (
          <Field label={t('sync.password_confirm')} error={error ?? undefined}>
            {(p) => <Input {...p} type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />}
          </Field>
        )}
        {!isNew && error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <p className="rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">{isNew ? t('sync.password_warning') : t('sync.replace_warning')}</p>
      </form>
    </Dialog>
  );
}
