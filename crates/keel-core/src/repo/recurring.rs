//! Recurring transactions. Occurrences are never booked automatically: due ones are shown
//! and the user confirms (or skips) each. Booking is idempotent per (rule, occurrence date).

use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::map_constraint;
use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::repo::rates::Converter;
use crate::repo::transactions::{self, PaymentMethod, Transaction, TransactionInput, TxType};
use crate::time::{fmt_date, now_utc, today_local};
use crate::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FreqUnit {
    Day,
    Week,
    Month,
    Year,
}

impl FreqUnit {
    fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "day" => Self::Day,
            "week" => Self::Week,
            "year" => Self::Year,
            _ => Self::Month,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Rule {
    pub id: String,
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub account_id: String,
    pub account_name: String,
    pub currency: String,
    pub to_account_id: Option<String>,
    pub to_account_name: Option<String>,
    pub amount_minor: i64,
    pub to_amount_minor: Option<i64>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub payment_method: Option<PaymentMethod>,
    pub freq_unit: FreqUnit,
    pub freq_interval: u32,
    pub anchor_date: String,
    pub end_date: Option<String>,
    pub next_due_date: Option<String>,
    pub active: bool,
    pub booked_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleInput {
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub account_id: String,
    pub amount_minor: i64,
    #[serde(default)]
    pub to_account_id: Option<String>,
    #[serde(default)]
    pub to_amount_minor: Option<i64>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub payee: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub payment_method: Option<PaymentMethod>,
    pub freq_unit: FreqUnit,
    pub freq_interval: u32,
    pub anchor_date: String,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Occurrence {
    pub rule_id: String,
    pub date: String,
    pub due: bool,
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub title: String,
    pub amount_minor: i64,
    pub currency: String,
    pub account_name: String,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Upcoming {
    pub items: Vec<Occurrence>,
    pub currency: String,
    pub due_count: i64,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub missing_rates: Vec<String>,
}

/// The `k`-th occurrence (0-based) of a schedule. Monthly/yearly dates keep the anchor's day,
/// clamped to the last day of shorter months (31 Jan → 28/29 Feb → 31 Mar).
pub fn nth(anchor: NaiveDate, unit: FreqUnit, interval: u32, k: u32) -> Option<NaiveDate> {
    let step = (interval as i64).checked_mul(k as i64)?;
    match unit {
        FreqUnit::Day => anchor.checked_add_signed(Duration::days(step)),
        FreqUnit::Week => anchor.checked_add_signed(Duration::weeks(step)),
        FreqUnit::Month | FreqUnit::Year => {
            let months = if unit == FreqUnit::Year {
                step.checked_mul(12)?
            } else {
                step
            };
            let total = anchor.year() as i64 * 12 + anchor.month0() as i64 + months;
            let y = i32::try_from(total.div_euclid(12)).ok()?;
            let m = total.rem_euclid(12) as u32 + 1;
            let last = crate::time::month_end(NaiveDate::from_ymd_opt(y, m, 1)?).day();
            NaiveDate::from_ymd_opt(y, m, anchor.day().min(last))
        }
    }
}

const MAX_SCAN: u32 = 20_000;

const SELECT_SQL: &str = "SELECT r.id, r.type, r.account_id, a.name, a.currency, r.to_account_id, ta.name,
       r.amount_minor, r.to_amount_minor, r.category_id, c.name, c.color, r.payee, r.description,
       r.payment_method, r.freq_unit, r.freq_interval, r.anchor_date, r.end_date, r.next_due_date, r.active,
       (SELECT COUNT(*) FROM transactions t WHERE t.recurring_rule_id = r.id)
FROM recurring_rules r
JOIN accounts a ON a.id = r.account_id
LEFT JOIN accounts ta ON ta.id = r.to_account_id
LEFT JOIN categories c ON c.id = r.category_id";

fn map_row(r: &Row) -> rusqlite::Result<Rule> {
    let ty: String = r.get(1)?;
    Ok(Rule {
        id: r.get(0)?,
        tx_type: match ty.as_str() {
            "income" => TxType::Income,
            "transfer" => TxType::Transfer,
            _ => TxType::Expense,
        },
        account_id: r.get(2)?,
        account_name: r.get(3)?,
        currency: r.get(4)?,
        to_account_id: r.get(5)?,
        to_account_name: r.get(6)?,
        amount_minor: r.get(7)?,
        to_amount_minor: r.get(8)?,
        category_id: r.get(9)?,
        category_name: r.get(10)?,
        category_color: r.get(11)?,
        payee: r.get(12)?,
        description: r.get(13)?,
        payment_method: r
            .get::<_, Option<String>>(14)?
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
        freq_unit: FreqUnit::parse(&r.get::<_, String>(15)?),
        freq_interval: r.get(16)?,
        anchor_date: r.get(17)?,
        end_date: r.get(18)?,
        next_due_date: r.get(19)?,
        active: r.get(20)?,
        booked_count: r.get(21)?,
    })
}

pub fn list(conn: &Connection) -> CoreResult<Vec<Rule>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_SQL} ORDER BY r.active DESC, r.next_due_date IS NULL, r.next_due_date, IFNULL(r.payee, r.description)"
    ))?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> CoreResult<Rule> {
    validate::id("id", id)?;
    conn.query_row(&format!("{SELECT_SQL} WHERE r.id = ?1"), [id], map_row)
        .optional()?
        .ok_or(CoreError::NotFound {
            entity: "recurring transaction",
        })
}

fn as_tx_input(input: &RuleInput, date: &str) -> TransactionInput {
    TransactionInput {
        tx_type: input.tx_type,
        account_id: input.account_id.clone(),
        amount_minor: input.amount_minor,
        to_account_id: input.to_account_id.clone(),
        to_amount_minor: input.to_amount_minor,
        date: date.to_owned(),
        category_id: input.category_id.clone(),
        payee: input.payee.clone(),
        description: input.description.clone(),
        notes: None,
        payment_method: input.payment_method,
        tags: vec![],
    }
}

fn rule_to_input(r: &Rule) -> RuleInput {
    RuleInput {
        tx_type: r.tx_type,
        account_id: r.account_id.clone(),
        amount_minor: r.amount_minor,
        to_account_id: r.to_account_id.clone(),
        to_amount_minor: r.to_amount_minor,
        category_id: r.category_id.clone(),
        payee: r.payee.clone(),
        description: r.description.clone(),
        payment_method: r.payment_method,
        freq_unit: r.freq_unit,
        freq_interval: r.freq_interval,
        anchor_date: r.anchor_date.clone(),
        end_date: r.end_date.clone(),
        active: r.active,
    }
}

struct Clean {
    anchor: NaiveDate,
    end: Option<NaiveDate>,
    to_amount: Option<i64>,
}

fn clean(
    conn: &Connection,
    input: &RuleInput,
    existing: Option<&Transaction>,
) -> CoreResult<Clean> {
    if input.freq_interval == 0 || input.freq_interval > 366 {
        return Err(CoreError::validation(
            "freq_interval",
            "must be between 1 and 366",
        ));
    }
    let anchor = validate::date("anchor_date", &input.anchor_date)?;
    let end = match input.end_date.as_deref().filter(|s| !s.is_empty()) {
        Some(e) => {
            let e = validate::date("end_date", e)?;
            if e < anchor {
                return Err(CoreError::validation(
                    "end_date",
                    "must be on or after the start date",
                ));
            }
            Some(e)
        }
        None => None,
    };
    if input
        .payee
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
        && input
            .description
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        return Err(CoreError::validation(
            "payee",
            "enter a name or description",
        ));
    }
    // Validate as a transaction (accounts, category kind, transfer rules, text limits).
    let probe = transactions::check(conn, &as_tx_input(input, &fmt_date(anchor)), existing)?;
    Ok(Clean {
        anchor,
        end,
        to_amount: probe,
    })
}

