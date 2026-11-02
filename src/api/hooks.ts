import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import { call } from './client';
import type {
  Balances,
  BudgetHistoryPoint,
  BudgetInput,
  BudgetMonth,
  CategoryTotal,
  Contribution,
  DateRange,
  Goal,
  GoalInput,
  GoalStatus,
  MonthFlow,
  NetWorthPoint,
  Occurrence,
  Rate,
  RateInput,
  RecurringInput,
  RecurringRule,
  Summary,
  Upcoming,
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
const DATA_ROOTS = ['accounts', 'categories', 'tags', 'transactions', 'payees', 'reports', 'budgets', 'recurring', 'goals', 'rates'];

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

// Reports -------------------------------------------------------------------

export function useSummary(range: DateRange) {
  return useQuery({ queryKey: ['reports', 'summary', range], queryFn: () => call<Summary>('reports.summary', { ...range }) });
}

export function useCashflow(range: DateRange) {
  return useQuery({ queryKey: ['reports', 'cashflow', range], queryFn: () => call<MonthFlow[]>('reports.cashflow', { ...range }) });
}

export function useByCategory(range: DateRange, kind: 'income' | 'expense', parentId: string | null = null) {
  return useQuery({
    queryKey: ['reports', 'by_category', range, kind, parentId],
    queryFn: () => call<CategoryTotal[]>('reports.by_category', { range, kind, parent_id: parentId }),
  });
}

export function useBalances() {
  return useQuery({ queryKey: ['reports', 'balances'], queryFn: () => call<Balances>('reports.balances') });
}

export function useNetWorth(range: DateRange) {
  return useQuery({ queryKey: ['reports', 'net_worth', range], queryFn: () => call<NetWorthPoint[]>('reports.net_worth', { ...range }) });
}

export function useActiveMonths() {
  return useQuery({ queryKey: ['reports', 'active_months'], queryFn: () => call<string[]>('reports.active_months') });
}

// Exchange rates ------------------------------------------------------------

export function useRates() {
  return useQuery({ queryKey: ['rates'], queryFn: () => call<Rate[]>('rates.list') });
}

export function useSaveRate() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (input: RateInput) => call<Rate>('rates.upsert', { input }), onSuccess: invalidate });
}

export function useDeleteRate() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => call<null>('rates.delete', { id }), onSuccess: invalidate });
}

// Budgets -------------------------------------------------------------------

export function useBudgetMonth(month: string) {
  return useQuery({ queryKey: ['budgets', 'month', month], queryFn: () => call<BudgetMonth>('budgets.month', { month }) });
}

export function useBudgetHistory(endMonth: string, count = 6) {
  return useQuery({
    queryKey: ['budgets', 'history', endMonth, count],
    queryFn: () => call<BudgetHistoryPoint[]>('budgets.history', { end_month: endMonth, count }),
  });
}

export function useSetBudget() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (input: BudgetInput) => call<null>('budgets.set', { input }), onSuccess: invalidate });
}

// Recurring -----------------------------------------------------------------

export function useRecurring() {
  return useQuery({ queryKey: ['recurring', 'list'], queryFn: () => call<RecurringRule[]>('recurring.list') });
}

export function useUpcoming(days = 30) {
  return useQuery({ queryKey: ['recurring', 'upcoming', days], queryFn: () => call<Upcoming>('recurring.upcoming', { days }) });
}

export function useSaveRecurring() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RecurringInput }) =>
      id ? call<RecurringRule>('recurring.update', { id, input }) : call<RecurringRule>('recurring.create', { input }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => call<null>('recurring.delete', { id }), onSuccess: invalidate });
}

export function useConfirmOccurrence() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ o, amountMinor, date }: { o: Occurrence; amountMinor?: number; date?: string }) =>
      call<Transaction>('recurring.confirm', {
        rule_id: o.rule_id,
        occurrence_date: o.date,
        overrides: { ...(amountMinor !== undefined ? { amount_minor: amountMinor } : {}), ...(date ? { date } : {}) },
      }),
    onSuccess: invalidate,
  });
}

export function useSkipOccurrence() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (o: Occurrence) => call<RecurringRule>('recurring.skip', { rule_id: o.rule_id, occurrence_date: o.date }),
    onSuccess: invalidate,
  });
}

// Goals ---------------------------------------------------------------------

export function useGoals() {
  return useQuery({ queryKey: ['goals', 'list'], queryFn: () => call<Goal[]>('goals.list') });
}

export function useSaveGoal() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: GoalInput }) =>
      id ? call<Goal>('goals.update', { id, input }) : call<Goal>('goals.create', { input }),
    onSuccess: invalidate,
  });
}

export function useGoalStatus() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: GoalStatus }) => call<Goal>('goals.set_status', { id, status }),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => call<null>('goals.delete', { id }), onSuccess: invalidate });
}

export function useContributions(goalId: string | null) {
  return useQuery({
    queryKey: ['goals', 'contributions', goalId],
    queryFn: () => call<Contribution[]>('goals.contributions', { id: goalId }),
    enabled: !!goalId,
  });
}

export function useContribute() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (input: { goal_id: string; amount_minor: number; date: string; note: string | null }) =>
      call<Goal>('goals.contribute', { input }),
    onSuccess: invalidate,
  });
}

export function useDeleteContribution() {
  const invalidate = useInvalidateData();
  return useMutation({ mutationFn: (id: string) => call<Goal>('goals.delete_contribution', { id }), onSuccess: invalidate });
}
