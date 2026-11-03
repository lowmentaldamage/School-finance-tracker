//! Encrypted backup files (`.keelbak`) and CSV export.
//!
//! Backup layout: `KEELBAK1` | u32 LE header length | header JSON | sealed payload.
//! The header (format version, schema version, KDF parameters, salt) is authenticated as
//! associated data. The payload is a JSON dump of every user table, sealed with
//! XChaCha20-Poly1305 under Argon2id(backup password).

use std::collections::BTreeMap;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams};
use crate::db::SCHEMA_VERSION;
use crate::error::{CoreError, CoreResult};
use crate::keystore::{validate_secret, LockKind};
use crate::repo::{currencies, transactions};
use crate::time::now_utc;

const MAGIC: &[u8; 8] = b"KEELBAK1";
const MAX_BACKUP_BYTES: usize = 200 * 1024 * 1024;

/// Settings that belong to this device and are never exported or overwritten by a restore:
/// stored keys and tokens, sync state, automatic-backup folder.
const LOCAL_SETTINGS: &str =
    "(key LIKE 'secret.%' OR key LIKE 'sync.%' OR key LIKE 'backup.auto.%')";

fn is_local_setting(key: &str) -> bool {
    key.starts_with("secret.") || key.starts_with("sync.") || key.starts_with("backup.auto.")
}

/// User tables in dependency order (parents first).
const TABLES: &[(&str, &str)] = &[
    ("settings", "key"),
    ("exchange_rates", "id"),
    ("accounts", "id"),
    ("categories", "parent_id IS NOT NULL, id"),
    ("recurring_rules", "id"),
    ("recurring_skips", "rule_id, occurrence_date"),
    ("transactions", "id"),
    ("tags", "id"),
    ("transaction_tags", "transaction_id, tag_id"),
    ("budget_limits", "id"),
    ("savings_goals", "id"),
    ("goal_contributions", "id"),
];

#[derive(Serialize, Deserialize)]
struct Header {
    format: u32,
    app: String,
    schema_version: i64,
    created_at: String,
    kdf: KdfParams,
    salt: String,
}

#[derive(Serialize, Deserialize)]
struct Payload {
    tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BackupSummary {
    pub schema_version: i64,
    pub created_at: String,
    pub transactions: usize,
    pub accounts: usize,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn bad_file() -> CoreError {
    CoreError::validation("file", "is not a Keel backup or is damaged")
}

fn dump(conn: &Connection) -> CoreResult<Payload> {
    let mut tables = BTreeMap::new();
    for (t, order) in TABLES {
        let filter = if *t == "settings" {
            format!("WHERE NOT {LOCAL_SETTINGS}")
        } else {
            String::new()
        };
        let mut stmt = conn.prepare(&format!("SELECT * FROM {t} {filter} ORDER BY {order}"))?;
        let cols: Vec<String> = stmt.column_names().map(str::to_owned).collect();
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            let mut m = Map::new();
            for (i, c) in cols.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::Number(n.into()),
                    ValueRef::Real(f) => Number::from_f64(f)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    ValueRef::Text(s) => Value::String(String::from_utf8_lossy(s).into_owned()),
                    ValueRef::Blob(_) => {
                        return Err(CoreError::validation("backup", "unexpected binary data"))
                    }
                };
                m.insert(c.clone(), v);
            }
            out.push(m);
        }
        tables.insert((*t).to_owned(), out);
    }
    Ok(Payload { tables })
}

/// A backup key derived once from a password, so automatic backups and sync need no prompt.
/// Files made with it restore with the same password, because the salt is in the header.
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredKey {
    pub salt: String,
    pub kdf: KdfParams,
    pub key: String,
}

