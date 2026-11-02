-- Keel schema v1. Money is INTEGER minor units. Dates are TEXT 'YYYY-MM-DD'.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE currencies (
  code        TEXT PRIMARY KEY CHECK (length(code) = 3 AND code = upper(code)),
  minor_unit  INTEGER NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  name        TEXT NOT NULL
);

INSERT INTO currencies (code, minor_unit, name) VALUES
  ('EUR', 2, 'Euro'),
  ('USD', 2, 'US Dollar'),
  ('GBP', 2, 'British Pound'),
  ('CHF', 2, 'Swiss Franc'),
  ('SEK', 2, 'Swedish Krona'),
  ('NOK', 2, 'Norwegian Krone'),
  ('DKK', 2, 'Danish Krone'),
  ('PLN', 2, 'Polish Złoty'),
  ('CZK', 2, 'Czech Koruna'),
  ('HUF', 2, 'Hungarian Forint'),
  ('RON', 2, 'Romanian Leu'),
  ('BGN', 2, 'Bulgarian Lev'),
  ('TRY', 2, 'Turkish Lira'),
  ('CAD', 2, 'Canadian Dollar'),
  ('AUD', 2, 'Australian Dollar'),
  ('NZD', 2, 'New Zealand Dollar'),
  ('JPY', 0, 'Japanese Yen'),
  ('CNY', 2, 'Chinese Yuan'),
  ('INR', 2, 'Indian Rupee'),
  ('BRL', 2, 'Brazilian Real'),
  ('MXN', 2, 'Mexican Peso'),
  ('ZAR', 2, 'South African Rand'),
  ('KRW', 0, 'South Korean Won'),
  ('SGD', 2, 'Singapore Dollar'),
  ('HKD', 2, 'Hong Kong Dollar'),
  ('AED', 2, 'UAE Dirham'),
  ('KWD', 3, 'Kuwaiti Dinar');

CREATE TABLE exchange_rates (
  id          TEXT PRIMARY KEY,
  from_code   TEXT NOT NULL REFERENCES currencies(code),
  to_code     TEXT NOT NULL REFERENCES currencies(code),
  rate_e9     INTEGER NOT NULL CHECK (rate_e9 > 0),
  valid_from  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (from_code, to_code, valid_from),
  CHECK (from_code <> to_code)
);

CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind                  TEXT NOT NULL CHECK (kind IN
                          ('checking','savings','cash','credit_card','loan','investment','other')),
  currency              TEXT NOT NULL REFERENCES currencies(code),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_date          TEXT NOT NULL,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1 CHECK (include_in_net_worth IN (0,1)),
  archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_accounts_name ON accounts(name COLLATE NOCASE);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color       TEXT NOT NULL CHECK (length(color) = 7 AND substr(color,1,1) = '#'),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX ux_categories_name ON categories(kind, IFNULL(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX ix_categories_parent ON categories(parent_id);

-- Subcategories: parent must be top-level and of the same kind; a category with children cannot become a child.
CREATE TRIGGER trg_categories_parent_ins BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'category_parent_invalid')
  WHERE NOT EXISTS (SELECT 1 FROM categories p
                    WHERE p.id = NEW.parent_id AND p.parent_id IS NULL AND p.kind = NEW.kind);
END;

CREATE TRIGGER trg_categories_parent_upd BEFORE UPDATE OF parent_id, kind ON categories
BEGIN
  SELECT RAISE(ABORT, 'category_parent_invalid')
  WHERE NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories p
    WHERE p.id = NEW.parent_id AND p.parent_id IS NULL AND p.kind = NEW.kind AND p.id <> NEW.id);
  SELECT RAISE(ABORT, 'category_has_children')
  WHERE NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM categories c WHERE c.parent_id = NEW.id);
  SELECT RAISE(ABORT, 'category_kind_children')
  WHERE NEW.kind <> OLD.kind AND EXISTS (SELECT 1 FROM categories c WHERE c.parent_id = NEW.id);
END;

