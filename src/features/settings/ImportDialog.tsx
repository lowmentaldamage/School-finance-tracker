import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { call } from '../../api/client';
import { useAccounts, useInvalidateAll } from '../../api/hooks';
import { Button, Checkbox, Dialog, Field, Segmented, Select } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { pickFile } from '../../lib/platform';

interface Preview {
  delimiter: string;
  rows: string[][];
  total_rows: number;
  columns: number;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  categorized: number;
  issues: Array<{ row: number; reason: string }>;
}

type DateFormat = 'ymd' | 'dmy' | 'mdy';

const GUESS: Record<string, RegExp> = {
  date: /date|datum|fecha|data|booking|buchung|valuta/i,
  amount: /amount|betrag|importe|montant|importo|value|sum/i,
  debit: /debit|out|withdraw|soll|ausgang/i,
  credit: /credit|in$|deposit|haben|eingang/i,
  payee: /payee|name|merchant|beneficiar|counterpart|empf|recipient|party/i,
  description: /desc|memo|text|reference|verwendung|purpose|details/i,
};

function guessCol(headers: string[], kind: keyof typeof GUESS): number | '' {
  const i = headers.findIndex((h) => GUESS[kind]!.test(h));
  return i >= 0 ? i : '';
}

function guessDateFormat(sample: string | undefined): DateFormat {
  if (!sample) return 'dmy';
  if (/^\d{4}[-./]/.test(sample.trim())) return 'ymd';
  const parts = sample.trim().split(/[-./]/).map(Number);
  if ((parts[1] ?? 0) > 12) return 'mdy';
  return 'dmy';
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts(false);
  const invalidate = useInvalidateAll();
  const [data, setData] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [account, setAccount] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [dateCol, setDateCol] = useState<number | ''>('');
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy');
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [amountCol, setAmountCol] = useState<number | ''>('');
  const [debitCol, setDebitCol] = useState<number | ''>('');
  const [creditCol, setCreditCol] = useState<number | ''>('');
  const [payeeCol, setPayeeCol] = useState<number | ''>('');
  const [descCol, setDescCol] = useState<number | ''>('');
  const [invert, setInvert] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setData(null);
    setPreview(null);
    setResult(null);
    setError(null);
    onClose();
  };

  const headers = useMemo(() => {
    const n = preview?.columns ?? 0;
    return Array.from({ length: n }, (_, i) => (hasHeader ? preview?.rows[0]?.[i]?.trim() || t('import.column', { n: i + 1 }) : t('import.column', { n: i + 1 })));
  }, [preview, hasHeader, t]);
  const sampleRows = (preview?.rows ?? []).slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 4);

  async function choose() {
    setError(null);
    try {
      const d = await pickFile('.csv,text/csv,text/plain');
      if (!d) return;
      const p = await call<Preview>('import.preview', { data_b64: d });
      setData(d);
      setPreview(p);
      const hs = p.rows[0] ?? [];
      const dc = guessCol(hs, 'date');
      setDateCol(dc === '' ? 0 : dc);
      setDateFormat(guessDateFormat(p.rows[1]?.[dc === '' ? 0 : dc]));
      const ac = guessCol(hs, 'amount');
      const db = guessCol(hs, 'debit');
      const cr = guessCol(hs, 'credit');
      if (ac === '' && db !== '' && cr !== '') {
        setMode('split');
        setDebitCol(db);
        setCreditCol(cr);
      } else {
        setMode('single');
        setAmountCol(ac);
      }
      setPayeeCol(guessCol(hs, 'payee'));
      setDescCol(guessCol(hs, 'description'));
      setAccount((accounts.data ?? [])[0]?.id ?? '');
    } catch (e) {
      setError(humanize(fieldError(e).message));
    }
  }

  async function run() {
    if (!data) return;
    setError(null);
    if (!account) return setError(t('import.need_account'));
    if (dateCol === '') return setError(t('import.need_date'));
    if (mode === 'single' ? amountCol === '' : debitCol === '' && creditCol === '') return setError(t('import.need_amount'));
    setBusy(true);
    try {
      const r = await call<ImportResult>('import.run', {
        data_b64: data,
        mapping: {
          account_id: account,
          has_header: hasHeader,
          date_col: dateCol,
          date_format: dateFormat,
          amount_col: mode === 'single' ? amountCol : null,
          debit_col: mode === 'split' && debitCol !== '' ? debitCol : null,
          credit_col: mode === 'split' && creditCol !== '' ? creditCol : null,
          payee_col: payeeCol === '' ? null : payeeCol,
          description_col: descCol === '' ? null : descCol,
          invert_sign: invert,
          decimal: 'auto',
          skip_duplicates: true,
          auto_categorize: true,
        },
      });
      setResult(r);
      await invalidate();
    } catch (e) {
      setError(humanize(fieldError(e).message));
    } finally {
      setBusy(false);
    }
  }

  const colSelect = (label: string, value: number | '', set: (v: number | '') => void, optional = false) => (
    <Field label={label} optional={optional ? t('common.optional') : undefined}>
      {(p) => (
        <Select {...p} value={value} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">{optional ? t('common.none') : t('common.select')}</option>
          {headers.map((h, i) => (
            <option key={i} value={i}>
              {h}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('import.title')} size="lg">
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">{t('import.done', { imported: result.imported, duplicates: result.duplicates, categorized: result.categorized })}</p>
          {result.issues.length > 0 && (
            <div className="rounded-md border border-border p-3 text-[13px]">
              <p className="mb-1 font-medium text-text">{t('import.issues', { count: result.issues.length })}</p>
              <ul className="max-h-40 overflow-y-auto text-muted">
                {result.issues.slice(0, 50).map((i) => (
                  <li key={i.row}>{t('import.issue_row', { row: i.row, reason: i.reason })}</li>
                ))}
              </ul>
            </div>
          )}
          <Button variant="primary" className="self-end" onClick={close}>
            {t('common.done')}
          </Button>
        </div>
      ) : !preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('import.intro')}</p>
          <Button variant="primary" onClick={() => void choose()} className="self-start">
            {t('data.choose_file')}
          </Button>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">{t('import.rows_found', { count: preview.total_rows - (hasHeader ? 1 : 0) })}</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[480px] text-left text-[12px]">
              <thead className="bg-surface-2 text-muted">
                <tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {sampleRows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {headers.map((_, j) => (
                      <td key={j} className="max-w-[160px] truncate px-2 py-1.5 text-text">
                        {r[j] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Checkbox label={t('import.has_header')} checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('import.account')}>
              {(p) => (
                <Select {...p} value={account} onChange={(e) => setAccount(e.target.value)}>
                  {(accounts.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {colSelect(t('import.date_col'), dateCol, setDateCol)}
            <Field label={t('import.date_format')}>
              {(p) => (
                <Select {...p} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                  <option value="dmy">{t('import.fmt_dmy')}</option>
                  <option value="mdy">{t('import.fmt_mdy')}</option>
                  <option value="ymd">{t('import.fmt_ymd')}</option>
                </Select>
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('import.amounts')}</span>
              <Segmented
                label={t('import.amounts')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'single', label: t('import.one_column') },
                  { value: 'split', label: t('import.two_columns') },
                ]}
              />
            </div>
            {mode === 'single' ? (
              colSelect(t('import.amount_col'), amountCol, setAmountCol)
            ) : (
              <>
                {colSelect(t('import.debit_col'), debitCol, setDebitCol)}
                {colSelect(t('import.credit_col'), creditCol, setCreditCol)}
              </>
            )}
            {colSelect(t('import.payee_col'), payeeCol, setPayeeCol, true)}
            {colSelect(t('import.desc_col'), descCol, setDescCol, true)}
          </div>
          {mode === 'single' && <Checkbox label={t('import.invert')} checked={invert} onChange={(e) => setInvert(e.target.checked)} />}
          <p className="text-[12.5px] text-muted">{t('import.rules')}</p>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={busy} onClick={() => void run()}>
              {t('import.run')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
