import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useAccounts, useCategories, useDeleteTransactions, useTags, useTransactions } from '../../api/hooks';
import type { SortKey, Transaction } from '../../api/types';
import { useBaseCurrency, useLocale } from '../../app/preferences';
import {
  Amount,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Input,
  LoadingRows,
  Page,
  PageHeader,
  Panel,
  Select,
  useToast,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { dayLabel } from '../../lib/dates';
import { humanize } from '../../lib/errors';
import { currencyExponent, parseAmount } from '../../lib/money';
import { FilterDialog } from './FilterDialog';
import { activeFilterCount, DEFAULT_FILTERS, fromSearchParams, toApiFilter, toSearchParams, type FilterState } from './filters';
import { useQuickAdd } from './QuickAdd';
import { TransactionForm } from './TransactionForm';

const PAGE_SIZE = 50;

export function TransactionsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const base = useBaseCurrency();
  const toast = useToast();
  const quickAdd = useQuickAdd();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => fromSearchParams(params), [params]);
  const update = (s: FilterState) => setParams(toSearchParams(s), { replace: true });

  // Debounced search input bound to the URL.
  const [q, setQ] = useState(state.q);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = window.setTimeout(() => {
      if (q !== state.q) update({ ...state, q, page: 0 });
    }, 250);
    return () => window.clearTimeout(h);
  }, [q]);

  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const tags = useTags();
  const parse = (v: string) => parseAmount(v, currencyExponent(base));
  const filter = useMemo(() => toApiFilter(state, parse, PAGE_SIZE), [state, base]);
  const txs = useTransactions(filter);
  const del = useDeleteTransactions();

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => setSelected(new Set()), [filter]);

  const items = txs.data?.items ?? [];
  const total = txs.data?.total ?? 0;
  const groupByDay = state.sort === 'date';
  const nFilters = activeFilterCount(state);
  const hasAccounts = (accounts.data ?? []).some((a) => !a.archived);

  const chips = useMemo(() => {
    const c: Array<{ key: keyof FilterState; label: string }> = [];
    if (state.period !== 'all') {
      const label = state.period === 'custom' ? `${state.from || '…'} – ${state.to || '…'}` : t(`period.${state.period}`);
      c.push({ key: 'period', label });
    }
    if (state.type) c.push({ key: 'type', label: t(`tx_type.${state.type}`) });
    if (state.account) c.push({ key: 'account', label: accounts.data?.find((a) => a.id === state.account)?.name ?? t('filters.account') });
    if (state.category)
      c.push({
        key: 'category',
        label: state.category === 'none' ? t('transactions.uncategorized') : categories.data?.find((x) => x.id === state.category)?.name ?? t('filters.category'),
      });
    if (state.tag) c.push({ key: 'tag', label: `#${tags.data?.find((x) => x.id === state.tag)?.name ?? ''}` });
    if (state.method) c.push({ key: 'method', label: t(`payment_method.${state.method}`) });
    if (state.min) c.push({ key: 'min', label: `≥ ${state.min}` });
    if (state.max) c.push({ key: 'max', label: `≤ ${state.max}` });
    return c;
  }, [state, accounts.data, categories.data, tags.data, t]);

  function clearChip(key: keyof FilterState) {
    const next = { ...state, [key]: DEFAULT_FILTERS[key], page: 0 };
    if (key === 'period') {
      next.from = '';
      next.to = '';
    }
    update(next);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulkDelete() {
    try {
      const n = await del.mutateAsync([...selected]);
      toast(t('transactions.deleted', { count: n }));
      setSelected(new Set());
      setConfirmBulk(false);
    } catch (e) {
      toast(humanize((e as Error).message), 'negative');
    }
  }

  const groups = useMemo(() => {
    if (!groupByDay) return [{ key: 'all', label: '', items }];
    const out: Array<{ key: string; label: string; items: Transaction[] }> = [];
    for (const tx of items) {
      const last = out[out.length - 1];
      if (last && last.key === tx.date) last.items.push(tx);
      else out.push({ key: tx.date, label: dayLabel(tx.date, locale, { today: t('dates.today'), yesterday: t('dates.yesterday') }), items: [tx] });
    }
    return out;
  }, [items, groupByDay, locale, t]);

  const from = total === 0 ? 0 : state.page * PAGE_SIZE + 1;
  const to = Math.min(total, (state.page + 1) * PAGE_SIZE);

  return (
    <Page>
      <PageHeader
        title={t('nav.transactions')}
        subtitle={txs.isSuccess ? t('transactions.count', { count: total }) : undefined}
        actions={
          <Button variant="primary" onClick={() => quickAdd.open(state.account ? { account_id: state.account } : undefined)} className="max-md:hidden">
            <Icon name="plus" />
            {t('transactions.add')}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 px-4 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('transactions.search')}
              aria-label={t('transactions.search')}
              className="pl-9"
              maxLength={100}
            />
          </div>
          <Button onClick={() => setFiltersOpen(true)} aria-label={t('filters.title')}>
            <Icon name="filter" />
            <span className="hidden sm:inline">{t('filters.title')}</span>
            {nFilters > 0 && <span className="tabular rounded-sm bg-text px-1 text-[11px] text-bg">{nFilters}</span>}
          </Button>
          <div className="flex items-center gap-1">
            <Select
              aria-label={t('sort.label')}
              value={state.sort}
              onChange={(e) => update({ ...state, sort: e.target.value as SortKey, page: 0 })}
              className="w-[132px]"
            >
              <option value="date">{t('sort.date')}</option>
              <option value="amount">{t('sort.amount')}</option>
              <option value="payee">{t('sort.payee')}</option>
              <option value="created">{t('sort.created')}</option>
            </Select>
            <IconButton
              label={state.dir === 'desc' ? t('sort.desc') : t('sort.asc')}
              onClick={() => update({ ...state, dir: state.dir === 'desc' ? 'asc' : 'desc', page: 0 })}
              variant="secondary"
            >
              <Icon name="arrowUpDown" className={cn('transition-transform', state.dir === 'asc' && 'rotate-180')} />
            </IconButton>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => clearChip(c.key)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text hover:bg-surface-2"
                aria-label={t('filters.remove', { label: c.label })}
              >
                {c.label}
                <Icon name="close" size={12} className="text-faint" />
              </button>
            ))}
            <button type="button" className="h-7 px-2 text-[12.5px] text-muted hover:text-text" onClick={() => update({ ...DEFAULT_FILTERS, q: state.q, sort: state.sort, dir: state.dir })}>
              {t('filters.clear_all')}
            </button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
            <span>{t('transactions.selected', { count: selected.size })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmBulk(true)}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        )}

        <Panel className="overflow-hidden">
          {txs.isLoading ? (
            <LoadingRows label={t('common.loading')} />
          ) : txs.isError ? (
            <ErrorState title={t('common.load_failed')} message={txs.error.message} action={<Button onClick={() => void txs.refetch()}>{t('common.retry')}</Button>} />
          ) : total === 0 ? (
            nFilters > 0 || state.q ? (
              <EmptyState title={t('transactions.no_match')} body={t('transactions.no_match_body')} />
            ) : (
              <EmptyState
                title={t('transactions.empty_title')}
                body={hasAccounts ? t('transactions.empty_body') : t('transactions.need_account')}
                action={
                  hasAccounts ? (
                    <Button variant="primary" onClick={() => quickAdd.open()}>
                      {t('transactions.add')}
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <div className={cn(txs.isFetching && 'opacity-70 transition-opacity')}>
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label || undefined}>
                  {g.label && (
                    <h3 className="sticky top-0 z-10 border-b border-border bg-surface-2/95 px-4 py-1.5 text-[12px] font-medium text-muted backdrop-blur">{g.label}</h3>
                  )}
                  <ul className="divide-y divide-border">
                    {g.items.map((tx) => (
                      <TxRow key={tx.id} tx={tx} showDate={!groupByDay} locale={locale} selected={selected.has(tx.id)} onToggle={() => toggle(tx.id)} onOpen={() => setEditing(tx)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Panel>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span className="tabular">{t('pagination.range', { from, to, total })}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={state.page === 0} onClick={() => update({ ...state, page: state.page - 1 })}>
                <Icon name="chevronLeft" size={14} />
                {t('pagination.prev')}
              </Button>
              <Button size="sm" disabled={to >= total} onClick={() => update({ ...state, page: state.page + 1 })}>
                {t('pagination.next')}
                <Icon name="chevronRight" size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      <FilterDialog open={filtersOpen} onOpenChange={setFiltersOpen} value={state} onApply={update} />
      <TransactionForm open={!!editing} onOpenChange={(o) => !o && setEditing(null)} transaction={editing} />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={t('transactions.delete_title', { count: selected.size })}
        body={t('transactions.delete_body', { count: selected.size })}
        confirmLabel={t('common.delete')}
        onConfirm={() => void bulkDelete()}
        loading={del.isPending}
      />
    </Page>
  );
}

function TxRow({
  tx,
  showDate,
  locale,
  selected,
  onToggle,
  onOpen,
}: {
  tx: Transaction;
  showDate: boolean;
  locale: string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const title =
    tx.type === 'transfer'
      ? t('transactions.transfer_title', { from: tx.account_name, to: tx.to_account_name ?? '' })
      : tx.payee || tx.description || tx.category_name || t('transactions.uncategorized');
  const meta: string[] = [];
  if (tx.type !== 'transfer') {
    if (tx.payee && tx.description) meta.push(tx.description);
    meta.push(tx.category_name ?? t('transactions.uncategorized'));
    meta.push(tx.account_name);
  } else if (tx.description) meta.push(tx.description);
  if (showDate) meta.unshift(new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(tx.date + 'T00:00:00')));

  return (
    <li className={cn('group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60', selected && 'bg-accent-soft/60')}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={t('transactions.select', { name: title })}
        className={cn('hidden size-4 shrink-0 accent-[var(--accent)] md:block', !selected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
      />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span
          aria-hidden="true"
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold', tx.type === 'transfer' ? 'bg-surface-2 text-muted' : 'text-white')}
          style={tx.type !== 'transfer' ? { backgroundColor: tx.category_color ?? 'var(--text-faint)' } : undefined}
        >
          {tx.type === 'transfer' ? <Icon name="transfer" size={15} /> : (tx.category_name ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{title}</span>
          <span className="block truncate text-[12.5px] text-muted">
            {meta.join(' · ')}
            {tx.tags.length > 0 && <span className="text-faint"> · {tx.tags.map((x) => `#${x}`).join(' ')}</span>}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <Amount minor={tx.amount_minor} currency={tx.currency} type={tx.type} className="text-sm font-medium" />
          {tx.type === 'transfer' && tx.to_currency && tx.to_currency !== tx.currency && tx.to_amount_minor != null && (
            <Amount minor={tx.to_amount_minor} currency={tx.to_currency} muted className="text-[12px]" />
          )}
        </span>
      </button>
    </li>
  );
}
