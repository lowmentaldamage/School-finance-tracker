import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategories, useSetBudget } from '../../api/hooks';
import type { BudgetLine } from '../../api/types';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import { Button, Checkbox, Dialog, Field, Input, Select } from '../../components/ui';
import { fieldError, humanize } from '../../lib/errors';
import { currencyExponent, minorToInput, parseAmount } from '../../lib/money';
import { formatMonth } from '../../lib/period';

export interface BudgetTarget {
  /** Existing line being edited, if any. */
  line?: BudgetLine;
  /** 'overall' for the monthly cap, a category id, or undefined to choose. */
  categoryId?: string | 'overall';
}

export function BudgetForm({
  open,
  onOpenChange,
  month,
  target,
  budgetedIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  month: string;
  target: BudgetTarget;
  budgetedIds: string[];
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const exp = currencyExponent(base);
  const categories = useCategories(false);
  const save = useSetBudget();

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmRemove(false);
    setCategoryId(target.categoryId ?? target.line?.category_id ?? '');
    setAmount(target.line ? minorToInput(target.line.limit_minor, exp) : '');
    setRollover(target.line?.rollover ?? false);
  }, [open, target, exp]);

  const editing = !!target.line;
  const options = (categories.data ?? []).filter((c) => c.kind === 'expense' && c.parent_id === null && (!budgetedIds.includes(c.id) || c.id === categoryId));

  async function submit(limitMinor: number) {
    setError(null);
    try {
      await save.mutateAsync({
        category_id: categoryId === 'overall' ? null : categoryId,
        month,
        limit_minor: limitMinor,
        rollover: limitMinor === 0 ? false : rollover,
      });
      onOpenChange(false);
    } catch (e) {
      setError(humanize(fieldError(e).message));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError(t('budgets.choose_category'));
      return;
    }
    const v = parseAmount(amount, exp);
    if (v === null || v <= 0) {
      setError(t('validation.amount_positive'));
      return;
    }
    void submit(v);
  }

  const title = editing ? t('budgets.edit') : t('budgets.add');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={t('budgets.applies_from', { month: formatMonth(month, locale) })}
      footer={
        <>
          {editing &&
            (confirmRemove ? (
              <Button variant="danger" className="mr-auto" loading={save.isPending} onClick={() => void submit(0)}>
                {t('budgets.confirm_remove')}
              </Button>
            ) : (
              <Button variant="ghost" className="mr-auto text-negative hover:text-negative" onClick={() => setConfirmRemove(true)}>
                {t('budgets.remove')}
              </Button>
            ))}
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="budget-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="budget-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {!editing && target.categoryId !== 'overall' && (
          <Field label={t('budgets.category')}>
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('common.select')}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {(editing || target.categoryId === 'overall') && (
          <p className="text-sm font-medium text-text">{categoryId === 'overall' || target.categoryId === 'overall' ? t('budgets.overall') : target.line?.name}</p>
        )}
        <Field label={t('budgets.limit', { currency: base })} hint={t('budgets.limit_hint')}>
          {(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="tabular" autoFocus />}
        </Field>
        <div>
          <Checkbox label={t('budgets.rollover')} checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
          <p className="mt-1 pl-6 text-[12px] text-muted">{t('budgets.rollover_hint')}</p>
        </div>
        {confirmRemove && <p className="text-sm text-muted">{t('budgets.remove_body', { month: formatMonth(month, locale) })}</p>}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
