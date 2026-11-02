//! Money is stored and computed as integer minor units. No floating point.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};

/// ISO-4217 alphabetic code, uppercase.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CurrencyCode(String);

impl CurrencyCode {
    pub fn parse(s: &str) -> CoreResult<Self> {
        if s.len() == 3 && s.chars().all(|c| c.is_ascii_uppercase()) {
            Ok(Self(s.to_owned()))
        } else {
            Err(CoreError::validation(
                "currency",
                "must be a 3-letter ISO code",
            ))
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for CurrencyCode {
    type Error = CoreError;
    fn try_from(s: String) -> CoreResult<Self> {
        Self::parse(&s)
    }
}

impl From<CurrencyCode> for String {
    fn from(c: CurrencyCode) -> String {
        c.0
    }
}

/// Exchange rates are integers scaled by 10^9.
pub const RATE_SCALE: i128 = 1_000_000_000;

/// Convert `minor` (in a currency with `from_exp` decimals) to a currency with
/// `to_exp` decimals using `rate_e9` (= rate × 10^9). Rounds half to even.
pub fn convert_minor(minor: i64, rate_e9: i64, from_exp: u32, to_exp: u32) -> CoreResult<i64> {
    if rate_e9 <= 0 {
        return Err(CoreError::validation("rate", "must be greater than zero"));
    }
    let mut num = (minor as i128) * (rate_e9 as i128);
    let mut den = RATE_SCALE;
    if to_exp >= from_exp {
        num *= 10i128.pow(to_exp - from_exp);
    } else {
        den *= 10i128.pow(from_exp - to_exp);
    }
    let q = div_round_half_even(num, den);
    i64::try_from(q).map_err(|_| CoreError::validation("amount", "is too large"))
}

/// Integer division rounding half to even (banker's rounding). `den` must be positive.
pub fn div_round_half_even(num: i128, den: i128) -> i128 {
    debug_assert!(den > 0);
    let q = num.div_euclid(den);
    let r = num.rem_euclid(den);
    let twice = r * 2;
    if twice > den || (twice == den && q % 2 != 0) {
        q + 1
    } else {
        q
    }
}

/// Parse a decimal rate string like "1.0834" into `rate_e9`.
pub fn parse_rate(s: &str) -> CoreResult<i64> {
    let err = || CoreError::validation("rate", "must be a positive decimal number");
    let s = s.trim();
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if int.is_empty() && frac.is_empty() || frac.len() > 9 {
        return Err(err());
    }
    if !int.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) {
        return Err(err());
    }
    let int: i64 = if int.is_empty() {
        0
    } else {
        int.parse().map_err(|_| err())?
    };
    let frac_val: i64 = if frac.is_empty() {
        0
    } else {
        format!("{frac:0<9}").parse().map_err(|_| err())?
    };
    let v = int
        .checked_mul(1_000_000_000)
        .and_then(|v| v.checked_add(frac_val))
        .ok_or_else(err)?;
    if v <= 0 {
        return Err(err());
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currency_code() {
        assert!(CurrencyCode::parse("EUR").is_ok());
        assert!(CurrencyCode::parse("eur").is_err());
        assert!(CurrencyCode::parse("EURO").is_err());
    }

    #[test]
    fn half_even_rounding() {
        assert_eq!(div_round_half_even(5, 2), 2); // 2.5 -> 2
        assert_eq!(div_round_half_even(7, 2), 4); // 3.5 -> 4
        assert_eq!(div_round_half_even(-5, 2), -2); // -2.5 -> -2
        assert_eq!(div_round_half_even(-7, 2), -4); // -3.5 -> -4
        assert_eq!(div_round_half_even(10, 3), 3);
        assert_eq!(div_round_half_even(11, 3), 4);
    }

    #[test]
    fn conversion() {
        // 100.00 USD at 0.92 -> 92.00 EUR
        assert_eq!(convert_minor(10_000, 920_000_000, 2, 2).unwrap(), 9_200);
        // 1.00 EUR at 160.5 JPY -> 160.5 -> rounds to 160 (half even)
        assert_eq!(convert_minor(100, 160_500_000_000, 2, 0).unwrap(), 160);
        // 1000 JPY at 0.0062 -> 6.20 EUR
        assert_eq!(convert_minor(1000, 6_200_000, 0, 2).unwrap(), 620);
        assert!(convert_minor(1, 0, 2, 2).is_err());
    }

    #[test]
    fn rate_parsing() {
        assert_eq!(parse_rate("1").unwrap(), 1_000_000_000);
        assert_eq!(parse_rate("1.0834").unwrap(), 1_083_400_000);
        assert_eq!(parse_rate(".5").unwrap(), 500_000_000);
        assert!(parse_rate("0").is_err());
        assert!(parse_rate("-1").is_err());
        assert!(parse_rate("1.0000000001").is_err());
        assert!(parse_rate("abc").is_err());
        assert!(parse_rate("").is_err());
    }
}
