import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useCurrencies, useSaveGoal } from '../../api/hooks';
import type { Goal } from '../../api/types';
import { useBaseCurrency } from '../../app/preferences';
import { Button, Dialog, Field, Input, Select, useToast } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, minorToInput, parseAmount } from '../../lib/money';

type Errors = Partial<Record<'name' | 'target_minor' | 'deadline' | 'linked_account_id' | 'form', string>>;

export function GoalForm({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal: Goal | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const base = useBaseCurrency();
  const currencies = useCurrencies();
  const accounts = useAccounts(false);
  const save = useSaveGoal();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState(base);
  const [deadline, setDeadline] = useState('');
  const [mode, setMode] = useState<'manual' | 'account'>('manual');
  const [linked, setLinked] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setName(goal?.name ?? '');
    setCurrency(goal?.currency ?? base);
    setTarget(goal ? minorToInput(goal.target_minor, currencyExponent(goal.currency)) : '');
    setDeadline(goal?.deadline ?? '');
    setMode(goal?.linked_account_id ? 'account' : 'manual');
    setLinked(goal?.linked_account_id ?? '');
  }, [open, goal, base]);

  const sameCurrencyAccounts = (accounts.data ?? []).filter((a) => a.currency === currency);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!name.trim()) errs.name = t('validation.required');
    const v = parseAmount(target, currencyExponent(currency));
    if (v === null || v <= 0) errs.target_minor = t('validation.amount_positive');
    if (mode === 'account' && !linked) errs.linked_account_id = t('validation.required');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync({
        ...(goal ? { id: goal.id } : {}),
        input: { name: name.trim(), target_minor: v!, currency, deadline: deadline || null, linked_account_id: mode === 'account' ? linked : null },
      });
      toast(goal ? t('goals.updated') : t('goals.created'));
      onOpenChange(false);
    } catch (err) {
      const fe = fieldError(err);
      const known = ['name', 'target_minor', 'deadline', 'linked_account_id'] as const;
      setErrors({ [known.find((k) => k === fe.field) ?? 'form']: humanize(fe.message) });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? t('goals.edit') : t('goals.new')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="goal-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('goals.name')} error={errors.name} className="sm:col-span-2">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('goals.name_placeholder')} autoFocus />}
        </Field>
        <Field label={t('goals.target')} error={errors.target_minor}>
          {(p) => <Input {...p} value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" />}
        </Field>
        <Field label={t('accounts.currency')}>
          {(p) => (
            <Select {...p} value={currency} disabled={!!goal && goal.contribution_count > 0} onChange={(e) => { setCurrency(e.target.value); setLinked(''); }}>
              {(currencies.data ?? [{ code: currency, name: currency, minor_unit: 2 }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('goals.deadline')} optional={t('common.optional')} error={errors.deadline} className="sm:col-span-2">
          {(p) => <Input {...p} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}
        </Field>
        <Field label={t('goals.track')} className="sm:col-span-2" hint={mode === 'account' ? t('goals.track_account_hint') : t('goals.track_manual_hint')}>
          {(p) => (
            <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as 'manual' | 'account')} disabled={!!goal && goal.contribution_count > 0 && mode === 'manual'}>
              <option value="manual">{t('goals.track_manual')}</option>
              <option value="account" disabled={sameCurrencyAccounts.length === 0}>
                {t('goals.track_account')}
              </option>
            </Select>
          )}
        </Field>
        {mode === 'account' && (
          <Field label={t('goals.account')} error={errors.linked_account_id} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={linked} onChange={(e) => setLinked(e.target.value)}>
                <option value="">{t('common.select')}</option>
                {sameCurrencyAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {errors.form && (
          <p role="alert" className="text-sm text-negative sm:col-span-2">
            {errors.form}
          </p>
        )}
      </form>
    </Dialog>
  );
}
