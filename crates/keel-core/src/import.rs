//! Bank statement CSV import: preview, column mapping, duplicate detection, auto-categorisation.

use std::collections::HashMap;

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::repo::transactions::{self, TransactionInput, TxType};
use crate::repo::{accounts, currencies};
use crate::time::fmt_date;
use crate::validate;

const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;

/// Decode as UTF-8 (BOM stripped), falling back to Windows-1252/Latin-1.
pub fn decode(bytes: &[u8]) -> CoreResult<String> {
    if bytes.len() > MAX_BYTES {
        return Err(CoreError::validation(
            "file",
            "is too large (maximum 20 MB)",
        ));
    }
    let b = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    Ok(match std::str::from_utf8(b) {
        Ok(s) => s.to_owned(),
        Err(_) => b
            .iter()
            .map(|&c| if c == 0x80 { '€' } else { c as char })
            .collect(),
    })
}

fn detect_delimiter(text: &str) -> char {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let count = |d: char| {
        let mut n = 0;
        let mut q = false;
        for c in first.chars() {
            if c == '"' {
                q = !q;
            } else if c == d && !q {
                n += 1;
            }
        }
        n
    };
    [';', ',', '\t', '|']
        .into_iter()
        .max_by_key(|d| count(*d))
        .filter(|d| count(*d) > 0)
        .unwrap_or(',')
}

/// RFC 4180 parser (quoted fields, doubled quotes, newlines inside quotes).
pub fn parse_csv(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' && field.is_empty() {
            quoted = true;
        } else if c == delim {
            row.push(std::mem::take(&mut field));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut field));
            if row.iter().any(|f| !f.trim().is_empty()) {
                rows.push(std::mem::take(&mut row));
            } else {
                row.clear();
            }
            if rows.len() > MAX_ROWS {
                break;
            }
        } else {
            field.push(c);
        }
    }
    row.push(field);
    if row.iter().any(|f| !f.trim().is_empty()) {
        rows.push(row);
    }
    rows
}

#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub delimiter: String,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub columns: usize,
}

