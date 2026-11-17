//! Bank notifications captured on the phone: parsing the amount, direction and merchant out of
//! the notification text, an inbox of items waiting to be added, and optional automatic adding.
//!
//! The Android side only stores raw notification text (encrypted with a Keystore key) from the
//! apps the user picked. All interpretation happens here, once the database is unlocked.

use chrono::{DateTime, Local};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::import::{parse_amount, DecimalSep};
use crate::repo::transactions::{self, PaymentMethod, Transaction, TransactionInput, TxType};
use crate::repo::{accounts, currencies, settings};
use crate::time::{fmt_date, now_utc};

const MAX_BATCH: usize = 500;
/// Handled items are kept this long so a re-delivered notification is still recognised.
const KEEP_HANDLED_DAYS: i64 = 120;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Incoming {
    pub key: String,
    pub package: String,
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    pub posted_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Parsed {
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub amount_minor: i64,
    pub currency: String,
    pub payee: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Capture {
    pub id: String,
    pub source_package: String,
    pub source_app: String,
    pub title: String,
    pub body: String,
    pub posted_at: String,
    pub date: String,
    #[serde(rename = "type")]
    pub tx_type: Option<TxType>,
    pub amount_minor: Option<i64>,
    pub currency: Option<String>,
    pub payee: Option<String>,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub status: String,
    pub transaction_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct IngestResult {
    pub pending: usize,
    pub added: usize,
    pub duplicates: usize,
    pub ignored: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct AppRule {
    package: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    auto_add: bool,
}

fn app_rules(conn: &Connection) -> CoreResult<Vec<AppRule>> {
    Ok(settings::get(conn, "capture.apps")?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const INCOME_WORDS: &[&str] = &[
    "sent you",
    "paid you",
    "you received",
    "you've received",
    "you have received",
    "received",
    "credited",
    "credit of",
    "deposit",
    "incoming",
    "refund",
    "salary",
    "money in",
    "money added",
    "top-up",
    "top up",
    "cashback",
    "gutschrift",
    "eingang",
    "erhalten",
    "reçu",
    "virement reçu",
    "remboursement",
    "accredito",
    "ricevuto",
    "recibido",
    "recibiste",
    "abono",
    "ingreso",
    "otrzymano",
    "wpływ",
    // Slovenian (NLB Klik, Revolut in Slovenian)
    "prejeli ste",
    "prejeli",
    "prejeto",
    "prejem",
    "priliv",
    "dobropis",
    "vračilo",
    "poslal vam je",
    "poslala vam je",
];

const EXPENSE_WORDS: &[&str] = &[
    "paid",
    "payment",
    "purchase",
    "spent",
    "debited",
    "debit",
    "charged",
    "withdrawal",
    "withdrawn",
    "sent",
    "card",
    "transaction at",
    "direct debit",
    "zahlung",
    "bezahlt",
    "abbuchung",
    "belastung",
    "lastschrift",
    "paiement",
    "achat",
    "prélèvement",
    "pagamento",
    "addebito",
    "compra",
    "cargo",
    "pago",
    "płatność",
    "obciążenie",
    // Slovenian
    "plačilo",
    "plačali",
    "plačano",
    "obremenitev",
    "odliv",
    "nakup",
    "dvig",
    "poslali",
    "bremenitev",
    "kartica",
];

/// Words that mark a number as a balance or limit rather than the amount that moved.
const BALANCE_WORDS: &[&str] = &[
    "balance",
    "available",
    "limit",
    "saldo",
    "solde",
    "kontostand",
    "disponible",
    "disponibile",
    "dostępne",
    "stanje",
    "razpoložljiv",
];

const SYMBOLS: &[(&str, &str)] = &[
    ("R$", "BRL"),
    ("zł", "PLN"),
    ("Kč", "CZK"),
    ("Ft", "HUF"),
    ("lei", "RON"),
    ("€", "EUR"),
    ("£", "GBP"),
    ("¥", "JPY"),
    ("₹", "INR"),
    ("₺", "TRY"),
    ("₽", "RUB"),
    ("₩", "KRW"),
    ("₪", "ILS"),
    ("₴", "UAH"),
    ("kr", "SEK"),
    ("$", "USD"),
];

const DOLLAR_CURRENCIES: &[&str] = &["USD", "CAD", "AUD", "NZD", "MXN", "SGD", "HKD"];
const KRONA_CURRENCIES: &[&str] = &["SEK", "NOK", "DKK", "ISK"];

fn is_space(c: char) -> bool {
    c == ' ' || c == '\u{a0}' || c == '\u{202f}' || c == '\t'
}

struct Amount {
    start: usize,
    end: usize,
    raw: String,
    currency: String,
    sign: Option<bool>,
}

/// Currency written immediately before `idx` (byte offset), skipping spaces; returns (code, start).
fn currency_before(
    text: &str,
    idx: usize,
    known: &dyn Fn(&str) -> bool,
    default: &str,
) -> Option<(String, usize)> {
    let head = text[..idx].trim_end_matches(is_space);
    for (sym, code) in SYMBOLS {
        if let Some(rest) = head.strip_suffix(sym) {
            return Some((resolve_symbol(sym, code, default), rest.len()));
        }
    }
    let tail: String = head
        .chars()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let before = head[..head.len() - tail.len()].chars().next_back();
    if tail.len() == 3
        && tail.chars().all(|c| c.is_ascii_uppercase())
        && before.is_none_or(|c| !c.is_alphanumeric())
        && known(&tail)
    {
        return Some((tail, head.len() - 3));
    }
    None
}

/// Currency written immediately after `idx`, skipping spaces; returns (code, end).
fn currency_after(
    text: &str,
    idx: usize,
    known: &dyn Fn(&str) -> bool,
    default: &str,
) -> Option<(String, usize)> {
    let rest = &text[idx..];
    let trimmed = rest.trim_start_matches(is_space);
    let off = idx + (rest.len() - trimmed.len());
    for (sym, code) in SYMBOLS {
        if let Some(after) = trimmed.strip_prefix(sym) {
            // "kr" / "lei" / "Ft" must not be the start of a word.
            if sym.chars().all(char::is_alphabetic)
                && after.chars().next().is_some_and(char::is_alphabetic)
            {
                continue;
            }
            return Some((resolve_symbol(sym, code, default), off + sym.len()));
        }
    }
    let code: String = trimmed.chars().take(3).collect();
    let next = trimmed[code.len()..].chars().next();
    if code.len() == 3
        && code.chars().all(|c| c.is_ascii_uppercase())
        && next.is_none_or(|c| !c.is_alphanumeric())
        && known(&code)
    {
        return Some((code, off + 3));
    }
    None
}

fn resolve_symbol(sym: &str, code: &str, default: &str) -> String {
    if sym == "$" && DOLLAR_CURRENCIES.contains(&default) {
        return default.to_owned();
    }
    if sym == "kr" && KRONA_CURRENCIES.contains(&default) {
        return default.to_owned();
    }
    code.to_owned()
}

/// All numbers in the text that have a currency next to them.
fn amounts(text: &str, known: &dyn Fn(&str) -> bool, default: &str) -> Vec<Amount> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (start, c) = chars[i];
        let prev = i.checked_sub(1).map(|p| chars[p].1);
        if !c.is_ascii_digit() || prev.is_some_and(|p| p.is_alphanumeric()) {
            i += 1;
            continue;
        }
        // A number: digits, with . , ' or a single space between digit groups.
        let mut j = i;
        let mut last_digit = i;
        while j < chars.len() {
            let ch = chars[j].1;
            if ch.is_ascii_digit() {
                last_digit = j;
                j += 1;
            } else if matches!(ch, '.' | ',' | '\'') || is_space(ch) {
                let next_digit = chars.get(j + 1).is_some_and(|(_, n)| n.is_ascii_digit());
                // A space only joins thousands groups ("1 234,56").
                let group = !is_space(ch)
                    || (chars[j + 1..]
                        .iter()
                        .take(3)
                        .filter(|(_, n)| n.is_ascii_digit())
                        .count()
                        == 3
                        && chars.get(j + 4).is_none_or(|(_, n)| !n.is_ascii_digit()));
                if next_digit && group {
                    j += 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        let end = chars.get(last_digit + 1).map_or(text.len(), |(b, _)| *b);
        let raw = text[start..end].to_owned();
        let next_char = text[end..].chars().next();
        // Skip times, dates, percentages and card/account fragments.
        let looks_like_other = matches!(next_char, Some('%' | ':' | '/'))
            || prev.is_some_and(|p| matches!(p, '*' | '#' | ':' | '/'))
            || raw.matches(['.', ',']).count() > 3;
        if !looks_like_other {
            let before = currency_before(text, start, known, default);
            let after = currency_after(text, end, known, default);
            if let Some((currency, from, to)) = before
                .map(|(c, s)| (c, s, end))
                .or_else(|| after.map(|(c, e)| (c, start, e)))
            {
                let head = text[..from].trim_end_matches(is_space);
                let near = text[..start].trim_end_matches(is_space);
                let sign = match head.chars().next_back().or(near.chars().next_back()) {
                    Some('-' | '−' | '–') => Some(false),
                    Some('+') => Some(true),
                    _ if near.ends_with('-') => Some(false),
                    _ => None,
                };
                out.push(Amount {
                    start: from,
                    end: to,
                    raw,
                    currency,
                    sign,
                });
            }
        }
        i = last_digit + 1;
    }
    out
}

fn contains_word(hay: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(pos) = hay[from..].find(word) {
        let s = from + pos;
        let e = s + word.len();
        let ok_before = hay[..s]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphabetic());
        let ok_after = hay[e..].chars().next().is_none_or(|c| !c.is_alphabetic());
        if ok_before && ok_after {
            return true;
        }
        from = e;
    }
    false
}

fn direction(lower: &str, sign: Option<bool>) -> TxType {
    match sign {
        Some(true) => return TxType::Income,
        Some(false) => return TxType::Expense,
        None => {}
    }
    if INCOME_WORDS.iter().any(|w| contains_word(lower, w)) {
        TxType::Income
    } else {
        TxType::Expense
    }
}

const PAYEE_STOP: &[&str] = &[
    " on ",
    " for ",
    " using ",
    " with ",
    " via ",
    " am ",
    " le ",
    " il ",
    " el ",
    " card",
    " ending",
    " was ",
    " has ",
    " is ",
    " - ",
    " – ",
    " at ",
    " ref",
    " mit ",
    " avec ",
    " con ",
    " dne ",
    " s kartico",
    " z kartico",
    " je ",
    " v znesku",
];
const PAYEE_REJECT: &[&str] = &[
    "vaš",
    "vaši",
    "račun",
    "računu",
    "kartico",
    "your",
    "you",
    "account",
    "card",
    "konto",
    "compte",
    "conto",
    "cuenta",
    "the account",
];

fn clean_payee(s: &str) -> Option<String> {
    let mut end = s.len();
    for stop in PAYEE_STOP {
        if let Some(p) = s.to_lowercase().find(stop) {
            end = end.min(p);
        }
    }
    for (i, c) in s.char_indices() {
        if matches!(c, '.' | ',' | '\n' | ';' | '!' | '(' | '|' | '•') && i < end {
            // Keep dots inside names such as "amazon.de".
            if c == '.' && s[i + 1..].chars().next().is_some_and(char::is_alphanumeric) {
                continue;
            }
            end = i;
            break;
        }
    }
    let p = s[..end].trim_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ':');
    let lower = p.to_lowercase();
    let first = lower.split_whitespace().next().unwrap_or("");
    if p.chars().count() < 2
        || !p.chars().next().is_some_and(char::is_alphanumeric)
        || PAYEE_REJECT.contains(&first)
        || p.chars()
            .all(|c| c.is_ascii_digit() || c == '*' || c.is_whitespace())
    {
        return None;
    }
    Some(p.chars().take(60).collect::<String>().trim().to_owned())
}

/// Merchant or counterparty: the text after "at" / "to" / "from" (and a few translations).
fn payee_from(text: &str, ty: TxType) -> Option<String> {
    let preps: &[&str] = match ty {
        TxType::Income => &[" from ", " von ", " de ", " da ", " od ", " plačnik "],
        _ => &[
            " at ",
            " to ",
            " bei ",
            " an ",
            " chez ",
            " à ",
            " presso ",
            " en ",
            " w ",
            " pri ",
            " prejemnik ",
            " na ",
        ],
    };
    let lower = text.to_lowercase();
    // Byte offsets match because lowercasing these prepositions keeps their length.
    let mut best: Option<(usize, String)> = None;
    for prep in preps {
        let mut from = 0;
        while let Some(pos) = lower[from..].find(prep) {
            let s = from + pos + prep.len();
            if text.is_char_boundary(s) {
                if let Some(p) = clean_payee(&text[s..]) {
                    if best.as_ref().is_none_or(|(b, _)| s < *b) {
                        best = Some((s, p));
                    }
                    break;
                }
            }
            from = s;
        }
    }
    best.map(|(_, p)| p)
}

/// A title that is just a merchant name (e.g. "Starbucks" over "Paid €4.50 with Visa").
fn payee_from_title(title: &str, app: &str) -> Option<String> {
    let t = title
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .trim();
    let lower = t.to_lowercase();
    let generic = [
        "bank",
        "alert",
        "notification",
        "transaction",
        "account",
        "update",
        "security",
    ];
    if t.is_empty()
        || t.chars().count() > 40
        || t.chars().any(|c| c.is_ascii_digit())
        || lower == app.to_lowercase()
        || generic.iter().any(|g| lower.contains(g))
        || INCOME_WORDS
            .iter()
            .chain(EXPENSE_WORDS)
            .any(|w| contains_word(&lower, w))
    {
        return None;
    }
    clean_payee(t)
}

/// Read the amount, direction, currency and merchant from a notification. `None` when the text
/// has no amount with a currency (statements ready, security codes, marketing).
pub fn parse(
    title: &str,
    text: &str,
    app: &str,
    default_currency: &str,
    known: &dyn Fn(&str) -> bool,
    minor_unit: &dyn Fn(&str) -> Option<u32>,
) -> Option<Parsed> {
    let full = format!("{title}\n{text}");
    let lower = full.to_lowercase();
    let found = amounts(&full, known, default_currency);
    let is_balance = |a: &Amount| {
        let start = a.start.saturating_sub(30);
        let start = (0..=start)
            .rev()
            .find(|i| full.is_char_boundary(*i))
            .unwrap_or(0);
        let ctx = full[start..a.start].to_lowercase();
        BALANCE_WORDS.iter().any(|w| ctx.contains(w))
    };
    let pick = found
        .iter()
        .find(|a| !is_balance(a))
        .or_else(|| (found.len() == 1).then(|| &found[0]))?;
    let exp = minor_unit(&pick.currency)?;
    let v = parse_amount(&pick.raw, exp, DecimalSep::Auto)?.abs();
    if v == 0 {
        return None;
    }
    // Words right next to the amount decide the direction more reliably than the whole text.
    let ty = direction(&lower, pick.sign);
    let after_amount = &full[pick.end..];
    let payee = payee_from(after_amount, ty)
        .or_else(|| payee_from(&full, ty))
        .or_else(|| payee_from_title(title, app));
    Some(Parsed {
        tx_type: ty,
        amount_minor: v,
        currency: pick.currency.clone(),
        payee,
    })
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

fn date_of(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|d| fmt_date(d.with_timezone(&Local).date_naive()))
        .unwrap_or_else(|| fmt_date(crate::time::today_local()))
}

fn trunc(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn learned_category(conn: &Connection, payee: &str, ty: TxType) -> CoreResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id
             WHERE t.type = ?1 AND c.archived = 0 AND lower(IFNULL(t.payee, '')) = ?2
             ORDER BY t.date DESC LIMIT 1",
            params![ty.as_str(), payee.to_lowercase()],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn ingest(conn: &Connection, items: &[Incoming]) -> CoreResult<IngestResult> {
    if items.len() > MAX_BATCH {
        return Err(CoreError::validation("items", "too many items"));
    }
    let rules = app_rules(conn)?;
    let base = settings::base_currency(conn)?;
    let known_list: Vec<(String, u32)> = currencies::list(conn)?
        .into_iter()
        .map(|c| (c.code, c.minor_unit))
        .collect();
    let known = |c: &str| known_list.iter().any(|(k, _)| k == c);
    let minor = |c: &str| known_list.iter().find(|(k, _)| k == c).map(|(_, m)| *m);
    let now = now_utc();
    let mut res = IngestResult::default();

    let tx = conn.unchecked_transaction()?;
    for it in items {
        let key = trunc(it.key.trim(), 128);
        let package = it.package.trim();
        if key.is_empty()
            || package.is_empty()
            || package.len() > 200
            || !package
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
        {
            res.ignored += 1;
            continue;
        }
        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM captures WHERE dedupe_key = ?1",
                [&key],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if exists {
            res.duplicates += 1;
            continue;
        }
        let rule = rules.iter().find(|r| r.package == package);
        let app = if it.app.trim().is_empty() {
            rule.map(|r| r.label.clone()).unwrap_or_default()
        } else {
            trunc(it.app.trim(), 120)
        };
        let title = trunc(&it.title, 300);
        let body = trunc(&it.text, 1000);
        let account = match rule.and_then(|r| r.account_id.as_deref()) {
            Some(id) => accounts::get(&tx, id).ok().filter(|a| !a.archived),
            None => None,
        };
        let default_currency = account
            .as_ref()
            .map_or(base.as_str(), |a| a.currency.as_str());
        let Some(p) = parse(&title, &body, &app, default_currency, &known, &minor) else {
            res.ignored += 1;
            continue;
        };
        let date = date_of(it.posted_ms);
        let posted = DateTime::from_timestamp_millis(it.posted_ms)
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| now.clone());
        let payee = p.payee.clone().map(|s| trunc(&s, 120));
        let category_id = match &payee {
            Some(name) => learned_category(&tx, name, p.tx_type)?,
            None => None,
        };
        let id = new_id();
        tx.execute(
            "INSERT INTO captures (id, dedupe_key, source_package, source_app, title, body, posted_at, date,
                                   type, amount_minor, currency, payee, category_id, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'pending', ?14, ?14)",
            params![
                id,
                key,
                package,
                app,
                title,
                body,
                posted,
                date,
                p.tx_type.as_str(),
                p.amount_minor,
                p.currency,
                payee,
                category_id,
                now
            ],
        )?;
        let auto = rule.is_some_and(|r| r.auto_add)
            && account.as_ref().is_some_and(|a| a.currency == p.currency);
        if auto {
            let acc = account.as_ref().expect("checked above");
            let input = TransactionInput {
                tx_type: p.tx_type,
                account_id: acc.id.clone(),
                amount_minor: p.amount_minor,
                to_account_id: None,
                to_amount_minor: None,
                date: date.clone(),
                category_id: category_id.clone(),
                payee: payee
                    .clone()
                    .or_else(|| (!app.is_empty()).then(|| trunc(&app, 120))),
                description: None,
                notes: None,
                payment_method: (p.tx_type == TxType::Expense).then_some(PaymentMethod::Card),
                tags: vec![],
            };
            // If the transaction is rejected (e.g. the account was archived), it stays in the inbox.
            if let Ok(t) = transactions::create(&tx, &input) {
                tx.execute(
                    "UPDATE captures SET status = 'added', transaction_id = ?2 WHERE id = ?1",
                    params![id, t.id],
                )?;
                res.added += 1;
                continue;
            }
        }
        res.pending += 1;
    }
    tx.execute(
        "DELETE FROM captures WHERE status <> 'pending' AND date < date('now', ?1)",
        [format!("-{KEEP_HANDLED_DAYS} days")],
    )?;
    tx.commit()?;
    Ok(res)
}

fn from_row(r: &Row, rules: &[AppRule]) -> rusqlite::Result<Capture> {
    let package: String = r.get("source_package")?;
    let ty: Option<String> = r.get("type")?;
    Ok(Capture {
        id: r.get("id")?,
        account_id: rules
            .iter()
            .find(|x| x.package == package)
            .and_then(|x| x.account_id.clone()),
        source_package: package,
        source_app: r.get("source_app")?,
        title: r.get("title")?,
        body: r.get("body")?,
        posted_at: r.get("posted_at")?,
        date: r.get("date")?,
        tx_type: ty.map(|t| {
            if t == "income" {
                TxType::Income
            } else {
                TxType::Expense
            }
        }),
        amount_minor: r.get("amount_minor")?,
        currency: r.get("currency")?,
        payee: r.get("payee")?,
        category_id: r.get("category_id")?,
        status: r.get("status")?,
        transaction_id: r.get("transaction_id")?,
    })
}

/// Items waiting to be added, newest first.
pub fn pending(conn: &Connection) -> CoreResult<Vec<Capture>> {
    let rules = app_rules(conn)?;
    let mut stmt = conn.prepare(
        "SELECT * FROM captures WHERE status = 'pending' ORDER BY posted_at DESC LIMIT 200",
    )?;
    let rows = stmt.query_map([], |r| from_row(r, &rules))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn pending_count(conn: &Connection) -> CoreResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM captures WHERE status = 'pending'",
        [],
        |r| r.get(0),
    )?)
}

fn ensure_pending(conn: &Connection, id: &str) -> CoreResult<()> {
    let status: Option<String> = conn
        .query_row("SELECT status FROM captures WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    match status.as_deref() {
        None => Err(CoreError::NotFound { entity: "capture" }),
        Some("pending") => Ok(()),
        Some(_) => Err(CoreError::Conflict {
            reason: "this notification was already handled",
        }),
    }
}

/// Add a captured item as a transaction (with the user's edits) and mark it handled.
pub fn confirm(conn: &Connection, id: &str, input: &TransactionInput) -> CoreResult<Transaction> {
    let tx = conn.unchecked_transaction()?;
    ensure_pending(&tx, id)?;
    let t = transactions::create(&tx, input)?;
    tx.execute(
        "UPDATE captures SET status = 'added', transaction_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, t.id, now_utc()],
    )?;
    tx.commit()?;
    Ok(t)
}

pub fn dismiss(conn: &Connection, ids: &[String]) -> CoreResult<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute(
            "UPDATE captures SET status = 'dismissed', updated_at = ?2 WHERE id = ?1 AND status = 'pending'",
            params![id, now_utc()],
        )?;
    }
    tx.commit()?;
    Ok(n)
}

