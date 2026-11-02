//! Read-only aggregates for the dashboard and analytics. All amounts are in the base currency.
//!
//! Flows are grouped by (currency, month) in SQL and converted with the rate valid at the end
//! of that month (or the end of the requested range, if earlier). Single-currency users never
//! hit a conversion.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::repo::accounts::BALANCE_SQL;
use crate::repo::rates::Converter;
use crate::time::{fmt_date, fmt_month, month_end, parse_month, today_local};
use crate::validate;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub from: String,
    pub to: String,
}

impl Range {
    fn parse(&self) -> CoreResult<(NaiveDate, NaiveDate)> {
        let f = validate::date("from", &self.from)?;
        let t = validate::date("to", &self.to)?;
        if f > t {
            return Err(CoreError::validation(
                "from",
                "must be on or before the end date",
            ));
        }
        if (t - f).num_days() > 366 * 30 {
            return Err(CoreError::validation("from", "range is too long"));
        }
        Ok((f, t))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Summary {
    pub currency: String,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_minor: i64,
    /// Savings rate in basis points (1 % = 100). None when there is no income.
    pub savings_rate_bp: Option<i64>,
    pub transaction_count: i64,
    pub missing_rates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MonthFlow {
    pub month: String,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_minor: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CategoryTotal {
    pub category_id: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
    pub amount_minor: i64,
    pub transaction_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NetWorthPoint {
    pub date: String,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub net_minor: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Balances {
    pub currency: String,
    pub assets_minor: i64,
    pub liabilities_minor: i64,
    pub net_minor: i64,
    pub missing_rates: Vec<String>,
}

/// (currency, month, type, sum, count)
type FlowRow = (String, String, String, i64, i64);

fn conversion_date(month: &str, range_end: NaiveDate) -> String {
    let end = parse_month(month).map(month_end).unwrap_or(range_end);
    fmt_date(end.min(range_end))
}

/// Raw (currency, month, type) sums of income and expense in a date range.
fn flows(conn: &Connection, from: NaiveDate, to: NaiveDate) -> CoreResult<Vec<FlowRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.currency, substr(t.date, 1, 7), t.type, SUM(t.amount_minor), COUNT(*)
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.type IN ('income', 'expense') AND t.date >= ?1 AND t.date <= ?2
         GROUP BY 1, 2, 3",
    )?;
    let rows = stmt.query_map(params![fmt_date(from), fmt_date(to)], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn savings_rate_bp(income: i64, expense: i64) -> Option<i64> {
    if income <= 0 {
        return None;
    }
    let net = (income - expense) as i128;
    Some(crate::money::div_round_half_even(net * 10_000, income as i128) as i64)
}

pub fn summary(conn: &Connection, range: &Range) -> CoreResult<Summary> {
    let (from, to) = range.parse()?;
    let conv = Converter::new(conn)?;
    let (mut income, mut expense, mut count) = (0i64, 0i64, 0i64);
    for (cur, month, ty, sum, n) in flows(conn, from, to)? {
        let v = conv.to_base_or_zero(sum, &cur, &conversion_date(&month, to))?;
        if ty == "income" {
            income += v;
        } else {
            expense += v;
        }
        count += n;
    }
    Ok(Summary {
        currency: conv.base.clone(),
        income_minor: income,
        expense_minor: expense,
        net_minor: income - expense,
        savings_rate_bp: savings_rate_bp(income, expense),
        transaction_count: count,
        missing_rates: conv.missing_list(),
    })
}

/// Months between two dates inclusive, as `YYYY-MM`.
pub fn months_between(from: NaiveDate, to: NaiveDate) -> Vec<String> {
    let mut out = Vec::new();
    let mut y = from.year();
    let mut m = from.month();
    while (y, m) <= (to.year(), to.month()) {
        out.push(format!("{y:04}-{m:02}"));
        if m == 12 {
            y += 1;
            m = 1;
        } else {
            m += 1;
        }
        if out.len() > 600 {
            break;
        }
    }
    out
}

pub fn cashflow_by_month(conn: &Connection, range: &Range) -> CoreResult<Vec<MonthFlow>> {
    let (from, to) = range.parse()?;
    let conv = Converter::new(conn)?;
    let mut by: BTreeMap<String, (i64, i64)> = months_between(from, to)
        .into_iter()
        .map(|m| (m, (0, 0)))
        .collect();
    for (cur, month, ty, sum, _) in flows(conn, from, to)? {
        let v = conv.to_base_or_zero(sum, &cur, &conversion_date(&month, to))?;
        let e = by.entry(month).or_default();
        if ty == "income" {
            e.0 += v;
        } else {
            e.1 += v;
        }
    }
    Ok(by
        .into_iter()
        .map(|(month, (i, e))| MonthFlow {
            month,
            income_minor: i,
            expense_minor: e,
            net_minor: i - e,
        })
        .collect())
}

/// Totals per top-level category (subcategories rolled up), or per subcategory of `parent_id`.
pub fn by_category(
    conn: &Connection,
    range: &Range,
    kind: &str,
    parent_id: Option<&str>,
) -> CoreResult<Vec<CategoryTotal>> {
    let (from, to) = range.parse()?;
    if kind != "income" && kind != "expense" {
        return Err(CoreError::validation("kind", "must be income or expense"));
    }
    if let Some(p) = parent_id {
        validate::id("parent_id", p)?;
    }
    let conv = Converter::new(conn)?;
    // Group key: the top-level category, or (when drilling down) the category itself.
    let key = if parent_id.is_some() {
        "c.id"
    } else {
        "IFNULL(c.parent_id, c.id)"
    };
    let sql = format!(
        "SELECT {key} AS k, a.currency, substr(t.date, 1, 7), SUM(t.amount_minor), COUNT(*)
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.type = ?1 AND t.date >= ?2 AND t.date <= ?3
           AND (?4 IS NULL OR c.id = ?4 OR c.parent_id = ?4)
         GROUP BY 1, 2, 3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![kind, fmt_date(from), fmt_date(to), parent_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        },
    )?;
    let mut totals: BTreeMap<Option<String>, (i64, i64)> = BTreeMap::new();
    for row in rows {
        let (k, cur, month, sum, n) = row?;
        let v = conv.to_base_or_zero(sum, &cur, &conversion_date(&month, to))?;
        let e = totals.entry(k).or_default();
        e.0 += v;
        e.1 += n;
    }
    let mut out = Vec::with_capacity(totals.len());
    for (k, (amount, n)) in totals {
        let (name, color) = match &k {
            Some(id) => conn
                .query_row(
                    "SELECT name, color FROM categories WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map(|(a, b): (String, String)| (Some(a), Some(b)))?,
            None => (None, None),
        };
        out.push(CategoryTotal {
            category_id: k,
            name,
            color,
            amount_minor: amount,
            transaction_count: n,
        });
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.amount_minor));
    Ok(out)
}

fn balances_at(conn: &Connection, conv: &Converter, date: NaiveDate) -> CoreResult<(i64, i64)> {
    let sql = format!(
        "SELECT a.currency, ({BALANCE_SQL}) FROM accounts a
         WHERE a.include_in_net_worth = 1 AND a.opening_date <= :asof"
    );
    let mut stmt = conn.prepare(&sql)?;
    let d = fmt_date(date);
    let rows = stmt.query_map(rusqlite::named_params! {":asof": d}, |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let (mut assets, mut liabilities) = (0i64, 0i64);
    for row in rows {
        let (cur, bal) = row?;
        let v = conv.to_base_or_zero(bal, &cur, &d)?;
        if v >= 0 {
            assets += v;
        } else {
            liabilities += -v;
        }
    }
    Ok((assets, liabilities))
}

/// Current balances (as of today) in the base currency.
pub fn balances(conn: &Connection) -> CoreResult<Balances> {
    let conv = Converter::new(conn)?;
    let (a, l) = balances_at(conn, &conv, today_local())?;
    Ok(Balances {
        currency: conv.base.clone(),
        assets_minor: a,
        liabilities_minor: l,
        net_minor: a - l,
        missing_rates: conv.missing_list(),
    })
}

/// Net worth at each month end in the range (the last point is the range end).
pub fn net_worth_series(conn: &Connection, range: &Range) -> CoreResult<Vec<NetWorthPoint>> {
    let (from, to) = range.parse()?;
    let conv = Converter::new(conn)?;
    let mut out = Vec::new();
    for m in months_between(from, to) {
        let d = parse_month(&m).map(month_end).unwrap_or(to).min(to);
        let (a, l) = balances_at(conn, &conv, d)?;
        out.push(NetWorthPoint {
            date: fmt_date(d),
            assets_minor: a,
            liabilities_minor: l,
            net_minor: a - l,
        });
    }
    Ok(out)
}

/// The months that contain at least one transaction (for "jump to" pickers and year lists).
pub fn active_months(conn: &Connection) -> CoreResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT substr(date, 1, 7) FROM transactions ORDER BY 1")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn current_month() -> String {
    fmt_month(today_local())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn savings_rate() {
        assert_eq!(savings_rate_bp(1000, 250), Some(7500));
        assert_eq!(savings_rate_bp(1000, 1500), Some(-5000));
        assert_eq!(savings_rate_bp(0, 10), None);
        assert_eq!(savings_rate_bp(3, 2), Some(3333));
    }

    #[test]
    fn month_list() {
        let f = NaiveDate::from_ymd_opt(2025, 11, 15).unwrap();
        let t = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        assert_eq!(
            months_between(f, t),
            vec!["2025-11", "2025-12", "2026-01", "2026-02"]
        );
    }
}
