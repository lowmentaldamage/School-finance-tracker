#![allow(clippy::inconsistent_digit_grouping)] // amounts are written as euros_cents
mod common;
use common::*;
use keel_core::money::CurrencyCode;
use keel_core::repo::budgets::{self, BudgetInput, BudgetStatus};
use keel_core::repo::goals::{self, ContributionInput, GoalInput, GoalStatus};
use keel_core::repo::rates::{self, RateInput};
use keel_core::repo::recurring::{self, ConfirmOverrides, FreqUnit, RuleInput};
use keel_core::repo::reports::{self, Range};
use keel_core::repo::transactions::{self, TransactionFilter, TxType};
use keel_core::time::{fmt_date, fmt_month, today_local};
use keel_core::CoreError;

fn range(f: &str, t: &str) -> Range {
    Range {
        from: f.into(),
        to: t.into(),
    }
}

#[test]
fn summary_cashflow_and_categories() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let salary = category_id(&conn, "Salary");
    let food = category_id(&conn, "Food");
    let housing = category_id(&conn, "Housing");
    transactions::create(
        &conn,
        &tx(
            TxType::Income,
            &a.id,
            3000_00,
            "2026-01-31",
            Some(salary.clone()),
        ),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Expense, &a.id, 1000_00, "2026-02-01", Some(housing)),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &a.id,
            200_00,
            "2026-02-10",
            Some(food.clone()),
        ),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Income, &a.id, 3000_00, "2026-02-28", Some(salary)),
    )
    .unwrap();
    let b = account(&conn, "Savings", "EUR", 0);
    let mut t = tx(TxType::Transfer, &a.id, 500_00, "2026-02-15", None);
    t.to_account_id = Some(b.id.clone());
    transactions::create(&conn, &t).unwrap();

    let s = reports::summary(&conn, &range("2026-02-01", "2026-02-28")).unwrap();
    assert_eq!(
        (s.income_minor, s.expense_minor, s.net_minor),
        (3000_00, 1200_00, 1800_00)
    );
    assert_eq!(s.savings_rate_bp, Some(6000), "transfers are not expenses");

    let cf = reports::cashflow_by_month(&conn, &range("2025-12-01", "2026-02-28")).unwrap();
    assert_eq!(cf.len(), 3);
    assert_eq!(cf[0].income_minor, 0);
    assert_eq!(cf[1].income_minor, 3000_00);
    assert_eq!(cf[2].expense_minor, 1200_00);

    let cats =
        reports::by_category(&conn, &range("2026-02-01", "2026-02-28"), "expense", None).unwrap();
    assert_eq!(cats.len(), 2);
    assert_eq!(cats[0].name.as_deref(), Some("Housing"));
    assert_eq!(cats[0].amount_minor, 1000_00);

    let nw = reports::net_worth_series(&conn, &range("2026-01-01", "2026-02-28")).unwrap();
    assert_eq!(nw[0].net_minor, 3000_00);
    assert_eq!(nw[1].net_minor, 4800_00);
}

