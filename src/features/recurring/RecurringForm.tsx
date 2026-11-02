import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useCategories, useDeleteRecurring, useSaveRecurring } from '../../api/hooks';
import type { FreqUnit, RecurringRule, TxType } from '../../api/types';
import { Button, Checkbox, ConfirmDialog, Dialog, Field, Input, Segmented, Select, useToast } from '../../components/ui';
import { todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, minorToInput, parseAmount } from '../../lib/money';
import { CategorySelect } from '../transactions/CategorySelect';

type Errors = Partial<Record<'amount_minor' | 'account_id' | 'to_account_id' | 'to_amount_minor' | 'payee' | 'anchor_date' | 'end_date' | 'freq_interval' | 'category_id' | 'form', string>>;

export function RecurringForm({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (o: boolean) => void; rule: RecurringRule | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const save = useSaveRecurring();
  const del = useDeleteRecurring();

  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<FreqUnit>('month');
  const [interval, setInterval] = useState('1');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const usable = useMemo(() => (accounts.data ?? []).filter((a) => !a.archived || a.id === rule?.account_id || a.id === rule?.to_account_id), [accounts.data, rule]);
  const account = usable.find((a) => a.id === accountId);
  const toAccount = usable.find((a) => a.id === toAccountId);
  const cross = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (rule) {
      setType(rule.type);
      setAmount(minorToInput(rule.amount_minor, currencyExponent(rule.currency)));
      setAccountId(rule.account_id);
      setToAccountId(rule.to_account_id ?? '');
      const toCur = (accounts.data ?? []).find((a) => a.id === rule.to_account_id)?.currency;
      setToAmount(rule.to_amount_minor != null && toCur ? minorToInput(rule.to_amount_minor, currencyExponent(toCur)) : '');
      setCategoryId(rule.category_id ?? '');
      setPayee(rule.payee ?? '');
      setDescription(rule.description ?? '');
      setUnit(rule.freq_unit);
      setInterval(String(rule.freq_interval));
      setStart(rule.anchor_date);
      setEnd(rule.end_date ?? '');
      setActive(rule.active);
    } else {
      setType('expense');
      setAmount('');
      setAccountId(usable.find((a) => !a.archived)?.id ?? '');
      setToAccountId('');
      setToAmount('');
      setCategoryId('');
      setPayee('');
      setDescription('');
      setUnit('month');
      setInterval('1');
      setStart(todayISO());
      setEnd('');
      setActive(true);
    }
  }, [open, rule]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    const amt = parseAmount(amount, currencyExponent(account?.currency ?? 'EUR'));
    if (amt === null || amt <= 0) errs.amount_minor = t('validation.amount_positive');
    if (!accountId) errs.account_id = t('validation.required');
    const n = Number.parseInt(interval, 10);
    if (!Number.isInteger(n) || n < 1 || n > 366) errs.freq_interval = t('recurring.interval_invalid');
    if (!start) errs.anchor_date = t('validation.required');
    if (end && start && end < start) errs.end_date = t('recurring.end_before_start');
    let toAmt: number | null = null;
    if (type === 'transfer') {
      if (!toAccountId) errs.to_account_id = t('validation.required');
      if (cross) {
        toAmt = parseAmount(toAmount, currencyExponent(toAccount!.currency));
        if (toAmt === null || toAmt <= 0) errs.to_amount_minor = t('validation.amount_positive');
      }
    } else if (!payee.trim() && !description.trim()) {
      errs.payee = t('recurring.name_required');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync({
        ...(rule ? { id: rule.id } : {}),
        input: {
          type,
          account_id: accountId,
          amount_minor: amt!,
          to_account_id: type === 'transfer' ? toAccountId : null,
          to_amount_minor: type === 'transfer' && cross ? toAmt : null,
          category_id: type === 'transfer' ? null : categoryId || null,
          payee: type === 'transfer' ? null : payee.trim() || null,
          description: description.trim() || (type === 'transfer' ? t('tx_type.transfer') : null),
          freq_unit: unit,
          freq_interval: n,
          anchor_date: start,
          end_date: end || null,
          active,
        },
      });
      toast(rule ? t('recurring.updated') : t('recurring.created'));
      onOpenChange(false);
    } catch (err) {
      const fe = fieldError(err);
      const known = ['amount_minor', 'account_id', 'to_account_id', 'to_amount_minor', 'payee', 'anchor_date', 'end_date', 'freq_interval', 'category_id'] as const;
      const key = known.find((k) => k === fe.field) ?? 'form';
      setErrors({ [key]: humanize(fe.message) });
    }
  }

  async function doDelete() {
    if (!rule) return;
    try {
      await del.mutateAsync(rule.id);
      toast(t('recurring.deleted'));
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={rule ? t('recurring.edit') : t('recurring.new')}
        size="lg"
        footer={
          <>
            {rule && (
              <Button variant="ghost" className="mr-auto text-negative hover:text-negative" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" form="recurring-form" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {usable.length === 0 ? (
          <p className="text-sm text-muted">{t('transactions.need_account')}</p>
        ) : (
          <form id="recurring-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
            <Segmented
              label={t('transactions.type')}
              value={type}
              onChange={(v) => {
                setType(v);
                setCategoryId('');
              }}
              options={[
                { value: 'expense', label: t('tx_type.expense') },
                { value: 'income', label: t('tx_type.income') },
                { value: 'transfer', label: t('tx_type.transfer') },
              ]}
              className="w-full sm:w-auto sm:self-start"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {type !== 'transfer' && (
                <Field label={type === 'income' ? t('recurring.from_whom') : t('recurring.name')} error={errors.payee} className="sm:col-span-2">
                  {(p) => <Input {...p} value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} placeholder={t('recurring.name_placeholder')} autoFocus />}
                </Field>
              )}
              <Field label={t('transactions.amount', { currency: account?.currency ?? '' })} error={errors.amount_minor}>
                {(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
              </Field>
              <Field label={type === 'transfer' ? t('transactions.from_account') : t('transactions.account')} error={errors.account_id}>
                {(p) => (
                  <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {usable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {type === 'transfer' ? (
                <Field label={t('transactions.to_account')} error={errors.to_account_id}>
                  {(p) => (
                    <Select {...p} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                      <option value="">{t('common.select')}</option>
                      {usable
                        .filter((a) => a.id !== accountId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field label={t('transactions.category')} error={errors.category_id}>
                  {(p) => (
                    <CategorySelect
                      {...p}
                      categories={categories.data ?? []}
                      kind={type === 'income' ? 'income' : 'expense'}
                      emptyLabel={t('transactions.uncategorized')}
                      keepId={rule?.category_id ?? null}
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {cross && (
                <Field label={t('transactions.to_amount', { currency: toAccount!.currency })} error={errors.to_amount_minor}>
                  {(p) => <Input {...p} value={toAmount} onChange={(e) => setToAmount(e.target.value)} inputMode="decimal" className="tabular" />}
                </Field>
              )}
              <Field label={t('recurring.repeats')} error={errors.freq_interval} className="sm:col-span-2">
                {(p) => (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted">{t('recurring.every')}</span>
                    <Input {...p} value={interval} onChange={(e) => setInterval(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="tabular w-16 text-center" maxLength={3} />
                    <Select aria-label={t('recurring.unit')} value={unit} onChange={(e) => setUnit(e.target.value as FreqUnit)} className="w-[140px]">
                      {(['day', 'week', 'month', 'year'] as FreqUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {t(`recurring.unit_${u}`, { count: Number(interval) || 1 })}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </Field>
              <Field label={t('recurring.start')} error={errors.anchor_date} hint={t('recurring.start_hint')}>
                {(p) => <Input {...p} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
              </Field>
              <Field label={t('recurring.end')} optional={t('common.optional')} error={errors.end_date}>
                {(p) => <Input {...p} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />}
              </Field>
              <Field label={t('transactions.description')} optional={t('common.optional')} className="sm:col-span-2">
                {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />}
              </Field>
              <div className="sm:col-span-2">
                <Checkbox label={t('recurring.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
              </div>
            </div>
            {errors.form && (
              <p role="alert" className="text-sm text-negative">
                {errors.form}
              </p>
            )}
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('recurring.delete_title')}
        body={t('recurring.delete_body')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void doDelete()}
        loading={del.isPending}
      />
    </>
  );
}
