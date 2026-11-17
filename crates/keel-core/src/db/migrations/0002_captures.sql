-- Bank notifications captured on the phone, waiting to be added (or already handled).
CREATE TABLE captures (
  id             TEXT PRIMARY KEY,
  dedupe_key     TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 128),
  source_package TEXT NOT NULL CHECK (length(source_package) BETWEEN 1 AND 200),
  source_app     TEXT NOT NULL CHECK (length(source_app) <= 120),
  title          TEXT NOT NULL CHECK (length(title) <= 300),
  body           TEXT NOT NULL CHECK (length(body) <= 1000),
  posted_at      TEXT NOT NULL,
  date           TEXT NOT NULL CHECK (length(date) = 10),
  type           TEXT CHECK (type IN ('income','expense')),
  amount_minor   INTEGER CHECK (amount_minor > 0),
  currency       TEXT CHECK (length(currency) = 3),
  payee          TEXT CHECK (length(payee) <= 120),
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','added','dismissed')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_captures_status ON captures(status, posted_at DESC);
