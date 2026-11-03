import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { call } from '../../api/client';
import { useSetSetting, useSettings } from '../../api/hooks';
import { useLocale } from '../../app/preferences';
import { Button, Dialog, Field, Input, useToast } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { isAndroidApp, native } from '../../lib/native';
import { runAutoBackup } from './AutoBackupRunner';

export function AutoBackupSection({ Row }: { Row: React.ComponentType<{ label: string; hint?: string; children: React.ReactNode }> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const settings = useSettings();
  const set = useSetSetting();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isAndroidApp()) return null;
  const s = settings.data ?? {};
  const on = s['backup.auto.enabled'] === true && !!s['backup.auto.folder_uri'];
  const last = s['backup.auto.last_at'];

  async function now() {
    setBusy(true);
    try {
      await runAutoBackup(s['backup.auto.folder_uri']!);
      await settings.refetch();
      toast(t('data.backup_saved'));
    } catch (e) {
      toast(humanize(fieldError(e).message), 'negative');
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    await call('autobackup.disable');
    set.mutate({ key: 'backup.auto.folder_uri', value: '' });
  }

  return (
    <>
      <Row
        label={t('autobackup.title')}
        hint={
          on
            ? t('autobackup.on_hint', {
                folder: s['backup.auto.folder_name'] ?? '',
                last: last ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(last)) : t('autobackup.never'),
              })
            : t('autobackup.off_hint')
        }
      >
        {on ? (
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void now()}>
              {t('autobackup.now')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void off()}>
              {t('security.turn_off')}
            </Button>
          </div>
        ) : (
          <Button onClick={() => setOpen(true)}>{t('autobackup.set_up')}</Button>
        )}
      </Row>
      <SetupDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const set = useSetSetting();
  const settings = useSettings();
  const [folder, setFolder] = useState<{ uri: string; name: string } | null>(null);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setFolder(null);
    setA('');
    setB('');
    setError(null);
    onClose();
  };

  async function choose() {
    const r = await native<{ uri: string; name?: string }>('pickFolder').catch((): { uri: string; name?: string } => ({ uri: '' }));
    if (r.uri) setFolder({ uri: r.uri, name: r.name ?? '' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!folder) return setError(t('autobackup.need_folder'));
    if ([...a].length < 10) return setError(t('lock.password_rule'));
    if (a !== b) return setError(t('lock.mismatch'));
    setBusy(true);
    try {
      await call('autobackup.configure', { password: a });
      await set.mutateAsync({ key: 'backup.auto.folder_uri', value: folder.uri });
      await set.mutateAsync({ key: 'backup.auto.folder_name', value: folder.name.slice(0, 200) });
      await runAutoBackup(folder.uri);
      await settings.refetch();
      toast(t('autobackup.enabled'));
      close();
    } catch (err) {
      setError(humanize(fieldError(err).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t('autobackup.set_up')}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="autobackup-form" loading={busy}>
            {t('autobackup.turn_on')}
          </Button>
        </>
      }
    >
      <form id="autobackup-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('autobackup.explain')}</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => void choose()}>{folder ? t('autobackup.change_folder') : t('autobackup.choose_folder')}</Button>
          {folder && <span className="truncate text-sm text-text">{folder.name}</span>}
        </div>
        <Field label={t('data.backup_password')}>{(p) => <Input {...p} type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" />}</Field>
        <Field label={t('data.backup_password_confirm')} error={error ?? undefined}>
          {(p) => <Input {...p} type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />}
        </Field>
        <p className="rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">{t('data.backup_warning')}</p>
      </form>
    </Dialog>
  );
}
