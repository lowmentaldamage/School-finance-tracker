# Keel — Architecture (v1)

Status: **Draft for sign-off**
Last updated: 2026-11-02

---

## 1. Technology stack

| Layer | Choice | Reason |
|---|---|---|
| App shell | **Tauri 2** | One codebase for Windows, Android and iOS. Small binaries (about 5–10 MB on desktop). A Rust backend keeps the database and crypto out of the webview. |
| Backend | **Rust** | Memory-safe, owns all data access, crypto, backup and file I/O |
| Database | **SQLite with SQLCipher** through `rusqlite` (`bundled-sqlcipher`) | Embedded, reliable, encrypted at rest, transactional |
| Frontend | **React 18 + TypeScript (strict) + Vite** | Mature ecosystem and type safety across the UI |
| Styling | **Tailwind CSS** driven by CSS-variable design tokens | Consistent spacing and colour, themeable light/dark |
| UI primitives | **Radix UI** (unstyled, accessible) | Accessible dialogs, menus and selects without imposing a visual style |
| Routing | React Router | Standard and well supported |
| Data fetching | TanStack Query | Caching, loading and error states, invalidation after writes |
| Forms | React Hook Form + Zod | Client validation. The Rust side re-validates every input. |
| Charts | Recharts | SVG-based and React-native; fully restyled to the grey theme |
| i18n | i18next | All text externalised from day one |
| Tests | `cargo test`, Vitest, Testing Library, Playwright | Database, logic, components, end-to-end |

**Mobile risk.** Tauri 2 mobile is newer than Capacitor. All platform-specific behaviour (biometrics, secure storage, notifications, file pickers) sits behind small Rust or TypeScript interfaces. If a Tauri mobile plugin proves inadequate in Phase 6, a platform-specific implementation can replace it without touching features.

## 2. High-level design

```
┌────────────────────────── WebView (React UI) ──────────────────────────┐
│ features/* screens → api/* typed client → @tauri-apps/api invoke()       │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ typed commands (JSON, no SQL)
┌───────────────────────────────▼──────────────────────────────────────────┐
│ Rust core                                                                 │
│  commands/   input validation, DTO mapping, error mapping                │
│  services/   business rules (balances, budgets, recurrence, goals)       │
│  repo/       parameterised SQL only                                       │
│  db/         connection, SQLCipher key, migrations                        │
│  crypto/     key derivation, key wrapping, secure storage bridge          │
│  backup/     encrypted export / import, CSV                               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                     keel.db (SQLCipher, AES-256)
```

Rules:
- **The UI never sends SQL.** It calls named commands (`transactions_list`, `transaction_create`, …) with typed arguments.
- Every command validates its input in Rust (ranges, lengths, enums, foreign-key existence) before touching the database.
- All SQL uses bound parameters. Dynamic sorting and filtering pick from allow-listed column names, never interpolated user strings.
- Multi-row writes (transfers, restores, migrations, recurring confirmations) run inside a database transaction.
- Tauri capabilities allow only Keel's own commands and the required plugins. No shell, no generic filesystem access, no HTTP.
- A strict Content Security Policy is applied: `default-src 'self'`, no remote sources, no `eval`.

## 3. Project structure

```
/
├─ docs/                    requirements, architecture, progress
├─ src/                     React app
│  ├─ app/                  router, providers, layout shell
│  ├─ features/
│  │  ├─ dashboard/
│  │  ├─ transactions/
│  │  ├─ accounts/
│  │  ├─ categories/
│  │  ├─ budgets/
│  │  ├─ analytics/
│  │  ├─ goals/
│  │  ├─ recurring/
│  │  ├─ settings/
│  │  ├─ onboarding/
│  │  └─ lock/
│  ├─ components/ui/        Button, Input, Select, Dialog, Table, Card, …
│  ├─ components/charts/    themed chart wrappers
│  ├─ api/                  typed command client + query hooks
│  ├─ lib/money/            formatting/parsing of minor units
│  ├─ lib/dates/
│  ├─ i18n/
│  └─ styles/tokens.css     design tokens (light/dark)
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/
│  │  ├─ services/
│  │  ├─ repo/
│  │  ├─ db/ (mod.rs, migrations/0001_init.sql, …)
│  │  ├─ crypto/
│  │  ├─ backup/
│  │  └─ domain/            Money, Currency, ids, enums
│  ├─ tests/                integration tests on temp databases
│  ├─ capabilities/
│  └─ tauri.conf.json
├─ e2e/                     Playwright tests
└─ .github/workflows/       CI: test, Windows build, Android build, iOS build
```