impl StoredKey {
    pub fn derive(password: &str, salt: &[u8], kdf: KdfParams) -> CoreResult<Self> {
        validate_secret(LockKind::Password, password)
            .map_err(|_| CoreError::validation("password", "use at least 10 characters"))?;
        let key = crypto::derive_key(password.as_bytes(), salt, kdf)?;
        Ok(Self {
            salt: hex(salt),
            kdf,
            key: hex(key.as_ref()),
        })
    }
    pub fn new(password: &str, kdf: KdfParams) -> CoreResult<Self> {
        let salt: [u8; 16] = crypto::random()?;
        Self::derive(password, &salt, kdf)
    }
    fn key_bytes(&self) -> CoreResult<Zeroizing<[u8; 32]>> {
        let v = unhex(&self.key).ok_or_else(bad_file)?;
        let arr: [u8; 32] = v.as_slice().try_into().map_err(|_| bad_file())?;
        Ok(Zeroizing::new(arr))
    }
}

/// Salt and KDF parameters from a backup header (to derive the key on another device).
pub fn header_params(bytes: &[u8]) -> CoreResult<(Vec<u8>, KdfParams)> {
    let (header, _, _) = split(bytes)?;
    Ok((unhex(&header.salt).ok_or_else(bad_file)?, header.kdf))
}

/// Export with a stored key (no password prompt).
pub fn export_with_key(conn: &Connection, k: &StoredKey) -> CoreResult<Vec<u8>> {
    let salt = unhex(&k.salt).ok_or_else(bad_file)?;
    let key = k.key_bytes()?;
    seal_payload(conn, &key, &salt, k.kdf)
}

/// Restore with a stored key. Fails if the file was made with a different password.
pub fn restore_with_key(
    conn: &Connection,
    bytes: &[u8],
    k: &StoredKey,
) -> CoreResult<BackupSummary> {
    let (header, header_json, sealed) = split(bytes)?;
    let key = k.key_bytes()?;
    let plain = crypto::open(&key, sealed, header_json).ok_or(CoreError::validation(
        "password",
        "is wrong, or the file is damaged",
    ))?;
    let payload: Payload = serde_json::from_slice(&plain).map_err(|_| bad_file())?;
    apply(conn, header, payload)
}

/// Create an encrypted backup of all data.
pub fn export(conn: &Connection, password: &str, kdf: KdfParams) -> CoreResult<Vec<u8>> {
    validate_secret(LockKind::Password, password)
        .map_err(|_| CoreError::validation("password", "use at least 10 characters"))?;
    let salt: [u8; 16] = crypto::random()?;
    let key = crypto::derive_key(password.as_bytes(), &salt, kdf)?;
    seal_payload(conn, &key, &salt, kdf)
}

fn seal_payload(
    conn: &Connection,
    key: &[u8; 32],
    salt: &[u8],
    kdf: KdfParams,
) -> CoreResult<Vec<u8>> {
    let header = Header {
        format: 1,
        app: "Keel".into(),
        schema_version: SCHEMA_VERSION,
        created_at: now_utc(),
        kdf,
        salt: hex(salt),
    };
    let header_json = serde_json::to_vec(&header).map_err(|_| bad_file())?;
    let payload = Zeroizing::new(serde_json::to_vec(&dump(conn)?).map_err(|_| bad_file())?);
    let sealed = crypto::seal(key, &payload, &header_json)?;
    let mut out = Vec::with_capacity(12 + header_json.len() + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(header_json.len() as u32).to_le_bytes());
    out.extend_from_slice(&header_json);
    out.extend_from_slice(&sealed);
    Ok(out)
}

fn split(bytes: &[u8]) -> CoreResult<(Header, &[u8], &[u8])> {
    if bytes.len() > MAX_BACKUP_BYTES || bytes.len() < 12 || &bytes[..8] != MAGIC {
        return Err(bad_file());
    }
    let hlen = u32::from_le_bytes(bytes[8..12].try_into().map_err(|_| bad_file())?) as usize;
    if hlen > 4096 || 12 + hlen > bytes.len() {
        return Err(bad_file());
    }
    let header_json = &bytes[12..12 + hlen];
    let header: Header = serde_json::from_slice(header_json).map_err(|_| bad_file())?;
    if header.format != 1 {
        return Err(bad_file());
    }
    Ok((header, header_json, &bytes[12 + hlen..]))
}

