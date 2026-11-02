import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useCategories, useTags } from '../../api/hooks';
import type { PaymentMethod, TxType } from '../../api/types';
import { Button, Dialog, Field, Input, Select } from '../../components/ui';
import { CategorySelect } from './CategorySelect';
import { DEFAULT_FILTERS, type FilterState, type Period } from './filters';
import { PAYMENT_METHODS } from './TransactionForm';

const PERIODS: Period[] = ['all', 'this_month', 'last_month', 'last_3_months', 'this_year', 'custom'];

export function FilterDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: FilterState;
  onApply: (v: FilterState) => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const tags = useTags();
  const [s, setS] = useState(value);

  useEffect(() => {
    if (open) setS(value);
  }, [open, value]);

  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => setS((p) => ({ ...p, [k]: v }));
  const catKind = s.type === 'income' ? 'income' : 'expense';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('filters.title')}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => setS({ ...DEFAULT_FILTERS, q: s.q, sort: s.sort, dir: s.dir })}
          >
            {t('filters.reset')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply({ ...s, page: 0 });
              onOpenChange(false);
            }}
          >
            {t('filters.apply')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('filters.period')} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={s.period} onChange={(e) => set('period', e.target.value as Period)}>
              {PERIODS.map((x) => (
                <option key={x} value={x}>
                  {t(`period.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {s.period === 'custom' && (
          <>
            <Field label={t('filters.from')}>{(p) => <Input {...p} type="date" value={s.from} onChange={(e) => set('from', e.target.value)} />}</Field>
            <Field label={t('filters.to')}>{(p) => <Input {...p} type="date" value={s.to} onChange={(e) => set('to', e.target.value)} />}</Field>
          </>
        )}
        <Field label={t('filters.type')}>
          {(p) => (
            <Select
              {...p}
              value={s.type}
              onChange={(e) => {
                const v = e.target.value as '' | TxType;
                setS((prev) => ({ ...prev, type: v, category: v === 'transfer' ? '' : prev.category }));
              }}
            >
              <option value="">{t('filters.any')}</option>
              <option value="expense">{t('tx_type.expense')}</option>
              <option value="income">{t('tx_type.income')}</option>
              <option value="transfer">{t('tx_type.transfer')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('filters.account')}>
          {(p) => (
            <Select {...p} value={s.account} onChange={(e) => set('account', e.target.value)}>
              <option value="">{t('filters.any')}</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {s.type !== 'transfer' && (
          <Field label={t('filters.category')}>
            {(p) =>
              s.type ? (
                <CategorySelect
                  {...p}
                  categories={categories.data ?? []}
                  kind={catKind}
                  keepId={s.category}
                  emptyLabel={t('filters.any')}
                  value={s.category}
                  onChange={(e) => set('category', e.target.value)}
                />
              ) : (
                <Select {...p} value={s.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">{t('filters.any')}</option>
                  <option value="none">{t('transactions.uncategorized')}</option>
                  {(['expense', 'income'] as const).map((k) => (
                    <optgroup key={k} label={t(`categories.${k}`)}>
                      {(categories.data ?? [])
                        .filter((c) => c.kind === k)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.parent_id ? ' ' : ''}
                            {c.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              )
            }
          </Field>
        )}
        <Field label={t('filters.tag')}>
          {(p) => (
            <Select {...p} value={s.tag} onChange={(e) => set('tag', e.target.value)} disabled={(tags.data ?? []).length === 0}>
              <option value="">{t('filters.any')}</option>
              {(tags.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('filters.payment_method')}>
          {(p) => (
            <Select {...p} value={s.method} onChange={(e) => set('method', e.target.value as '' | PaymentMethod)}>
              <option value="">{t('filters.any')}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`payment_method.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('filters.min')}>
          {(p) => <Input {...p} inputMode="decimal" value={s.min} onChange={(e) => set('min', e.target.value)} placeholder="0.00" className="tabular" />}
        </Field>
        <Field label={t('filters.max')}>
          {(p) => <Input {...p} inputMode="decimal" value={s.max} onChange={(e) => set('max', e.target.value)} placeholder="0.00" className="tabular" />}
        </Field>
      </div>
    </Dialog>
  );
}
