//! Encrypted database connection and schema migrations.

use std::path::Path;

pub use rusqlite::Connection;
use rusqlite::{ErrorCode, OpenFlags};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{CoreError, CoreResult};

/// 256-bit raw SQLCipher key. Zeroed on drop.
pub struct DbKey([u8; 32]);

impl DbKey {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Drop for DbKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Ordered list of embedded migrations. Never edit an existing entry; append new ones.
const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("migrations/0001_init.sql"))];

pub const SCHEMA_VERSION: i64 = MIGRATIONS[MIGRATIONS.len() - 1].0;

/// Open (or create) the encrypted database at `path`, verify the key, apply migrations,
/// and seed defaults on first run.
pub fn open(path: &Path, key: &DbKey) -> CoreResult<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    init(conn, key)
}

/// In-memory encrypted database (tests and previews).
pub fn open_in_memory(key: &DbKey) -> CoreResult<Connection> {
    init(Connection::open_in_memory()?, key)
}

fn init(conn: Connection, key: &DbKey) -> CoreResult<Connection> {
    // SQLCipher's own diagnostics go to stderr; they hold no user data but are noise in app logs.
    let _ = conn.execute_batch("PRAGMA cipher_log_level = NONE;");
    apply_key(&conn, key)?;
    verify_key(&conn)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA secure_delete = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    crate::repo::categories::seed_defaults_if_needed(&conn)?;
    Ok(conn)
}

fn apply_key(conn: &Connection, key: &DbKey) -> CoreResult<()> {
    // The key is hex-encoded bytes we generated ourselves, never user text, so formatting is safe.
    let mut hex = Zeroizing::new(String::with_capacity(64));
    for b in key.as_bytes() {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    let stmt = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", hex.as_str()));
    conn.execute_batch(&stmt)?;
    Ok(())
}

fn verify_key(conn: &Connection) -> CoreResult<()> {
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    }) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::NotADatabase => {
            Err(CoreError::WrongKeyOrCorrupt)
        }
        Err(e) => Err(e.into()),
    }
}

/// Re-encrypt the database with a new key.
pub fn rekey(conn: &Connection, new_key: &DbKey) -> CoreResult<()> {
    let mut hex = Zeroizing::new(String::with_capacity(64));
    for b in new_key.as_bytes() {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    let stmt = Zeroizing::new(format!("PRAGMA rekey = \"x'{}'\";", hex.as_str()));
    conn.execute_batch(&stmt)?;
    Ok(())
}

pub fn current_version(conn: &Connection) -> CoreResult<i64> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
         );",
    )?;
    Ok(conn.query_row(
        "SELECT IFNULL(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?)
}

fn migrate(conn: &Connection) -> CoreResult<()> {
    let current = current_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(CoreError::SchemaTooNew {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, crate::time::now_utc()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

/// Map SQLite constraint failures raised by triggers or unique indexes to domain errors.
pub(crate) fn map_constraint(e: rusqlite::Error) -> CoreError {
    if let rusqlite::Error::SqliteFailure(f, Some(msg)) = &e {
        if f.code == ErrorCode::ConstraintViolation {
            if msg.contains("category_parent_invalid") {
                return CoreError::validation(
                    "parent_id",
                    "must be a top-level category of the same kind",
                );
            }
            if msg.contains("category_has_children") {
                return CoreError::Conflict {
                    reason: "a category with subcategories cannot become a subcategory",
                };
            }
            if msg.contains("category_kind_children") {
                return CoreError::Conflict {
                    reason: "cannot change the kind of a category with subcategories",
                };
            }
            if msg.contains("transaction_category_kind") {
                return CoreError::validation(
                    "category_id",
                    "category kind does not match transaction type",
                );
            }
            if msg.contains("UNIQUE") {
                return CoreError::Conflict {
                    reason: "an item with this name already exists",
                };
            }
            if msg.contains("FOREIGN KEY") {
                return CoreError::Conflict {
                    reason: "the item is in use or a referenced item does not exist",
                };
            }
        }
    }
    CoreError::Db(e)
}
