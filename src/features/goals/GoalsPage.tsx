import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeleteGoal, useGoals, useGoalStatus } from '../../api/hooks';
import type { Goal } from '../../api/types';
import { useLocale } from '../../app/preferences';
import { Meter } from '../../components/charts';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Icon, IconButton, LoadingRows, Menu, MenuItem, MenuSeparator, Page, PageHeader, Panel, useToast } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { humanize } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { GoalDetail } from './GoalDetail';
import { GoalForm } from './GoalForm';

export function GoalsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const goals = useGoals();
  const status = useGoalStatus();
  const del = useDeleteGoal();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const active = useMemo(() => (goals.data ?? []).filter((g) => g.status === 'active'), [goals.data]);
  const done = useMemo(() => (goals.data ?? []).filter((g) => g.status !== 'active'), [goals.data]);
  const detail = (goals.data ?? []).find((g) => g.id === detailId) ?? null;

  async function setStatus(g: Goal, s: Goal['status']) {
    try {
      await status.mutateAsync({ id: g.id, status: s });
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  const card = (g: Goal) => {
    const money = (v: number) => formatMoney(v, g.currency, { locale });
    return (
      <li key={g.id} className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-start gap-2 px-4 pt-4">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetailId(g.id)}>
            <span className="block truncate text-[15px] font-semibold text-text">{g.name}</span>
            <span className="block text-[12.5px] text-muted">
              {g.deadline ? t('goals.by_date', { date: formatDate(g.deadline, locale) }) : t('goals.no_deadline')}
              {g.linked_account_name && ` · ${g.linked_account_name}`}
            </span>
          </button>
          {g.status === 'completed' && <Badge tone="positive">{t('goals.completed')}</Badge>}
          {g.status === 'archived' && <Badge>{t('goals.archived')}</Badge>}
          <Menu
            trigger={
              <IconButton size="sm" label={t('common.actions_for', { name: g.name })}>
                <Icon name="more" />
              </IconButton>
            }
          >
            <MenuItem onSelect={() => setDetailId(g.id)}>{g.linked_account_id ? t('goals.view') : t('goals.add_money')}</MenuItem>
            <MenuItem onSelect={() => { setEditing(g); setFormOpen(true); }}>{t('common.edit')}</MenuItem>
            {g.status !== 'completed' && <MenuItem onSelect={() => void setStatus(g, 'completed')}>{t('goals.mark_complete')}</MenuItem>}
            {g.status !== 'active' && <MenuItem onSelect={() => void setStatus(g, 'active')}>{t('goals.reactivate')}</MenuItem>}
            {g.status !== 'archived' && <MenuItem onSelect={() => void setStatus(g, 'archived')}>{t('goals.archive')}</MenuItem>}
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDeleting(g)}>
              {t('common.delete')}
            </MenuItem>
          </Menu>
        </div>
        <button type="button" className="block w-full px-4 pb-4 pt-3 text-left" onClick={() => setDetailId(g.id)}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="tabular text-[19px] font-semibold text-text">{money(g.saved_minor)}</span>
            <span className="tabular text-[12.5px] text-muted">{t('goals.of_target', { target: money(g.target_minor) })}</span>
          </div>
          <Meter valueBp={g.progress_bp} label={g.name} />
          <div className="mt-2 flex justify-between text-[12.5px] text-muted">
            <span className="tabular">{(g.progress_bp / 100).toFixed(0)}%</span>
            <span className="tabular">
              {g.remaining_minor === 0
                ? t('goals.reached')
                : g.monthly_needed_minor !== null
                  ? t('goals.per_month', { amount: money(g.monthly_needed_minor) })
                  : t('goals.remaining', { amount: money(g.remaining_minor) })}
            </span>
          </div>
        </button>
      </li>
    );
  };

  return (
    <Page>
      <PageHeader
        title={t('nav.goals')}
        actions={
          <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Icon name="plus" />
            {t('goals.new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        {goals.isLoading ? (
          <Panel>
            <LoadingRows label={t('common.loading')} rows={3} />
          </Panel>
        ) : goals.isError ? (
          <Panel>
            <ErrorState title={t('common.load_failed')} message={goals.error.message} />
          </Panel>
        ) : (goals.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              title={t('goals.empty_title')}
              body={t('goals.empty_body')}
              action={
                <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  {t('goals.new')}
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {active.length > 0 && <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{active.map(card)}</ul>}
            {done.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t('goals.finished')}</h2>
                <ul className="grid grid-cols-1 gap-3 opacity-80 md:grid-cols-2 xl:grid-cols-3">{done.map(card)}</ul>
              </section>
            )}
          </>
        )}
      </div>
      <GoalForm open={formOpen} onOpenChange={setFormOpen} goal={editing} />
      <GoalDetail goal={detail} onClose={() => setDetailId(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('goals.delete_title')}
        body={t('goals.delete_body', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast(t('goals.deleted'));
            },
            onError: (e) => toast(humanize(e.message), 'negative'),
          })
        }
      />
    </Page>
  );
}