CREATE TABLE recurring_rules (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id   TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
  to_amount_minor INTEGER CHECK (to_amount_minor > 0),
  category_id     TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  payee           TEXT CHECK (length(payee) <= 120),
  description     TEXT CHECK (length(description) <= 200),
  payment_method  TEXT CHECK (payment_method IN ('card','cash','bank_transfer','direct_debit','other')),
  freq_unit       TEXT NOT NULL CHECK (freq_unit IN ('day','week','month','year')),
  freq_interval   INTEGER NOT NULL CHECK (freq_interval BETWEEN 1 AND 366),
  anchor_date     TEXT NOT NULL,
  end_date        TEXT,
  next_due_date   TEXT,
  notify          INTEGER NOT NULL DEFAULT 0 CHECK (notify IN (0,1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_recurring_next_due ON recurring_rules(active, next_due_date);

CREATE TABLE recurring_skips (
  rule_id         TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  PRIMARY KEY (rule_id, occurrence_date)
);

CREATE TABLE transactions (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  to_account_id     TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  to_amount_minor   INTEGER CHECK (to_amount_minor > 0),
  date              TEXT NOT NULL,
  category_id       TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  payee             TEXT CHECK (length(payee) <= 120),
  description       TEXT CHECK (length(description) <= 200),
  notes             TEXT CHECK (length(notes) <= 2000),
  payment_method    TEXT CHECK (payment_method IN ('card','cash','bank_transfer','direct_debit','other')),
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,
  occurrence_date   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK ( (type = 'transfer'  AND to_account_id IS NOT NULL AND to_amount_minor IS NOT NULL
                              AND to_account_id <> account_id AND category_id IS NULL)
       OR (type <> 'transfer' AND to_account_id IS NULL AND to_amount_minor IS NULL) )
);
CREATE INDEX ix_tx_date          ON transactions(date DESC);
CREATE INDEX ix_tx_account_date  ON transactions(account_id, date);
CREATE INDEX ix_tx_to_account    ON transactions(to_account_id, date) WHERE to_account_id IS NOT NULL;
CREATE INDEX ix_tx_category_date ON transactions(category_id, date);
CREATE INDEX ix_tx_type_date     ON transactions(type, date);
CREATE UNIQUE INDEX ux_tx_occurrence ON transactions(recurring_rule_id, occurrence_date)
  WHERE recurring_rule_id IS NOT NULL;

-- The category kind must match the transaction type.
CREATE TRIGGER trg_tx_category_kind_ins BEFORE INSERT ON transactions
WHEN NEW.category_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'transaction_category_kind')
  WHERE (SELECT kind FROM categories WHERE id = NEW.category_id) IS NOT NEW.type;
END;
CREATE TRIGGER trg_tx_category_kind_upd BEFORE UPDATE OF category_id, type ON transactions
WHEN NEW.category_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'transaction_category_kind')
  WHERE (SELECT kind FROM categories WHERE id = NEW.category_id) IS NOT NEW.type;
END;

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_tags_name ON tags(name COLLATE NOCASE);

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX ix_tt_tag ON transaction_tags(tag_id);

CREATE TABLE budget_limits (
  id              TEXT PRIMARY KEY,
  category_id     TEXT REFERENCES categories(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL CHECK (length(effective_month) = 7),
  limit_minor     INTEGER NOT NULL CHECK (limit_minor >= 0),
  rollover        INTEGER NOT NULL DEFAULT 0 CHECK (rollover IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_budget_cat     ON budget_limits(category_id, effective_month) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX ux_budget_overall ON budget_limits(effective_month)              WHERE category_id IS NULL;

CREATE TABLE savings_goals (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  target_minor      INTEGER NOT NULL CHECK (target_minor > 0),
  currency          TEXT NOT NULL REFERENCES currencies(code),
  deadline          TEXT,
  linked_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE goal_contributions (
  id             TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor <> 0),
  date           TEXT NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT CHECK (length(note) <= 200),
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_gc_goal_date ON goal_contributions(goal_id, date);

CREATE TABLE backups (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('manual','automatic','pre_restore')),
  file_name   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  schema_ver  INTEGER NOT NULL,
  sha256      TEXT NOT NULL
);

CREATE TABLE security_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT
);
INSERT INTO security_state (id) VALUES (1);
