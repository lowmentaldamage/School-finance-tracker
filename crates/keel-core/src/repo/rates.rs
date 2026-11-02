//! Manually entered exchange rates and conversion to the base currency.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::map_constraint;
use crate::error::{CoreError, CoreResult};
use crate::ids::new_id;
use crate::money::{convert_minor, parse_rate, CurrencyCode};
use crate::repo::{currencies, settings};
use crate::time::{fmt_date, now_utc};
use crate::validate;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Rate {
    pub id: String,
    pub from_code: String,
    pub to_code: String,
    pub rate_e9: i64,
    pub valid_from: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RateInput {
    pub from_code: CurrencyCode,
    pub to_code: CurrencyCode,
    /// Decimal string, e.g. "1.0834": 1 unit of `from` = rate units of `to`.
    pub rate: String,
    pub valid_from: String,
}

pub fn list(conn: &Connection) -> CoreResult<Vec<Rate>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_code, to_code, rate_e9, valid_from FROM exchange_rates
         ORDER BY from_code, to_code, valid_from DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Rate {
            id: r.get(0)?,
            from_code: r.get(1)?,
            to_code: r.get(2)?,
            rate_e9: r.get(3)?,
            valid_from: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Insert or replace the rate for a pair and date.
pub fn upsert(conn: &Connection, input: &RateInput) -> CoreResult<Rate> {
    if input.from_code == input.to_code {
        return Err(CoreError::validation(
            "to_code",
            "must differ from the source currency",
        ));
    }
    currencies::minor_unit(conn, input.from_code.as_str())?;
    currencies::minor_unit(conn, input.to_code.as_str())?;
    let rate_e9 = parse_rate(&input.rate)?;
    let valid_from = fmt_date(validate::date("valid_from", &input.valid_from)?);
    let now = now_utc();
    conn.execute(
        "INSERT INTO exchange_rates (id, from_code, to_code, rate_e9, valid_from, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(from_code, to_code, valid_from) DO UPDATE SET rate_e9 = excluded.rate_e9, updated_at = excluded.updated_at",
        params![new_id(), input.from_code.as_str(), input.to_code.as_str(), rate_e9, valid_from, now],
    )
    .map_err(map_constraint)?;
    conn.query_row(
        "SELECT id, from_code, to_code, rate_e9, valid_from FROM exchange_rates
         WHERE from_code = ?1 AND to_code = ?2 AND valid_from = ?3",
        params![input.from_code.as_str(), input.to_code.as_str(), valid_from],
        |r| {
            Ok(Rate {
                id: r.get(0)?,
                from_code: r.get(1)?,
                to_code: r.get(2)?,
                rate_e9: r.get(3)?,
                valid_from: r.get(4)?,
            })
        },
    )
    .map_err(Into::into)
}

pub fn delete(conn: &Connection, id: &str) -> CoreResult<()> {
    validate::id("id", id)?;
    if conn.execute("DELETE FROM exchange_rates WHERE id = ?1", [id])? == 0 {
        return Err(CoreError::NotFound {
            entity: "exchange rate",
        });
    }
    Ok(())
}

/// Converts amounts into the base currency using the most recent rate on or before a date.
/// A direct rate (X→base) is preferred; otherwise the inverse of (base→X) is used.
pub struct Converter<'c> {
    conn: &'c Connection,
    pub base: String,
    exps: HashMap<String, u32>,
    /// Currencies for which a conversion was needed but no rate existed.
    pub missing: std::cell::RefCell<std::collections::BTreeSet<String>>,
}

impl<'c> Converter<'c> {
    pub fn new(conn: &'c Connection) -> CoreResult<Self> {
        let base = settings::base_currency(conn)?;
        let exps = currencies::list(conn)?
            .into_iter()
            .map(|c| (c.code, c.minor_unit))
            .collect();
        Ok(Self {
            conn,
            base,
            exps,
            missing: Default::default(),
        })
    }

    fn exp(&self, code: &str) -> u32 {
        *self.exps.get(code).unwrap_or(&2)
    }

    /// Rate (×1e9) to convert 1 unit of `code` into base, valid on `date`, plus whether it is inverted.
    fn rate(&self, code: &str, date: &str) -> CoreResult<Option<(i64, bool)>> {
        let direct: Option<i64> = self
            .conn
            .query_row(
                "SELECT rate_e9 FROM exchange_rates WHERE from_code = ?1 AND to_code = ?2 AND valid_from <= ?3
                 ORDER BY valid_from DESC LIMIT 1",
                params![code, self.base, date],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(r) = direct {
            return Ok(Some((r, false)));
        }
        let inverse: Option<i64> = self
            .conn
            .query_row(
                "SELECT rate_e9 FROM exchange_rates WHERE from_code = ?1 AND to_code = ?2 AND valid_from <= ?3
                 ORDER BY valid_from DESC LIMIT 1",
                params![self.base, code, date],
                |r| r.get(0),
            )
            .optional()?;
        Ok(inverse.map(|r| (r, true)))
    }

    /// Convert `minor` in `code` to base currency minor units. Returns None if no rate exists.
    pub fn to_base(&self, minor: i64, code: &str, date: &str) -> CoreResult<Option<i64>> {
        if code == self.base || minor == 0 {
            return Ok(Some(minor));
        }
        let Some((rate, inverted)) = self.rate(code, date)? else {
            self.missing.borrow_mut().insert(code.to_owned());
            return Ok(None);
        };
        let (fe, te) = (self.exp(code), self.exp(&self.base));
        if !inverted {
            return convert_minor(minor, rate, fe, te).map(Some);
        }
        // minor / rate: multiply by 1e18 / rate expressed as a rate_e9.
        let inv_e9 = crate::money::div_round_half_even(1_000_000_000_000_000_000, rate as i128);
        let inv_e9 =
            i64::try_from(inv_e9).map_err(|_| CoreError::validation("rate", "is out of range"))?;
        if inv_e9 <= 0 {
            return Err(CoreError::validation("rate", "is out of range"));
        }
        convert_minor(minor, inv_e9, fe, te).map(Some)
    }

    /// Convert, treating a missing rate as zero (and recording it in `missing`).
    pub fn to_base_or_zero(&self, minor: i64, code: &str, date: &str) -> CoreResult<i64> {
        Ok(self.to_base(minor, code, date)?.unwrap_or(0))
    }

    pub fn missing_list(&self) -> Vec<String> {
        self.missing.borrow().iter().cloned().collect()
    }
}