pub fn preview(bytes: &[u8]) -> CoreResult<Preview> {
    let text = decode(bytes)?;
    let d = detect_delimiter(&text);
    let rows = parse_csv(&text, d);
    if rows.is_empty() {
        return Err(CoreError::validation("file", "contains no rows"));
    }
    let columns = rows.iter().take(50).map(Vec::len).max().unwrap_or(0);
    Ok(Preview {
        delimiter: d.to_string(),
        total_rows: rows.len(),
        columns,
        rows: rows.into_iter().take(12).collect(),
    })
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DateFormat {
    Ymd,
    Dmy,
    Mdy,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DecimalSep {
    #[default]
    Auto,
    Dot,
    Comma,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mapping {
    pub account_id: String,
    pub has_header: bool,
    pub date_col: usize,
    pub date_format: DateFormat,
    /// One signed amount column…
    #[serde(default)]
    pub amount_col: Option<usize>,
    /// …or separate money-out / money-in columns.
    #[serde(default)]
    pub debit_col: Option<usize>,
    #[serde(default)]
    pub credit_col: Option<usize>,
    #[serde(default)]
    pub payee_col: Option<usize>,
    #[serde(default)]
    pub description_col: Option<usize>,
    #[serde(default)]
    pub invert_sign: bool,
    #[serde(default)]
    pub decimal: DecimalSep,
    #[serde(default = "yes")]
    pub skip_duplicates: bool,
    #[serde(default = "yes")]
    pub auto_categorize: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RowIssue {
    pub row: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ImportResult {
    pub imported: usize,
    pub duplicates: usize,
    pub categorized: usize,
    pub issues: Vec<RowIssue>,
}

pub fn parse_date(s: &str, f: DateFormat) -> Option<NaiveDate> {
    let s = s.trim();
    let s = s.split(['T', ' ']).next().unwrap_or(s);
    let parts: Vec<&str> = s.split(['-', '.', '/']).filter(|p| !p.is_empty()).collect();
    if parts.len() != 3 {
        return None;
    }
    let n = |i: usize| parts[i].parse::<u32>().ok();
    let (y, m, d) = match f {
        DateFormat::Ymd => (n(0)? as i32, n(1)?, n(2)?),
        DateFormat::Dmy => (n(2)? as i32, n(1)?, n(0)?),
        DateFormat::Mdy => (n(2)? as i32, n(0)?, n(1)?),
    };
    let y = if y < 100 { 2000 + y } else { y };
    NaiveDate::from_ymd_opt(y, m, d)
}

/// Parse a bank amount into signed minor units. Handles currency symbols, spaces, thousands
/// separators, a leading/trailing minus and accounting-style parentheses.
pub fn parse_amount(raw: &str, exp: u32, dec: DecimalSep) -> Option<i64> {
    let mut s: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{a0}' && *c != '\'')
        .collect();
    if s.is_empty() {
        return None;
    }
    let mut neg = false;
    if s.starts_with('(') && s.ends_with(')') {
        neg = true;
        s = s[1..s.len() - 1].to_owned();
    }
    s.retain(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | '+'));
    if let Some(r) = s.strip_prefix('-') {
        neg = !neg;
        s = r.to_owned();
    } else if let Some(r) = s.strip_suffix('-') {
        neg = !neg;
        s = r.to_owned();
    }
    s = s.trim_start_matches('+').to_owned();
    if s.is_empty() || s.contains('-') || s.contains('+') {
        return None;
    }
    let dec_char = match dec {
        DecimalSep::Dot => Some('.'),
        DecimalSep::Comma => Some(','),
        DecimalSep::Auto => {
            let last = s.rfind(['.', ',']);
            last.and_then(|i| {
                let tail = &s[i + 1..];
                let c = s[i..].chars().next()?;
                let count = s.matches(c).count();
                // A lone separator followed by 1–2 (or the currency's) digits is a decimal point.
                (count == 1 && !tail.is_empty() && (tail.len() != 3 || exp == 3)).then_some(c)
            })
        }
    };
    let (int, frac) = match dec_char.and_then(|c| s.rfind(c)) {
        Some(i) => (s[..i].replace(['.', ','], ""), s[i + 1..].to_owned()),
        None => (s.replace(['.', ','], ""), String::new()),
    };
    if frac.len() > exp as usize
        || !int.chars().all(|c| c.is_ascii_digit())
        || !frac.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let int: i64 = if int.is_empty() { 0 } else { int.parse().ok()? };
    let frac_v: i64 = if frac.is_empty() {
        0
    } else {
        format!("{frac:0<width$}", width = exp as usize)
            .parse()
            .ok()?
    };
    let v = int.checked_mul(10i64.pow(exp))?.checked_add(frac_v)?;
    if v > validate::MAX_AMOUNT_MINOR {
        return None;
    }
    Some(if neg { -v } else { v })
}

fn cell(row: &[String], i: Option<usize>) -> Option<String> {
    i.and_then(|i| row.get(i))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

pub fn run(conn: &Connection, bytes: &[u8], m: &Mapping) -> CoreResult<ImportResult> {
    let account = accounts::get(conn, &m.account_id)
        .map_err(|_| CoreError::validation("account_id", "account not found"))?;
    if account.archived {
        return Err(CoreError::validation("account_id", "account is archived"));
    }
    if m.amount_col.is_none() && m.debit_col.is_none() && m.credit_col.is_none() {
        return Err(CoreError::validation(
            "amount_col",
            "choose the amount column",
        ));
    }
    let exp = currencies::minor_unit(conn, &account.currency)?;
    let text = decode(bytes)?;
    let rows = parse_csv(&text, detect_delimiter(&text));
    let start = usize::from(m.has_header);

    let tx = conn.unchecked_transaction()?;
    let mut res = ImportResult {
        imported: 0,
        duplicates: 0,
        categorized: 0,
        issues: Vec::new(),
    };
    let mut seen: HashMap<(String, i64, String), i64> = HashMap::new();
    let mut learned: HashMap<(String, &'static str), Option<String>> = HashMap::new();

    for (i, row) in rows.iter().enumerate().skip(start) {
        let line = i + 1;
        let mut issue = |r: &str| {
            res.issues.push(RowIssue {
                row: line,
                reason: r.to_owned(),
            })
        };
        let Some(date) = cell(row, Some(m.date_col)).and_then(|s| parse_date(&s, m.date_format))
        else {
            issue("date not recognised");
            continue;
        };
        let amount = if let Some(c) = m.amount_col {
            cell(row, Some(c)).and_then(|s| parse_amount(&s, exp, m.decimal))
        } else {
            let debit = cell(row, m.debit_col)
                .and_then(|s| parse_amount(&s, exp, m.decimal))
                .map(|v| -v.abs());
            let credit = cell(row, m.credit_col)
                .and_then(|s| parse_amount(&s, exp, m.decimal))
                .map(i64::abs);
            match (debit, credit) {
                (Some(d), _) if d != 0 => Some(d),
                (_, Some(c)) => Some(c),
                (Some(d), None) => Some(d),
                _ => None,
            }
        };
        let Some(mut amount) = amount else {
            issue("amount not recognised");
            continue;
        };
        if m.invert_sign {
            amount = -amount;
        }
        if amount == 0 {
            issue("zero amount");
            continue;
        }
        let ty = if amount < 0 {
            TxType::Expense
        } else {
            TxType::Income
        };
        let payee = cell(row, m.payee_col).map(|s| s.chars().take(120).collect::<String>());
        let description =
            cell(row, m.description_col).map(|s| s.chars().take(200).collect::<String>());
        let label = payee
            .clone()
            .or_else(|| description.clone())
            .unwrap_or_default();
        let ds = fmt_date(date);

        if m.skip_duplicates {
            let key = (ds.clone(), amount, label.to_lowercase());
            let in_db: i64 = tx.query_row(
                "SELECT COUNT(*) FROM transactions WHERE account_id = ?1 AND date = ?2 AND type = ?3 AND amount_minor = ?4
                   AND lower(IFNULL(payee, IFNULL(description, ''))) = ?5",
                params![account.id, ds, ty.as_str(), amount.abs(), key.2],
                |r| r.get(0),
            )?;
            let n = seen.entry(key).or_insert(0);
            *n += 1;
            // Import only the copies beyond those already present (a file may hold genuine repeats).
            if *n <= in_db {
                res.duplicates += 1;
                continue;
            }
        }

        let mut category_id = None;
        if m.auto_categorize && !label.is_empty() {
            let k = (label.to_lowercase(), ty.as_str());
            if !learned.contains_key(&k) {
                let found: Option<String> = tx
                    .query_row(
                        "SELECT t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id
                         WHERE t.type = ?1 AND c.archived = 0
                           AND lower(IFNULL(t.payee, IFNULL(t.description, ''))) = ?2
                         ORDER BY t.date DESC LIMIT 1",
                        params![ty.as_str(), k.0],
                        |r| r.get(0),
                    )
                    .optional()?;
                learned.insert(k.clone(), found);
            }
            category_id = learned[&k].clone();
        }
        let input = TransactionInput {
            tx_type: ty,
            account_id: account.id.clone(),
            amount_minor: amount.abs(),
            to_account_id: None,
            to_amount_minor: None,
            date: ds,
            category_id: category_id.clone(),
            payee,
            description,
            notes: None,
            payment_method: None,
            tags: vec![],
        };
        match transactions::create(&tx, &input) {
            Ok(_) => {
                res.imported += 1;
                if category_id.is_some() {
                    res.categorized += 1;
                }
            }
            Err(e) => res.issues.push(RowIssue {
                row: line,
                reason: e.to_string(),
            }),
        }
    }
    tx.commit()?;
    res.issues.truncate(200);
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_parsing() {
        let rows = parse_csv("a;\"b;c\";\"say \"\"hi\"\"\"\r\n\r\n1;2;3\n", ';');
        assert_eq!(
            rows,
            vec![vec!["a", "b;c", "say \"hi\""], vec!["1", "2", "3"]]
        );
        assert_eq!(detect_delimiter("Date;Amount;Text\n"), ';');
        assert_eq!(detect_delimiter("Date,\"A;B\",Text\n"), ',');
        let multi = parse_csv("x,\"line1\nline2\"\n", ',');
        assert_eq!(multi[0][1], "line1\nline2");
    }

    #[test]
    fn dates() {
        assert_eq!(
            parse_date("2026-03-05", DateFormat::Ymd),
            NaiveDate::from_ymd_opt(2026, 3, 5)
        );
        assert_eq!(
            parse_date("05.03.2026", DateFormat::Dmy),
            NaiveDate::from_ymd_opt(2026, 3, 5)
        );
        assert_eq!(
            parse_date("03/05/26", DateFormat::Mdy),
            NaiveDate::from_ymd_opt(2026, 3, 5)
        );
        assert_eq!(
            parse_date("2026-03-05T10:00:00", DateFormat::Ymd),
            NaiveDate::from_ymd_opt(2026, 3, 5)
        );
        assert_eq!(parse_date("31.02.2026", DateFormat::Dmy), None);
    }

    #[test]
    fn amounts() {
        let a = |s| parse_amount(s, 2, DecimalSep::Auto);
        assert_eq!(a("-12,34"), Some(-1234));
        assert_eq!(a("1.234,56"), Some(123456));
        assert_eq!(a("1,234.56"), Some(123456));
        assert_eq!(a("€ 1 234,56"), Some(123456));
        assert_eq!(a("(45.00)"), Some(-4500));
        assert_eq!(a("45.00-"), Some(-4500));
        assert_eq!(a("+3000"), Some(300000));
        assert_eq!(a("1,234"), Some(123400));
        assert_eq!(a("abc"), None);
        assert_eq!(parse_amount("1.234", 2, DecimalSep::Comma), Some(123400));
        assert_eq!(parse_amount("1,5", 2, DecimalSep::Comma), Some(150));
        assert_eq!(parse_amount("12.345", 3, DecimalSep::Auto), Some(12345));
    }
}