fn opt_text(v: &Option<String>, field: &'static str, max: usize) -> CoreResult<Option<String>> {
    validate::optional_text(field, v.as_deref(), max, false)
}

fn is_closed(conn: &Connection, rule_id: &str, date: &str) -> CoreResult<bool> {
    let booked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE recurring_rule_id = ?1 AND occurrence_date = ?2",
        params![rule_id, date],
        |r| r.get(0),
    )?;
    if booked > 0 {
        return Ok(true);
    }
    let skipped: i64 = conn.query_row(
        "SELECT COUNT(*) FROM recurring_skips WHERE rule_id = ?1 AND occurrence_date = ?2",
        params![rule_id, date],
        |r| r.get(0),
    )?;
    Ok(skipped > 0)
}

/// Earliest occurrence that is neither booked nor skipped (and before the end date).
fn compute_next_due(conn: &Connection, rule: &Rule) -> CoreResult<Option<String>> {
    let anchor = validate::date("anchor_date", &rule.anchor_date)?;
    let end = rule.end_date.as_deref().and_then(crate::time::parse_date);
    for k in 0..MAX_SCAN {
        let Some(d) = nth(anchor, rule.freq_unit, rule.freq_interval, k) else {
            return Ok(None);
        };
        if end.is_some_and(|e| d > e) {
            return Ok(None);
        }
        let ds = fmt_date(d);
        if !is_closed(conn, &rule.id, &ds)? {
            return Ok(Some(ds));
        }
    }
    Ok(None)
}