#[test]
fn conversion_uses_rates_and_reports_missing() {
    let conn = mem();
    let eur = account(&conn, "EUR", "EUR", 0);
    let usd = account(&conn, "USD", "USD", 100_00);
    let food = category_id(&conn, "Food");
    transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &usd.id,
            50_00,
            "2026-03-10",
            Some(food.clone()),
        ),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Expense, &eur.id, 10_00, "2026-03-10", Some(food)),
    )
    .unwrap();

    let s = reports::summary(&conn, &range("2026-03-01", "2026-03-31")).unwrap();
    assert_eq!(s.expense_minor, 10_00);
    assert_eq!(s.missing_rates, vec!["USD".to_string()]);

    rates::upsert(
        &conn,
        &RateInput {
            from_code: CurrencyCode::parse("USD").unwrap(),
            to_code: CurrencyCode::parse("EUR").unwrap(),
            rate: "0.9".into(),
            valid_from: "2026-01-01".into(),
        },
    )
    .unwrap();
    let s = reports::summary(&conn, &range("2026-03-01", "2026-03-31")).unwrap();
    assert_eq!(s.expense_minor, 10_00 + 45_00);
    assert!(s.missing_rates.is_empty());

    // Inverse rate (EUR→GBP) is used when no direct GBP→EUR rate exists.
    let gbp = account(&conn, "GBP", "GBP", 85_00);
    rates::upsert(
        &conn,
        &RateInput {
            from_code: CurrencyCode::parse("EUR").unwrap(),
            to_code: CurrencyCode::parse("GBP").unwrap(),
            rate: "0.85".into(),
            valid_from: "2026-01-01".into(),
        },
    )
    .unwrap();
    let bal = reports::balances(&conn).unwrap();
    // EUR -10, USD 50 * 0.9 = 45, GBP 85 / 0.85 = 100
    assert_eq!(bal.assets_minor, 45_00 + 100_00);
    assert_eq!(bal.liabilities_minor, 10_00);
    let _ = gbp;

    assert!(rates::upsert(
        &conn,
        &RateInput {
            from_code: CurrencyCode::parse("EUR").unwrap(),
            to_code: CurrencyCode::parse("EUR").unwrap(),
            rate: "1".into(),
            valid_from: "2026-01-01".into(),
        },
    )
    .is_err());
}

#[test]
fn budgets_track_spending_warnings_and_rollover() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let food = category_id(&conn, "Food");
    let sub = keel_core::repo::categories::create(
        &conn,
        &keel_core::repo::categories::CategoryInput {
            kind: keel_core::repo::categories::CategoryKind::Expense,
            name: "Groceries".into(),
            color: "#555555".into(),
            parent_id: Some(food.clone()),
        },
    )
    .unwrap();
    budgets::set(
        &conn,
        &BudgetInput {
            category_id: Some(food.clone()),
            month: "2026-01".into(),
            limit_minor: 400_00,
            rollover: true,
        },
    )
    .unwrap();
    // Subcategories cannot carry their own budget.
    assert!(budgets::set(
        &conn,
        &BudgetInput {
            category_id: Some(sub.id.clone()),
            month: "2026-01".into(),
            limit_minor: 1,
            rollover: false
        }
    )
    .is_err());

    transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &a.id,
            300_00,
            "2026-01-05",
            Some(sub.id.clone()),
        ),
    )
    .unwrap();
    let jan = budgets::for_month(&conn, "2026-01").unwrap();
    assert_eq!(jan.lines.len(), 1);
    assert_eq!(
        jan.lines[0].spent_minor, 300_00,
        "subcategory spending counts"
    );
    assert_eq!(jan.lines[0].status, BudgetStatus::Ok);

    transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &a.id,
            20_00,
            "2026-01-20",
            Some(food.clone()),
        ),
    )
    .unwrap();
    assert_eq!(
        budgets::for_month(&conn, "2026-01").unwrap().lines[0].status,
        BudgetStatus::Warning
    );

    // February inherits the limit and gets 80 carried over.
    let feb = budgets::for_month(&conn, "2026-02").unwrap();
    assert_eq!(feb.lines[0].limit_minor, 400_00);
    assert_eq!(feb.lines[0].carried_minor, 80_00);
    assert_eq!(feb.lines[0].available_minor, 480_00);

    transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &a.id,
            500_00,
            "2026-02-10",
            Some(food.clone()),
        ),
    )
    .unwrap();
    let feb = budgets::for_month(&conn, "2026-02").unwrap();
    assert_eq!(feb.lines[0].status, BudgetStatus::Over);
    assert_eq!(feb.lines[0].remaining_minor, -20_00);
    assert_eq!(
        budgets::for_month(&conn, "2026-03").unwrap().lines[0].carried_minor,
        0,
        "overspend is not carried"
    );

    // Stop the budget from April.
    budgets::set(
        &conn,
        &BudgetInput {
            category_id: Some(food.clone()),
            month: "2026-04".into(),
            limit_minor: 0,
            rollover: false,
        },
    )
    .unwrap();
    assert!(budgets::for_month(&conn, "2026-04")
        .unwrap()
        .lines
        .is_empty());
    assert_eq!(budgets::for_month(&conn, "2026-03").unwrap().lines.len(), 1);

    // Overall cap counts all expenses.
    budgets::set(
        &conn,
        &BudgetInput {
            category_id: None,
            month: "2026-02".into(),
            limit_minor: 1000_00,
            rollover: false,
        },
    )
    .unwrap();
    let feb = budgets::for_month(&conn, "2026-02").unwrap();
    assert_eq!(feb.overall.as_ref().unwrap().spent_minor, 500_00);

    let hist = budgets::history(&conn, "2026-03", 3).unwrap();
    assert_eq!(
        hist.iter().map(|h| h.month.as_str()).collect::<Vec<_>>(),
        ["2026-01", "2026-02", "2026-03"]
    );
}

