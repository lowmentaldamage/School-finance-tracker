use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::map_constraint;
use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::repo::settings;
use crate::time::now_utc;
use crate::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoryKind {
    Income,
    Expense,
}

impl CategoryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Income => "income",
            Self::Expense => "expense",
        }
    }
    fn parse(s: &str) -> Self {
        if s == "income" {
            Self::Income
        } else {
            Self::Expense
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Category {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: CategoryKind,
    pub name: String,
    pub color: String,
    pub is_default: bool,
    pub archived: bool,
    pub sort_order: i64,
    pub transaction_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryInput {
    pub kind: CategoryKind,
    pub name: String,
    pub color: String,
    pub parent_id: Option<String>,
}

const SELECT_SQL: &str =
    "SELECT c.id, c.parent_id, c.kind, c.name, c.color, c.is_default, c.archived, c.sort_order,
       (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id)
FROM categories c";

fn map_row(r: &Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        kind: CategoryKind::parse(&r.get::<_, String>(2)?),
        name: r.get(3)?,
        color: r.get(4)?,
        is_default: r.get(5)?,
        archived: r.get(6)?,
        sort_order: r.get(7)?,
        transaction_count: r.get(8)?,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> CoreResult<Vec<Category>> {
    let sql = format!(
        "{SELECT_SQL} WHERE (?1 = 1 OR c.archived = 0)
         ORDER BY c.kind DESC, IFNULL((SELECT p.sort_order FROM categories p WHERE p.id = c.parent_id), c.sort_order),
                  c.parent_id IS NOT NULL, c.sort_order, c.name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([include_archived as i64], map_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> CoreResult<Category> {
    validate::id("id", id)?;
    conn.query_row(&format!("{SELECT_SQL} WHERE c.id = ?1"), [id], map_row)
        .optional()?
        .ok_or(CoreError::NotFound { entity: "category" })
}

fn clean(conn: &Connection, input: &CategoryInput) -> CoreResult<(String, String)> {
    let name = validate::required_text("name", &input.name, 60)?;
    let color = validate::hex_color("color", &input.color)?;
    if let Some(p) = &input.parent_id {
        let parent =
            get(conn, p).map_err(|_| CoreError::validation("parent_id", "parent not found"))?;
        if parent.parent_id.is_some() || parent.kind != input.kind {
            return Err(CoreError::validation(
                "parent_id",
                "must be a top-level category of the same kind",
            ));
        }
    }
    Ok((name, color))
}

pub fn create(conn: &Connection, input: &CategoryInput) -> CoreResult<Category> {
    let (name, color) = clean(conn, input)?;
    let id = new_id();
    let order: i64 = conn.query_row(
        "SELECT IFNULL(MAX(sort_order), -1) + 1 FROM categories WHERE kind = ?1 AND parent_id IS ?2",
        params![input.kind.as_str(), input.parent_id],
        |r| r.get(0),
    )?;
    let now = now_utc();
    conn.execute(
        "INSERT INTO categories (id, parent_id, kind, name, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, input.parent_id, input.kind.as_str(), name, color, order, now],
    )
    .map_err(map_constraint)?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &CategoryInput) -> CoreResult<Category> {
    let existing = get(conn, id)?;
    if input.parent_id.as_deref() == Some(id) {
        return Err(CoreError::validation(
            "parent_id",
            "a category cannot be its own parent",
        ));
    }
    let (name, color) = clean(conn, input)?;
    if existing.kind != input.kind && existing.transaction_count > 0 {
        return Err(CoreError::Conflict {
            reason: "cannot change the kind of a category with transactions",
        });
    }
    conn.execute(
        "UPDATE categories SET parent_id = ?2, kind = ?3, name = ?4, color = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, input.parent_id, input.kind.as_str(), name, color, now_utc()],
    )
    .map_err(map_constraint)?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> CoreResult<Category> {
    get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    let now = now_utc();
    tx.execute(
        "UPDATE categories SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, archived, now],
    )?;
    if archived {
        tx.execute(
            "UPDATE categories SET archived = 1, updated_at = ?2 WHERE parent_id = ?1",
            params![id, now],
        )?;
    }
    tx.commit()?;
    get(conn, id)
}

/// Delete a category. Its transactions and recurring rules are moved to `reassign_to`
/// (which must be a different category of the same kind), or deletion is refused if any exist.
/// Subcategories must be removed or moved first.
pub fn delete(conn: &Connection, id: &str, reassign_to: Option<&str>) -> CoreResult<()> {
    let cat = get(conn, id)?;
    let children: i64 = conn.query_row(
        "SELECT COUNT(*) FROM categories WHERE parent_id = ?1",
        [id],
        |r| r.get(0),
    )?;
    if children > 0 {
        return Err(CoreError::Conflict {
            reason: "remove or move its subcategories first",
        });
    }
    let rules: i64 = conn.query_row(
        "SELECT COUNT(*) FROM recurring_rules WHERE category_id = ?1",
        [id],
        |r| r.get(0),
    )?;
    let in_use = cat.transaction_count > 0 || rules > 0;

    let tx = conn.unchecked_transaction()?;
    if in_use {
        let target_id = reassign_to.ok_or(CoreError::Conflict {
            reason: "the category is in use; choose a category to move its transactions to",
        })?;
        if target_id == id {
            return Err(CoreError::validation(
                "reassign_to",
                "must be a different category",
            ));
        }
        let target = get(conn, target_id)
            .map_err(|_| CoreError::validation("reassign_to", "category not found"))?;
        if target.kind != cat.kind {
            return Err(CoreError::validation(
                "reassign_to",
                "must be a category of the same kind",
            ));
        }
        let now = now_utc();
        tx.execute(
            "UPDATE transactions SET category_id = ?2, updated_at = ?3 WHERE category_id = ?1",
            params![id, target_id, now],
        )?;
        tx.execute(
            "UPDATE recurring_rules SET category_id = ?2, updated_at = ?3 WHERE category_id = ?1",
            params![id, target_id, now],
        )?;
    }
    tx.execute("DELETE FROM categories WHERE id = ?1", [id])
        .map_err(map_constraint)?;
    tx.commit()?;
    Ok(())
}

/// Default categories: (kind, name, colour).
pub const DEFAULTS: &[(CategoryKind, &str, &str)] = &[
    (CategoryKind::Income, "Salary", "#3f7d5c"),
    (CategoryKind::Income, "Freelance", "#4f7a8a"),
    (CategoryKind::Income, "Investments", "#6a6f9a"),
    (CategoryKind::Income, "Business", "#8a7550"),
    (CategoryKind::Income, "Other income", "#7a7f87"),
    (CategoryKind::Expense, "Housing", "#5b6b82"),
    (CategoryKind::Expense, "Food", "#8a6a4f"),
    (CategoryKind::Expense, "Transportation", "#4f7a7a"),
    (CategoryKind::Expense, "Shopping", "#7d5a7a"),
    (CategoryKind::Expense, "Entertainment", "#6b7d4f"),
    (CategoryKind::Expense, "Subscriptions", "#5a6aa0"),
    (CategoryKind::Expense, "Healthcare", "#9a5a5a"),
    (CategoryKind::Expense, "Education", "#7a6a9a"),
    (CategoryKind::Expense, "Bills", "#8a7a4a"),
    (CategoryKind::Expense, "Other", "#7a7f87"),
];

/// Insert default categories once per database.
pub fn seed_defaults_if_needed(conn: &Connection) -> CoreResult<()> {
    if settings::get(conn, "defaults.seeded")?
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    let now = now_utc();
    for (i, (kind, name, color)) in DEFAULTS.iter().enumerate() {
        tx.execute(
            "INSERT OR IGNORE INTO categories (id, parent_id, kind, name, color, is_default, sort_order, created_at, updated_at)
             VALUES (?1, NULL, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
            params![new_id(), kind.as_str(), name, color, i as i64, now],
        )?;
    }
    settings::set(&tx, "defaults.seeded", &serde_json::Value::Bool(true))?;
    tx.commit()?;
    Ok(())
}
