//! Monthly report as a one-page PDF, written directly (no external libraries).
//! Uses the standard Helvetica fonts with WinAnsi encoding, so no fonts are embedded.

use chrono::Datelike;
use rusqlite::Connection;

use crate::error::CoreResult;
use crate::repo::reports::{self, Range};
use crate::repo::{accounts, budgets, rates::Converter};
use crate::time::{fmt_date, month_end, today_local};
use crate::validate;

const W: f32 = 595.0; // A4 points
const H: f32 = 842.0;
const M: f32 = 48.0;

struct Page {
    ops: String,
}

fn winansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c {
            '€' => 0x80,
            '–' => 0x96,
            '—' => 0x97,
            '•' => 0x95,
            c if (c as u32) < 256 && (c as u32) >= 32 => c as u8,
            _ => b'?',
        })
        .collect()
}

fn esc(s: &str) -> String {
    let bytes = winansi(s);
    let mut out = String::with_capacity(bytes.len());
    for b in bytes {
        match b {
            b'(' | b')' | b'\\' => {
                out.push('\\');
                out.push(b as char);
            }
            32..=126 => out.push(b as char),
            _ => out.push_str(&format!("\\{b:03o}")),
        }
    }
    out
}

/// Approximate Helvetica width (in points) for right-aligning numbers.
fn text_width(s: &str, size: f32) -> f32 {
    s.chars()
        .map(|c| match c {
            '0'..='9' | '€' | '$' | '£' | '+' | '-' | '%' => 0.556,
            '.' | ',' | ' ' => 0.278,
            'A'..='Z' => 0.667,
            _ => 0.5,
        })
        .sum::<f32>()
        * size
}

impl Page {
    fn text(&mut self, x: f32, y: f32, size: f32, bold: bool, grey: f32, s: &str) {
        let f = if bold { "F2" } else { "F1" };
        self.ops.push_str(&format!(
            "{grey:.2} g BT /{f} {size} Tf {x:.1} {y:.1} Td ({}) Tj ET\n",
            esc(s)
        ));
    }
    fn text_right(&mut self, xr: f32, y: f32, size: f32, bold: bool, grey: f32, s: &str) {
        self.text(xr - text_width(s, size), y, size, bold, grey, s);
    }
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, rgb: (f32, f32, f32)) {
        self.ops.push_str(&format!(
            "{:.3} {:.3} {:.3} rg {x:.1} {y:.1} {w:.1} {h:.1} re f\n",
            rgb.0, rgb.1, rgb.2
        ));
    }
    fn line(&mut self, y: f32) {
        self.ops.push_str(&format!(
            "0.85 G 0.5 w {M:.1} {y:.1} m {:.1} {y:.1} l S\n",
            W - M
        ));
    }
}