## 4. Money and dates

- Amounts are stored as `INTEGER` **minor units** (cents for EUR) in a Rust `Money { minor: i64, currency: CurrencyCode }` type. Adding different currencies without conversion is a compile-time or runtime error.
- Each currency has a `minor_unit` exponent (EUR 2, JPY 0, KWD 3).
- Conversion: `converted_minor = round_half_even(minor × rate)` using an integer rate scaled by 10⁹ (`rate_e9`) in `i128` arithmetic. There are no floats anywhere in the money path.
- Amounts are always stored as **positive** numbers. The direction comes from the transaction type.
- Transaction dates are `TEXT 'YYYY-MM-DD'` (a calendar date, with no time-zone shift). Audit timestamps are UTC ISO-8601.
- The UI parses user input with a locale-aware parser into minor units. Display formatting uses `Intl.NumberFormat`.

## 5. Security model

### 5.1 Key hierarchy (envelope encryption)

```
DEK  (random 256-bit Data Encryption Key) ── encrypts ──► keel.db (SQLCipher)
 │
 ├─ wrapped by OS-KEK     (OS secure storage: Windows DPAPI / Android Keystore / iOS Keychain)
 ├─ wrapped by PIN-KEK    (Argon2id(PIN/password, salt))            — if app lock enabled
 ├─ wrapped by REC-KEK    (Argon2id(recovery key, salt))            — if app lock enabled
 └─ wrapped by BIO-KEK    (Keystore/Keychain key gated by biometrics) — if biometrics enabled
```

- **No app lock:** the DEK is wrapped only by the OS-bound key. The database is unreadable if the file is copied to another machine or user account, but anyone using the unlocked device account can open Keel.
- **App lock enabled:** the OS-only wrapping is removed. The DEK can be unwrapped only with the PIN or password, the recovery key, or biometrics.
- Changing the password re-wraps the DEK; the database is not re-encrypted.
- Wrapping uses XChaCha20-Poly1305 (AEAD). Argon2id parameters are tuned per platform, targeting about 0.5 s (with a memory floor of at least 64 MiB on desktop and 32 MiB on mobile).
- Key material is held in `zeroize`-on-drop buffers and cleared on lock.

### 5.2 Recovery key
A 128-bit random key, shown once as 8 groups of 4 characters (Crockford Base32), which the user writes down. Keel never stores it in plaintext.

### 5.3 Session and lock
- Unlocking opens the database connection in the Rust process. Locking closes it and zeroes the DEK.
- Auto-lock after inactivity (5 minutes by default). On mobile, the app locks immediately when sent to the background, after a configurable grace period.
- Five wrong attempts trigger an increasing delay (30 s, 1 min, 5 min, …), stored in the database.

### 5.4 Honest limitations
- **Malware or someone with access to the unlocked device** can read data while Keel is unlocked. Encryption protects data at rest, not a compromised running system.
- **PIN strength:** a 6-digit PIN has 1,000,000 combinations. With Argon2id at about 0.5 s per guess, an attacker who copies the encrypted file can try them all in about 6 CPU-days, which is feasible with hardware. **A PIN protects against casual access. A strong password protects against a determined attacker.** The UI states this. On Android and iOS, biometrics use hardware-backed keys, which are stronger.
- **No lock set:** protection depends entirely on the OS account. If the OS account is compromised, the data is too.
- **Rooted or jailbroken devices** weaken OS key storage.
- **CSV exports are plaintext** and are protected only by wherever the user saves them.
- **Lost password and lost recovery key** means permanent data loss. That is by design.
- Screenshots and the app-switcher preview: on Android, `FLAG_SECURE` is offered as a setting ("Hide in app switcher"), off by default. On iOS, a blur overlay is applied when the app goes to the background.