/// Settings shape echoed to the phone so the listener knows which apps to read.
pub fn packages(conn: &Connection) -> CoreResult<Value> {
    let enabled = settings::get(conn, "capture.enabled")?
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let pk: Vec<String> = app_rules(conn)?.into_iter().map(|r| r.package).collect();
    Ok(serde_json::json!({ "enabled": enabled, "packages": pk }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(c: &str) -> bool {
        matches!(c, "EUR" | "USD" | "GBP" | "CHF" | "PLN" | "JPY" | "SEK")
    }
    fn minor(c: &str) -> Option<u32> {
        known(c).then_some(if c == "JPY" { 0 } else { 2 })
    }
    fn p(title: &str, text: &str) -> Option<Parsed> {
        parse(title, text, "My Bank", "EUR", &known, &minor)
    }
    fn exp(ty: TxType, amount: i64, cur: &str, payee: Option<&str>) -> Option<Parsed> {
        Some(Parsed {
            tx_type: ty,
            amount_minor: amount,
            currency: cur.into(),
            payee: payee.map(Into::into),
        })
    }

    #[test]
    fn common_bank_messages() {
        use TxType::*;
        assert_eq!(
            p(
                "Card payment",
                "You paid €12.50 at Tesco Express on 14 Nov."
            ),
            exp(Expense, 1250, "EUR", Some("Tesco Express"))
        );
        assert_eq!(
            p("Starbucks", "Paid €4.50 with Visa •• 1234"),
            exp(Expense, 450, "EUR", Some("Starbucks"))
        );
        assert_eq!(
            p("Money received", "John Smith sent you 25,00 €"),
            exp(Income, 2500, "EUR", None)
        );
        assert_eq!(
            p(
                "Incoming transfer",
                "+1.234,56 EUR from ACME GmbH. Balance: 5.000,00 EUR"
            ),
            exp(Income, 123456, "EUR", Some("ACME GmbH"))
        );
        assert_eq!(
            p(
                "Kartenzahlung",
                "Zahlung über 19,99 EUR bei REWE Markt. Kontostand 1.200,00 EUR"
            ),
            exp(Expense, 1999, "EUR", Some("REWE Markt"))
        );
        assert_eq!(
            p("", "Purchase of USD 1,299.00 at amazon.com was approved"),
            exp(Expense, 129900, "USD", Some("amazon.com"))
        );
        assert_eq!(
            p("Transaction", "-£8.40 Uber Trip"),
            exp(Expense, 840, "GBP", None)
        );
        assert_eq!(
            p("Refund", "Refund of €15.00 from Zalando"),
            exp(Income, 1500, "EUR", Some("Zalando"))
        );
        assert_eq!(
            p("Płatność kartą", "Płatność 45,60 zł w Biedronka"),
            exp(Expense, 4560, "PLN", Some("Biedronka"))
        );
        assert_eq!(
            p("Sent", "You sent €50 to Anna Müller"),
            exp(Expense, 5000, "EUR", Some("Anna Müller"))
        );
    }

    #[test]
    fn revolut_and_nlb() {
        use TxType::*;
        let q = |title: &str, text: &str, app: &str| parse(title, text, app, "EUR", &known, &minor);
        assert_eq!(
            q("Lidl", "Plačali ste 23,45 € s kartico ••1234", "Revolut"),
            exp(Expense, 2345, "EUR", Some("Lidl"))
        );
        assert_eq!(
            q("", "Prejeli ste 50,00 € od Ana Novak", "Revolut"),
            exp(Income, 5000, "EUR", Some("Ana Novak"))
        );
        assert_eq!(
            q("Mercator", "Paid €12.30 with Visa", "Revolut"),
            exp(Expense, 1230, "EUR", Some("Mercator"))
        );
        assert_eq!(
            q(
                "NLB Klik",
                "Plačilo s kartico: 18,90 EUR pri PETROL D.D. dne 17.11.2026. Razpoložljivo stanje: 1.204,10 EUR",
                "NLB Klik"
            ),
            exp(Expense, 1890, "EUR", Some("PETROL D.D"))
        );
        assert_eq!(
            q(
                "NLB Klik",
                "Priliv na račun: 1.850,00 EUR, plačnik ACME d.o.o.",
                "NLB Klik"
            ),
            exp(Income, 185000, "EUR", Some("ACME d.o.o"))
        );
        assert_eq!(
            q(
                "NLB Klik",
                "Obremenitev računa 42,00 EUR, prejemnik Telekom Slovenije",
                "NLB Klik"
            ),
            exp(Expense, 4200, "EUR", Some("Telekom Slovenije"))
        );
        assert_eq!(
            q("NLB Klik", "Vaša enkratna koda je 482913", "NLB Klik"),
            None
        );
    }

    #[test]
    fn ignores_non_money_messages() {
        assert_eq!(
            p("Security code", "Your code is 123456. Valid until 14:30."),
            None
        );
        assert_eq!(p("Statement", "Your November statement is ready."), None);
        assert_eq!(p("Offer", "Get 5% cashback this weekend"), None);
    }

    #[test]
    fn balance_only_is_used_when_nothing_else() {
        let r = p("Daily balance", "Available balance: €1,020.00").unwrap();
        assert_eq!(r.amount_minor, 102000);
    }

    #[test]
    fn ingest_inbox_auto_add_and_dedupe() {
        use crate::db::{open_in_memory, DbKey};
        use serde_json::json;
        let conn = open_in_memory(&DbKey::from_bytes([3; 32])).unwrap();
        let acc = accounts::create(
            &conn,
            &serde_json::from_value(
                json!({"name": "Main", "kind": "checking", "currency": "EUR",
                "opening_balance_minor": 10000, "opening_date": "2026-01-01"}),
            )
            .unwrap(),
        )
        .unwrap();
        let item = |key: &str, pkg: &str, text: &str| Incoming {
            key: key.into(),
            package: pkg.into(),
            app: "Bank".into(),
            title: "Card payment".into(),
            text: text.into(),
            posted_ms: 1_763_000_000_000,
        };
        // No rule: goes to the inbox.
        let r = ingest(
            &conn,
            &[item("k1", "com.bank.a", "You paid €3.20 at Café Luna")],
        )
        .unwrap();
        assert_eq!((r.pending, r.added), (1, 0));
        let r = ingest(
            &conn,
            &[item("k1", "com.bank.a", "You paid €3.20 at Café Luna")],
        )
        .unwrap();
        assert_eq!(r.duplicates, 1);
        let r = ingest(&conn, &[item("k2", "com.bank.a", "Your code is 1234")]).unwrap();
        assert_eq!(r.ignored, 1);

        let list = pending(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].payee.as_deref(), Some("Café Luna"));
        let input: TransactionInput = serde_json::from_value(json!({
            "type": "expense", "account_id": acc.id, "amount_minor": 320, "date": list[0].date,
            "payee": "Café Luna"
        }))
        .unwrap();
        confirm(&conn, &list[0].id, &input).unwrap();
        assert!(confirm(&conn, &list[0].id, &input).is_err());
        assert_eq!(pending_count(&conn).unwrap(), 0);

        // With a rule set to add automatically.
        settings::set(
            &conn,
            "capture.apps",
            &json!([{"package": "com.bank.a", "label": "Bank", "account_id": acc.id, "auto_add": true}]),
        )
        .unwrap();
        let r = ingest(
            &conn,
            &[item("k3", "com.bank.a", "You paid €10.00 at Café Luna")],
        )
        .unwrap();
        assert_eq!((r.pending, r.added), (0, 1));
        assert_eq!(
            accounts::get(&conn, &acc.id).unwrap().balance_minor,
            10000 - 320 - 1000
        );
        // A foreign-currency payment still waits for review.
        let r = ingest(
            &conn,
            &[item("k4", "com.bank.a", "You paid $10.00 at Shop")],
        )
        .unwrap();
        assert_eq!(r.pending, 1);
        let id = pending(&conn).unwrap()[0].id.clone();
        assert_eq!(dismiss(&conn, &[id]).unwrap(), 1);
        assert_eq!(pending_count(&conn).unwrap(), 0);
    }
}
