//! Single dispatch point for UI commands.
//!
//! The `match` below is the allow-list of operations the UI may perform. Arguments are
//! deserialised into typed structs (unknown fields rejected) before any database access.

use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{CoreError, CoreResult};
use crate::repo::{
    accounts, budgets, categories, currencies, goals, rates, recurring, reports, settings, tags,
    transactions,
};

fn args<T: DeserializeOwned>(v: Value) -> CoreResult<T> {
    serde_json::from_value(v).map_err(|_| CoreError::validation("args", "malformed arguments"))
}

fn ok<T: serde::Serialize>(v: T) -> CoreResult<Value> {
    serde_json::to_value(v).map_err(|_| CoreError::validation("result", "serialisation failed"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdArg {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdsArg {
    ids: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
struct ListArg {
    include_archived: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveArg {
    id: String,
    archived: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateArg<T> {
    id: String,
    input: T,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateArg<T> {
    input: T,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CategoryDeleteArg {
    id: String,
    reassign_to: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingArg {
    key: String,
    value: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FilterArg {
    #[serde(default)]
    filter: transactions::TransactionFilter,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PayeeArg {
    prefix: String,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    8
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CategoryReportArg {
    range: reports::Range,
    kind: String,
    #[serde(default)]
    parent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthArg {
    month: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryArg {
    end_month: String,
    #[serde(default = "default_months")]
    count: u32,
}

fn default_months() -> u32 {
    6
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DaysArg {
    #[serde(default = "default_days")]
    days: u32,
}

fn default_days() -> u32 {
    30
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OccurrenceArg {
    rule_id: String,
    occurrence_date: String,
    #[serde(default)]
    overrides: recurring::ConfirmOverrides,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GoalStatusArg {
    id: String,
    status: goals::GoalStatus,
}

/// Names of all commands, for documentation and tests.
pub const COMMANDS: &[&str] = &[
    "settings.all",
    "settings.set",
    "currencies.list",
    "accounts.list",
    "accounts.get",
    "accounts.create",
    "accounts.update",
    "accounts.archive",
    "accounts.delete",
    "accounts.reorder",
    "categories.list",
    "categories.create",
    "categories.update",
    "categories.archive",
    "categories.delete",
    "tags.list",
    "transactions.list",
    "transactions.get",
    "transactions.create",
    "transactions.update",
    "transactions.delete",
    "transactions.delete_many",
    "transactions.payees",
    "rates.list",
    "rates.upsert",
    "rates.delete",
    "reports.summary",
    "reports.cashflow",
    "reports.by_category",
    "reports.balances",
    "reports.net_worth",
    "reports.active_months",
    "budgets.month",
    "budgets.set",
    "budgets.history",
    "recurring.list",
    "recurring.get",
    "recurring.create",
    "recurring.update",
    "recurring.delete",
    "recurring.upcoming",
    "recurring.confirm",
    "recurring.skip",
    "goals.list",
    "goals.create",
    "goals.update",
    "goals.set_status",
    "goals.delete",
    "goals.contributions",
    "goals.contribute",
    "goals.delete_contribution",
];

/// Whether a command changes data (used to mark the database as changed for sync).
pub fn is_mutation(cmd: &str) -> bool {
    const READ_SUFFIXES: &[&str] = &[
        ".list",
        ".get",
        ".all",
        ".month",
        ".history",
        ".upcoming",
        ".summary",
        ".cashflow",
        ".by_category",
        ".balances",
        ".net_worth",
        ".active_months",
        ".payees",
        ".contributions",
    ];
    COMMANDS.contains(&cmd) && !READ_SUFFIXES.iter().any(|s| cmd.ends_with(s))
}

pub fn dispatch(conn: &Connection, cmd: &str, a: Value) -> CoreResult<Value> {
    match cmd {
        "settings.all" => ok(settings::all(conn)?),
        "settings.set" => {
            let p: SettingArg = args(a)?;
            settings::set(conn, &p.key, &p.value)?;
            ok(json!(null))
        }
        "currencies.list" => ok(currencies::list(conn)?),

        "accounts.list" => ok(accounts::list(conn, args::<ListArg>(a)?.include_archived)?),
        "accounts.get" => ok(accounts::get(conn, &args::<IdArg>(a)?.id)?),
        "accounts.create" => ok(accounts::create(conn, &args::<CreateArg<_>>(a)?.input)?),
        "accounts.update" => {
            let p: UpdateArg<accounts::AccountInput> = args(a)?;
            ok(accounts::update(conn, &p.id, &p.input)?)
        }
        "accounts.archive" => {
            let p: ArchiveArg = args(a)?;
            ok(accounts::set_archived(conn, &p.id, p.archived)?)
        }
        "accounts.delete" => {
            accounts::delete(conn, &args::<IdArg>(a)?.id)?;
            ok(json!(null))
        }
        "accounts.reorder" => {
            accounts::reorder(conn, &args::<IdsArg>(a)?.ids)?;
            ok(json!(null))
        }

        "categories.list" => ok(categories::list(
            conn,
            args::<ListArg>(a)?.include_archived,
        )?),
        "categories.create" => ok(categories::create(conn, &args::<CreateArg<_>>(a)?.input)?),
        "categories.update" => {
            let p: UpdateArg<categories::CategoryInput> = args(a)?;
            ok(categories::update(conn, &p.id, &p.input)?)
        }
        "categories.archive" => {
            let p: ArchiveArg = args(a)?;
            ok(categories::set_archived(conn, &p.id, p.archived)?)
        }
        "categories.delete" => {
            let p: CategoryDeleteArg = args(a)?;
            categories::delete(conn, &p.id, p.reassign_to.as_deref())?;
            ok(json!(null))
        }

        "tags.list" => ok(tags::list(conn)?),

        "transactions.list" => ok(transactions::list(conn, &args::<FilterArg>(a)?.filter)?),
        "transactions.get" => ok(transactions::get(conn, &args::<IdArg>(a)?.id)?),
        "transactions.create" => ok(transactions::create(conn, &args::<CreateArg<_>>(a)?.input)?),
        "transactions.update" => {
            let p: UpdateArg<transactions::TransactionInput> = args(a)?;
            ok(transactions::update(conn, &p.id, &p.input)?)
        }
        "transactions.delete" => {
            transactions::delete(conn, &args::<IdArg>(a)?.id)?;
            ok(json!(null))
        }
        "transactions.delete_many" => ok(transactions::delete_many(conn, &args::<IdsArg>(a)?.ids)?),
        "transactions.payees" => {
            let p: PayeeArg = args(a)?;
            ok(transactions::recent_payees(conn, &p.prefix, p.limit)?)
        }

        "rates.list" => ok(rates::list(conn)?),
        "rates.upsert" => ok(rates::upsert(conn, &args::<CreateArg<_>>(a)?.input)?),
        "rates.delete" => {
            rates::delete(conn, &args::<IdArg>(a)?.id)?;
            ok(json!(null))
        }

        "reports.summary" => ok(reports::summary(conn, &args::<reports::Range>(a)?)?),
        "reports.cashflow" => ok(reports::cashflow_by_month(
            conn,
            &args::<reports::Range>(a)?,
        )?),
        "reports.by_category" => {
            let p: CategoryReportArg = args(a)?;
            ok(reports::by_category(
                conn,
                &p.range,
                &p.kind,
                p.parent_id.as_deref(),
            )?)
        }
        "reports.balances" => ok(reports::balances(conn)?),
        "reports.net_worth" => ok(reports::net_worth_series(
            conn,
            &args::<reports::Range>(a)?,
        )?),
        "reports.active_months" => ok(reports::active_months(conn)?),

        "budgets.month" => ok(budgets::for_month(conn, &args::<MonthArg>(a)?.month)?),
        "budgets.set" => {
            budgets::set(conn, &args::<CreateArg<_>>(a)?.input)?;
            ok(json!(null))
        }
        "budgets.history" => {
            let p: HistoryArg = args(a)?;
            ok(budgets::history(conn, &p.end_month, p.count)?)
        }

        "recurring.list" => ok(recurring::list(conn)?),
        "recurring.get" => ok(recurring::get(conn, &args::<IdArg>(a)?.id)?),
        "recurring.create" => ok(recurring::create(conn, &args::<CreateArg<_>>(a)?.input)?),
        "recurring.update" => {
            let p: UpdateArg<recurring::RuleInput> = args(a)?;
            ok(recurring::update(conn, &p.id, &p.input)?)
        }
        "recurring.delete" => {
            recurring::delete(conn, &args::<IdArg>(a)?.id)?;
            ok(json!(null))
        }
        "recurring.upcoming" => ok(recurring::upcoming(conn, args::<DaysArg>(a)?.days)?),
        "recurring.confirm" => {
            let p: OccurrenceArg = args(a)?;
            ok(recurring::confirm(
                conn,
                &p.rule_id,
                &p.occurrence_date,
                &p.overrides,
            )?)
        }
        "recurring.skip" => {
            let p: OccurrenceArg = args(a)?;
            ok(recurring::skip(conn, &p.rule_id, &p.occurrence_date)?)
        }

        "goals.list" => ok(goals::list(conn)?),
        "goals.create" => ok(goals::create(conn, &args::<CreateArg<_>>(a)?.input)?),
        "goals.update" => {
            let p: UpdateArg<goals::GoalInput> = args(a)?;
            ok(goals::update(conn, &p.id, &p.input)?)
        }
        "goals.set_status" => {
            let p: GoalStatusArg = args(a)?;
            ok(goals::set_status(conn, &p.id, p.status)?)
        }
        "goals.delete" => {
            goals::delete(conn, &args::<IdArg>(a)?.id)?;
            ok(json!(null))
        }
        "goals.contributions" => ok(goals::contributions(conn, &args::<IdArg>(a)?.id)?),
        "goals.contribute" => ok(goals::contribute(conn, &args::<CreateArg<_>>(a)?.input)?),
        "goals.delete_contribution" => ok(goals::delete_contribution(conn, &args::<IdArg>(a)?.id)?),

        _ => Err(CoreError::validation("cmd", "unknown command")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, DbKey};

    #[test]
    fn unknown_command_and_fields_are_rejected() {
        let conn = open_in_memory(&DbKey::from_bytes([1; 32])).unwrap();
        assert!(dispatch(&conn, "drop_everything", json!({})).is_err());
        assert!(dispatch(
            &conn,
            "accounts.list",
            json!({"include_archived": true, "sql": "x"})
        )
        .is_err());
    }

    #[test]
    fn round_trip_through_dispatch() {
        let conn = open_in_memory(&DbKey::from_bytes([1; 32])).unwrap();
        let acc = dispatch(
            &conn,
            "accounts.create",
            json!({"input": {"name": "Main", "kind": "checking", "currency": "EUR",
                             "opening_balance_minor": 1000, "opening_date": "2026-01-01"}}),
        )
        .unwrap();
        let id = acc["id"].as_str().unwrap().to_owned();
        dispatch(
            &conn,
            "transactions.create",
            json!({"input": {"type": "expense", "account_id": id, "amount_minor": 250, "date": "2026-01-02",
                             "tags": ["a"]}}),
        )
        .unwrap();
        let page = dispatch(&conn, "transactions.list", json!({"filter": {"limit": 10}})).unwrap();
        assert_eq!(page["total"], 1);
        assert_eq!(page["items"][0]["type"], "expense");
        let acc = dispatch(&conn, "accounts.get", json!({"id": id})).unwrap();
        assert_eq!(acc["balance_minor"], 750);
    }
}