fn refresh_next_due(conn: &Connection, id: &str) -> CoreResult<Rule> {
    let rule = get(conn, id)?;
    let next = compute_next_due(conn, &rule)?;
    conn.execute(
        "UPDATE recurring_rules SET next_due_date = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, next, now_utc()],
    )?;
    get(conn, id)
}

pub fn create(conn: &Connection, input: &RuleInput) -> CoreResult<Rule> {
    let c = clean(conn, input, None)?;
    let id = new_id();
    let now = now_utc();
    conn.execute(
        "INSERT INTO recurring_rules (id, type, account_id, to_account_id, amount_minor, to_amount_minor, category_id,
            payee, description, payment_method, freq_unit, freq_interval, anchor_date, end_date, next_due_date,
            active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?13, ?15, ?16, ?16)",
        params![
            id,
            input.tx_type.as_str(),
            input.account_id,
            input.to_account_id.as_deref().filter(|_| input.tx_type == TxType::Transfer),
            input.amount_minor,
            c.to_amount,
            input.category_id.as_deref().filter(|_| input.tx_type != TxType::Transfer),
            opt_text(&input.payee, "payee", 120)?,
            opt_text(&input.description, "description", 200)?,
            input.payment_method.map(PaymentMethod::as_str),
            input.freq_unit.as_str(),
            input.freq_interval,
            fmt_date(c.anchor),
            c.end.map(fmt_date),
            input.active,
            now
        ],
    )
    .map_err(map_constraint)?;
    refresh_next_due(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &RuleInput) -> CoreResult<Rule> {
    get(conn, id)?;
    let c = clean(conn, input, None)?;
    conn.execute(
        "UPDATE recurring_rules SET type = ?2, account_id = ?3, to_account_id = ?4, amount_minor = ?5,
            to_amount_minor = ?6, category_id = ?7, payee = ?8, description = ?9, payment_method = ?10,
            freq_unit = ?11, freq_interval = ?12, anchor_date = ?13, end_date = ?14, active = ?15, updated_at = ?16
         WHERE id = ?1",
        params![
            id,
            input.tx_type.as_str(),
            input.account_id,
            input.to_account_id.as_deref().filter(|_| input.tx_type == TxType::Transfer),
            input.amount_minor,
            c.to_amount,
            input.category_id.as_deref().filter(|_| input.tx_type != TxType::Transfer),
            opt_text(&input.payee, "payee", 120)?,
            opt_text(&input.description, "description", 200)?,
            input.payment_method.map(PaymentMethod::as_str),
            input.freq_unit.as_str(),
            input.freq_interval,
            fmt_date(c.anchor),
            c.end.map(fmt_date),
            input.active,
            now_utc()
        ],
    )
    .map_err(map_constraint)?;
    refresh_next_due(conn, id)
}

/// Delete a rule. Transactions already booked from it are kept.
pub fn delete(conn: &Connection, id: &str) -> CoreResult<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM recurring_rules WHERE id = ?1", [id])?;
    Ok(())
}

