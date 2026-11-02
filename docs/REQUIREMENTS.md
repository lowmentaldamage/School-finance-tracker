# Keel — Product Requirements (v1)

Status: **Approved**
Last updated: 2026-11-02

Keel is a local-first, privacy-focused personal finance tracker for Android. Windows and iOS are deferred. It runs fully offline, stores all data on the user's device in an encrypted database, and makes no network calls.

---

## 1. Product

| Item | Decision |
|---|---|
| Name | Keel |
| Scope | Commercial-grade product |
| Audience | Individuals and households; categories also suit freelancers |
| Users per install | One |
| Icon | Monogram mark in the grey palette (designed in Phase 7) |
| Source model | Closed source |
| Pricing (future) | Free core plus a one-time "Pro" unlock. **Not built in v1**; Pro features will be defined later. v1 has no paywall. |
| Distribution | v1: direct download (Windows installer, Android APK). Later: Microsoft Store, Google Play. |

## 2. Platforms

| Platform | Minimum | Output | Notes |
|---|---|---|---|
| Windows | — | — | Deferred by the owner (2026-11-02). The shared codebase keeps it possible later. |
| Android | 8.0 (API 26) | Signed `.apk` | Sideloaded at first, built to meet Google Play's requirements later |
| iOS, macOS, Linux | — | — | Out of scope for v1. The shared codebase keeps them possible later (iOS needs a Mac and an Apple Developer account). |

## 3. Data model scope

- **Accounts:** checking, savings, cash, credit card, loan, investment, other. Each has its own currency and opening balance.
- **Transaction types:** income, expense, transfer. Transfers move money between two accounts and never count as income or expenses.
- **Currency:** each account has its own currency. The base currency is **EUR**, and totals are converted to it. Exchange rates are **entered manually** (no network). Amounts are stored as integer minor units.
- **Categories:** two levels (category › subcategory), separate for income and expenses, with custom names and colours. They can be archived; a category in use cannot be hard-deleted until its transactions are reassigned.
- **Tags:** free-form, any number per transaction.
- **Payment method:** an optional field on a transaction (card, cash, bank transfer, direct debit, other).
- **Split transactions:** not in v1. The schema allows adding them later without a migration of existing data.
- **Attachments / receipts:** not in v1.

## 4. Features

### 4.1 Dashboard
- Total balance (net worth in EUR), total income, total expenses, net savings, savings rate.
- Income vs. expenses chart, expense breakdown by category, spending trend.
- Budget progress, recent transactions, upcoming recurring payments.
- Time periods: this month (default), last month, last 3, 6 or 12 months, year to date, custom range.
- Fixed, designed layout. Individual sections can be hidden in Settings.

### 4.2 Transactions
- Create, edit and delete income, expenses and transfers.
- Fields: account, type, amount, date, description, payee, category, tags, payment method, notes.
- Search (description, payee, notes), filter (date range, account, type, category, tag, amount range), sort (date, amount, payee).
- Paginated or virtualised list for large datasets.

### 4.3 Categories
- Default set on first run:
  - Income: Salary, Freelance, Investments, Business, Other income.
  - Expenses: Housing, Food, Transportation, Shopping, Entertainment, Subscriptions, Healthcare, Education, Bills, Other.
- Create, edit, archive and delete (with reassignment) categories and subcategories.

### 4.4 Budgets
- Monthly limit per expense category, plus an optional overall monthly cap.
- A limit stays in effect from the month it is set until it is changed, so users don't re-enter budgets every month. History is preserved, so months can be compared.
- Optional rollover per category (unused amount carries into the next month). Off by default.
- Warnings at **80%** and **100%** of the limit, shown in the app and optionally as a notification.
- Month-to-month comparison view.

### 4.5 Analytics
- Monthly income, monthly expenses, income vs. expenses.
- Spending by category, with drill-down to subcategories and transactions.
- Savings trend and savings rate over time.
- Month-over-month and year-over-year comparisons.
- Net worth over time, from account balances (liabilities subtracted).
- Custom date-range analysis.
- All charts are drawn from database queries. No hardcoded values.

### 4.6 Savings goals
- Name, target amount, optional deadline, optional linked account.
- Contributions, entered manually or optionally linked to a transaction.
- Progress view: percentage, remaining amount, required monthly amount to meet the deadline.

