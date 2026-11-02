import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useDeleteRate, useRates, useSaveRate } from '../../api/hooks';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { Button, Field, Icon, IconButton, Input, Panel, useToast } from '../../components/ui';
import { formatDate, todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';

/** Manual exchange rates (Keel never fetches rates from the internet). */
export function RatesPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const base = useBaseCurrency();
  const accounts = useAccounts(true);
  const rates = useRates();
  const save = useSaveRate();
  const del = useDeleteRate();

  const foreign = useMemo(() => [...new Set((accounts.data ?? []).map((a) => a.currency).filter((c) => c !== base))].sort(), [accounts.data, base]);
  const [from, setFrom] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const fromCode = from || foreign[0] || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fromCode) return;
    try {
      await save.mutateAsync({ from_code: fromCode, to_code: base, rate: rate.trim().replace(',', '.'), valid_from: date });
      setRate('');
      toast(t('rates.saved'));
    } catch (err) {
      setError(humanize(fieldError(err).message));
    }
  }

  const fmtRate = (e9: number) => (e9 / 1e9).toLocaleString(locale, { maximumFractionDigits: 9 });

  return (
    <Panel title={t('rates.title')}>
      <div id="rates" className="flex flex-col gap-4 p-4">
        <p className="text-[13px] text-muted">{t('rates.intro', { base })}</p>
        {foreign.length === 0 ? (
          <p className="text-sm text-muted">{t('rates.none_needed', { base })}</p>
        ) : (
          <form onSubmit={submit} noValidate className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[120px_1fr_150px_auto]">
            <Field label={t('rates.currency')}>
              {(p) => (
                <select {...p} value={fromCode} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm">
                  {foreign.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('rates.rate', { from: fromCode, base })} error={error ?? undefined}>
              {(p) => <Input {...p} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="1.0000" className="tabular" />}
            </Field>
            <Field label={t('rates.valid_from')}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </form>
        )}
        {(rates.data ?? []).length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {(rates.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="tabular flex-1">
                  1 {r.from_code} = {fmtRate(r.rate_e9)} {r.to_code}
                </span>
                <span className="text-[12.5px] text-muted">{t('rates.from_date', { date: formatDate(r.valid_from, locale) })}</span>
                <IconButton
                  size="sm"
                  label={t('rates.delete')}
                  onClick={() => del.mutate(r.id, { onError: (e) => toast(humanize(e.message), 'negative') })}
                >
                  <Icon name="close" size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
