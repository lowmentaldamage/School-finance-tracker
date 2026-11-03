import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { call } from '../../api/client';
import { useInvalidateAll, useResetAfterSessionChange } from '../../api/hooks';
import type { BackupSummary, FileData } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { Button, Dialog, Field, Input, Panel, useToast } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { pickFile, saveFile } from '../../lib/platform';
import { monthKey, shiftMonth, formatMonth } from '../../lib/period';
import { ImportDialog } from './ImportDialog';
import { Select } from '../../components/ui';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function DataPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const locale = useLocale();
  const [dlg, setDlg] = useState<null | 'backup' | 'restore' | 'delete' | 'import'>(null);
  const [reportMonth, setReportMonth] = useState(shiftMonth(monthKey(), -1));

  async function exportPdf() {
    setBusy('pdf');
    try {
      const f = await call<FileData>('report.monthly_pdf', { month: reportMonth });
      if (await saveFile(f.file_name, 'application/pdf', f.data_b64)) toast(t('data.pdf_saved'));
    } catch (e) {
      toast(humanize(fieldError(e).message), 'negative');
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy('csv');
    try {
      const f = await call<FileData>('data.export_csv');
      if (await saveFile(f.file_name, 'text/csv', f.data_b64)) toast(t('data.csv_saved'));
    } catch (e) {
      toast(humanize(fieldError(e).message), 'negative');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t('data.title')}>
      <div className="divide-y divide-border">
        <Row label={t('data.backup')} hint={t('data.backup_hint')}>
          <Button onClick={() => setDlg('backup')}>{t('data.create_backup')}</Button>
        </Row>
        <Row label={t('data.restore')} hint={t('data.restore_hint')}>
          <Button onClick={() => setDlg('restore')}>{t('data.restore_backup')}</Button>
        </Row>
        <Row label={t('data.report')} hint={t('data.report_hint')}>
          <div className="flex gap-2">
            <Select aria-label={t('data.report_month')} value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="w-[150px]">
              {Array.from({ length: 13 }, (_, i) => shiftMonth(monthKey(), -i)).map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m, locale)}
                </option>
              ))}
            </Select>
            <Button onClick={() => void exportPdf()} loading={busy === 'pdf'}>
              {t('data.save_pdf')}
            </Button>
          </div>
        </Row>
        <Row label={t('import.title')} hint={t('import.hint')}>
          <Button onClick={() => setDlg('import')}>{t('import.button')}</Button>
        </Row>
        <Row label={t('data.csv')} hint={t('data.csv_hint')}>
          <Button onClick={() => void exportCsv()} loading={busy === 'csv'}>
            {t('data.export_csv')}
          </Button>
        </Row>
        <Row label={t('data.delete')} hint={t('data.delete_hint')}>
          <Button variant="ghost" className="text-negative hover:text-negative" onClick={() => setDlg('delete')}>
            {t('data.delete_button')}
          </Button>
        </Row>
      </div>
      <BackupDialog open={dlg === 'backup'} onClose={() => setDlg(null)} />
      <RestoreDialog open={dlg === 'restore'} onClose={() => setDlg(null)} />
      <DeleteAllDialog open={dlg === 'delete'} onClose={() => setDlg(null)} />
      <ImportDialog open={dlg === 'import'} onClose={() => setDlg(null)} />
    </Panel>
  );
}

function BackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setA('');
    setB('');
    setError(null);
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if ([...a].length < 10) return setError(t('lock.password_rule'));
    if (a !== b) return setError(t('lock.mismatch'));
    setBusy(true);
    try {
      const f = await call<FileData>('backup.export', { password: a });
      if (await saveFile(f.file_name, 'application/octet-stream', f.data_b64)) {
        toast(t('data.backup_saved'));
        close();
      }
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
      title={t('data.create_backup')}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="backup-form" loading={busy}>
            {t('data.save_backup')}
          </Button>
        </>
      }
    >
      <form id="backup-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('data.backup_explain')}</p>
        <Field label={t('data.backup_password')}>{(p) => <Input {...p} type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" autoFocus />}</Field>
        <Field label={t('data.backup_password_confirm')} error={error ?? undefined}>
          {(p) => <Input {...p} type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />}
        </Field>
        <p className="rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">{t('data.backup_warning')}</p>
      </form>
    </Dialog>
  );
}

function RestoreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [data, setData] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setData(null);
    setPassword('');
    setSummary(null);
    setError(null);
    onClose();
  };

  async function choose() {
    setError(null);
    try {
      const d = await pickFile();
      if (d) setData(d);
    } catch (e) {
      setError(humanize(fieldError(e).message));
    }
  }

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError(null);
    setBusy(true);
    try {
      setSummary(await call<BackupSummary>('backup.inspect', { data_b64: data, password }));
    } catch (err) {
      const fe = fieldError(err);
      setError(fe.field === 'password' ? t('data.wrong_backup_password') : fe.field === 'file' ? t('data.not_a_backup') : humanize(fe.message));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await call<BackupSummary>('backup.restore', { data_b64: data, password });
      await invalidate();
      toast(t('data.restored'));
      close();
    } catch (err) {
      setError(humanize(fieldError(err).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('data.restore_backup')}>
      {!data ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('data.restore_explain')}</p>
          <Button variant="primary" onClick={() => void choose()} className="self-start">
            {t('data.choose_file')}
          </Button>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        </div>
      ) : !summary ? (
        <form onSubmit={check} noValidate className="flex flex-col gap-4">
          <Field label={t('data.backup_password')} error={error ?? undefined}>
            {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" />}
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>
            {t('data.open_backup')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            {t('data.backup_contents', {
              date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.created_at)),
              accounts: summary.accounts,
              transactions: summary.transactions,
            })}
          </p>
          <p className="rounded-md bg-negative-soft px-3 py-2.5 text-[13px] text-negative">{t('data.restore_warning')}</p>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void restore()}>
              {t('data.replace_data')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DeleteAllDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const reset = useResetAfterSessionChange();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setText('');
    setError(null);
    onClose();
  };

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await call('data.delete_all', { confirm: text });
      close();
      await reset();
    } catch (e) {
      setError(humanize(fieldError(e).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t('data.delete_title')}
      size="sm"
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={text !== 'DELETE'} onClick={() => void run()}>
            {t('data.delete_button')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('data.delete_body')}</p>
        <Field label={t('data.delete_type')} error={error ?? undefined}>
          {(p) => <Input {...p} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="characters" />}
        </Field>
      </div>
    </Dialog>
  );
}
