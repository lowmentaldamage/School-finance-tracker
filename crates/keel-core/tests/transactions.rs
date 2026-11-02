#![allow(clippy::inconsistent_digit_grouping)] // amounts are written as euros_cents
mod common;
use common::*;
use keel_core::repo::accounts;
use keel_core::repo::tags;
use keel_core::repo::transactions::{
    self, PaymentMethod, SortDir, SortKey, TransactionFilter, TxType,
};
use keel_core::CoreError;

#[test]
fn balances_follow_income_expense_and_transfers() {
    let conn = mem();
    let a = account(&conn, "Checking", "EUR", 1_000_00);
    let b = account(&conn, "Savings", "EUR", 0);
    let salary = category_id(&conn, "Salary");
    let food = category_id(&conn, "Food");

    transactions::create(
        &conn,
        &tx(TxType::Income, &a.id, 2_500_00, "2026-01-31", Some(salary)),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Expense, &a.id, 45_67, "2026-02-01", Some(food)),
    )
    .unwrap();
    let mut t = tx(TxType::Transfer, &a.id, 500_00, "2026-02-02", None);
    t.to_account_id = Some(b.id.clone());
    let transfer = transactions::create(&conn, &t).unwrap();
    assert_eq!(transfer.to_amount_minor, Some(500_00));

    assert_eq!(
        accounts::get(&conn, &a.id).unwrap().balance_minor,
        1_000_00 + 2_500_00 - 45_67 - 500_00
    );
    assert_eq!(accounts::get(&conn, &b.id).unwrap().balance_minor, 500_00);

    transactions::delete(&conn, &transfer.id).unwrap();
    assert_eq!(accounts::get(&conn, &b.id).unwrap().balance_minor, 0);
}

#[test]
fn transfer_rules() {
    let conn = mem();
    let eur = account(&conn, "EUR acc", "EUR", 0);
    let eur2 = account(&conn, "EUR acc 2", "EUR", 0);
    let usd = account(&conn, "USD acc", "USD", 0);
    let food = category_id(&conn, "Food");

    let mut t = tx(TxType::Transfer, &eur.id, 100_00, "2026-02-02", None);
    assert!(matches!(
        transactions::create(&conn, &t),
        Err(CoreError::Validation {
            field: "to_account_id",
            ..
        })
    ));

    t.to_account_id = Some(eur.id.clone());
    assert!(matches!(
        transactions::create(&conn, &t),
        Err(CoreError::Validation {
            field: "to_account_id",
            ..
        })
    ));

    t.to_account_id = Some(eur2.id.clone());
    t.to_amount_minor = Some(99_00);
    assert!(matches!(
        transactions::create(&conn, &t),
        Err(CoreError::Validation {
            field: "to_amount_minor",
            ..
        })
    ));

    t.to_amount_minor = None;
    t.category_id = Some(food);
    assert!(matches!(
        transactions::create(&conn, &t),
        Err(CoreError::Validation {
            field: "category_id",
            ..
        })
    ));
    t.category_id = None;

    // Cross-currency needs an explicit destination amount.
    t.to_account_id = Some(usd.id.clone());
    assert!(matches!(
        transactions::create(&conn, &t),
        Err(CoreError::Validation {
            field: "to_amount_minor",
            ..
        })
    ));
    t.to_amount_minor = Some(108_34);
    transactions::create(&conn, &t).unwrap();
    assert_eq!(accounts::get(&conn, &usd.id).unwrap().balance_minor, 108_34);
    assert_eq!(
        accounts::get(&conn, &eur.id).unwrap().balance_minor,
        -100_00
    );
}