#[test]
fn recurring_confirm_skip_and_idempotency() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let subs = category_id(&conn, "Subscriptions");
    let today = today_local();
    let anchor = today - chrono::Duration::days(14);
    let rule = recurring::create(
        &conn,
        &RuleInput {
            tx_type: TxType::Expense,
            account_id: a.id.clone(),
            amount_minor: 9_99,
            to_account_id: None,
            to_amount_minor: None,
            category_id: Some(subs),
            payee: Some("Music".into()),
            description: None,
            payment_method: None,
            freq_unit: FreqUnit::Week,
            freq_interval: 1,
            anchor_date: fmt_date(anchor),
            end_date: None,
            active: true,
        },
    )
    .unwrap();
    assert_eq!(
        rule.next_due_date.as_deref(),
        Some(fmt_date(anchor).as_str())
    );

    let up = recurring::upcoming(&conn, 30).unwrap();
    assert_eq!(up.due_count, 3, "anchor, +7 and +14 days are due");
    assert!(up.items.len() >= 6);

    let first = fmt_date(anchor);
    let t = recurring::confirm(&conn, &rule.id, &first, &ConfirmOverrides::default()).unwrap();
    assert_eq!(t.amount_minor, 9_99);
    assert_eq!(t.date, first);
    assert!(matches!(
        recurring::confirm(&conn, &rule.id, &first, &ConfirmOverrides::default()),
        Err(CoreError::Conflict { .. })
    ));
    let second = fmt_date(anchor + chrono::Duration::days(7));
    recurring::skip(&conn, &rule.id, &second).unwrap();
    let third = fmt_date(anchor + chrono::Duration::days(14));
    let r = recurring::get(&conn, &rule.id).unwrap();
    assert_eq!(r.next_due_date.as_deref(), Some(third.as_str()));
    assert_eq!(recurring::upcoming(&conn, 30).unwrap().due_count, 1);

    // Not a scheduled date.
    let bad = fmt_date(anchor + chrono::Duration::days(3));
    assert!(recurring::confirm(&conn, &rule.id, &bad, &ConfirmOverrides::default()).is_err());

    // Overrides.
    let t3 = recurring::confirm(
        &conn,
        &rule.id,
        &third,
        &ConfirmOverrides {
            amount_minor: Some(12_49),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(t3.amount_minor, 12_49);

    // Deleting the rule keeps booked transactions.
    recurring::delete(&conn, &rule.id).unwrap();
    assert_eq!(
        transactions::list(&conn, &TransactionFilter::default())
            .unwrap()
            .total,
        2
    );
}

#[test]
fn recurring_validation() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let base = RuleInput {
        tx_type: TxType::Expense,
        account_id: a.id.clone(),
        amount_minor: 100,
        to_account_id: None,
        to_amount_minor: None,
        category_id: None,
        payee: Some("Rent".into()),
        description: None,
        payment_method: None,
        freq_unit: FreqUnit::Month,
        freq_interval: 1,
        anchor_date: "2026-01-01".into(),
        end_date: Some("2025-12-01".into()),
        active: true,
    };
    assert!(matches!(
        recurring::create(&conn, &base),
        Err(CoreError::Validation {
            field: "end_date",
            ..
        })
    ));
    let mut no_name = base.clone();
    no_name.end_date = None;
    no_name.payee = None;
    assert!(matches!(
        recurring::create(&conn, &no_name),
        Err(CoreError::Validation { field: "payee", .. })
    ));
    let mut zero = base.clone();
    zero.end_date = None;
    zero.freq_interval = 0;
    assert!(recurring::create(&conn, &zero).is_err());
    let mut ended = base;
    ended.anchor_date = "2025-01-01".into();
    ended.end_date = Some("2025-03-01".into());
    let r = recurring::create(&conn, &ended).unwrap();
    for d in ["2025-01-01", "2025-02-01", "2025-03-01"] {
        recurring::skip(&conn, &r.id, d).unwrap();
    }
    assert_eq!(
        recurring::get(&conn, &r.id).unwrap().next_due_date,
        None,
        "finished after end date"
    );
}

