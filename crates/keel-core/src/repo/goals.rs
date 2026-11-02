//! Savings goals. Progress comes either from manual contributions or, when a goal is linked
//! to an account, from that account's balance.

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::money::CurrencyCode;
use crate::repo::{accounts, currencies};
use crate::time::{fmt_date, now_utc, today_local};
use crate::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Completed,
    Archived,
}

impl GoalStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Archived => "archived",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "completed" => Self::Completed,
            "archived" => Self::Archived,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub target_minor: i64,
    pub currency: String,
    pub deadline: Option<String>,
    pub linked_account_id: Option<String>,
    pub linked_account_name: Option<String>,
    pub status: GoalStatus,
    pub saved_minor: i64,
    pub remaining_minor: i64,
    pub progress_bp: i64,
    /// Amount per month needed to reach the target by the deadline (None without a deadline).
    pub monthly_needed_minor: Option<i64>,
    pub months_left: Option<i64>,
    pub contribution_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalInput {
    pub name: String,
    pub target_minor: i64,
    pub currency: CurrencyCode,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub linked_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Contribution {
    pub id: String,
    pub goal_id: String,
    pub amount_minor: i64,
    pub date: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContributionInput {
    pub goal_id: String,
    /// Negative for a withdrawal.
    pub amount_minor: i64,
    pub date: String,
    #[serde(default)]
    pub note: Option<String>,
}

const SELECT_SQL: &str =
    "SELECT g.id, g.name, g.target_minor, g.currency, g.deadline, g.linked_account_id, a.name,
       g.status, g.created_at,
       IFNULL((SELECT SUM(amount_minor) FROM goal_contributions c WHERE c.goal_id = g.id), 0),
       (SELECT COUNT(*) FROM goal_contributions c WHERE c.goal_id = g.id)
FROM savings_goals g LEFT JOIN accounts a ON a.id = g.linked_account_id";

/// Whole months from `today` to `deadline` (the deadline month counts). 0 if past.
pub fn months_until(today: NaiveDate, deadline: NaiveDate) -> i64 {
    let m = (deadline.year() - today.year()) as i64 * 12 + deadline.month() as i64
        - today.month() as i64;
    if deadline < today {
        0
    } else {
        m + 1
    }
}

fn build(conn: &Connection, r: &Row) -> rusqlite::Result<(Goal, Option<String>)> {
    let target: i64 = r.get(2)?;
    let linked: Option<String> = r.get(5)?;
    let contributed: i64 = r.get(9)?;
    let _ = conn;
    Ok((
        Goal {
            id: r.get(0)?,
            name: r.get(1)?,
            target_minor: target,
            currency: r.get(3)?,
            deadline: r.get(4)?,
            linked_account_id: linked.clone(),
            linked_account_name: r.get(6)?,
            status: GoalStatus::parse(&r.get::<_, String>(7)?),
            saved_minor: contributed,
            remaining_minor: 0,
            progress_bp: 0,
            monthly_needed_minor: None,
            months_left: None,
            contribution_count: r.get(10)?,
            created_at: r.get(8)?,
        },
        linked,
    ))
}

fn finish(conn: &Connection, mut g: Goal, linked: Option<String>) -> CoreResult<Goal> {
    if let Some(acc) = linked {
        if let Ok(a) = accounts::get(conn, &acc) {
            g.saved_minor = a.balance_minor.max(0);
        }
    }
    g.remaining_minor = (g.target_minor - g.saved_minor).max(0);
    g.progress_bp = (crate::money::div_round_half_even(
        g.saved_minor.max(0) as i128 * 10_000,
        g.target_minor as i128,
    ) as i64)
        .min(10_000);
    if let Some(d) = g.deadline.as_deref().and_then(crate::time::parse_date) {
        let months = months_until(today_local(), d);
        g.months_left = Some(months);
        g.monthly_needed_minor = Some(if g.remaining_minor == 0 {
            0
        } else if months == 0 {
            g.remaining_minor
        } else {
            // Round up so the target is reached.
            (g.remaining_minor + months - 1) / months
        });
    }
    Ok(g)
}

pub fn list(conn: &Connection) -> CoreResult<Vec<Goal>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_SQL} ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                       g.deadline IS NULL, g.deadline, g.created_at"
    ))?;
    let rows = stmt
        .query_map([], |r| build(conn, r))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(|(g, l)| finish(conn, g, l)).collect()
}

pub fn get(conn: &Connection, id: &str) -> CoreResult<Goal> {
    validate::id("id", id)?;
    let (g, l) = conn
        .query_row(&format!("{SELECT_SQL} WHERE g.id = ?1"), [id], |r| {
            build(conn, r)
        })
        .optional()?
        .ok_or(CoreError::NotFound { entity: "goal" })?;
    finish(conn, g, l)
}

struct Clean {
    name: String,
    deadline: Option<String>,
}

