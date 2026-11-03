use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::map_constraint;
use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::repo::{accounts, categories, like_escape, tags};
use crate::time::{fmt_date, now_utc};
use crate::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxType {
    Income,
    Expense,
    Transfer,
}

impl TxType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Income => "income",
            Self::Expense => "expense",
            Self::Transfer => "transfer",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "income" => Self::Income,
            "transfer" => Self::Transfer,
            _ => Self::Expense,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Card,
    Cash,
    BankTransfer,
    DirectDebit,
    Other,
}

impl PaymentMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Card => "card",
            Self::Cash => "cash",
            Self::BankTransfer => "bank_transfer",
            Self::DirectDebit => "direct_debit",
            Self::Other => "other",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "card" => Self::Card,
            "cash" => Self::Cash,
            "bank_transfer" => Self::BankTransfer,
            "direct_debit" => Self::DirectDebit,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Transaction {
    pub id: String,
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub account_id: String,
    pub account_name: String,
    pub currency: String,
    pub amount_minor: i64,
    pub to_account_id: Option<String>,
    pub to_account_name: Option<String>,
    pub to_currency: Option<String>,
    pub to_amount_minor: Option<i64>,
    pub date: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub payment_method: Option<PaymentMethod>,
    pub recurring_rule_id: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransactionInput {
    #[serde(rename = "type")]
    pub tx_type: TxType,
    pub account_id: String,
    pub amount_minor: i64,
    #[serde(default)]
    pub to_account_id: Option<String>,
    #[serde(default)]
    pub to_amount_minor: Option<i64>,
    pub date: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub payee: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub payment_method: Option<PaymentMethod>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    #[default]
    Date,
    Amount,
    Payee,
    Created,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDir {
    Asc,
    #[default]
    Desc,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct TransactionFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub account_id: Option<String>,
    pub types: Vec<TxType>,
    /// Includes subcategories of the given categories.
    pub category_ids: Vec<String>,
    pub uncategorized: bool,
    pub tag_ids: Vec<String>,
    pub min_amount_minor: Option<i64>,
    pub max_amount_minor: Option<i64>,
    pub search: Option<String>,
    pub payment_method: Option<PaymentMethod>,
    pub sort: SortKey,
    pub dir: SortDir,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransactionPage {
    pub items: Vec<Transaction>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

const SELECT_SQL: &str = "SELECT t.id, t.type, t.account_id, a.name, a.currency, t.amount_minor,
       t.to_account_id, ta.name, ta.currency, t.to_amount_minor, t.date,
       t.category_id, c.name, c.color, t.payee, t.description, t.notes, t.payment_method,
       t.recurring_rule_id,
       (SELECT json_group_array(g.name) FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
         WHERE tt.transaction_id = t.id),
       t.created_at, t.updated_at
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id";

fn map_row(r: &Row) -> rusqlite::Result<Transaction> {
    let tags_json: Option<String> = r.get(19)?;
    let mut tags: Vec<String> = tags_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    tags.sort_by_key(|s| s.to_lowercase());
    Ok(Transaction {
        id: r.get(0)?,
        tx_type: TxType::parse(&r.get::<_, String>(1)?),
        account_id: r.get(2)?,
        account_name: r.get(3)?,
        currency: r.get(4)?,
        amount_minor: r.get(5)?,
        to_account_id: r.get(6)?,
        to_account_name: r.get(7)?,
        to_currency: r.get(8)?,
        to_amount_minor: r.get(9)?,
        date: r.get(10)?,
        category_id: r.get(11)?,
        category_name: r.get(12)?,
        category_color: r.get(13)?,
        payee: r.get(14)?,
        description: r.get(15)?,
        notes: r.get(16)?,
        payment_method: r
            .get::<_, Option<String>>(17)?
            .as_deref()
            .map(PaymentMethod::parse),
        recurring_rule_id: r.get(18)?,
        tags,
        created_at: r.get(20)?,
        updated_at: r.get(21)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> CoreResult<Transaction> {
    validate::id("id", id)?;
    conn.query_row(&format!("{SELECT_SQL} WHERE t.id = ?1"), [id], map_row)
        .optional()?
        .ok_or(CoreError::NotFound {
            entity: "transaction",
        })
}

/// Normalised, validated values ready to write.
struct Clean {
    to_account_id: Option<String>,
    to_amount_minor: Option<i64>,
    date: String,
    category_id: Option<String>,
    payee: Option<String>,
    description: Option<String>,
    notes: Option<String>,
    tags: Vec<String>,
}

fn clean(
    conn: &Connection,
    input: &TransactionInput,
    existing: Option<&Transaction>,
) -> CoreResult<Clean> {
    validate::positive_amount("amount_minor", input.amount_minor)?;
    let date = fmt_date(validate::date("date", &input.date)?);
    let account = accounts::get(conn, &input.account_id)
        .map_err(|_| CoreError::validation("account_id", "account not found"))?;
    let unchanged_account = existing.is_some_and(|e| e.account_id == account.id);
    if account.archived && !unchanged_account {
        return Err(CoreError::validation("account_id", "account is archived"));
    }

    let (to_account_id, to_amount_minor, category_id) = match input.tx_type {
        TxType::Transfer => {
            if input.category_id.is_some() {
                return Err(CoreError::validation(
                    "category_id",
                    "transfers have no category",
                ));
            }
            let to_id = input.to_account_id.as_deref().ok_or(CoreError::validation(
                "to_account_id",
                "required for transfers",
            ))?;
            if to_id == account.id {
                return Err(CoreError::validation(
                    "to_account_id",
                    "must differ from the source account",
                ));
            }
            let to = accounts::get(conn, to_id)
                .map_err(|_| CoreError::validation("to_account_id", "account not found"))?;
            let unchanged_to = existing.is_some_and(|e| e.to_account_id.as_deref() == Some(to_id));
            if to.archived && !unchanged_to {
                return Err(CoreError::validation(
                    "to_account_id",
                    "account is archived",
                ));
            }
            let to_amount = if to.currency == account.currency {
                match input.to_amount_minor {
                    None => input.amount_minor,
                    Some(v) if v == input.amount_minor => v,
                    Some(_) => {
                        return Err(CoreError::validation(
                            "to_amount_minor",
                            "must equal the amount for same-currency transfers",
                        ))
                    }
                }
            } else {
                let v = input.to_amount_minor.ok_or(CoreError::validation(
                    "to_amount_minor",
                    "required for transfers between currencies",
                ))?;
                validate::positive_amount("to_amount_minor", v)?
            };
            (Some(to.id), Some(to_amount), None)
        }
        TxType::Income | TxType::Expense => {
            if input.to_account_id.is_some() || input.to_amount_minor.is_some() {
                return Err(CoreError::validation(
                    "to_account_id",
                    "only transfers have a destination account",
                ));
            }
            let category_id = match input.category_id.as_deref() {
                None => None,
                Some(cid) => {
                    let cat = categories::get(conn, cid)
                        .map_err(|_| CoreError::validation("category_id", "category not found"))?;
                    if cat.kind.as_str() != input.tx_type.as_str() {
                        return Err(CoreError::validation(
                            "category_id",
                            "category kind does not match transaction type",
                        ));
                    }
                    let unchanged = existing.is_some_and(|e| e.category_id.as_deref() == Some(cid));
                    if cat.archived && !unchanged {
                        return Err(CoreError::validation("category_id", "category is archived"));
                    }
                    Some(cat.id)
                }
            };
            (None, None, category_id)
        }
    };

    let mut tags = Vec::new();
    for t in &input.tags {
        let t = validate::required_text("tags", t, 40)?;
        if !tags.iter().any(|x: &String| x.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }
    if tags.len() > tags::MAX_TAGS_PER_TRANSACTION {
        return Err(CoreError::validation("tags", "too many tags"));
    }

    Ok(Clean {
        to_account_id,
        to_amount_minor,
        date,
        category_id,
        payee: validate::optional_text("payee", input.payee.as_deref(), 120, false)?,
        description: validate::optional_text(
            "description",
            input.description.as_deref(),
            200,
            false,
        )?,
        notes: validate::optional_text("notes", input.notes.as_deref(), 2000, true)?,
        tags,
    })
}

/// Validate an input without writing. Returns the effective destination amount for transfers.
pub fn check(
    conn: &Connection,
    input: &TransactionInput,
    existing: Option<&Transaction>,
) -> CoreResult<Option<i64>> {
    Ok(clean(conn, input, existing)?.to_amount_minor)
}

pub fn create(conn: &Connection, input: &TransactionInput) -> CoreResult<Transaction> {
    create_inner(conn, input, None)
}

/// Create a transaction booked from a recurring rule occurrence.
pub fn create_from_recurring(
    conn: &Connection,
    input: &TransactionInput,
    rule_id: &str,
    occurrence_date: &str,
) -> CoreResult<Transaction> {
    create_inner(conn, input, Some((rule_id, occurrence_date)))
}

fn create_inner(
    conn: &Connection,
    input: &TransactionInput,
    recurring: Option<(&str, &str)>,
) -> CoreResult<Transaction> {
    let c = clean(conn, input, None)?;
    let id = new_id();
    let now = now_utc();
    // Join the caller's transaction (e.g. a CSV import) or open our own.
    let own = if conn.is_autocommit() {
        Some(conn.unchecked_transaction()?)
    } else {
        None
    };
    let tx: &Connection = conn;
    tx.execute(
        "INSERT INTO transactions (id, type, account_id, amount_minor, to_account_id, to_amount_minor, date,
                                   category_id, payee, description, notes, payment_method,
                                   recurring_rule_id, occurrence_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
        params![
            id,
            input.tx_type.as_str(),
            input.account_id,
            input.amount_minor,
            c.to_account_id,
            c.to_amount_minor,
            c.date,
            c.category_id,
            c.payee,
            c.description,
            c.notes,
            input.payment_method.map(PaymentMethod::as_str),
            recurring.map(|r| r.0),
            recurring.map(|r| r.1),
            now
        ],
    )
    .map_err(map_constraint)?;
    tags::set_for_transaction(tx, &id, &c.tags)?;
    if let Some(t) = own {
        t.commit()?;
    }
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &TransactionInput) -> CoreResult<Transaction> {
    let existing = get(conn, id)?;
    let c = clean(conn, input, Some(&existing))?;
    // Join the caller's transaction (e.g. a CSV import) or open our own.
    let own = if conn.is_autocommit() {
        Some(conn.unchecked_transaction()?)
    } else {
        None
    };
    let tx: &Connection = conn;
    tx.execute(
        "UPDATE transactions SET type = ?2, account_id = ?3, amount_minor = ?4, to_account_id = ?5,
                to_amount_minor = ?6, date = ?7, category_id = ?8, payee = ?9, description = ?10,
                notes = ?11, payment_method = ?12, updated_at = ?13
         WHERE id = ?1",
        params![
            id,
            input.tx_type.as_str(),
            input.account_id,
            input.amount_minor,
            c.to_account_id,
            c.to_amount_minor,
            c.date,
            c.category_id,
            c.payee,
            c.description,
            c.notes,
            input.payment_method.map(PaymentMethod::as_str),
            now_utc()
        ],
    )
    .map_err(map_constraint)?;
    tags::set_for_transaction(tx, id, &c.tags)?;
    if let Some(t) = own {
        t.commit()?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> CoreResult<()> {
    validate::id("id", id)?;
    let n = conn
        .execute("DELETE FROM transactions WHERE id = ?1", [id])
        .map_err(map_constraint)?;
    if n == 0 {
        return Err(CoreError::NotFound {
            entity: "transaction",
        });
    }
    Ok(())
}

/// Delete several transactions atomically. Returns the number deleted.
pub fn delete_many(conn: &Connection, ids: &[String]) -> CoreResult<usize> {
    if ids.len() > 10_000 {
        return Err(CoreError::validation("ids", "too many items"));
    }
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        validate::id("ids", id)?;
        n += tx.execute("DELETE FROM transactions WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(n)
}

pub const DEFAULT_PAGE: u32 = 50;
pub const MAX_PAGE: u32 = 500;

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

/// Build the WHERE clause and parameters for a filter. Only fixed SQL fragments are concatenated;
/// every user value is a bound parameter.
fn where_clause(f: &TransactionFilter) -> CoreResult<(String, Vec<Value>)> {
    let mut sql = vec!["1=1".to_owned()];
    let mut p: Vec<Value> = Vec::new();

    if let Some(from) = &f.from {
        sql.push("t.date >= ?".into());
        p.push(Value::Text(fmt_date(validate::date("from", from)?)));
    }
    if let Some(to) = &f.to {
        sql.push("t.date <= ?".into());
        p.push(Value::Text(fmt_date(validate::date("to", to)?)));
    }
    if let Some(acc) = &f.account_id {
        validate::id("account_id", acc)?;
        sql.push("(t.account_id = ? OR t.to_account_id = ?)".into());
        p.push(Value::Text(acc.clone()));
        p.push(Value::Text(acc.clone()));
    }
    if !f.types.is_empty() {
        sql.push(format!("t.type IN ({})", placeholders(f.types.len())));
        p.extend(f.types.iter().map(|t| Value::Text(t.as_str().into())));
    }
    if !f.category_ids.is_empty() || f.uncategorized {
        let mut parts = Vec::new();
        if !f.category_ids.is_empty() {
            if f.category_ids.len() > 200 {
                return Err(CoreError::validation("category_ids", "too many items"));
            }
            for c in &f.category_ids {
                validate::id("category_ids", c)?;
            }
            let ph = placeholders(f.category_ids.len());
            parts.push(format!("t.category_id IN (SELECT id FROM categories WHERE id IN ({ph}) OR parent_id IN ({ph}))"));
            p.extend(f.category_ids.iter().map(|c| Value::Text(c.clone())));
            p.extend(f.category_ids.iter().map(|c| Value::Text(c.clone())));
        }
        if f.uncategorized {
            parts.push("(t.category_id IS NULL AND t.type <> 'transfer')".into());
        }
        sql.push(format!("({})", parts.join(" OR ")));
    }
    if !f.tag_ids.is_empty() {
        if f.tag_ids.len() > 200 {
            return Err(CoreError::validation("tag_ids", "too many items"));
        }
        for t in &f.tag_ids {
            validate::id("tag_ids", t)?;
        }
        sql.push(format!(
            "EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN ({}))",
            placeholders(f.tag_ids.len())
        ));
        p.extend(f.tag_ids.iter().map(|t| Value::Text(t.clone())));
    }
    if let Some(min) = f.min_amount_minor {
        sql.push("t.amount_minor >= ?".into());
        p.push(Value::Integer(validate::signed_amount(
            "min_amount_minor",
            min,
        )?));
    }
    if let Some(max) = f.max_amount_minor {
        sql.push("t.amount_minor <= ?".into());
        p.push(Value::Integer(validate::signed_amount(
            "max_amount_minor",
            max,
        )?));
    }
    if let Some(pm) = f.payment_method {
        sql.push("t.payment_method = ?".into());
        p.push(Value::Text(pm.as_str().into()));
    }
    if let Some(q) = f.search.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        if q.chars().count() > 100 {
            return Err(CoreError::validation("search", "too long"));
        }
        sql.push(
            "(t.payee LIKE ?1x ESCAPE '\\' OR t.description LIKE ?1x ESCAPE '\\' OR t.notes LIKE ?1x ESCAPE '\\'
              OR c.name LIKE ?1x ESCAPE '\\')"
                .replace("?1x", "?"),
        );
        let pat = like_escape(q);
        for _ in 0..4 {
            p.push(Value::Text(pat.clone()));
        }
    }
    Ok((sql.join(" AND "), p))
}

pub fn list(conn: &Connection, f: &TransactionFilter) -> CoreResult<TransactionPage> {
    let (where_sql, mut p) = where_clause(f)?;
    let order_col = match f.sort {
        SortKey::Date => "t.date",
        SortKey::Amount => "t.amount_minor",
        SortKey::Payee => "IFNULL(t.payee, t.description) COLLATE NOCASE",
        SortKey::Created => "t.created_at",
    };
    let dir = match f.dir {
        SortDir::Asc => "ASC",
        SortDir::Desc => "DESC",
    };
    let limit = f.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let offset = f.offset.unwrap_or(0);

    let total: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE {where_sql}"
        ),
        params_from_iter(p.iter()),
        |r| r.get(0),
    )?;

    let sql = format!(
        "{SELECT_SQL} WHERE {where_sql} ORDER BY {order_col} {dir}, t.date {dir}, t.created_at {dir}, t.id {dir}
         LIMIT ? OFFSET ?"
    );
    p.push(Value::Integer(limit as i64));
    p.push(Value::Integer(offset as i64));
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params_from_iter(p.iter()), map_row)?
        .collect::<Result<_, _>>()?;
    Ok(TransactionPage {
        items,
        total,
        limit,
        offset,
    })
}

/// Distinct payees used before, most recent first (for autocomplete).
pub fn recent_payees(conn: &Connection, prefix: &str, limit: u32) -> CoreResult<Vec<String>> {
    let limit = limit.clamp(1, 50);
    let prefix = prefix.trim();
    let mut pat = String::new();
    for ch in prefix.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            pat.push('\\');
        }
        pat.push(ch);
    }
    pat.push('%');
    let mut stmt = conn.prepare(
        "SELECT payee FROM transactions WHERE payee IS NOT NULL AND payee LIKE ?1 ESCAPE '\\'
         GROUP BY payee COLLATE NOCASE ORDER BY MAX(date) DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![pat, limit], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
