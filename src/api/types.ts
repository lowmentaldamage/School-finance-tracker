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
}

export type KeyProtection = 'dpapi' | 'plain' | 'development';

export interface AppStatus {
  ready: boolean;
  error: ApiErrorPayload | null;
  key_protection?: KeyProtection;
}

export interface ApiErrorPayload {
  code: string;
  field: string | null;
  message: string;
}
