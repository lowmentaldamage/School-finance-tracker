import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAccounts, useArchiveAccount, useDeleteAccount } from '../../api/hooks';
import type { Account } from '../../api/types';
import { useLocale } from '../../app/preferences';
import {
  Amount,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingRows,
  Menu,
  MenuItem,
  MenuSeparator,
  Page,
  PageHeader,
  Panel,
  useToast,
} from '../../components/ui';
import { formatDate, todayISO } from '../../lib/dates';
import { humanize } from '../../lib/errors';
import { formatMoney } from '../../lib/money';
import { AccountForm } from './AccountForm';

export function AccountsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const accounts = useAccounts(true);
  const archive = useArchiveAccount();
  const del = useDeleteAccount();

  const [editing, setEditing] = useState<Account | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const active = useMemo(() => (accounts.data ?? []).filter((a) => !a.archived), [accounts.data]);
  const archived = useMemo(() => (accounts.data ?? []).filter((a) => a.archived), [accounts.data]);

  // Totals per currency. Cross-currency totals need exchange rates (planned with analytics).
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of active) if (a.include_in_net_worth) m.set(a.currency, (m.get(a.currency) ?? 0) + a.balance_minor);
    return [...m.entries()];
  }, [active]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  async function toggleArchive(a: Account) {
    try {
      await archive.mutateAsync({ id: a.id, archived: !a.archived });
      toast(a.archived ? t('accounts.restored') : t('accounts.archived_toast'));
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
      toast(t('accounts.deleted'));
    } catch (e) {
      setDeleteError(humanize((e as Error).message));
    }
  }

  const row = (a: Account) => (
    <li key={a.id} className="group flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => navigate(`/transactions?account=${a.id}`)}
        title={t('accounts.view_transactions')}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{a.name}</span>
          {!a.include_in_net_worth && <Badge>{t('accounts.excluded')}</Badge>}
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted">
          {t(`account_kind.${a.kind}`)} · {a.currency} · {t('accounts.tx_count', { count: a.transaction_count })}
        </div>
      </button>
      <Amount minor={a.balance_minor} currency={a.currency} signed className="text-sm font-medium" muted={a.archived} />
      <Menu
        trigger={
          <IconButton label={t('common.actions_for', { name: a.name })} size="sm">
            <Icon name="more" />
          </IconButton>
        }
      >
        <MenuItem
          onSelect={() => {
            setEditing(a);
            setFormOpen(true);
          }}
        >
          {t('common.edit')}
        </MenuItem>
        <MenuItem onSelect={() => void toggleArchive(a)}>{a.archived ? t('accounts.unarchive') : t('accounts.archive')}</MenuItem>
        {a.transaction_count === 0 && (
          <>
            <MenuSeparator />
            <MenuItem
              danger
              onSelect={() => {
                setDeleteError(null);
                setDeleting(a);
              }}
            >
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
        title={t('nav.accounts')}
        actions={
          <Button variant="primary" onClick={openNew}>
            <Icon name="plus" />
            {t('accounts.new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-4 md:px-8">
        {accounts.isLoading ? (
          <Panel>
            <LoadingRows label={t('common.loading')} rows={3} />
          </Panel>
        ) : accounts.isError ? (
          <Panel>
            <ErrorState title={t('common.load_failed')} message={accounts.error.message} action={<Button onClick={() => void accounts.refetch()}>{t('common.retry')}</Button>} />
          </Panel>
        ) : active.length === 0 && archived.length === 0 ? (
          <Panel>
            <EmptyState
              title={t('accounts.empty_title')}
              body={t('accounts.empty_body')}
              action={
                <Button variant="primary" onClick={openNew}>
                  {t('accounts.new')}
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {totals.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {totals.map(([cur, sum]) => (
                  <div key={cur} className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-sm">
                    <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-muted">
                      {t('accounts.total_in', { currency: cur })}
                    </div>
                    <div className={`tabular mt-1 text-[22px] font-semibold tracking-[-0.01em] ${sum < 0 ? 'text-negative' : 'text-text'}`}>
                      {formatMoney(sum, cur, { locale })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {active.length > 0 && (
              <Panel title={t('accounts.active')}>
                <ul className="divide-y divide-border">{active.map(row)}</ul>
              </Panel>
            )}
            {archived.length > 0 && (
              <Panel title={t('accounts.archived')}>
                <ul className="divide-y divide-border opacity-80">{archived.map(row)}</ul>
              </Panel>
            )}
            <p className="text-[12.5px] text-faint">
              {t('accounts.balance_note', { date: formatDate(todayISO(), locale) })}
            </p>
          </>
        )}
      </div>

      <AccountForm open={formOpen} onOpenChange={setFormOpen} account={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('accounts.delete_title')}
        body={t('accounts.delete_body', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDelete()}
        loading={del.isPending}
        error={deleteError}
      />
    </Page>
  );
}