/// Format minor units for the report (English formatting).
pub fn money(minor: i64, currency: &str, exp: u32) -> String {
    let neg = minor < 0;
    let abs = minor.unsigned_abs();
    let div = 10u64.pow(exp);
    let int = (abs / div).to_string();
    let mut grouped = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    let frac = if exp > 0 {
        format!(".{:0width$}", abs % div, width = exp as usize)
    } else {
        String::new()
    };
    let sym = match currency {
        "EUR" => "€".to_owned(),
        "USD" => "$".to_owned(),
        "GBP" => "£".to_owned(),
        c => format!("{c} "),
    };
    format!("{}{sym}{grouped}{frac}", if neg { "-" } else { "" })
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// One-page PDF summary of `month` (`YYYY-MM`).
pub fn monthly_report(conn: &Connection, month: &str) -> CoreResult<Vec<u8>> {
    let first = validate::month("month", month)?;
    let last = month_end(first);
    let range = Range {
        from: fmt_date(first),
        to: fmt_date(last),
    };
    let conv = Converter::new(conn)?;
    let cur = conv.base.clone();
    let exp = crate::repo::currencies::minor_unit(conn, &cur).unwrap_or(2);
    let fm = |v: i64| money(v, &cur, exp);

    let summary = reports::summary(conn, &range)?;
    let cats = reports::by_category(conn, &range, "expense", None)?;
    let budget = budgets::for_month(conn, month)?;

    let mut p = Page { ops: String::new() };
    let mut y = H - M;
    p.text(M, y - 8.0, 20.0, true, 0.1, "Monthly report");
    p.text_right(W - M, y - 8.0, 11.0, false, 0.45, "Keel");
    y -= 30.0;
    p.text(
        M,
        y,
        12.0,
        false,
        0.35,
        &format!("{} {}", MONTHS[first.month0() as usize], first.year()),
    );
    y -= 26.0;

    // Key figures
    let tiles = [
        ("Income", fm(summary.income_minor)),
        ("Expenses", fm(summary.expense_minor)),
        ("Net savings", fm(summary.net_minor)),
        (
            "Savings rate",
            summary
                .savings_rate_bp
                .map(|b| format!("{:.1}%", b as f64 / 100.0))
                .unwrap_or_else(|| "—".into()),
        ),
    ];
    let tw = (W - 2.0 * M - 3.0 * 10.0) / 4.0;
    for (i, (label, value)) in tiles.iter().enumerate() {
        let x = M + i as f32 * (tw + 10.0);
        p.rect(x, y - 46.0, tw, 52.0, (0.955, 0.955, 0.96));
        p.text(x + 10.0, y - 12.0, 8.5, false, 0.4, &label.to_uppercase());
        p.text(x + 10.0, y - 32.0, 13.0, true, 0.1, value);
    }
    y -= 76.0;

    // Spending by category
    p.text(M, y, 11.0, true, 0.15, "Spending by category");
    y -= 8.0;
    p.line(y);
    y -= 16.0;
    if cats.is_empty() {
        p.text(M, y, 10.0, false, 0.45, "No spending recorded this month.");
        y -= 18.0;
    }
    let total: i64 = cats.iter().map(|c| c.amount_minor).sum::<i64>().max(1);
    let max = cats
        .iter()
        .map(|c| c.amount_minor)
        .max()
        .unwrap_or(1)
        .max(1);
    for c in cats.iter().take(12) {
        let name = c.name.clone().unwrap_or_else(|| "Uncategorized".into());
        p.text(M, y, 10.0, false, 0.15, &name);
        let bar_x = M + 170.0;
        let bar_w = 200.0 * c.amount_minor as f32 / max as f32;
        p.rect(bar_x, y - 1.0, 200.0, 7.0, (0.93, 0.93, 0.94));
        p.rect(bar_x, y - 1.0, bar_w.max(1.5), 7.0, (0.30, 0.32, 0.36));
        p.text_right(
            W - M - 70.0,
            y,
            10.0,
            false,
            0.45,
            &format!("{}%", c.amount_minor * 100 / total),
        );
        p.text_right(W - M, y, 10.0, true, 0.15, &fm(c.amount_minor));
        y -= 18.0;
    }
    y -= 14.0;

    // Budgets
    let mut lines = budget.lines.clone();
    if let Some(o) = budget.overall.clone() {
        lines.insert(0, o);
    }
    if !lines.is_empty() {
        p.text(M, y, 11.0, true, 0.15, "Budgets");
        y -= 8.0;
        p.line(y);
        y -= 16.0;
        for l in lines.iter().take(10) {
            let name = l.name.clone().unwrap_or_else(|| "Overall limit".into());
            p.text(M, y, 10.0, false, 0.15, &name);
            let status = match l.status {
                budgets::BudgetStatus::Ok => "On track",
                budgets::BudgetStatus::Warning => "Near limit",
                budgets::BudgetStatus::Over => "Over budget",
            };
            p.text(M + 170.0, y, 10.0, false, 0.45, status);
            p.text_right(
                W - M,
                y,
                10.0,
                false,
                0.15,
                &format!("{} of {}", fm(l.spent_minor), fm(l.available_minor)),
            );
            y -= 18.0;
        }
        y -= 14.0;
    }

    // Account balances at month end
    p.text(M, y, 11.0, true, 0.15, "Account balances at month end");
    y -= 8.0;
    p.line(y);
    y -= 16.0;
    let asof = fmt_date(last);
    for a in accounts::list(conn, false)?.into_iter().take(12) {
        let bal: i64 = conn.query_row(
            &format!(
                "SELECT {} FROM accounts a WHERE a.id = :id",
                crate::repo::accounts::BALANCE_SQL
            ),
            rusqlite::named_params! {":asof": asof, ":id": a.id},
            |r| r.get(0),
        )?;
        let aexp = crate::repo::currencies::minor_unit(conn, &a.currency).unwrap_or(2);
        p.text(M, y, 10.0, false, 0.15, &a.name);
        p.text_right(W - M, y, 10.0, false, 0.15, &money(bal, &a.currency, aexp));
        y -= 18.0;
        if y < M + 40.0 {
            break;
        }
    }

    p.text(
        M,
        M - 16.0,
        8.0,
        false,
        0.55,
        &format!(
            "Generated by Keel on {}. Amounts in {cur} unless stated.",
            fmt_date(today_local())
        ),
    );
    if !summary.missing_rates.is_empty() {
        p.text(
            M,
            M - 4.0,
            8.0,
            false,
            0.55,
            &format!(
                "Totals exclude {} (no exchange rate set).",
                summary.missing_rates.join(", ")
            ),
        );
    }
    Ok(build_pdf(&p.ops))
}

fn build_pdf(content: &str) -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_owned(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}endstream", content.len()),
    ];
    let mut out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_format() {
        assert_eq!(money(123456, "EUR", 2), "€1,234.56");
        assert_eq!(money(-5, "EUR", 2), "-€0.05");
        assert_eq!(money(1000, "JPY", 0), "JPY 1,000");
        assert_eq!(money(100000000, "USD", 2), "$1,000,000.00");
    }

    #[test]
    fn escaping() {
        assert_eq!(esc("a(b)\\"), "a\\(b\\)\\\\");
        assert_eq!(esc("€"), "\\200");
        assert_eq!(esc("✓"), "?");
    }
}
