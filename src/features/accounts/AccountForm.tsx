import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrencies, useSaveAccount } from '../../api/hooks';
import type { Account, AccountKind } from '../../api/types';
import { useBaseCurrency } from '../../app/preferences';
import { Button, Checkbox, Dialog, Field, Input, Select } from '../../components/ui';
import { todayISO } from '../../lib/dates';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, minorToInput, parseSignedAmount } from '../../lib/money';

export const ACCOUNT_KINDS: AccountKind[] = ['checking', 'savings', 'cash', 'credit_card', 'loan', 'investment', 'other'];

type Errors = Partial<Record<'name' | 'opening_balance_minor' | 'opening_date' | 'currency' | 'form', string>>;

export function AccountForm({
  open,
  onOpenChange,
  account,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  account?: Account | null;
  onSaved?: (a: Account) => void;
}) {
  const { t } = useTranslation();
  const base = useBaseCurrency();
  const currencies = useCurrencies();
  const save = useSaveAccount();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('checking');
  const [currency, setCurrency] = useState(base);
  const [opening, setOpening] = useState('');
  const [openingDate, setOpeningDate] = useState(todayISO());
  const [includeNw, setIncludeNw] = useState(true);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (account) {
      setName(account.name);
      setKind(account.kind);
      setCurrency(account.currency);
      const liability = account.kind === 'credit_card' || account.kind === 'loan';
      const shown = liability ? -account.opening_balance_minor : account.opening_balance_minor;
      setOpening(shown === 0 ? '' : minorToInput(shown, currencyExponent(account.currency)));
      setOpeningDate(account.opening_date);
      setIncludeNw(account.include_in_net_worth);
    } else {
      setName('');
      setKind('checking');
      setCurrency(base);
      setOpening('');
      setOpeningDate(todayISO());
      setIncludeNw(true);
    }
  }, [open, account, base]);

  const isLiability = kind === 'credit_card' || kind === 'loan';
  const currencyLocked = !!account && account.transaction_count > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!name.trim()) errs.name = t('validation.required');
    let openingMinor = 0;
    if (opening.trim()) {
      const v = parseSignedAmount(opening, currencyExponent(currency));
      if (v === null) errs.opening_balance_minor = t('validation.amount');
      // Liabilities are entered as the amount owed and stored as a negative balance.
      else openingMinor = isLiability ? -v : v;
    }
    if (!openingDate) errs.opening_date = t('validation.required');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      const saved = await save.mutateAsync({
        ...(account ? { id: account.id } : {}),
        input: {
          name: name.trim(),
          kind,
          currency,
          opening_balance_minor: openingMinor,
          opening_date: openingDate,
          include_in_net_worth: includeNw,
        },
      });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      const fe = fieldError(err);
      const known: Array<keyof Errors> = ['name', 'opening_balance_minor', 'opening_date', 'currency'];
      const key = known.find((k) => k === fe.field) ?? 'form';
      setErrors({ [key]: humanize(fe.message) });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={account ? t('accounts.edit') : t('accounts.new')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="account-form" loading={save.isPending}>
            {account ? t('common.save') : t('accounts.create')}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <Field label={t('accounts.name')} error={errors.name} className="sm:col-span-2">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder={t('accounts.name_placeholder')} />}
        </Field>
        <Field label={t('accounts.kind')}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`account_kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('accounts.currency')} error={errors.currency} hint={currencyLocked ? t('accounts.currency_locked') : undefined}>
          {(p) => (
            <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={currencyLocked}>
              {(currencies.data ?? [{ code: currency, name: currency, minor_unit: 2 }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={isLiability ? t('accounts.opening_owed') : t('accounts.opening_balance')}
          error={errors.opening_balance_minor}
          hint={isLiability ? t('accounts.opening_owed_hint') : t('accounts.opening_hint')}
        >
          {(p) => <Input {...p} value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
        </Field>
        <Field label={t('accounts.opening_date')} error={errors.opening_date}>
          {(p) => <Input {...p} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label={t('accounts.include_net_worth')} checked={includeNw} onChange={(e) => setIncludeNw(e.target.checked)} />
        </div>
        {errors.form && (
          <p role="alert" className="text-sm text-negative sm:col-span-2">
            {errors.form}
          </p>
        )}
      </form>
    </Dialog>
  );
}
