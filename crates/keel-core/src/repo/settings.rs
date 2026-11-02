//! Key/value settings stored as JSON. Keys are allow-listed.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
use crate::time::now_utc;

pub const ALLOWED_KEYS: &[&str] = &[
    "profile.display_name",
    "base_currency",
    "locale.number",
    "locale.date",
    "theme",
    "dashboard.hidden_sections",
    "onboarding.completed",
    "defaults.seeded",
    "security.auto_lock_minutes",
    "security.background_lock_secs",
    "security.hide_in_switcher",
];

fn check_key(key: &str) -> CoreResult<()> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(CoreError::validation("key", "unknown setting"))
    }
}

pub fn get(conn: &Connection, key: &str) -> CoreResult<Option<Value>> {
    check_key(key)?;
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> CoreResult<()> {
    check_key(key)?;
    validate_value(key, value)?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value.to_string(), now_utc()],
    )?;
    Ok(())
}

pub fn all(conn: &Connection) -> CoreResult<serde_json::Map<String, Value>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (k, v) = row?;
        if let Ok(v) = serde_json::from_str(&v) {
            map.insert(k, v);
        }
    }
    Ok(map)
}

fn validate_value(key: &str, v: &Value) -> CoreResult<()> {
    let ok = match key {
        "profile.display_name" => v.as_str().is_some_and(|s| s.chars().count() <= 60),
        "base_currency" => v
            .as_str()
            .is_some_and(|s| crate::money::CurrencyCode::parse(s).is_ok()),
        "locale.number" | "locale.date" => v.as_str().is_some_and(|s| {
            s.len() <= 20
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '/' || c == '.')
        }),
        "theme" => matches!(v.as_str(), Some("system" | "light" | "dark")),
        "dashboard.hidden_sections" => v.as_array().is_some_and(|a| {
            a.len() <= 20 && a.iter().all(|x| x.as_str().is_some_and(|s| s.len() <= 40))
        }),
        "onboarding.completed" | "defaults.seeded" | "security.hide_in_switcher" => v.is_boolean(),
        "security.auto_lock_minutes" => matches!(v.as_u64(), Some(1 | 2 | 5 | 10 | 15 | 30 | 60)),
        "security.background_lock_secs" => matches!(v.as_u64(), Some(0 | 30 | 60 | 300)),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(CoreError::validation(
            "value",
            "invalid value for this setting",
        ))
    }
}

pub fn base_currency(conn: &Connection) -> CoreResult<String> {
    Ok(get(conn, "base_currency")?
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "EUR".to_owned()))
}
