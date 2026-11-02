#![allow(dead_code)]
use keel_core::db::{self, DbKey};
use keel_core::money::CurrencyCode;
use keel_core::repo::accounts::{self, AccountInput, AccountKind};
use keel_core::repo::categories;
use keel_core::repo::transactions::{TransactionInput, TxType};
use rusqlite::Connection;

pub fn key(b: u8) -> DbKey {
    DbKey::from_bytes([b; 32])
}

pub fn mem() -> Connection {
    db::open_in_memory(&key(7)).expect("open")
}

pub fn account(conn: &Connection, name: &str, currency: &str, opening: i64) -> accounts::Account {
    accounts::create(
        conn,
        &AccountInput {
            name: name.into(),
            kind: AccountKind::Checking,
            currency: CurrencyCode::parse(currency).unwrap(),
            opening_balance_minor: opening,
            opening_date: "2026-01-01".into(),
            include_in_net_worth: true,
        },
    )
    .expect("create account")
}

pub fn category_id(conn: &Connection, name: &str) -> String {
    categories::list(conn, true)
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .expect("category")
        .id
}

pub fn tx(
    t: TxType,
    account_id: &str,
    amount: i64,
    date: &str,
    category_id: Option<String>,
) -> TransactionInput {
    TransactionInput {
        tx_type: t,
        account_id: account_id.into(),
        amount_minor: amount,
        to_account_id: None,
        to_amount_minor: None,
        date: date.into(),
        category_id,
        payee: None,
        description: None,
        notes: None,
        payment_method: None,
        tags: vec![],
    }
}
