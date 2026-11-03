#![allow(clippy::inconsistent_digit_grouping)]
mod common;
use common::*;
use keel_core::import::{run, DateFormat, DecimalSep, Mapping};
use keel_core::repo::transactions::{self, TransactionFilter, TxType};

fn mapping(acc: &str) -> Mapping {
    Mapping {
        account_id: acc.into(),
        has_header: true,
        date_col: 0,
        date_format: DateFormat::Dmy,
        amount_col: Some(2),
        debit_col: None,
        credit_col: None,
        payee_col: Some(1),
        description_col: None,
        invert_sign: false,
        decimal: DecimalSep::Auto,
        skip_duplicates: true,
        auto_categorize: true,
    }
}

#[test]
fn import_dedup_and_categorise() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let food = category_id(&conn, "Food");
    let mut t = tx(
        TxType::Expense,
        &a.id,
        4_20,
        "2026-01-02",
        Some(food.clone()),
    );
    t.payee = Some("Bakery".into());
    transactions::create(&conn, &t).unwrap();

    let csv = "Date;Payee;Amount\n02.01.2026;Bakery;-4,20\n03.01.2026;BAKERY;-3,10\n03.01.2026;Coffee;-2,50\n03.01.2026;Coffee;-2,50\n31.01.2026;Employer;3.200,00\nbad;Row;1\n";
    let r = run(&conn, csv.as_bytes(), &mapping(&a.id)).unwrap();
    assert_eq!(r.duplicates, 1, "existing bakery row skipped");
    assert_eq!(r.imported, 4, "both coffees kept: genuine repeats");
    assert_eq!(r.categorized, 1, "bakery learned from history");
    assert_eq!(r.issues.len(), 1);
    assert_eq!(r.issues[0].row, 7);

    let page = transactions::list(
        &conn,
        &TransactionFilter {
            search: Some("employer".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.items[0].tx_type, TxType::Income);
    assert_eq!(page.items[0].amount_minor, 3200_00);

    // Re-importing the same file adds nothing.
    let again = run(&conn, csv.as_bytes(), &mapping(&a.id)).unwrap();
    assert_eq!(again.imported, 0);
    assert_eq!(again.duplicates, 5);
}

#[test]
fn import_debit_credit_columns() {
    let conn = mem();
    let a = account(&conn, "Main", "EUR", 0);
    let csv = "2026-02-01,Rent,1150.00,\n2026-02-28,Salary,,3000.00\n";
    let mut m = mapping(&a.id);
    m.has_header = false;
    m.date_format = DateFormat::Ymd;
    m.amount_col = None;
    m.debit_col = Some(2);
    m.credit_col = Some(3);
    let r = run(&conn, csv.as_bytes(), &m).unwrap();
    assert_eq!(r.imported, 2, "{r:?}");
    let bal = keel_core::repo::accounts::get(&conn, &a.id)
        .unwrap()
        .balance_minor;
    assert_eq!(bal, 3000_00 - 1150_00);
}
