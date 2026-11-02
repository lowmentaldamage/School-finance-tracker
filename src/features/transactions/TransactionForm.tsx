import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useCategories, usePayees, useSaveTransaction, useDeleteTransactions } from '../../api/hooks';
import type { PaymentMethod, Transaction, TxType } from '../../api/types';
import { Button, ConfirmDialog, Dialog, Field, Icon, Input, Segmented, Select, Textarea, useToast } from '../../components/ui';
import { todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, minorToInput, parseAmount } from '../../lib/money';
import { CategorySelect } from './CategorySelect';

export const PAYMENT_METHODS: PaymentMethod[] = ['card', 'cash', 'bank_transfer', 'direct_debit', 'other'];

type FieldName =
  | 'amount_minor'
  | 'account_id'
  | 'to_account_id'
  | 'to_amount_minor'
  | 'date'
  | 'category_id'
  | 'payee'
  | 'description'
  | 'notes'
  | 'tags'
  | 'form';
type Errors = Partial<Record<FieldName, string>>;

export interface TransactionDraft {
  type?: TxType;
  account_id?: string;
}

export function TransactionForm({
  open,
  onOpenChange,
  transaction,
  draft,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  transaction?: Transaction | null;
  draft?: TransactionDraft;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const save = useSaveTransaction();
  const del = useDeleteTransactions();

  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => !a.archived || a.id === transaction?.account_id || a.id === transaction?.to_account_id),
    [accounts.data, transaction],
  );
  const account = activeAccounts.find((a) => a.id === accountId);
  const toAccount = activeAccounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;
  const payees = usePayees(payee.trim());

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setTagDraft('');
    const firstAccount = activeAccounts.find((a) => !a.archived);
    if (transaction) {
      const exp = currencyExponent(transaction.currency);
      setType(transaction.type);
      setAmount(minorToInput(transaction.amount_minor, exp));
      setAccountId(transaction.account_id);
      setToAccountId(transaction.to_account_id ?? '');
      setToAmount(
        transaction.to_amount_minor != null && transaction.to_currency
          ? minorToInput(transaction.to_amount_minor, currencyExponent(transaction.to_currency))
          : '',
      );
      setDate(transaction.date);
      setCategoryId(transaction.category_id ?? '');
      setPayee(transaction.payee ?? '');
      setDescription(transaction.description ?? '');
      setPaymentMethod(transaction.payment_method ?? '');
      setTags(transaction.tags);
      setNotes(transaction.notes ?? '');
    } else {
      setType(draft?.type ?? 'expense');
      setAmount('');
      setAccountId(draft?.account_id ?? firstAccount?.id ?? '');
      setToAccountId('');
      setToAmount('');
      setDate(todayISO());
      setCategoryId('');
      setPayee('');
      setDescription('');
      setPaymentMethod('');
      setTags([]);
      setNotes('');
    }
    // Only re-initialise when the dialog opens or the target changes.
  }, [open, transaction]);

  function addTag(raw: string) {
    const v = raw.trim().replace(/,$/, '').trim();
    if (!v) return;
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase()) && tags.length < 10) setTags([...tags, v.slice(0, 40)]);
    setTagDraft('');
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
      setTags(tags.slice(0, -1));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    const exp = currencyExponent(account?.currency ?? 'EUR');
    const amountMinor = parseAmount(amount, exp);
    if (amountMinor === null || amountMinor <= 0) errs.amount_minor = t('validation.amount_positive');
    if (!accountId) errs.account_id = t('validation.required');
    if (!date) errs.date = t('validation.required');
    let toAmountMinor: number | null = null;
    if (type === 'transfer') {
      if (!toAccountId) errs.to_account_id = t('validation.required');
      else if (toAccountId === accountId) errs.to_account_id = t('transactions.same_account');
      if (crossCurrency) {
        toAmountMinor = parseAmount(toAmount, currencyExponent(toAccount!.currency));
        if (toAmountMinor === null || toAmountMinor <= 0) errs.to_amount_minor = t('validation.amount_positive');
      }
    }
    const pendingTags = tagDraft.trim() ? [...tags, tagDraft.trim()] : tags;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      await save.mutateAsync({
        ...(transaction ? { id: transaction.id } : {}),
        input: {
          type,
          account_id: accountId,
          amount_minor: amountMinor!,
          to_account_id: type === 'transfer' ? toAccountId : null,
          to_amount_minor: type === 'transfer' && crossCurrency ? toAmountMinor : null,
          date,
          category_id: type === 'transfer' ? null : categoryId || null,
          payee: payee.trim() || null,
          description: description.trim() || null,
          notes: notes.trim() || null,
          payment_method: paymentMethod || null,
          tags: pendingTags,
        },
      });
      toast(transaction ? t('transactions.updated') : t('transactions.added'));
      onOpenChange(false);
    } catch (err) {
      const fe = fieldError(err);
      const known: FieldName[] = ['amount_minor', 'account_id', 'to_account_id', 'to_amount_minor', 'date', 'category_id', 'payee', 'description', 'notes', 'tags'];
      const key = known.find((k) => k === fe.field) ?? 'form';
      setErrors({ [key]: humanize(fe.message) });
    }
  }

  async function doDelete() {
    if (!transaction) return;
    try {
      await del.mutateAsync([transaction.id]);
      toast(t('transactions.deleted', { count: 1 }));
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  const noAccounts = accounts.isSuccess && activeAccounts.length === 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={transaction ? t('transactions.edit') : t('transactions.new')}
        size="lg"
        footer={
          noAccounts ? (
            <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          ) : (
            <>
              {transaction && (
                <Button variant="ghost" className="mr-auto text-negative hover:text-negative" onClick={() => setConfirmDelete(true)}>
                  {t('common.delete')}
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" form="tx-form" loading={save.isPending}>
                {transaction ? t('common.save') : t('transactions.add_short')}
              </Button>
            </>
          )
        }
      >
        {noAccounts ? (
          <p className="text-sm text-muted">{t('transactions.need_account')}</p>
        ) : (
          <form id="tx-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
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
              <Field label={t('transactions.amount', { currency: account?.currency ?? '' })} error={errors.amount_minor}>
                {(p) => (
                  <Input
                    {...p}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    autoFocus
                    placeholder="0.00"
                    className="tabular h-11 text-[17px] font-medium"
                  />
                )}
              </Field>
              <Field label={t('transactions.date')} error={errors.date}>
                {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />}
              </Field>

              <Field label={type === 'transfer' ? t('transactions.from_account') : t('transactions.account')} error={errors.account_id}>
                {(p) => (
                  <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {activeAccounts.map((a) => (
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
                      {activeAccounts
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
                      keepId={transaction?.category_id ?? null}
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                    />
                  )}
                </Field>
              )}

              {crossCurrency && (
                <Field
                  label={t('transactions.to_amount', { currency: toAccount!.currency })}
                  error={errors.to_amount_minor}
                  hint={t('transactions.to_amount_hint')}
                  className="sm:col-span-2"
                >
                  {(p) => <Input {...p} value={toAmount} onChange={(e) => setToAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
                </Field>
              )}

              {type !== 'transfer' && (
                <Field label={type === 'income' ? t('transactions.payer') : t('transactions.payee')} optional={t('common.optional')} error={errors.payee}>
                  {(p) => (
                    <>
                      <Input {...p} value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} list="payee-suggestions" autoComplete="off" />
                      <datalist id="payee-suggestions">
                        {(payees.data ?? []).map((x) => (
                          <option key={x} value={x} />
                        ))}
                      </datalist>
                    </>
                  )}
                </Field>
              )}
              <Field label={t('transactions.description')} optional={t('common.optional')} error={errors.description} className={type === 'transfer' ? 'sm:col-span-2' : ''}>
                {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />}
              </Field>

              {type !== 'transfer' && (
                <Field label={t('transactions.payment_method')} optional={t('common.optional')}>
                  {(p) => (
                    <Select {...p} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                      <option value="">{t('common.none')}</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`payment_method.${m}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              <Field label={t('transactions.tags')} optional={t('common.optional')} error={errors.tags} hint={t('transactions.tags_hint')} className={type === 'transfer' ? 'sm:col-span-2' : ''}>
                {(p) => (
                  <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    {tags.map((tag) => (
                      <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-sm bg-surface-2 pl-2 pr-1 text-[12.5px] text-text">
                        {tag}
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((x) => x !== tag))}
                          className="rounded-sm p-0.5 text-faint hover:text-text"
                          aria-label={t('transactions.remove_tag', { tag })}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      {...p}
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={onTagKey}
                      onBlur={() => addTag(tagDraft)}
                      maxLength={40}
                      className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                      placeholder={tags.length ? '' : t('transactions.tags_placeholder')}
                    />
                  </div>
                )}
              </Field>

              <Field label={t('transactions.notes')} optional={t('common.optional')} error={errors.notes} className="sm:col-span-2">
                {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />}
              </Field>
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
        title={t('transactions.delete_title', { count: 1 })}
        body={t('transactions.delete_body', { count: 1 })}
        confirmLabel={t('common.delete')}
        onConfirm={() => void doDelete()}
        loading={del.isPending}
      />
    </>
  );
}
