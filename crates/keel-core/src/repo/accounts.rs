use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::map_constraint;
use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::money::CurrencyCode;
use crate::repo::currencies;
use crate::time::{fmt_date, now_utc};
use crate::validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    Checking,
    Savings,
    Cash,
    CreditCard,
    Loan,
    Investment,
    Other,
}

impl AccountKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Checking => "checking",
            Self::Savings => "savings",
            Self::Cash => "cash",
            Self::CreditCard => "credit_card",
            Self::Loan => "loan",
            Self::Investment => "investment",
            Self::Other => "other",
        }
    }
    fn parse(s: &str) -> rusqlite::Result<Self> {
        Ok(match s {
            "checking" => Self::Checking,
            "savings" => Self::Savings,
            "cash" => Self::Cash,
            "credit_card" => Self::CreditCard,
            "loan" => Self::Loan,
            "investment" => Self::Investment,
            _ => Self::Other,
        })
    }
    /// Liabilities usually carry a negative balance.
    pub fn is_liability(self) -> bool {
        matches!(self, Self::CreditCard | Self::Loan)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: AccountKind,
    pub currency: String,
    pub opening_balance_minor: i64,
    pub opening_date: String,
    pub include_in_net_worth: bool,
    pub archived: bool,
    pub sort_order: i64,
    pub balance_minor: i64,
    pub transaction_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountInput {
    pub name: String,
    pub kind: AccountKind,
    pub currency: CurrencyCode,
    pub opening_balance_minor: i64,
    pub opening_date: String,
    #[serde(default = "default_true")]
    pub include_in_net_worth: bool,
}

fn default_true() -> bool {
    true
}

/// Balance expression for account `a`, counting transactions dated on or before `?asof`
/// (pass '9999-12-31' for all).
pub(crate) const BALANCE_SQL: &str = "a.opening_balance_minor
  + IFNULL((SELECT SUM(CASE t.type WHEN 'income' THEN t.amount_minor ELSE -t.amount_minor END)
            FROM transactions t WHERE t.account_id = a.id AND t.date <= :asof), 0)
  + IFNULL((SELECT SUM(t.to_amount_minor)
            FROM transactions t WHERE t.to_account_id = a.id AND t.date <= :asof), 0)";

const SELECT_SQL: &str = "SELECT a.id, a.name, a.kind, a.currency, a.opening_balance_minor, a.opening_date,
       a.include_in_net_worth, a.archived, a.sort_order,
       (BALANCE) AS balance,
       (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id OR t.to_account_id = a.id) AS tx_count
FROM accounts a";

fn select_sql() -> String {
    SELECT_SQL.replace("BALANCE", BALANCE_SQL)
}

fn map_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: AccountKind::parse(&r.get::<_, String>(2)?)?,
        currency: r.get(3)?,
        opening_balance_minor: r.get(4)?,
        opening_date: r.get(5)?,
        include_in_net_worth: r.get(6)?,
        archived: r.get(7)?,
        sort_order: r.get(8)?,
        balance_minor: r.get(9)?,
        transaction_count: r.get(10)?,
    })
}

struct Clean {
    name: String,
    opening_date: String,
}

fn clean(conn: &Connection, input: &AccountInput) -> CoreResult<Clean> {
    let name = validate::required_text("name", &input.name, 80)?;
    validate::signed_amount("opening_balance_minor", input.opening_balance_minor)?;
    let d = validate::date("opening_date", &input.opening_date)?;
    currencies::minor_unit(conn, input.currency.as_str())?;
    Ok(Clean {
        name,
        opening_date: fmt_date(d),
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> CoreResult<Vec<Account>> {
    let sql = format!(
        "{} WHERE (:all = 1 OR a.archived = 0) ORDER BY a.archived, a.sort_order, a.name COLLATE NOCASE",
        select_sql()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::named_params! {":asof": "9999-12-31", ":all": include_archived as i64},
        map_row,
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> CoreResult<Account> {
    validate::id("id", id)?;
    let sql = format!("{} WHERE a.id = :id", select_sql());
    conn.query_row(
        &sql,
        rusqlite::named_params! {":asof": "9999-12-31", ":id": id},
        map_row,
    )
    .optional()?
    .ok_or(CoreError::NotFound { entity: "account" })
}

pub fn create(conn: &Connection, input: &AccountInput) -> CoreResult<Account> {
    let c = clean(conn, input)?;
    let id = new_id();
    let now = now_utc();
    let order: i64 = conn.query_row(
        "SELECT IFNULL(MAX(sort_order), -1) + 1 FROM accounts",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO accounts (id, name, kind, currency, opening_balance_minor, opening_date,
                               include_in_net_worth, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            c.name,
            input.kind.as_str(),
            input.currency.as_str(),
            input.opening_balance_minor,
            c.opening_date,
            input.include_in_net_worth,
            order,
            now
        ],
    )
    .map_err(map_constraint)?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &AccountInput) -> CoreResult<Account> {
    let existing = get(conn, id)?;
    let c = clean(conn, input)?;
    if existing.currency != input.currency.as_str() && existing.transaction_count > 0 {
        return Err(CoreError::Conflict {
            reason: "the currency of an account with transactions cannot be changed",
        });
    }
    conn.execute(
        "UPDATE accounts SET name = ?2, kind = ?3, currency = ?4, opening_balance_minor = ?5,
                opening_date = ?6, include_in_net_worth = ?7, updated_at = ?8
         WHERE id = ?1",
        params![
            id,
            c.name,
            input.kind.as_str(),
            input.currency.as_str(),
            input.opening_balance_minor,
            c.opening_date,
            input.include_in_net_worth,
            now_utc()
        ],
    )
    .map_err(map_constraint)?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> CoreResult<Account> {
    validate::id("id", id)?;
    let n = conn.execute(
        "UPDATE accounts SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, archived, now_utc()],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound { entity: "account" });
    }
    get(conn, id)
}

/// Delete an account. Refused while transactions reference it; archive it instead.
pub fn delete(conn: &Connection, id: &str) -> CoreResult<()> {
    let acc = get(conn, id)?;
    if acc.transaction_count > 0 {
        return Err(CoreError::Conflict {
            reason: "the account has transactions; archive it instead",
        });
    }
    conn.execute("DELETE FROM accounts WHERE id = ?1", [id])
        .map_err(map_constraint)?;
    Ok(())
}

/// Persist a new display order. `ids` must contain every account exactly once.
pub fn reorder(conn: &Connection, ids: &[String]) -> CoreResult<()> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))?;
    let mut uniq = ids.to_vec();
    uniq.sort();
    uniq.dedup();
    if uniq.len() != ids.len() || ids.len() as i64 != total {
        return Err(CoreError::validation(
            "ids",
            "must list every account exactly once",
        ));
    }
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ids.iter().enumerate() {
        validate::id("ids", id)?;
        let n = tx.execute(
            "UPDATE accounts SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound { entity: "account" });
        }
    }
    tx.commit()?;
    Ok(())
}
