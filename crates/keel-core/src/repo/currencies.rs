use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize)]
pub struct Currency {
    pub code: String,
    pub minor_unit: u32,
    pub name: String,
}

pub fn list(conn: &Connection) -> CoreResult<Vec<Currency>> {
    let mut stmt = conn.prepare("SELECT code, minor_unit, name FROM currencies ORDER BY code")?;
    let rows = stmt.query_map([], |r| {
        Ok(Currency {
            code: r.get(0)?,
            minor_unit: r.get(1)?,
            name: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn minor_unit(conn: &Connection, code: &str) -> CoreResult<u32> {
    conn.query_row(
        "SELECT minor_unit FROM currencies WHERE code = ?1",
        [code],
        |r| r.get(0),
    )
    .optional()?
    .ok_or(CoreError::validation("currency", "unsupported currency"))
}