fn decrypt(bytes: &[u8], password: &str) -> CoreResult<(Header, Payload)> {
    let (header, header_json, sealed) = split(bytes)?;
    let salt = unhex(&header.salt).ok_or_else(bad_file)?;
    let key = crypto::derive_key(password.as_bytes(), &salt, header.kdf)?;
    let plain = crypto::open(&key, sealed, header_json).ok_or(CoreError::validation(
        "password",
        "is wrong, or the file is damaged",
    ))?;
    let payload: Payload = serde_json::from_slice(&plain).map_err(|_| bad_file())?;
    Ok((header, payload))
}

/// Read a backup's metadata without restoring it.
pub fn inspect(bytes: &[u8], password: &str) -> CoreResult<BackupSummary> {
    let (h, p) = decrypt(bytes, password)?;
    Ok(BackupSummary {
        schema_version: h.schema_version,
        created_at: h.created_at,
        transactions: p.tables.get("transactions").map_or(0, Vec::len),
        accounts: p.tables.get("accounts").map_or(0, Vec::len),
    })
}

fn table_columns(conn: &Connection, table: &str) -> CoreResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
    Ok(cols.collect::<Result<_, _>>()?)
}

/// Replace all data with the backup's contents, atomically. On any error nothing changes.
pub fn restore(conn: &Connection, bytes: &[u8], password: &str) -> CoreResult<BackupSummary> {
    let (header, payload) = decrypt(bytes, password)?;
    apply(conn, header, payload)
}

