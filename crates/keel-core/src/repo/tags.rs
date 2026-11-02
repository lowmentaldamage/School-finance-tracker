use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::CoreResult;
use crate::ids::new_id;
use crate::time::now_utc;
use crate::validate;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub usage_count: i64,
}

pub const MAX_TAGS_PER_TRANSACTION: usize = 10;

pub fn list(conn: &Connection) -> CoreResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, COUNT(tt.transaction_id)
         FROM tags t LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            usage_count: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Find a tag by case-insensitive name or create it. Returns the tag id.
pub fn ensure(conn: &Connection, name: &str) -> CoreResult<String> {
    let name = validate::required_text("tags", name, 40)?;
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
            [&name],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, now_utc()],
    )?;
    Ok(id)
}

/// Replace the tag set of a transaction.
pub fn set_for_transaction(
    conn: &Connection,
    transaction_id: &str,
    names: &[String],
) -> CoreResult<()> {
    if names.len() > MAX_TAGS_PER_TRANSACTION {
        return Err(crate::CoreError::validation("tags", "too many tags"));
    }
    conn.execute(
        "DELETE FROM transaction_tags WHERE transaction_id = ?1",
        [transaction_id],
    )?;
    for n in names {
        let tag_id = ensure(conn, n)?;
        conn.execute(
            "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?1, ?2)",
            params![transaction_id, tag_id],
        )?;
    }
    Ok(())
}

/// Remove tags no longer used by any transaction.
pub fn prune_unused(conn: &Connection) -> CoreResult<usize> {
    Ok(conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM transaction_tags)",
        [],
    )?)
}
