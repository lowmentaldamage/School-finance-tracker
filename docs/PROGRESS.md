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
- [x] Reminders: phone notifications for bills (day before) and budgets (80 %/100 %), off by default
- [x] PDF monthly report

## Phase 5 — Security and reliability
- [x] Database key wrapped by the Android Keystore
- [x] App lock: 8-digit PIN or password, recovery key, biometrics, auto-lock, throttling
- [x] Encrypted backup and restore
- [x] Delete all data
- [x] Release build without network permission; no Android cloud backup
- [x] Automatic weekly encrypted backups to a chosen folder (keeps 5)
- [x] Bank CSV import with duplicate skipping and learned categories
- [x] Optional Dropbox sync of one encrypted file (newest wins, conflicts asked)
- [x] Bank notifications: reads payment notifications from chosen bank apps, review inbox or automatic adding
- [x] Revolut and NLB Klik read without setup; English and Slovenian messages; one-tap setup card on Overview

## Phase 6 — Packaging
- [x] Android project, icon, splash, signed release APK built in CI
- [x] Emulator smoke test passing in CI
- [ ] Test on a physical phone

## Phase 7 — Product readiness
- [x] App icon and splash screen
- [ ] User guide
- [x] Release workflow publishing signed APKs to GitHub Releases
- [x] v0.3.0 published (signed with a one-off key; updates need backup, reinstall, restore)
- [ ] Release signing secrets added by the owner (enables in-place updates)
- [ ] Dropbox app key added by the owner (optional)

## Test status
- Rust: 69 tests — money, validation, migrations, encryption at rest, wrong key, key file, app lock, throttling, recovery, biometric wrap, backup round-trip and tampering, device-local settings kept on restore, two-phone sync, automatic backup, bank CSV import, bank notification parsing (English and Slovenian, Revolut and NLB Klik formats, codes and balance lines ignored), notification inbox, automatic adding and duplicates, CSV export, accounts, categories, transactions, reports, budgets, recurring, goals.
- Frontend: 40 tests — amount parsing/formatting, dates, periods, filters, translation coverage.
- End to end (browser, real core): onboarding, transactions, validation, balances, search, edit/delete, category guard, app lock with wrong PIN, recovery-key unlock, encrypted backup and restore, theme persistence, bank notification inbox (add and dismiss).
- Android (CI emulator): onboarding, add transaction, balance, Keystore status, lock on background, PIN unlock, back button, data after restart.