fn apply(conn: &Connection, header: Header, payload: Payload) -> CoreResult<BackupSummary> {
    if header.schema_version > SCHEMA_VERSION {
        return Err(CoreError::SchemaTooNew {
            found: header.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    if header.schema_version != SCHEMA_VERSION {
        return Err(CoreError::validation(
            "file",
            "was made by an older Keel version that cannot be restored here",
        ));
    }
    for name in payload.tables.keys() {
        if !TABLES.iter().any(|(t, _)| t == name) {
            return Err(bad_file());
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")?;
    for (t, _) in TABLES.iter().rev() {
        let filter = if *t == "settings" {
            format!("WHERE NOT {LOCAL_SETTINGS}")
        } else {
            String::new()
        };
        tx.execute(&format!("DELETE FROM {t} {filter}"), [])?;
    }
    for (t, _) in TABLES {
        let allowed = table_columns(&tx, t)?;
        for row in payload.tables.get(*t).map(Vec::as_slice).unwrap_or(&[]) {
            if *t == "settings"
                && row
                    .get("key")
                    .and_then(Value::as_str)
                    .is_some_and(is_local_setting)
            {
                continue;
            }
            let mut cols = Vec::with_capacity(row.len());
            let mut vals = Vec::with_capacity(row.len());
            for (k, v) in row {
                // Column names come from the file, so only names that exist in the schema are accepted.
                if !allowed.iter().any(|c| c == k) {
                    return Err(bad_file());
                }
                cols.push(format!("\"{k}\""));
                vals.push(match v {
                    Value::Null => SqlValue::Null,
                    Value::Bool(b) => SqlValue::Integer(*b as i64),
                    Value::Number(n) => n.as_i64().map(SqlValue::Integer).ok_or_else(bad_file)?,
                    Value::String(s) => SqlValue::Text(s.clone()),
                    _ => return Err(bad_file()),
                });
            }
            let ph = vec!["?"; vals.len()].join(",");
            tx.execute(
                &format!("INSERT INTO {t} ({}) VALUES ({ph})", cols.join(",")),
                rusqlite::params_from_iter(vals),
            )
            .map_err(|_| bad_file())?;
        }
    }
    let violations: i64 =
        tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    if violations > 0 {
        return Err(bad_file());
    }
    tx.commit()?;
    Ok(BackupSummary {
        schema_version: header.schema_version,
        created_at: header.created_at,
        transactions: payload.tables.get("transactions").map_or(0, Vec::len),
        accounts: payload.tables.get("accounts").map_or(0, Vec::len),
    })
}

/// Quote a CSV field. Text that a spreadsheet would treat as a formula is prefixed with `'`.
fn csv_text(s: &str) -> String {
    let guarded = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_owned()
    };
    if guarded.contains([',', '"', '\n', '\r']) || guarded != guarded.trim() {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

fn decimal(minor: i64, exp: u32) -> String {
    let neg = minor < 0;
    let abs = minor.unsigned_abs().to_string();
    let s = if exp == 0 {
        abs
    } else {
        let padded = format!("{abs:0>width$}", width = exp as usize + 1);
        let (i, f) = padded.split_at(padded.len() - exp as usize);
        format!("{i}.{f}")
    };
    if neg {
        format!("-{s}")
    } else {
        s
    }
}

/// All transactions as CSV (UTF-8 with BOM so spreadsheet apps detect the encoding).
pub fn transactions_csv(conn: &Connection) -> CoreResult<String> {
    let mut out = String::from("\u{feff}date,type,account,amount,currency,to_account,to_amount,to_currency,category,payee,description,payment_method,tags,notes\r\n");
    let mut offset = 0;
    loop {
        let page = transactions::list(
            conn,
            &transactions::TransactionFilter {
                sort: transactions::SortKey::Date,
                dir: transactions::SortDir::Asc,
                limit: Some(transactions::MAX_PAGE),
                offset: Some(offset),
                ..Default::default()
            },
        )?;
        for t in &page.items {
            let exp = currencies::minor_unit(conn, &t.currency)?;
            let signed = match t.tx_type {
                transactions::TxType::Expense | transactions::TxType::Transfer => -t.amount_minor,
                transactions::TxType::Income => t.amount_minor,
            };
            let to_amount = match (&t.to_currency, t.to_amount_minor) {
                (Some(c), Some(a)) => decimal(a, currencies::minor_unit(conn, c)?),
                _ => String::new(),
            };
            let pm = t.payment_method.map(|p| p.as_str()).unwrap_or("");
            let fields = [
                t.date.clone(),
                t.tx_type.as_str().to_owned(),
                csv_text(&t.account_name),
                decimal(signed, exp),
                t.currency.clone(),
                csv_text(t.to_account_name.as_deref().unwrap_or("")),
                to_amount,
                t.to_currency.clone().unwrap_or_default(),
                csv_text(t.category_name.as_deref().unwrap_or("")),
                csv_text(t.payee.as_deref().unwrap_or("")),
                csv_text(t.description.as_deref().unwrap_or("")),
                pm.to_owned(),
                csv_text(&t.tags.join(";")),
                csv_text(t.notes.as_deref().unwrap_or("")),
            ];
            out.push_str(&fields.join(","));
            out.push_str("\r\n");
        }
        offset += page.items.len() as u32;
        if page.items.is_empty() || offset as i64 >= page.total {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_quoting_and_formula_guard() {
        assert_eq!(csv_text("Bakery"), "Bakery");
        assert_eq!(csv_text("a,b"), "\"a,b\"");
        assert_eq!(csv_text("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_text("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(csv_text("+1"), "'+1");
        assert_eq!(csv_text("line\nbreak"), "\"line\nbreak\"");
    }

    #[test]
    fn decimals() {
        assert_eq!(decimal(123456, 2), "1234.56");
        assert_eq!(decimal(-5, 2), "-0.05");
        assert_eq!(decimal(1000, 0), "1000");
        assert_eq!(decimal(1, 3), "0.001");
    }
}
