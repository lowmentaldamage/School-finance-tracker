import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useArchiveCategory, useCategories, useDeleteCategory } from '../../api/hooks';
import type { Category, CategoryKind } from '../../api/types';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  Icon,
  IconButton,
  LoadingRows,
  Menu,
  MenuItem,
  MenuSeparator,
  Page,
  PageHeader,
  Panel,
  Segmented,
  Select,
  useToast,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { humanize } from '../../lib/errors';
import { CategoryForm, type CategoryFormTarget } from './CategoryForm';

export function CategoriesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const cats = useCategories(true);
  const archive = useArchiveCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [target, setTarget] = useState<CategoryFormTarget>({});
  const [deleting, setDeleting] = useState<Category | null>(null);

  const tree = useMemo(() => {
    const list = (cats.data ?? []).filter((c) => c.kind === kind && (showArchived || !c.archived));
    const tops = list.filter((c) => c.parent_id === null);
    return tops.map((p) => ({ parent: p, children: list.filter((c) => c.parent_id === p.id) }));
  }, [cats.data, kind, showArchived]);

  const archivedCount = (cats.data ?? []).filter((c) => c.kind === kind && c.archived).length;

  function open(tgt: CategoryFormTarget) {
    setTarget(tgt);
    setFormOpen(true);
  }

  async function toggleArchive(c: Category) {
    try {
      await archive.mutateAsync({ id: c.id, archived: !c.archived });
      toast(c.archived ? t('categories.restored') : t('categories.archived_toast'));
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  const row = (c: Category, child: boolean, childCount = 0) => (
    <li key={c.id} className={cn('flex items-center gap-3 py-2.5 pr-3', child ? 'pl-11' : 'pl-4')}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden="true" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', child ? 'text-text' : 'font-medium text-text', c.archived && 'text-faint line-through')}>
        {c.name}
      </span>
      {c.archived && <Badge>{t('categories.archived')}</Badge>}
      <span className="tabular hidden text-[12.5px] text-faint sm:inline">{t('categories.tx_count', { count: c.transaction_count })}</span>
      <Menu
        trigger={
          <IconButton label={t('common.actions_for', { name: c.name })} size="sm">
            <Icon name="more" />
          </IconButton>
        }
      >
        <MenuItem onSelect={() => open({ category: c })}>{t('common.edit')}</MenuItem>
        {!child && !c.archived && <MenuItem onSelect={() => open({ kind: c.kind, parentId: c.id })}>{t('categories.add_sub')}</MenuItem>}
        <MenuItem onSelect={() => void toggleArchive(c)}>{c.archived ? t('categories.unarchive') : t('categories.archive')}</MenuItem>
        {childCount === 0 && (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDeleting(c)}>
              {t('common.delete')}
            </MenuItem>
          </>
        )}
      </Menu>
    </li>
  );

  return (
    <Page>
      <PageHeader
        title={t('nav.categories')}
        actions={
          <Button variant="primary" onClick={() => open({ kind })}>
            <Icon name="plus" />
            {t('categories.new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label={t('categories.kind')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: t('categories.expense') },
              { value: 'income', label: t('categories.income') },
            ]}
          />
          {archivedCount > 0 && (
            <Checkbox label={t('categories.show_archived', { count: archivedCount })} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          )}
        </div>
        <Panel>
          {cats.isLoading ? (
            <LoadingRows label={t('common.loading')} />
          ) : cats.isError ? (
            <ErrorState title={t('common.load_failed')} message={cats.error.message} />
          ) : tree.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted">{t('categories.empty')}</div>
          ) : (
            <ul className="divide-y divide-border">
              {tree.map(({ parent, children }) => (
                <li key={parent.id}>
                  <ul>
                    {row(parent, false, children.length)}
                    {children.map((c) => row(c, true))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <CategoryForm open={formOpen} onOpenChange={setFormOpen} target={target} />
      <DeleteCategoryDialog category={deleting} all={cats.data ?? []} onClose={() => setDeleting(null)} />
    </Page>
  );
}

function DeleteCategoryDialog({ category, all, onClose }: { category: Category | null; all: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const del = useDeleteCategory();
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => all.filter((c) => category && c.kind === category.kind && c.id !== category.id && !c.archived),
    [all, category],
  );
  const inUse = (category?.transaction_count ?? 0) > 0;

  async function confirm() {
    if (!category) return;
    setError(null);
    if (inUse && !target) {
      setError(t('categories.choose_target'));
      return;
    }
    try {
      await del.mutateAsync({ id: category.id, reassignTo: target || null });
      toast(t('categories.deleted'));
      setTarget('');
      onClose();
    } catch (e) {
      setError(humanize((e as Error).message));
    }
  }

  return (
    <Dialog
      open={!!category}
      onOpenChange={(o) => {
        if (!o) {
          setTarget('');
          setError(null);
          onClose();
        }
      }}
      title={t('categories.delete_title', { name: category?.name ?? '' })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={del.isPending} onClick={() => void confirm()}>
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {inUse ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('categories.delete_in_use', { count: category?.transaction_count ?? 0 })}</p>
          <Field label={t('categories.move_to')}>
            {(p) => (
              <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t('common.select')}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent_id ? `— ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('categories.delete_body')}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </Dialog>
  );
}