### 4.7 Recurring transactions
- Rules for subscriptions, rent, utilities, loans, salary and so on.
- Frequencies: weekly, every 2 weeks, monthly, quarterly, yearly, custom (every N days/weeks/months).
- Due occurrences appear as **"Due"** and are booked only when the user confirms (one tap). Nothing is posted automatically.
- Skip, or edit before confirming, an individual occurrence.
- An upcoming payments list with projected totals for the next 30 days.

### 4.8 Notifications
- Local notifications only; there is no push server.
- Upcoming bill (1 day before) and budget warnings (80% / 100%).
- **Off by default.** The user turns them on, and the OS permission is requested at that moment.

### 4.9 Reports and export
- CSV export of transactions (any filter).
- PDF monthly report (Phase 4).
- CSV import from bank statements: **after the MVP** (Phase 5+).

### 4.10 Settings
- Profile: display name.
- Base currency (EUR) and exchange-rate management.
- Number and date formats: follow the device by default, with overrides.
- Language: English (v1). All text is set up for translation.
- Theme: System (default), Light, Dark.
- Dashboard section visibility.
- Security: app lock, biometrics, auto-lock timeout, recovery key, change password.
- Backup: manual backup, automatic backup schedule, restore.
- Data: CSV export, delete all data.

### 4.11 Onboarding
Three steps: confirm currency (EUR), create the first account, set an optional PIN or password (with the recovery key shown). No sample data is ever inserted.

## 5. Security and privacy

| Requirement | Decision |
|---|---|
| Database encryption | Always encrypted (SQLCipher, AES-256). See ARCHITECTURE.md §5 for key handling. |
| App lock | Optional PIN (exactly 8 digits) or password. When set, it is needed to decrypt the database. |
| Biometrics | Optional fingerprint or face unlock, available once a PIN or password is set |
| Forgotten password | Data cannot be recovered without the password or the **recovery key** shown once at setup. This is stated clearly to the user. |
| Auto-lock | After 5 minutes of inactivity (adjustable), and when the app goes to the background on mobile |
| Network | **None.** No telemetry, no crash reporting, no analytics, no remote fonts or scripts. |
| Logs | Logs never contain amounts, descriptions, payees, account names or keys. |
| Backups | Encrypted backup file (`.keelbak`) protected by a password. CSV export is unencrypted and the user is warned. |
| Auto backup | Weekly, keeping the last 5. Folder chosen by the user (desktop) or app storage (mobile). |
| Restore | Replaces all data after confirmation. Before restoring, the app creates an automatic safety backup. |
| Delete all data | Wipes the database, settings and app-made backups, after two confirmations |
| Android OS cloud backup | Disabled (`allowBackup=false`), so the database is never uploaded to Google without consent |

## 6. Design

- Grey-based palette: light grey or dark charcoal backgrounds, subtle grey surfaces, black, white and muted-grey text.
- Green is used only for positive changes and red only for negative ones. One muted blue-grey accent for focus and selection.
- Inter font with tabular numbers.
- Desktop: sidebar navigation. Mobile: bottom tab bar (Dashboard, Transactions, **+ Add**, Budgets, More).
- Restrained motion (≤150 ms, honours the reduced-motion setting). Subtle borders and shadows, moderate corner radius (4–8 px).
- Accessibility: WCAG 2.2 AA contrast, full keyboard navigation, screen-reader labels, colour never the only signal (± signs and labels accompany green and red).

## 7. Non-functional

- Accurate money handling: integer minor units, no floating-point arithmetic on amounts.
- Cold start under 1.5 s on mid-range hardware; dashboard queries under 100 ms with 50,000 transactions.
- Fully offline.
- Automated tests: Rust unit and database tests, TypeScript unit tests, component tests, end-to-end smoke tests.
- No fake buttons, no placeholder features, no mock data in production code.

## 8. Out of scope for v1

iOS, cloud sync, multi-device, multi-user or household profiles, bank connections, live exchange rates, receipt attachments, split transactions, investment price tracking, macOS/Linux builds, the paid tier, languages other than English.

## 9. Confirmed decisions

1. The PIN is 8 digits. Passwords are also allowed.
2. Android only for now. Windows and iOS are deferred.
