//! Monthly budgets. A limit applies from its `effective_month` until a later row replaces it,
//! so users set a budget once and it carries forward. Limits are in the base currency.

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::repo::categories::{self, CategoryKind};
use crate::repo::rates::Converter;
use crate::time::{fmt_date, fmt_month, month_end, now_utc};
use crate::validate;

pub const WARNING_BP: i64 = 8_000;
pub const OVER_BP: i64 = 10_000;
const MAX_ROLLOVER_MONTHS: i32 = 24;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BudgetStatus {
    Ok,
    Warning,
    Over,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BudgetLine {
    /// None for the overall monthly cap.
    pub category_id: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
    pub limit_minor: i64,
    pub rollover: bool,
    pub carried_minor: i64,
    pub available_minor: i64,
    pub spent_minor: i64,
    pub remaining_minor: i64,
    /// Spent as a share of available, in basis points.
    pub used_bp: i64,
    pub status: BudgetStatus,
    /// Month the current limit was set.
    pub effective_month: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BudgetMonth {
    pub month: String,
    pub currency: String,
    pub lines: Vec<BudgetLine>,
    pub overall: Option<BudgetLine>,
    pub total_available_minor: i64,
    pub total_spent_minor: i64,
    /// Spending this month in expense categories without a budget.
    pub unbudgeted_spent_minor: i64,
    pub missing_rates: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetInput {
    /// None sets the overall monthly cap.
    pub category_id: Option<String>,
    pub month: String,
    pub limit_minor: i64,
    #[serde(default)]
    pub rollover: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BudgetHistoryPoint {
    pub month: String,
    pub budgeted_minor: i64,
    pub spent_minor: i64,
}

fn add_months(d: NaiveDate, n: i32) -> NaiveDate {
    let total = d.year() * 12 + d.month0() as i32 + n;
    NaiveDate::from_ymd_opt(total.div_euclid(12), total.rem_euclid(12) as u32 + 1, 1)
        .expect("valid month")
}

fn check_category(conn: &Connection, id: &str) -> CoreResult<()> {
    let c = categories::get(conn, id)
        .map_err(|_| CoreError::validation("category_id", "category not found"))?;
    if c.kind != CategoryKind::Expense || c.parent_id.is_some() {
        return Err(CoreError::validation(
            "category_id",
            "budgets apply to top-level expense categories",
        ));
    }
    Ok(())
}

/// Set (or with limit 0, stop) a budget from `month` onwards.
pub fn set(conn: &Connection, input: &BudgetInput) -> CoreResult<()> {
    let month = fmt_month(validate::month("month", &input.month)?);
    if input.limit_minor < 0 || input.limit_minor > validate::MAX_AMOUNT_MINOR {
        return Err(CoreError::validation(
            "limit_minor",
            "must be zero or a positive amount",
        ));
    }
    if let Some(c) = &input.category_id {
        check_category(conn, c)?;
    }
    let now = now_utc();
    let tx = conn.unchecked_transaction()?;
    let updated = tx.execute(
        "UPDATE budget_limits SET limit_minor = ?3, rollover = ?4, updated_at = ?5
         WHERE category_id IS ?1 AND effective_month = ?2",
        params![
            input.category_id,
            month,
            input.limit_minor,
            input.rollover,
            now
        ],
    )?;
    if updated == 0 {
        tx.execute(
            "INSERT INTO budget_limits (id, category_id, effective_month, limit_minor, rollover, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![new_id(), input.category_id, month, input.limit_minor, input.rollover, now],
        )?;
    }
    // Drop redundant "no budget" markers that precede any real budget.
    tx.execute(
        "DELETE FROM budget_limits WHERE limit_minor = 0 AND category_id IS ?1 AND NOT EXISTS (
            SELECT 1 FROM budget_limits b WHERE b.category_id IS ?1 AND b.effective_month < budget_limits.effective_month)",
        params![input.category_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Effective (limit, rollover, effective_month) for a category (None = overall) in a month.
fn effective(
    conn: &Connection,
    category_id: Option<&str>,
    month: &str,
) -> CoreResult<Option<(i64, bool, String)>> {
    Ok(conn
        .query_row(
            "SELECT limit_minor, rollover, effective_month FROM budget_limits
             WHERE category_id IS ?1 AND effective_month <= ?2 ORDER BY effective_month DESC LIMIT 1",
            params![category_id, month],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?)
}

/// Spending in a month for a top-level category and its subcategories (None = all expenses).
fn spent(
    conn: &Connection,
    conv: &Converter,
    category_id: Option<&str>,
    month: NaiveDate,
) -> CoreResult<i64> {
    let from = fmt_date(month);
    let to = fmt_date(month_end(month));
    let mut stmt = conn.prepare_cached(
        "SELECT a.currency, SUM(t.amount_minor) FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.type = 'expense' AND t.date >= ?1 AND t.date <= ?2
           AND (?3 IS NULL OR c.id = ?3 OR c.parent_id = ?3)
         GROUP BY a.currency",
    )?;
    let rows = stmt.query_map(params![from, to, category_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut total = 0;
    for row in rows {
        let (cur, sum) = row?;
        total += conv.to_base_or_zero(sum, &cur, &to)?;
    }
    Ok(total)
}

/// Unused budget carried into `month` from previous months with rollover enabled.
fn carried_into(
    conn: &Connection,
    conv: &Converter,
    category_id: Option<&str>,
    month: NaiveDate,
) -> CoreResult<i64> {
    // Find how far back the unbroken chain of rollover-enabled months goes.
    let mut start = month;
    for _ in 0..MAX_ROLLOVER_MONTHS {
        let prev = add_months(start, -1);
        match effective(conn, category_id, &fmt_month(prev))? {
            Some((limit, true, _)) if limit > 0 => start = prev,
            _ => break,
        }
    }
    let mut carry = 0i64;
    let mut m = start;
    while m < month {
        let (limit, _, _) =
            effective(conn, category_id, &fmt_month(m))?.unwrap_or((0, false, String::new()));
        let available = limit + carry;
        carry = (available - spent(conn, conv, category_id, m)?).max(0);
        m = add_months(m, 1);
    }
    Ok(carry)
}

fn line(
    conn: &Connection,
    conv: &Converter,
    category_id: Option<&str>,
    month: NaiveDate,
) -> CoreResult<Option<BudgetLine>> {
    let Some((limit, rollover, eff)) = effective(conn, category_id, &fmt_month(month))? else {
        return Ok(None);
    };
    if limit == 0 {
        return Ok(None);
    }
    let carried = if rollover {
        carried_into(conn, conv, category_id, month)?
    } else {
        0
    };
    let available = limit + carried;
    let spent = spent(conn, conv, category_id, month)?;
    let used_bp = if available > 0 {
        crate::money::div_round_half_even(spent as i128 * 10_000, available as i128) as i64
    } else if spent > 0 {
        OVER_BP
    } else {
        0
    };
    let status = if used_bp >= OVER_BP {
        BudgetStatus::Over
    } else if used_bp >= WARNING_BP {
        BudgetStatus::Warning
    } else {
        BudgetStatus::Ok
    };
    let (name, color) = match category_id {
        Some(id) => {
            let c = categories::get(conn, id)?;
            (Some(c.name), Some(c.color))
        }
        None => (None, None),
    };
    Ok(Some(BudgetLine {
        category_id: category_id.map(str::to_owned),
        name,
        color,
        limit_minor: limit,
        rollover,
        carried_minor: carried,
        available_minor: available,
        spent_minor: spent,
        remaining_minor: available - spent,
        used_bp,
        status,
        effective_month: eff,
    }))
}

pub fn for_month(conn: &Connection, month: &str) -> CoreResult<BudgetMonth> {
    let m = validate::month("month", month)?;
    let conv = Converter::new(conn)?;
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT b.category_id FROM budget_limits b JOIN categories c ON c.id = b.category_id
             WHERE b.category_id IS NOT NULL ORDER BY c.sort_order, c.name",
        )?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut lines = Vec::new();
    for id in &ids {
        if let Some(l) = line(conn, &conv, Some(id), m)? {
            lines.push(l);
        }
    }
    let overall = line(conn, &conv, None, m)?;
    let all_spent = spent(conn, &conv, None, m)?;
    let budgeted_spent: i64 = lines.iter().map(|l| l.spent_minor).sum();
    let total_available = match &overall {
        Some(o) => o.available_minor,
        None => lines.iter().map(|l| l.available_minor).sum(),
    };
    let total_spent = if overall.is_some() {
        all_spent
    } else {
        budgeted_spent
    };
    Ok(BudgetMonth {
        month: fmt_month(m),
        currency: conv.base.clone(),
        lines,
        overall,
        total_available_minor: total_available,
        total_spent_minor: total_spent,
        unbudgeted_spent_minor: all_spent - budgeted_spent,
        missing_rates: conv.missing_list(),
    })
}

/// Budgeted vs spent for the `count` months ending at `end_month`.
pub fn history(
    conn: &Connection,
    end_month: &str,
    count: u32,
) -> CoreResult<Vec<BudgetHistoryPoint>> {
    let end = validate::month("end_month", end_month)?;
    let count = count.clamp(1, 24) as i32;
    let mut out = Vec::new();
    for i in (0..count).rev() {
        let m = add_months(end, -i);
        let bm = for_month(conn, &fmt_month(m))?;
        out.push(BudgetHistoryPoint {
            month: bm.month,
            budgeted_minor: bm.total_available_minor,
            spent_minor: bm.total_spent_minor,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_arithmetic() {
        let d = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(fmt_month(add_months(d, -1)), "2025-12");
        assert_eq!(fmt_month(add_months(d, 13)), "2027-02");
        assert_eq!(fmt_month(add_months(d, -25)), "2023-12");
    }
}