fn clean(conn: &Connection, input: &GoalInput) -> CoreResult<Clean> {
    let name = validate::required_text("name", &input.name, 80)?;
    validate::positive_amount("target_minor", input.target_minor)?;
    currencies::minor_unit(conn, input.currency.as_str())?;
    let deadline = match input.deadline.as_deref().filter(|s| !s.is_empty()) {
        Some(d) => Some(fmt_date(validate::date("deadline", d)?)),
        None => None,
    };
    if let Some(a) = &input.linked_account_id {
        let acc = accounts::get(conn, a)
            .map_err(|_| CoreError::validation("linked_account_id", "account not found"))?;
        if acc.currency != input.currency.as_str() {
            return Err(CoreError::validation(
                "linked_account_id",
                "the account must use the goal's currency",
            ));
        }
    }
    Ok(Clean { name, deadline })
}

pub fn create(conn: &Connection, input: &GoalInput) -> CoreResult<Goal> {
    let c = clean(conn, input)?;
    let id = new_id();
    let now = now_utc();
    conn.execute(
        "INSERT INTO savings_goals (id, name, target_minor, currency, deadline, linked_account_id, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)",
        params![id, c.name, input.target_minor, input.currency.as_str(), c.deadline, input.linked_account_id, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &GoalInput) -> CoreResult<Goal> {
    let existing = get(conn, id)?;
    let c = clean(conn, input)?;
    if existing.currency != input.currency.as_str() && existing.contribution_count > 0 {
        return Err(CoreError::Conflict {
            reason: "the currency of a goal with contributions cannot be changed",
        });
    }
    conn.execute(
        "UPDATE savings_goals SET name = ?2, target_minor = ?3, currency = ?4, deadline = ?5, linked_account_id = ?6,
                updated_at = ?7 WHERE id = ?1",
        params![id, c.name, input.target_minor, input.currency.as_str(), c.deadline, input.linked_account_id, now_utc()],
    )?;
    get(conn, id)
}

pub fn set_status(conn: &Connection, id: &str, status: GoalStatus) -> CoreResult<Goal> {
    get(conn, id)?;
    conn.execute(
        "UPDATE savings_goals SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status.as_str(), now_utc()],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> CoreResult<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM savings_goals WHERE id = ?1", [id])?;
    Ok(())
}

pub fn contributions(conn: &Connection, goal_id: &str) -> CoreResult<Vec<Contribution>> {
    get(conn, goal_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, goal_id, amount_minor, date, note FROM goal_contributions WHERE goal_id = ?1
         ORDER BY date DESC, created_at DESC",
    )?;
    let rows = stmt.query_map([goal_id], |r| {
        Ok(Contribution {
            id: r.get(0)?,
            goal_id: r.get(1)?,
            amount_minor: r.get(2)?,
            date: r.get(3)?,
            note: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn contribute(conn: &Connection, input: &ContributionInput) -> CoreResult<Goal> {
    let goal = get(conn, &input.goal_id)?;
    if goal.linked_account_id.is_some() {
        return Err(CoreError::Conflict {
            reason: "this goal follows an account balance; add money to the account instead",
        });
    }
    if input.amount_minor == 0 {
        return Err(CoreError::validation("amount_minor", "must not be zero"));
    }
    validate::signed_amount("amount_minor", input.amount_minor)?;
    if goal.saved_minor + input.amount_minor < 0 {
        return Err(CoreError::validation(
            "amount_minor",
            "a withdrawal cannot exceed the saved amount",
        ));
    }
    let date = fmt_date(validate::date("date", &input.date)?);
    let note = validate::optional_text("note", input.note.as_deref(), 200, false)?;
    conn.execute(
        "INSERT INTO goal_contributions (id, goal_id, amount_minor, date, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![new_id(), input.goal_id, input.amount_minor, date, note, now_utc()],
    )?;
    let g = get(conn, &input.goal_id)?;
    if g.status == GoalStatus::Active && g.saved_minor >= g.target_minor {
        return set_status(conn, &g.id, GoalStatus::Completed);
    }
    Ok(g)
}

pub fn delete_contribution(conn: &Connection, id: &str) -> CoreResult<Goal> {
    validate::id("id", id)?;
    let goal_id: String = conn
        .query_row(
            "SELECT goal_id FROM goal_contributions WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(CoreError::NotFound {
            entity: "contribution",
        })?;
    conn.execute("DELETE FROM goal_contributions WHERE id = ?1", [id])?;
    get(conn, &goal_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_until_counts_deadline_month() {
        let d = |s| crate::time::parse_date(s).unwrap();
        assert_eq!(months_until(d("2026-11-02"), d("2026-11-30")), 1);
        assert_eq!(months_until(d("2026-11-02"), d("2027-01-15")), 3);
        assert_eq!(months_until(d("2026-11-02"), d("2026-10-01")), 0);
    }
}