### 5.5 Platform hardening
- **Android:** `allowBackup=false`, `dataExtractionRules` excluding everything, minimal permissions (`POST_NOTIFICATIONS`, `USE_BIOMETRIC`, `SCHEDULE_EXACT_ALARM` only if needed). The `INTERNET` permission is removed from the manifest if the Tauri build permits it; this is verified in Phase 6.
- **iOS:** Data Protection class `Complete` on the database file, and no iCloud backup of the database (`isExcludedFromBackup`).
- **Windows:** the database sits in `%APPDATA%\Keel`, with the ACL inherited from the user profile.

## 6. Database schema (migration `0001_init`)

IDs are UUIDv7 stored as `TEXT`. They are time-ordered and unique across devices, which suits future sync. All tables carry `created_at` and `updated_at`. `PRAGMA foreign_keys = ON` and `journal_mode = WAL`.

```sql
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,              -- JSON
  updated_at  TEXT NOT NULL
);

CREATE TABLE currencies (
  code        TEXT PRIMARY KEY CHECK (length(code) = 3),
  minor_unit  INTEGER NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  name        TEXT NOT NULL
);

CREATE TABLE exchange_rates (
  id          TEXT PRIMARY KEY,
  from_code   TEXT NOT NULL REFERENCES currencies(code),
  to_code     TEXT NOT NULL REFERENCES currencies(code),
  rate_e9     INTEGER NOT NULL CHECK (rate_e9 > 0),   -- rate × 10^9
  valid_from  TEXT NOT NULL,                           -- YYYY-MM-DD
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
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,  -- signed; negative for debt
  opening_date          TEXT NOT NULL,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1 CHECK (include_in_net_worth IN (0,1)),
  archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color       TEXT NOT NULL CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  is_default  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_categories_name ON categories(kind, IFNULL(parent_id,''), name COLLATE NOCASE);
-- Two-level depth and parent.kind = child.kind are enforced in the service layer + trigger.

CREATE TABLE recurring_rules (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id   TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
  to_amount_minor INTEGER CHECK (to_amount_minor > 0),
  category_id     TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  payee           TEXT,
  description     TEXT,
  payment_method  TEXT CHECK (payment_method IN ('card','cash','bank_transfer','direct_debit','other')),
  freq_unit       TEXT NOT NULL CHECK (freq_unit IN ('day','week','month','year')),
  freq_interval   INTEGER NOT NULL CHECK (freq_interval BETWEEN 1 AND 366),
  anchor_date     TEXT NOT NULL,           -- first occurrence
  end_date        TEXT,
  next_due_date   TEXT,                    -- NULL when finished
  notify          INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_recurring_next_due ON recurring_rules(active, next_due_date);

CREATE TABLE transactions (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),  -- in account currency
  to_account_id     TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  to_amount_minor   INTEGER CHECK (to_amount_minor > 0),        -- in destination currency
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
  WHERE recurring_rule_id IS NOT NULL;     -- an occurrence can be booked only once

CREATE TABLE recurring_skips (
  rule_id         TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  PRIMARY KEY (rule_id, occurrence_date)
);

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 40),
  created_at  TEXT NOT NULL
);

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX ix_tt_tag ON transaction_tags(tag_id);

-- Effective-dated budget limits: a row applies from effective_month until a later row replaces it.
CREATE TABLE budget_limits (
  id              TEXT PRIMARY KEY,
  category_id     TEXT REFERENCES categories(id) ON DELETE CASCADE,  -- NULL = overall cap
  effective_month TEXT NOT NULL CHECK (effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  limit_minor     INTEGER NOT NULL CHECK (limit_minor >= 0),          -- base currency; 0 = removed
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
  amount_minor   INTEGER NOT NULL CHECK (amount_minor <> 0),   -- negative = withdrawal
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

CREATE TABLE security_state (            -- single row
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT
);
```

