# Keel — Progress

## Phase 1 — Product planning
- [x] Product interview
- [x] Requirements draft (`docs/REQUIREMENTS.md`)
- [x] Architecture and schema draft (`docs/ARCHITECTURE.md`)
- [x] Requirements and architecture signed off by the owner
- [x] Project scaffold (Tauri 2 + React + TypeScript + Vite + Tailwind), CI workflow (tests, lint, e2e, Windows installer)

## Phase 2 — Design
- [x] Design tokens (grey palette, light and dark, typography, spacing)
- [x] Core UI components (Button, Input, Select, Dialog, Menu, Panel, EmptyState, Toast, Amount, Segmented)
- [x] App shell: desktop sidebar, mobile bottom tabs with central Add button
- [x] Screens built: Onboarding, Transactions, Accounts, Categories, Settings
- [ ] Screens to build: Dashboard, Budgets, Analytics, Goals, Recurring, Lock

## Phase 3 — Core development
- [x] Rust database layer: SQLCipher, migrations, schema v1, constraint triggers
- [x] Device key storage (DPAPI on Windows; see interim note below)
- [x] Accounts (create, edit, archive, delete when unused, balances)
- [x] Categories (defaults, subcategories, colours, archive, delete with reassignment)
- [x] Transactions (CRUD, transfers incl. cross-currency, tags, payees, search, filters, sort, paging, bulk delete)
- [ ] Exchange-rate management and base-currency totals
- [ ] Dashboard
- [ ] Budgets

## Phase 4 — Advanced functionality
- [ ] Analytics and charts
- [ ] Savings goals
- [ ] Recurring transactions and upcoming payments
- [ ] Local notifications
- [ ] CSV export and PDF monthly report

## Phase 5 — Security and reliability
- [ ] Android Keystore wrapping of the database key (interim: key file in app-private storage, mode 0600)
- [ ] App lock, biometrics, auto-lock, recovery key
- [ ] Encrypted backup and restore, automatic backups
- [ ] Delete all data
- [ ] Integrity, offline and security review
- [ ] Bank CSV import

## Phase 6 — Cross-platform packaging
- [ ] Windows installer
- [ ] Android APK (signed), permissions audit
- [ ] Persistence and responsiveness verification on all platforms

## Phase 7 — Product readiness
- [ ] Icon and splash screen
- [ ] Onboarding polish
- [ ] User documentation and installation guide
- [ ] Release preparation (unsigned Windows build)

## Test status
- Rust: 30 tests (`cargo test -p keel-core`): money maths, validation, keystore, migrations, encryption at rest, wrong-key rejection, rekey, accounts, categories, transactions, filters, injection attempts.
- Frontend: 38 tests (`npm test`): amount parsing and formatting, dates, filter state, translation key coverage.
- End to end: `npm run e2e` drives the real UI against the real core and a fresh encrypted database (onboarding, add, validate, edit, delete, search, balances, reassignment guard, theme persistence).

## Known limitations (current build)
- The Android APK is not built yet (Phase 6). The UI is already responsive and touch-sized for it.
- Totals across different currencies are not combined yet; the Accounts screen shows one total per currency.
- Windows installer is produced by CI but has not yet been run on a real Windows machine.
