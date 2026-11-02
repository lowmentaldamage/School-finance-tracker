import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import { call } from './client';
import type {
  Account,
  AccountInput,
  Category,
  CategoryInput,
  Currency,
  Settings,
  Tag,
  Transaction,
  TransactionFilter,
  TransactionInput,
  TransactionPage,
} from './types';

export const keys = {
  settings: ['settings'] as const,
  currencies: ['currencies'] as const,
  accounts: (archived: boolean) => ['accounts', { archived }] as const,
  categories: (archived: boolean) => ['categories', { archived }] as const,
  tags: ['tags'] as const,
  transactions: (f: TransactionFilter) => ['transactions', f] as const,
  payees: (prefix: string) => ['payees', prefix] as const,
};

/** Anything that changes balances or transaction lists invalidates these. */
const DATA_ROOTS = ['accounts', 'categories', 'tags', 'transactions', 'payees'];

/**
 * Returns an onSuccess handler that marks data stale. It does not wait for the refetch,
 * so a save completes as soon as the core confirms it; lists refresh in the background.
 */
function useInvalidateData() {
  const qc = useQueryClient();
  return () => {
    for (const k of DATA_ROOTS) void qc.invalidateQueries({ queryKey: [k] });
  };
}

// Settings ------------------------------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => call<Settings>('settings.all'), staleTime: Infinity });
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: keyof Settings; value: unknown }) => call<null>('settings.set', { key, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

export function useCurrencies() {
  return useQuery({ queryKey: keys.currencies, queryFn: () => call<Currency[]>('currencies.list'), staleTime: Infinity });
}

// Accounts ------------------------------------------------------------------

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: keys.accounts(includeArchived),
    queryFn: () => call<Account[]>('accounts.list', { include_archived: includeArchived }),
  });
}

export function useSaveAccount() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AccountInput }) =>
      id ? call<Account>('accounts.update', { id, input }) : call<Account>('accounts.create', { input }),
    onSuccess: invalidate,
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => call<Account>('accounts.archive', { id, archived }),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => call<null>('accounts.delete', { id }), onSuccess: invalidate });
}

// Categories ----------------------------------------------------------------

export function useCategories(includeArchived = false) {
  return useQuery({
    queryKey: keys.categories(includeArchived),
    queryFn: () => call<Category[]>('categories.list', { include_archived: includeArchived }),
  });
}

export function useSaveCategory() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CategoryInput }) =>
      id ? call<Category>('categories.update', { id, input }) : call<Category>('categories.create', { input }),
    onSuccess: invalidate,
  });
}

export function useArchiveCategory() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      call<Category>('categories.archive', { id, archived }),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo: string | null }) =>
      call<null>('categories.delete', { id, reassign_to: reassignTo }),
    onSuccess: invalidate,
  });
}

// Tags ----------------------------------------------------------------------

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => call<Tag[]>('tags.list') });
}

// Transactions --------------------------------------------------------------

export function useTransactions(filter: TransactionFilter) {
  return useQuery({
    queryKey: keys.transactions(filter),
    queryFn: () => call<TransactionPage>('transactions.list', { filter }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveTransaction() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TransactionInput }) =>
      id ? call<Transaction>('transactions.update', { id, input }) : call<Transaction>('transactions.create', { input }),
    onSuccess: invalidate,
  });
}

export function useDeleteTransactions() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (ids: string[]) => call<number>('transactions.delete_many', { ids }),
    onSuccess: invalidate,
  });
}

export function usePayees(prefix: string) {
  return useQuery({
    queryKey: keys.payees(prefix),
    queryFn: () => call<string[]>('transactions.payees', { prefix, limit: 8 }),
    staleTime: 30_000,
  });
}