fn check_occurrence(rule: &Rule, date: &str) -> CoreResult<()> {
    let d = validate::date("occurrence_date", date)?;
    let anchor = validate::date("anchor_date", &rule.anchor_date)?;
    for k in 0..MAX_SCAN {
        match nth(anchor, rule.freq_unit, rule.freq_interval, k) {
            Some(x) if x == d => {
                if rule
                    .end_date
                    .as_deref()
                    .and_then(crate::time::parse_date)
                    .is_some_and(|e| d > e)
                {
                    break;
                }
                return Ok(());
            }
            Some(x) if x > d => break,
            None => break,
            _ => {}
        }
    }
    Err(CoreError::validation(
        "occurrence_date",
        "is not a scheduled date of this item",
    ))
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
pub struct ConfirmOverrides {
    pub amount_minor: Option<i64>,
    pub to_amount_minor: Option<i64>,
    pub date: Option<String>,
}

/// Book one occurrence as a transaction.
pub fn confirm(
    conn: &Connection,
    rule_id: &str,
    occurrence: &str,
    o: &ConfirmOverrides,
) -> CoreResult<Transaction> {
    let rule = get(conn, rule_id)?;
    check_occurrence(&rule, occurrence)?;
    if is_closed(conn, rule_id, occurrence)? {
        return Err(CoreError::Conflict {
            reason: "this occurrence was already booked or skipped",
        });
    }
    let mut input = as_tx_input(
        &rule_to_input(&rule),
        o.date.as_deref().unwrap_or(occurrence),
    );
    if let Some(a) = o.amount_minor {
        input.amount_minor = a;
    }
    if o.to_amount_minor.is_some() {
        input.to_amount_minor = o.to_amount_minor;
    }
    let t = transactions::create_from_recurring(conn, &input, rule_id, occurrence)?;
    refresh_next_due(conn, rule_id)?;
    Ok(t)
}

pub fn skip(conn: &Connection, rule_id: &str, occurrence: &str) -> CoreResult<Rule> {
    let rule = get(conn, rule_id)?;
    check_occurrence(&rule, occurrence)?;
    if is_closed(conn, rule_id, occurrence)? {
        return Err(CoreError::Conflict {
            reason: "this occurrence was already booked or skipped",
        });
    }
    conn.execute(
        "INSERT INTO recurring_skips (rule_id, occurrence_date) VALUES (?1, ?2)",
        params![rule_id, occurrence],
    )?;
    refresh_next_due(conn, rule_id)
}

/// Due and upcoming occurrences through `today + days`.
pub fn upcoming(conn: &Connection, days: u32) -> CoreResult<Upcoming> {
    let days = days.clamp(1, 366);
    let today = today_local();
    let horizon = today + Duration::days(days as i64);
    let conv = Converter::new(conn)?;
    let mut items = Vec::new();
    for rule in list(conn)?.into_iter().filter(|r| r.active) {
        let Some(next) = rule
            .next_due_date
            .as_deref()
            .and_then(crate::time::parse_date)
        else {
            continue;
        };
        let anchor = validate::date("anchor_date", &rule.anchor_date)?;
        let end = rule.end_date.as_deref().and_then(crate::time::parse_date);
        let mut shown = 0;
        for k in 0..MAX_SCAN {
            let Some(d) = nth(anchor, rule.freq_unit, rule.freq_interval, k) else {
                break;
            };
            if d < next {
                continue;
            }
            if d > horizon || end.is_some_and(|e| d > e) || shown >= 12 {
                break;
            }
            let ds = fmt_date(d);
            if is_closed(conn, &rule.id, &ds)? {
                continue;
            }
            shown += 1;
            let title = match rule.tx_type {
                TxType::Transfer => format!(
                    "{} → {}",
                    rule.account_name,
                    rule.to_account_name.clone().unwrap_or_default()
                ),
                _ => rule
                    .payee
                    .clone()
                    .or_else(|| rule.description.clone())
                    .unwrap_or_default(),
            };
            items.push(Occurrence {
                rule_id: rule.id.clone(),
                date: ds,
                due: d <= today,
                tx_type: rule.tx_type,
                title,
                amount_minor: rule.amount_minor,
                currency: rule.currency.clone(),
                account_name: rule.account_name.clone(),
                category_name: rule.category_name.clone(),
                category_color: rule.category_color.clone(),
            });
        }
    }
    items.sort_by(|a, b| a.date.cmp(&b.date).then(a.title.cmp(&b.title)));
    let (mut income, mut expense) = (0, 0);
    for o in &items {
        let v = conv.to_base_or_zero(
            o.amount_minor,
            &o.currency,
            &o.date.clone().min(fmt_date(today)),
        )?;
        match o.tx_type {
            TxType::Income => income += v,
            TxType::Expense => expense += v,
            TxType::Transfer => {}
        }
    }
    Ok(Upcoming {
        due_count: items.iter().filter(|o| o.due).count() as i64,
        items,
        currency: conv.base.clone(),
        income_minor: income,
        expense_minor: expense,
        missing_rates: conv.missing_list(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        crate::time::parse_date(s).unwrap()
    }

    #[test]
    fn monthly_clamps_to_month_end_and_recovers() {
        let a = d("2026-01-31");
        let got: Vec<String> = (0..4)
            .map(|k| fmt_date(nth(a, FreqUnit::Month, 1, k).unwrap()))
            .collect();
        assert_eq!(
            got,
            ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
        );
    }

    #[test]
    fn other_frequencies() {
        let a = d("2024-02-29");
        assert_eq!(
            fmt_date(nth(a, FreqUnit::Year, 1, 1).unwrap()),
            "2025-02-28"
        );
        assert_eq!(
            fmt_date(nth(a, FreqUnit::Year, 1, 4).unwrap()),
            "2028-02-29"
        );
        assert_eq!(
            fmt_date(nth(d("2026-01-01"), FreqUnit::Week, 2, 3).unwrap()),
            "2026-02-12"
        );
        assert_eq!(
            fmt_date(nth(d("2026-01-01"), FreqUnit::Day, 10, 3).unwrap()),
            "2026-01-31"
        );
        assert_eq!(
            fmt_date(nth(d("2026-01-15"), FreqUnit::Month, 3, 2).unwrap()),
            "2026-07-15"
        );
    }
}