#[test]
fn income_expense_validation() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let salary = category_id(&conn, "Salary");

    assert!(matches!(
        transactions::create(&conn, &tx(TxType::Expense, &a.id, 0, "2026-01-01", None)),
        Err(CoreError::Validation {
            field: "amount_minor",
            ..
        })
    ));
    assert!(matches!(
        transactions::create(&conn, &tx(TxType::Expense, &a.id, -5, "2026-01-01", None)),
        Err(CoreError::Validation {
            field: "amount_minor",
            ..
        })
    ));
    assert!(matches!(
        transactions::create(&conn, &tx(TxType::Expense, &a.id, 5, "01/02/2026", None)),
        Err(CoreError::Validation { field: "date", .. })
    ));
    assert!(matches!(
        transactions::create(
            &conn,
            &tx(TxType::Expense, &a.id, 5, "2026-01-01", Some(salary))
        ),
        Err(CoreError::Validation {
            field: "category_id",
            ..
        })
    ));
    assert!(matches!(
        transactions::create(
            &conn,
            &tx(TxType::Expense, "not-an-id", 5, "2026-01-01", None)
        ),
        Err(CoreError::Validation {
            field: "account_id",
            ..
        })
    ));
    let mut long = tx(TxType::Expense, &a.id, 5, "2026-01-01", None);
    long.payee = Some("x".repeat(121));
    assert!(matches!(
        transactions::create(&conn, &long),
        Err(CoreError::Validation { field: "payee", .. })
    ));

    accounts::set_archived(&conn, &a.id, true).unwrap();
    assert!(matches!(
        transactions::create(&conn, &tx(TxType::Expense, &a.id, 5, "2026-01-01", None)),
        Err(CoreError::Validation {
            field: "account_id",
            ..
        })
    ));
}

#[test]
fn update_and_tags() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let mut input = tx(TxType::Expense, &a.id, 12_00, "2026-04-01", None);
    input.payee = Some("  Corner Shop  ".into());
    input.tags = vec!["Work".into(), "work".into(), "Trip".into()];
    input.payment_method = Some(PaymentMethod::Card);
    let t = transactions::create(&conn, &input).unwrap();
    assert_eq!(t.payee.as_deref(), Some("Corner Shop"));
    assert_eq!(t.tags, vec!["Trip".to_string(), "Work".to_string()]);
    assert_eq!(t.payment_method, Some(PaymentMethod::Card));

    input.amount_minor = 15_50;
    input.tags = vec!["Trip".into()];
    let u = transactions::update(&conn, &t.id, &input).unwrap();
    assert_eq!(u.amount_minor, 15_50);
    assert_eq!(u.tags, vec!["Trip".to_string()]);
    assert_eq!(tags::prune_unused(&conn).unwrap(), 1);

    // Type change from expense to transfer clears category and requires destination.
    let b = account(&conn, "Other", "EUR", 0);
    input.tx_type = TxType::Transfer;
    input.to_account_id = Some(b.id.clone());
    let tr = transactions::update(&conn, &t.id, &input).unwrap();
    assert_eq!(tr.tx_type, TxType::Transfer);
    assert_eq!(tr.to_account_id.as_deref(), Some(b.id.as_str()));
}

