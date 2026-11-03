# Keel — Architecture (v1)

Status: **Approved**
Last updated: 2026-11-02

---

## 1. Technology stack

| Layer | Choice | Reason |
|---|---|---|
| App shell | **Tauri 2** | One codebase for Windows and Android (iOS possible later). Small binaries (about 5–10 MB on desktop). A Rust backend keeps the database and crypto out of the webview. |
| Backend | **Rust** | Memory-safe, owns all data access, crypto, backup and file I/O |
| Database | **SQLite with SQLCipher** through `rusqlite` (`bundled-sqlcipher`) | Embedded, reliable, encrypted at rest, transactional |
| Frontend | **React 19 + TypeScript (strict) + Vite** | Mature ecosystem and type safety across the UI |
| Styling | **Tailwind CSS** driven by CSS-variable design tokens | Consistent spacing and colour, themeable light/dark |
| UI primitives | **Radix UI** (unstyled, accessible) for dialogs and menus; native `<select>` and date inputs | Accessible, and the native controls use the platform pickers on Android |
| Routing | React Router | Standard and well supported |
| Data fetching | TanStack Query | Caching, loading and error states, invalidation after writes |
| Forms | Plain React state + small validation functions | Fewer dependencies. The Rust side re-validates every input and returns the invalid field name. |
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
- **The UI never sends SQL.** Every data operation is one Tauri command, `core_call(cmd, args)`, which forwards to `keel_core::api::dispatch`. The `match` in `dispatch` is the allow-list of operations (`accounts.create`, `transactions.list`, …). Arguments are deserialised into typed structs with unknown fields rejected.
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
├─ crates/
│  ├─ keel-core/            all domain logic, SQL, migrations, key storage (no UI dependency)
│  └─ keel-devserver/       development-only HTTP bridge so the UI runs in a browser against the real core
├─ src-tauri/               thin Tauri shell: window, IPC, platform key protection
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
└─ .github/workflows/       CI: test, Windows build, Android build
```

## 4. Money and dates

- Amounts are stored as `INTEGER` **minor units** (cents for EUR) in a Rust `Money { minor: i64, currency: CurrencyCode }` type. Adding different currencies without conversion is a compile-time or runtime error.
- Each currency has a `minor_unit` exponent (EUR 2, JPY 0, KWD 3).
- Conversion: `converted_minor = round_half_even(minor × rate)` using an integer rate scaled by 10⁹ (`rate_e9`) in `i128` arithmetic. There are no floats anywhere in the money path.
- Amounts are always stored as **positive** numbers. The direction comes from the transaction type.
- Transaction dates are `TEXT 'YYYY-MM-DD'` (a calendar date, with no time-zone shift). Audit timestamps are UTC ISO-8601.
- The UI parses user input with a locale-aware parser into minor units. Display formatting uses `Intl.NumberFormat`.

## 5. Security model

### 5.1 Key hierarchy (envelope encryption) — as implemented

```
DEK  (random 256-bit key) ── encrypts ──► keel.db (SQLCipher, AES-256)

keystore.json (mode 0600, app-private storage)
 ├─ device:    Keystore( DEK )                                          — only when no app lock
 └─ lock:
     ├─ secret:    Keystore( XChaCha20-Poly1305( Argon2id(PIN/password), DEK ) )
     ├─ recovery:  Keystore( XChaCha20-Poly1305( Argon2id(recovery key), DEK ) )
     └─ biometric: BiometricKeystore( DEK )                              — optional
