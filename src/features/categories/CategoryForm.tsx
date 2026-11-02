import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategories, useSaveCategory } from '../../api/hooks';
import type { Category, CategoryKind } from '../../api/types';
import { Button, Dialog, Field, Input, Segmented, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { fieldError, humanize } from '../../lib/errors';
import { CATEGORY_COLORS } from './palette';

type Errors = Partial<Record<'name' | 'color' | 'parent_id' | 'form', string>>;

export interface CategoryFormTarget {
  category?: Category;
  kind?: CategoryKind;
  parentId?: string | null;
}

export function CategoryForm({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: CategoryFormTarget;
}) {
  const { t } = useTranslation();
  const save = useSaveCategory();
  const all = useCategories(false);
  const editing = target.category;

  const [kind, setKind] = useState<CategoryKind>('expense');
  const [name, setName] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[0]!);
  const [parentId, setParentId] = useState<string>('');
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setKind(editing?.kind ?? target.kind ?? 'expense');
    setName(editing?.name ?? '');
    setColor(editing?.color ?? CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]!);
    setParentId(editing?.parent_id ?? target.parentId ?? '');
  }, [open, editing, target.kind, target.parentId]);

  const hasChildren = useMemo(
    () => !!editing && (all.data ?? []).some((c) => c.parent_id === editing.id),
    [all.data, editing],
  );
  const parents = useMemo(
    () => (all.data ?? []).filter((c) => c.parent_id === null && c.kind === kind && c.id !== editing?.id),
    [all.data, kind, editing],
  );
  const kindLocked = !!editing && (editing.transaction_count > 0 || hasChildren);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: t('validation.required') });
      return;
    }
    try {
      await save.mutateAsync({
        ...(editing ? { id: editing.id } : {}),
        input: { kind, name: name.trim(), color, parent_id: parentId || null },
      });
      onOpenChange(false);
    } catch (err) {
      const fe = fieldError(err);
      const known: Array<keyof Errors> = ['name', 'color', 'parent_id'];
      const key = known.find((k) => k === fe.field) ?? (fe.message.includes('name') ? 'name' : 'form');
      setErrors({ [key]: humanize(fe.message) });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t('categories.edit') : parentId ? t('categories.new_sub') : t('categories.new')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="category-form" loading={save.isPending}>
            {editing ? t('common.save') : t('categories.create')}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!kindLocked && (
          <Segmented
            label={t('categories.kind')}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setParentId('');
            }}
            options={[
              { value: 'expense', label: t('categories.expense') },
              { value: 'income', label: t('categories.income') },
            ]}
            className="self-start"
          />
        )}
        <Field label={t('categories.name')} error={errors.name}>
          {(p) => <Input {...p} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />}
        </Field>
        {!hasChildren && (
          <Field label={t('categories.parent')} optional={t('common.optional')} error={errors.parent_id}>
            {(p) => (
              <Select {...p} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t('categories.no_parent')}</option>
                {parents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-text">{t('categories.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={color === c}
                className={cn(
                  'size-7 rounded-md border-2 transition-transform duration-100',
                  color === c ? 'scale-105 border-text' : 'border-transparent hover:scale-105',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-border-strong text-[11px] text-muted" title={t('categories.custom_color')}>
              +
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t('categories.custom_color')}
              />
            </label>
          </div>
        </fieldset>
        {errors.form && (
          <p role="alert" className="text-sm text-negative">
            {errors.form}
          </p>
        )}
      </form>
    </Dialog>
  );
}