#[test]
fn filter_search_sort_paginate() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let b = account(&conn, "Card", "EUR", 0);
    let food = category_id(&conn, "Food");
    let housing = category_id(&conn, "Housing");
    let salary = category_id(&conn, "Salary");
    let sub = keel_core::repo::categories::create(
        &conn,
        &keel_core::repo::categories::CategoryInput {
            kind: keel_core::repo::categories::CategoryKind::Expense,
            name: "Groceries".into(),
            color: "#445566".into(),
            parent_id: Some(food.clone()),
        },
    )
    .unwrap();

    let mut i1 = tx(
        TxType::Expense,
        &a.id,
        30_00,
        "2026-03-05",
        Some(sub.id.clone()),
    );
    i1.payee = Some("Market 100%_real".into());
    i1.tags = vec!["weekly".into()];
    transactions::create(&conn, &i1).unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Expense, &b.id, 900_00, "2026-03-01", Some(housing)),
    )
    .unwrap();
    transactions::create(
        &conn,
        &tx(TxType::Income, &a.id, 3000_00, "2026-02-28", Some(salary)),
    )
    .unwrap();
    transactions::create(&conn, &tx(TxType::Expense, &a.id, 5_00, "2026-03-10", None)).unwrap();

    let all = transactions::list(&conn, &TransactionFilter::default()).unwrap();
    assert_eq!(all.total, 4);
    assert_eq!(all.items[0].date, "2026-03-10");

    let march = transactions::list(
        &conn,
        &TransactionFilter {
            from: Some("2026-03-01".into()),
            to: Some("2026-03-31".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(march.total, 3);

    let food_f = transactions::list(
        &conn,
        &TransactionFilter {
            category_ids: vec![food],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(food_f.total, 1, "parent category includes subcategories");

    let uncategorized = transactions::list(
        &conn,
        &TransactionFilter {
            uncategorized: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(uncategorized.total, 1);

    let acc_b = transactions::list(
        &conn,
        &TransactionFilter {
            account_id: Some(b.id.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(acc_b.total, 1);

    let by_amount = transactions::list(
        &conn,
        &TransactionFilter {
            sort: SortKey::Amount,
            dir: SortDir::Asc,
            ..Default::default()
        },
    )
    .unwrap();
    let amounts: Vec<i64> = by_amount.items.iter().map(|t| t.amount_minor).collect();
    assert_eq!(amounts, vec![5_00, 30_00, 900_00, 3000_00]);

    // LIKE wildcards in the query are literal.
    let s = transactions::list(
        &conn,
        &TransactionFilter {
            search: Some("100%_".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.total, 1);
    let s = transactions::list(
        &conn,
        &TransactionFilter {
            search: Some("%".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.total, 1);
    let s = transactions::list(
        &conn,
        &TransactionFilter {
            search: Some("groceries".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.total, 1, "search matches category name");

    // Injection attempt is treated as data.
    let s = transactions::list(
        &conn,
        &TransactionFilter {
            search: Some("'; DROP TABLE transactions; --".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.total, 0);
    assert_eq!(
        transactions::list(&conn, &TransactionFilter::default())
            .unwrap()
            .total,
        4
    );

    let tag_id = tags::list(&conn).unwrap()[0].id.clone();
    let by_tag = transactions::list(
        &conn,
        &TransactionFilter {
            tag_ids: vec![tag_id],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(by_tag.total, 1);

    let ranged = transactions::list(
        &conn,
        &TransactionFilter {
            min_amount_minor: Some(10_00),
            max_amount_minor: Some(1000_00),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(ranged.total, 2);

    let p1 = transactions::list(
        &conn,
        &TransactionFilter {
            limit: Some(3),
            ..Default::default()
        },
    )
    .unwrap();
    let p2 = transactions::list(
        &conn,
        &TransactionFilter {
            limit: Some(3),
            offset: Some(3),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(p1.items.len(), 3);
    assert_eq!(p2.items.len(), 1);
    assert_eq!(p2.total, 4);

    let types = transactions::list(
        &conn,
        &TransactionFilter {
            types: vec![TxType::Income],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(types.total, 1);
}

#[test]
fn bad_filter_values_are_rejected() {
    let conn = mem();
    assert!(transactions::list(
        &conn,
        &TransactionFilter {
            from: Some("yesterday".into()),
            ..Default::default()
        }
    )
    .is_err());
    assert!(transactions::list(
        &conn,
        &TransactionFilter {
            category_ids: vec!["1 OR 1=1".into()],
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn delete_many_is_atomic_on_invalid_id() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let t =
        transactions::create(&conn, &tx(TxType::Expense, &a.id, 1, "2026-01-01", None)).unwrap();
    assert!(transactions::delete_many(&conn, &[t.id.clone(), "bad".into()]).is_err());
    assert_eq!(
        transactions::list(&conn, &TransactionFilter::default())
            .unwrap()
            .total,
        1
    );
    assert_eq!(transactions::delete_many(&conn, &[t.id]).unwrap(), 1);
}
