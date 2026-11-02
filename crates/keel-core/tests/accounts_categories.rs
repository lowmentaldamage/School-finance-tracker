#![allow(clippy::inconsistent_digit_grouping)] // amounts are written as euros_cents
mod common;
use common::*;
use keel_core::money::CurrencyCode;
use keel_core::repo::accounts::{self, AccountInput, AccountKind};
use keel_core::repo::categories::{self, CategoryInput, CategoryKind};
use keel_core::repo::transactions::{self, TxType};
use keel_core::CoreError;

#[test]
fn account_crud_and_validation() {
    let conn = mem();
    let a = account(&conn, "Checking", "EUR", 100_00);
    assert_eq!(a.balance_minor, 100_00);
    assert_eq!(a.kind, AccountKind::Checking);

    let dup = accounts::create(
        &conn,
        &AccountInput {
            name: "checking".into(),
            kind: AccountKind::Savings,
            currency: CurrencyCode::parse("EUR").unwrap(),
            opening_balance_minor: 0,
            opening_date: "2026-01-01".into(),
            include_in_net_worth: true,
        },
    );
    assert!(matches!(dup, Err(CoreError::Conflict { .. })));

    let bad_currency = accounts::create(
        &conn,
        &AccountInput {
            name: "X".into(),
            kind: AccountKind::Cash,
            currency: CurrencyCode::parse("XXX").unwrap(),
            opening_balance_minor: 0,
            opening_date: "2026-01-01".into(),
            include_in_net_worth: true,
        },
    );
    assert!(matches!(
        bad_currency,
        Err(CoreError::Validation {
            field: "currency",
            ..
        })
    ));

    let bad_date = accounts::create(
        &conn,
        &AccountInput {
            name: "Y".into(),
            kind: AccountKind::Cash,
            currency: CurrencyCode::parse("EUR").unwrap(),
            opening_balance_minor: 0,
            opening_date: "2026-13-01".into(),
            include_in_net_worth: true,
        },
    );
    assert!(matches!(
        bad_date,
        Err(CoreError::Validation {
            field: "opening_date",
            ..
        })
    ));
}

#[test]
fn account_with_transactions_cannot_be_deleted_or_change_currency() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    transactions::create(&conn, &tx(TxType::Expense, &a.id, 500, "2026-02-01", None)).unwrap();
    assert!(matches!(
        accounts::delete(&conn, &a.id),
        Err(CoreError::Conflict { .. })
    ));

    let mut input = AccountInput {
        name: "Main".into(),
        kind: AccountKind::Checking,
        currency: CurrencyCode::parse("USD").unwrap(),
        opening_balance_minor: 0,
        opening_date: "2026-01-01".into(),
        include_in_net_worth: true,
    };
    assert!(matches!(
        accounts::update(&conn, &a.id, &input),
        Err(CoreError::Conflict { .. })
    ));
    input.currency = CurrencyCode::parse("EUR").unwrap();
    input.name = "Renamed".into();
    assert_eq!(
        accounts::update(&conn, &a.id, &input).unwrap().name,
        "Renamed"
    );

    let archived = accounts::set_archived(&conn, &a.id, true).unwrap();
    assert!(archived.archived);
    assert!(accounts::list(&conn, false).unwrap().is_empty());
    assert_eq!(accounts::list(&conn, true).unwrap().len(), 1);

    let empty = account(&conn, "Empty", "EUR", 0);
    accounts::delete(&conn, &empty.id).unwrap();
}

#[test]
fn subcategories_follow_rules() {
    let conn = mem();
    let food = category_id(&conn, "Food");
    let salary = category_id(&conn, "Salary");

    let rest = categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Expense,
            name: "Restaurants".into(),
            color: "#123456".into(),
            parent_id: Some(food.clone()),
        },
    )
    .unwrap();
    assert_eq!(rest.parent_id.as_deref(), Some(food.as_str()));

    // Third level is refused.
    let deep = categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Expense,
            name: "Fast food".into(),
            color: "#123456".into(),
            parent_id: Some(rest.id.clone()),
        },
    );
    assert!(matches!(
        deep,
        Err(CoreError::Validation {
            field: "parent_id",
            ..
        })
    ));

    // Parent of a different kind is refused.
    let wrong_kind = categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Expense,
            name: "Odd".into(),
            color: "#123456".into(),
            parent_id: Some(salary),
        },
    );
    assert!(matches!(
        wrong_kind,
        Err(CoreError::Validation {
            field: "parent_id",
            ..
        })
    ));

    // Parent with children cannot be deleted.
    assert!(matches!(
        categories::delete(&conn, &food, None),
        Err(CoreError::Conflict { .. })
    ));

    // Archiving parent archives children.
    categories::set_archived(&conn, &food, true).unwrap();
    assert!(categories::get(&conn, &rest.id).unwrap().archived);
}

#[test]
fn deleting_used_category_requires_reassignment() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let shopping = category_id(&conn, "Shopping");
    let other = category_id(&conn, "Other");
    let salary = category_id(&conn, "Salary");
    let t = transactions::create(
        &conn,
        &tx(
            TxType::Expense,
            &a.id,
            999,
            "2026-03-03",
            Some(shopping.clone()),
        ),
    )
    .unwrap();

    assert!(matches!(
        categories::delete(&conn, &shopping, None),
        Err(CoreError::Conflict { .. })
    ));
    assert!(matches!(
        categories::delete(&conn, &shopping, Some(&salary)),
        Err(CoreError::Validation {
            field: "reassign_to",
            ..
        })
    ));
    categories::delete(&conn, &shopping, Some(&other)).unwrap();
    assert_eq!(
        transactions::get(&conn, &t.id)
            .unwrap()
            .category_id
            .as_deref(),
        Some(other.as_str())
    );
}

#[test]
fn category_colour_and_name_validation() {
    let conn = mem();
    let bad = categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Expense,
            name: "Pets".into(),
            color: "blue".into(),
            parent_id: None,
        },
    );
    assert!(matches!(
        bad,
        Err(CoreError::Validation { field: "color", .. })
    ));
    let dup = categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Expense,
            name: "food".into(),
            color: "#000000".into(),
            parent_id: None,
        },
    );
    assert!(matches!(dup, Err(CoreError::Conflict { .. })));
    // Same name in the other kind is allowed.
    categories::create(
        &conn,
        &CategoryInput {
            kind: CategoryKind::Income,
            name: "Food".into(),
            color: "#000000".into(),
            parent_id: None,
        },
    )
    .unwrap();
}
