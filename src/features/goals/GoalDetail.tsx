import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useContribute, useContributions, useDeleteContribution } from '../../api/hooks';
import type { Goal } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { Meter } from '../../components/charts';
import { Button, Dialog, Field, Icon, IconButton, Input, Segmented, useToast } from '../../components/ui';
import { formatDate, todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, formatMoney, parseAmount } from '../../lib/money';

/** Goal progress, contribution history, and the add-money form. */
export function GoalDetail({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const list = useContributions(goal?.id ?? null);
  const contribute = useContribute();
  const remove = useDeleteContribution();
  const [dir, setDir] = useState<'add' | 'withdraw'>('add');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAmount('');
    setNote('');
    setDir('add');
    setDate(todayISO());
    setError(null);
  }, [goal?.id]);

  if (!goal) return null;
  const money = (v: number) => formatMoney(v, goal.currency, { locale });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!goal) return;
    const v = parseAmount(amount, currencyExponent(goal.currency));
    if (v === null || v <= 0) {
      setError(t('validation.amount_positive'));
      return;
    }
    setError(null);
    try {
      await contribute.mutateAsync({ goal_id: goal.id, amount_minor: dir === 'add' ? v : -v, date, note: note.trim() || null });
      toast(dir === 'add' ? t('goals.added_money') : t('goals.withdrew'));
      setAmount('');
      setNote('');
    } catch (err) {
      setError(humanize(fieldError(err).message));
    }
  }

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()} title={goal.name} size="md">
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="tabular text-[22px] font-semibold">{money(goal.saved_minor)}</span>
            <span className="tabular text-sm text-muted">{t('goals.of_target', { target: money(goal.target_minor) })}</span>
          </div>
          <div className="mt-2">
            <Meter valueBp={goal.progress_bp} label={goal.name} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {goal.remaining_minor === 0
              ? t('goals.reached')
              : goal.monthly_needed_minor !== null
                ? t('goals.needed_per_month', { amount: money(goal.monthly_needed_minor), date: formatDate(goal.deadline!, locale) })
                : t('goals.remaining', { amount: money(goal.remaining_minor) })}
          </p>
        </div>

        {goal.linked_account_id ? (
          <p className="rounded-md bg-surface-2 px-3 py-2.5 text-[13px] text-muted">{t('goals.linked_note', { account: goal.linked_account_name ?? '' })}</p>
        ) : (
          <>
            <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-md border border-border p-3">
              <Segmented
                label={t('goals.contribution_type')}
                value={dir}
                onChange={setDir}
                options={[
                  { value: 'add', label: t('goals.add_money') },
                  { value: 'withdraw', label: t('goals.withdraw') },
                ]}
                className="self-start"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('transactions.amount', { currency: goal.currency })} error={error ?? undefined}>
                  {(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
                </Field>
                <Field label={t('transactions.date')}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
              </div>
              <Field label={t('goals.note')} optional={t('common.optional')}>
                {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
              </Field>
              <Button type="submit" variant="primary" loading={contribute.isPending} className="self-end">
                {dir === 'add' ? t('goals.add_money') : t('goals.withdraw')}
              </Button>
            </form>

            <div>
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t('goals.history')}</h3>
              {(list.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">{t('goals.no_contributions')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {(list.data ?? []).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-text">{formatDate(c.date, locale)}</span>
                        {c.note && <span className="block truncate text-[12px] text-muted">{c.note}</span>}
                      </span>
                      <span className={`tabular text-sm font-medium ${c.amount_minor < 0 ? 'text-text' : 'text-positive'}`}>
                        {formatMoney(c.amount_minor, goal.currency, { locale, sign: 'always' })}
                      </span>
                      <IconButton
                        size="sm"
                        label={t('goals.delete_contribution')}
                        onClick={() =>
                          remove.mutate(c.id, {
                            onError: (e) => toast(humanize(e.message), 'negative'),
                          })
                        }
                      >
                        <Icon name="close" size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
