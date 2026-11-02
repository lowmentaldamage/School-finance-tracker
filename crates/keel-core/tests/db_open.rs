#![allow(clippy::inconsistent_digit_grouping)] // amounts are written as euros_cents
mod common;
use common::*;
use keel_core::db;
use keel_core::repo::{accounts, categories};
use keel_core::CoreError;

#[test]
fn file_is_encrypted_and_wrong_key_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keel.db");
    {
        let conn = db::open(&path, &key(1)).unwrap();
        account(&conn, "Main", "EUR", 12_345);
    }
    let raw = std::fs::read(&path).unwrap();
    assert!(
        !raw.starts_with(b"SQLite format 3"),
        "database header must not be plaintext"
    );
    assert!(
        !raw.windows(4).any(|w| w == b"Main"),
        "account name must not appear in plaintext"
    );

    match db::open(&path, &key(2)) {
        Err(CoreError::WrongKeyOrCorrupt) => {}
        other => panic!("expected WrongKeyOrCorrupt, got {other:?}"),
    }

    let conn = db::open(&path, &key(1)).unwrap();
    let accs = accounts::list(&conn, false).unwrap();
    assert_eq!(accs.len(), 1);
    assert_eq!(accs[0].balance_minor, 12_345);
}

#[test]
fn migrations_and_seeding_are_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keel.db");
    let n1 = {
        let conn = db::open(&path, &key(3)).unwrap();
        assert_eq!(db::current_version(&conn).unwrap(), db::SCHEMA_VERSION);
        categories::list(&conn, true).unwrap().len()
    };
    let conn = db::open(&path, &key(3)).unwrap();
    assert_eq!(categories::list(&conn, true).unwrap().len(), n1);
    assert_eq!(n1, categories::DEFAULTS.len());
}

#[test]
fn deleted_default_categories_are_not_reseeded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keel.db");
    {
        let conn = db::open(&path, &key(4)).unwrap();
        let id = category_id(&conn, "Education");
        categories::delete(&conn, &id, None).unwrap();
    }
    let conn = db::open(&path, &key(4)).unwrap();
    assert!(categories::list(&conn, true)
        .unwrap()
        .iter()
        .all(|c| c.name != "Education"));
}

#[test]
fn rekey_changes_the_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("keel.db");
    {
        let conn = db::open(&path, &key(5)).unwrap();
        account(&conn, "A", "EUR", 1);
        db::rekey(&conn, &key(6)).unwrap();
    }
    assert!(matches!(
        db::open(&path, &key(5)),
        Err(CoreError::WrongKeyOrCorrupt)
    ));
    let conn = db::open(&path, &key(6)).unwrap();
    assert_eq!(accounts::list(&conn, false).unwrap().len(), 1);
}

#[test]
fn foreign_keys_are_enforced() {
    let conn = mem();
    let on: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(on, 1);
    let err = conn.execute(
        "INSERT INTO transactions (id, type, account_id, amount_minor, date, created_at, updated_at)
         VALUES ('x', 'expense', 'missing', 1, '2026-01-01', '', '')",
        [],
    );
    assert!(err.is_err());
}
