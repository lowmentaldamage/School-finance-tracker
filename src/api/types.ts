// Mirrors the Rust types in crates/keel-core. Amounts are integer minor units.

export type AccountKind = 'checking' | 'savings' | 'cash' | 'credit_card' | 'loan' | 'investment' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TxType = 'income' | 'expense' | 'transfer';
export type PaymentMethod = 'card' | 'cash' | 'bank_transfer' | 'direct_debit' | 'other';

export interface Currency {
  code: string;
  minor_unit: number;
  name: string;
}

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  opening_balance_minor: number;
  opening_date: string;
  include_in_net_worth: boolean;
  archived: boolean;
  sort_order: number;
  balance_minor: number;
  transaction_count: number;
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  currency: string;
  opening_balance_minor: number;
  opening_date: string;
  include_in_net_worth: boolean;
}

export interface Category {
  id: string;
  parent_id: string | null;
  kind: CategoryKind;
  name: string;
  color: string;
  is_default: boolean;
  archived: boolean;
  sort_order: number;
  transaction_count: number;
}

export interface CategoryInput {
  kind: CategoryKind;
  name: string;
  color: string;
  parent_id: string | null;
}

export interface Tag {
  id: string;
  name: string;
  usage_count: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  account_id: string;
  account_name: string;
  currency: string;
  amount_minor: number;
  to_account_id: string | null;
  to_account_name: string | null;
  to_currency: string | null;
  to_amount_minor: number | null;
  date: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  payee: string | null;
  description: string | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  recurring_rule_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TransactionInput {
  type: TxType;
  account_id: string;
  amount_minor: number;
  to_account_id?: string | null;
  to_amount_minor?: number | null;
  date: string;
  category_id?: string | null;
  payee?: string | null;
  description?: string | null;
  notes?: string | null;
  payment_method?: PaymentMethod | null;
  tags: string[];
}

export type SortKey = 'date' | 'amount' | 'payee' | 'created';
export type SortDir = 'asc' | 'desc';

export interface TransactionFilter {
  from?: string;
  to?: string;
  account_id?: string;
  types?: TxType[];
  category_ids?: string[];
  uncategorized?: boolean;
  tag_ids?: string[];
  min_amount_minor?: number;
  max_amount_minor?: number;
  search?: string;
  payment_method?: PaymentMethod;
  sort?: SortKey;
  dir?: SortDir;
  limit?: number;
  offset?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  'profile.display_name'?: string;
  base_currency?: string;
  'locale.number'?: string;
  'locale.date'?: string;
  theme?: Theme;
  'dashboard.hidden_sections'?: string[];
  'onboarding.completed'?: boolean;
  'security.auto_lock_minutes'?: number;
  'security.background_lock_secs'?: number;
  'security.hide_in_switcher'?: boolean;
  'backup.auto.enabled'?: boolean;
  'backup.auto.folder_uri'?: string;
  'backup.auto.folder_name'?: string;
  'backup.auto.last_at'?: string;
  'notifications.bills'?: boolean;
  'notifications.budgets'?: boolean;
  'notifications.budget_sent'?: string[];
  'sync.enabled'?: boolean;
  'sync.last_rev'?: string;
  'sync.last_at'?: string;
  'sync.dirty'?: boolean;
  'sync.account_name'?: string;
}

export type KeyProtection = 'android-keystore' | 'plain';
export type LockKind = 'pin' | 'password';

export interface LockInfo {
  kind: LockKind;
  biometric: boolean;
  failed_attempts: number;
  retry_after_secs: number;
}

export interface AppStatus {
  ready: boolean;
  locked: boolean;
  lock: LockInfo | null;
  biometric_available: boolean;
  key_protection: KeyProtection;
  error: ApiErrorPayload | null;
}

export interface FileData {
  file_name: string;
  data_b64: string;
}

export interface BackupSummary {
  schema_version: number;
  created_at: string;
  transactions: number;
  accounts: number;
}

export interface ApiErrorPayload {
  code: string;
  field: string | null;
  message: string;
  retry_after_secs?: number;
}

// Reports --------------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

export interface Summary {
  currency: string;
  income_minor: number;
  expense_minor: number;
  net_minor: number;
  savings_rate_bp: number | null;
  transaction_count: number;
  missing_rates: string[];
}

export interface MonthFlow {
  month: string;
  income_minor: number;
  expense_minor: number;
  net_minor: number;
}

export interface CategoryTotal {
  category_id: string | null;
  name: string | null;
  color: string | null;
  amount_minor: number;
  transaction_count: number;
}

export interface NetWorthPoint {
  date: string;
  assets_minor: number;
  liabilities_minor: number;
  net_minor: number;
}

export interface Balances {
  currency: string;
  assets_minor: number;
  liabilities_minor: number;
  net_minor: number;
  missing_rates: string[];
}

export interface Rate {
  id: string;
  from_code: string;
  to_code: string;
  rate_e9: number;
  valid_from: string;
}

export interface RateInput {
  from_code: string;
  to_code: string;
  rate: string;
  valid_from: string;
}

// Budgets --------------------------------------------------------------------

export type BudgetStatus = 'ok' | 'warning' | 'over';

export interface BudgetLine {
  category_id: string | null;
  name: string | null;
  color: string | null;
  limit_minor: number;
  rollover: boolean;
  carried_minor: number;
  available_minor: number;
  spent_minor: number;
  remaining_minor: number;
  used_bp: number;
  status: BudgetStatus;
  effective_month: string;
}

export interface BudgetMonth {
  month: string;
  currency: string;
  lines: BudgetLine[];
  overall: BudgetLine | null;
  total_available_minor: number;
  total_spent_minor: number;
  unbudgeted_spent_minor: number;
  missing_rates: string[];
}

export interface BudgetInput {
  category_id: string | null;
  month: string;
  limit_minor: number;
  rollover: boolean;
}

export interface BudgetHistoryPoint {
  month: string;
  budgeted_minor: number;
  spent_minor: number;
}

// Recurring ------------------------------------------------------------------

export type FreqUnit = 'day' | 'week' | 'month' | 'year';

export interface RecurringRule {
  id: string;
  type: TxType;
  account_id: string;
  account_name: string;
  currency: string;
  to_account_id: string | null;
  to_account_name: string | null;
  amount_minor: number;
  to_amount_minor: number | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  payee: string | null;
  description: string | null;
  payment_method: PaymentMethod | null;
  freq_unit: FreqUnit;
  freq_interval: number;
  anchor_date: string;
  end_date: string | null;
  next_due_date: string | null;
  active: boolean;
  booked_count: number;
}

export interface RecurringInput {
  type: TxType;
  account_id: string;
  amount_minor: number;
  to_account_id?: string | null;
  to_amount_minor?: number | null;
  category_id?: string | null;
  payee?: string | null;
  description?: string | null;
  payment_method?: PaymentMethod | null;
  freq_unit: FreqUnit;
  freq_interval: number;
  anchor_date: string;
  end_date?: string | null;
  active: boolean;
}

export interface Occurrence {
  rule_id: string;
  date: string;
  due: boolean;
  type: TxType;
  title: string;
  amount_minor: number;
  currency: string;
  account_name: string;
  category_name: string | null;
  category_color: string | null;
}

export interface Upcoming {
  items: Occurrence[];
  currency: string;
  due_count: number;
  income_minor: number;
  expense_minor: number;
  missing_rates: string[];
}

// Goals ----------------------------------------------------------------------

export type GoalStatus = 'active' | 'completed' | 'archived';

export interface Goal {
  id: string;
  name: string;
  target_minor: number;
  currency: string;
  deadline: string | null;
  linked_account_id: string | null;
  linked_account_name: string | null;
  status: GoalStatus;
  saved_minor: number;
  remaining_minor: number;
  progress_bp: number;
  monthly_needed_minor: number | null;
  months_left: number | null;
  contribution_count: number;
  created_at: string;
}

export interface GoalInput {
  name: string;
  target_minor: number;
  currency: string;
  deadline: string | null;
  linked_account_id: string | null;
}

export interface Contribution {
  id: string;
  goal_id: string;
  amount_minor: number;
  date: string;
  note: string | null;
}