#[test]
fn goals_with_contributions_and_linked_account() {
    let conn = mem();
    let eur = CurrencyCode::parse("EUR").unwrap();
    let deadline = fmt_date(today_local() + chrono::Duration::days(80));
    let g = goals::create(
        &conn,
        &GoalInput {
            name: "Holiday".into(),
            target_minor: 1200_00,
            currency: eur.clone(),
            deadline: Some(deadline),
            linked_account_id: None,
        },
    )
    .unwrap();
    assert_eq!(g.progress_bp, 0);
    assert!(g.monthly_needed_minor.unwrap() > 0);

    let g = goals::contribute(
        &conn,
        &ContributionInput {
            goal_id: g.id.clone(),
            amount_minor: 300_00,
            date: fmt_date(today_local()),
            note: None,
        },
    )
    .unwrap();
    assert_eq!(g.saved_minor, 300_00);
    assert_eq!(g.progress_bp, 2500);
    assert!(goals::contribute(
        &conn,
        &ContributionInput {
            goal_id: g.id.clone(),
            amount_minor: -400_00,
            date: fmt_date(today_local()),
            note: None
        }
    )
    .is_err());
    let g = goals::contribute(
        &conn,
        &ContributionInput {
            goal_id: g.id.clone(),
            amount_minor: 900_00,
            date: fmt_date(today_local()),
            note: Some("bonus".into()),
        },
    )
    .unwrap();
    assert_eq!(g.status, GoalStatus::Completed);
    assert_eq!(g.monthly_needed_minor, Some(0));
    let c = goals::contributions(&conn, &g.id).unwrap();
    assert_eq!(c.len(), 2);
    let g = goals::delete_contribution(&conn, &c[0].id).unwrap();
    assert_eq!(g.contribution_count, 1);

    let acc = account(&conn, "Savings", "EUR", 250_00);
    let linked = goals::create(
        &conn,
        &GoalInput {
            name: "Buffer".into(),
            target_minor: 1000_00,
            currency: eur,
            deadline: None,
            linked_account_id: Some(acc.id.clone()),
        },
    )
    .unwrap();
    assert_eq!(linked.saved_minor, 250_00);
    assert_eq!(linked.monthly_needed_minor, None);
    assert!(goals::contribute(
        &conn,
        &ContributionInput {
            goal_id: linked.id.clone(),
            amount_minor: 1,
            date: fmt_date(today_local()),
            note: None
        }
    )
    .is_err());

    let usd_acc = account(&conn, "USD", "USD", 0);
    assert!(goals::create(
        &conn,
        &GoalInput {
            name: "X".into(),
            target_minor: 1,
            currency: CurrencyCode::parse("EUR").unwrap(),
            deadline: None,
            linked_account_id: Some(usd_acc.id)
        },
    )
    .is_err());
    let _ = fmt_month(today_local());
}