```

- `Keystore(…)` = AES-256-GCM with a non-exportable key in the Android Keystore (hardware-backed on
  most devices). `BiometricKeystore` uses a second Keystore key that can only be used after a strong
  biometric check and is invalidated when fingerprints/faces are re-enrolled.
- **No app lock:** the DEK is protected by the device key only. Copied files are unreadable off the
  phone; anyone who can use the unlocked phone can open Keel.
- **App lock on:** the device-only copy is deleted. Opening needs the PIN/password, the recovery key
  or biometrics. Because the PIN-wrapped copy is also Keystore-wrapped, the PIN cannot be brute-forced
  offline from copied files — guesses must go through this phone, and the app throttles them.
- Argon2id parameters: 64 MiB, 3 passes, 1 lane (stored per wrap, so they can be raised later).
- Changing the PIN re-wraps the DEK; the database is not re-encrypted. The recovery key survives a PIN change.
- Key material is zeroed on drop; locking closes the database and forgets the DEK.
- If the database exists but `keystore.json` is missing, Keel refuses to create a new key, so data is never silently replaced.

### 5.2 Recovery key
160 random bits shown once as 8 groups of 4 Crockford Base32 characters. Input is case-insensitive and tolerant of O/0 and I/L/1 confusion. A new key can be issued (the old one stops working). Keel never stores it.

### 5.3 Session and lock
- `keel_core::session::Session` owns the open database and the lock state. The Android app and the development server use the same code.
- Auto-lock after inactivity (default 5 minutes; 1–60 configurable) and when the app goes to the background (immediately by default; 30 s / 1 min / 5 min grace).
- After 5 wrong attempts: 30 s delay, doubling to a maximum of 1 hour. The counter lives in `keystore.json` (the database is closed while locked).
- The Android back button closes the top dialog instead of leaving the screen.

### 5.4 Honest limitations
- **Malware or someone with the unlocked app in hand** can read data while Keel is unlocked. Encryption protects data at rest, not a compromised running system.
- **PIN strength:** an 8-digit PIN has 100,000,000 combinations. Offline guessing requires this phone's Keystore, and on-device guessing is throttled, so a PIN is strong against casual and moderate attackers. A long password is stronger still.
- **Rooted devices** weaken the Keystore guarantees.
- **CSV exports are plaintext** and are protected only by wherever the user saves them.
- **Lost PIN/password and lost recovery key** means permanent data loss. That is by design, and the UI says so.
- Backups are only as strong as their password (minimum 10 characters, Argon2id).

### 5.5 Platform hardening (Android)
- `allowBackup=false`, `fullBackupContent` and `dataExtractionRules` exclude everything: Android never copies Keel's data to the cloud or another device.
- Without a Dropbox app key, release builds remove the `INTERNET` permission. With Dropbox sync compiled in, the permission is present but the native layer only allows HTTPS requests to `api.dropboxapi.com` and `content.dropboxapi.com`, and only when the user has connected Dropbox. The web view itself has no network access (CSP `connect-src` is IPC only).
- File import/export uses the system file picker (Storage Access Framework): no storage permission.
- `FileProvider` is limited to the app's export cache folder.
- Optional `FLAG_SECURE` ("Hide in app switcher") blanks the recent-apps preview and blocks screenshots.
- Content Security Policy forbids remote scripts, styles, fonts and connections.

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
"KEELBAK1" | u32 LE header length | header JSON {format, app, schema_version, created_at, kdf, salt}
| nonce(24) | XChaCha20-Poly1305( JSON dump of all user tables ), header as associated data
```
- Encrypted with Argon2id(backup password, ≥10 characters). Independent of the device, so it can be restored on another phone.
- Restore: verify tag → check schema version → in one transaction delete and re-insert every table, accepting only column names that exist in the schema → foreign-key check → commit. Any failure rolls back; nothing changes.
- A wrong password or a modified file is rejected.

## 7a. Sync and automatic backups
- **Dropbox sync:** OAuth 2 with PKCE (no client secret); the refresh token is stored in the encrypted database under a `secret.` key that never leaves the core through `settings.all` or backups. The app reads and writes a single file, `/keel.keelbak`, in its own Dropbox app folder. It is the same encrypted backup format, sealed with a key derived from a *sync password*; the salt travels in the file header so a second phone can derive the same key from the password.
- Every data-changing command marks the database dirty. A sync pass: no remote file → upload; remote unchanged and local dirty → upload with `update` mode (Dropbox rejects it if someone else wrote meanwhile); remote changed and local clean → download and restore; both changed → the user chooses. Sync runs on open, 20 s after changes and before the app goes to the background.
- **Automatic backups:** weekly when the app is opened, written through the Storage Access Framework to a folder the user picked (persisted permission), keeping the five newest `keel-auto-*.keelbak` files. Encrypted with a stored key derived from a backup password.
- Restores never overwrite device-local settings (`secret.*`, `sync.*`, `backup.auto.*`).

## 8. Recurring engine

- When the app starts or unlocks, for each active rule it computes occurrences from `next_due_date` up to today plus 30 days. Skipped ones are excluded.
- Occurrences on or before today show as **Due**. Later ones show as **Upcoming**.
- Confirming creates the transaction with `(recurring_rule_id, occurrence_date)` and advances `next_due_date`, both in one database transaction. The unique index prevents double booking.
- Month-end handling: an anchor on the 31st falls on the last day of shorter months.
- Optional phone reminders the day before each bill (09:00), scheduled with inexact `AlarmManager` alarms and re-scheduled after reboot. Lock-screen notifications show no details.

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
| Windows | windows-latest | `.msi` + NSIS `.exe` (unsigned) | — |
| Android | ubuntu + Android SDK/NDK | Signed `.apk` (and `.aab` later) | Release keystore and password |

The Android keystore stays in GitHub Actions secrets and are never committed. **Losing the Android keystore means updates can't be installed over existing installs.** The user must keep a safe offline copy.

## 11. Future sync readiness (not built in v1)
- UUIDv7 IDs and `updated_at` on every row.
- A deletion log (`tombstones` table) is added with the sync migration.
- The planned model is end-to-end encrypted sync, where the server stores only ciphertext. The DEK and backup format already work this way.