The wrapped keys (§5.1) live in a separate small `keystore.json` next to the database, because they are needed *before* the database can be opened. It contains only ciphertext, salts and KDF parameters.

### Derived values (not stored)
- **Account balance** = opening balance + income − expenses − outgoing transfers + incoming transfers.
- **Net worth** = Σ balances of included accounts, converted to EUR at the latest rate on or before the date.
- **Savings rate** = (income − expenses) ÷ income, for the period. Transfers are excluded, and the rate is undefined when income is 0 (shown as "—").
- **Budget spent** = Σ expenses in the category, its subcategories and the month, converted to EUR.
- Balances are computed with SQL aggregates over indexed columns. A cached balance table is added only if benchmarks require it.

### Migrations
Numbered SQL files are embedded in the binary and applied in one transaction at startup. The schema version is checked against backups on restore. Before each migration the app takes an automatic backup. Down-migrations are not supported; the pre-migration backup is the rollback.

## 7. Backup format (`.keelbak`)

```
magic "KEELBAK1" | header JSON (version, schema_ver, created_at, kdf params, salt, nonce)
| XChaCha20-Poly1305( zstd( SQLite logical dump of all tables ) )
```
- It is encrypted with a key derived (Argon2id) from a **backup password** (by default the app password, which the user can change). It is independent of the device, so it can be restored on another device or platform.
- Restore steps: verify the AEAD tag → check the schema version (migrate forward if older) → write to a temporary database → run integrity checks (`PRAGMA integrity_check`, foreign-key check) → swap atomically → reopen. The pre-restore safety backup is kept.

## 8. Recurring engine

- When the app starts or unlocks, for each active rule it computes occurrences from `next_due_date` up to today plus 30 days. Skipped ones are excluded.
- Occurrences on or before today show as **Due**. Later ones show as **Upcoming**.
- Confirming creates the transaction with `(recurring_rule_id, occurrence_date)` and advances `next_due_date`, both in one database transaction. The unique index prevents double booking.
- Month-end handling: an anchor on the 31st falls on the last day of shorter months.
- Local notifications are scheduled through the Tauri notification plugin when enabled.

## 9. Testing strategy

| Level | Tool | Covers |
|---|---|---|
| Rust unit | `cargo test` | Money arithmetic, conversion rounding, recurrence dates, budget maths, validation |
| Database integration | `cargo test` on temp SQLCipher databases | Migrations, constraints, foreign keys, balances, transfers, restore round-trip, wrong-key rejection |
| TypeScript unit | Vitest | Money parsing and formatting per locale, date helpers |
| Component | Vitest + Testing Library | Forms, validation messages, empty, loading and error states, accessibility roles |
| End-to-end | Playwright (web build) plus a Tauri WebDriver smoke test on Windows | Main user flows |
| Property tests | `proptest` | Balances always equal the sum of postings; conversions never panic or overflow |

Test fixtures are generated in test code only. Production code ships no sample data.

## 10. Build and release (CI)

| Target | Runner | Output | Secrets needed |
|---|---|---|---|
| Tests and lint | ubuntu | — | — |
| Windows | windows-latest | `.msi` + NSIS `.exe` | Code-signing certificate (optional, Phase 7) |
| Android | ubuntu + Android SDK/NDK | Signed `.apk` (and `.aab` later) | Release keystore and password |
| iOS | macos-latest + Xcode | `.ipa` → TestFlight | Apple Developer certificate, provisioning profile, App Store Connect API key |

The Android keystore and Apple credentials stay in GitHub Actions secrets and are never committed. **Losing the Android keystore means updates can't be installed over existing installs.** The user must keep a safe offline copy.

## 11. Future sync readiness (not built in v1)
- UUIDv7 IDs and `updated_at` on every row.
- A deletion log (`tombstones` table) is added with the sync migration.
- The planned model is end-to-end encrypted sync, where the server stores only ciphertext. The DEK and backup format already work this way.
