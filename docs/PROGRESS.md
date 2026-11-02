# Keel — Progress

Target: Android (APK). Windows and iOS are deferred.

## Phase 1 — Product planning
- [x] Product interview, requirements, architecture and schema (signed off)
- [x] Project scaffold (Tauri 2 + React + TypeScript + Vite + Tailwind) and CI

## Phase 2 — Design
- [x] Grey design system, light and dark themes, reusable components
- [x] Navigation: desktop sidebar; mobile bottom tabs, central Add button, More sheet
- [x] All screens: Onboarding, Overview, Transactions, Budgets, Analytics, Recurring, Goals, Accounts, Categories, Settings, Lock

## Phase 3 — Core development
- [x] Encrypted SQLite (SQLCipher), migrations, constraints and triggers
- [x] Accounts, categories (with subcategories), transactions (transfers, tags, search, filters, sort, paging)
- [x] Exchange rates (manual) and base-currency totals
- [x] Overview dashboard
- [x] Budgets (carry-forward limits, rollover, 80 %/100 % warnings, overall cap, history)

## Phase 4 — Advanced functionality
- [x] Analytics: cash flow, category drill-down, savings-rate and net-worth trends, year comparison, custom ranges
- [x] Savings goals (contributions or linked account)
- [x] Recurring transactions with due/upcoming lists, record/skip
- [x] CSV export
- [ ] System notifications for bills and budgets (in-app reminders exist)
- [ ] PDF monthly report

## Phase 5 — Security and reliability
- [x] Database key wrapped by the Android Keystore
- [x] App lock: 8-digit PIN or password, recovery key, biometrics, auto-lock, throttling
- [x] Encrypted backup and restore
- [x] Delete all data
- [x] Release build without network permission; no Android cloud backup
- [ ] Automatic scheduled backups
- [ ] Bank CSV import

## Phase 6 — Packaging
- [x] Android project, icon, splash, signed release APK built in CI
- [ ] Emulator smoke test passing in CI (in progress)
- [ ] Test on a physical phone

## Phase 7 — Product readiness
- [x] App icon and splash screen
- [ ] User guide
- [ ] Release signing key set up by the owner (see README)

## Test status
- Rust: 54 tests — money, validation, migrations, encryption at rest, wrong key, key file, app lock, throttling, recovery, biometric wrap, backup round-trip and tampering, CSV, accounts, categories, transactions, reports, budgets, recurring, goals.
- Frontend: 40 tests — amount parsing/formatting, dates, periods, filters, translation coverage.
- End to end (browser, real core): onboarding, transactions, validation, balances, search, edit/delete, category guard, app lock with wrong PIN, recovery-key unlock, encrypted backup and restore, theme persistence.
- Android (CI emulator): onboarding, add transaction, balance, Keystore status, lock on background, PIN unlock, back button, data after restart.
