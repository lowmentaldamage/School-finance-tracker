use crate::error::{CoreError, CoreResult};
use crate::ids::is_valid_id;

/// Trim and length-check a required text field (length in characters).
pub fn required_text(field: &'static str, value: &str, max: usize) -> CoreResult<String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(CoreError::validation(field, "required"));
    }
    if v.chars().count() > max {
        return Err(CoreError::validation(field, "too long"));
    }
    if v.chars().any(|c| c.is_control()) {
        return Err(CoreError::validation(field, "contains control characters"));
    }
    Ok(v.to_owned())
}

/// Trim an optional text field; empty becomes `None`. Newlines allowed when `multiline`.
pub fn optional_text(
    field: &'static str,
    value: Option<&str>,
    max: usize,
    multiline: bool,
) -> CoreResult<Option<String>> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if v.chars().count() > max {
        return Err(CoreError::validation(field, "too long"));
    }
    if v.chars()
        .any(|c| c.is_control() && !(multiline && (c == '\n' || c == '\t')))
    {
        return Err(CoreError::validation(field, "contains control characters"));
    }
    Ok(Some(v.to_owned()))
}

pub fn id(field: &'static str, value: &str) -> CoreResult<()> {
    if is_valid_id(value) {
        Ok(())
    } else {
        Err(CoreError::validation(field, "invalid id"))
    }
}

pub fn date(field: &'static str, value: &str) -> CoreResult<chrono::NaiveDate> {
    crate::time::parse_date(value).ok_or(CoreError::validation(field, "must be a date YYYY-MM-DD"))
}

pub fn month(field: &'static str, value: &str) -> CoreResult<chrono::NaiveDate> {
    crate::time::parse_month(value).ok_or(CoreError::validation(field, "must be a month YYYY-MM"))
}

pub fn hex_color(field: &'static str, value: &str) -> CoreResult<String> {
    let ok = value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(value.to_ascii_lowercase())
    } else {
        Err(CoreError::validation(
            field,
            "must be a hex colour like #6b7280",
        ))
    }
}

/// Maximum absolute amount in minor units (10^13 = 100 billion in a 2-decimal currency).
pub const MAX_AMOUNT_MINOR: i64 = 10_000_000_000_000;

pub fn positive_amount(field: &'static str, minor: i64) -> CoreResult<i64> {
    if minor <= 0 {
        return Err(CoreError::validation(field, "must be greater than zero"));
    }
    if minor > MAX_AMOUNT_MINOR {
        return Err(CoreError::validation(field, "is too large"));
    }
    Ok(minor)
}

pub fn signed_amount(field: &'static str, minor: i64) -> CoreResult<i64> {
    if minor.unsigned_abs() > MAX_AMOUNT_MINOR as u64 {
        return Err(CoreError::validation(field, "is too large"));
    }
    Ok(minor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_rules() {
        assert_eq!(required_text("n", "  Rent ", 10).unwrap(), "Rent");
        assert!(required_text("n", "   ", 10).is_err());
        assert!(required_text("n", "a\u{0007}", 10).is_err());
        assert!(required_text("n", "ééééé", 5).is_ok());
        assert!(required_text("n", "éééééé", 5).is_err());
        assert_eq!(optional_text("n", Some("  "), 5, false).unwrap(), None);
        assert!(optional_text("n", Some("a\nb"), 5, false).is_err());
        assert!(optional_text("n", Some("a\nb"), 5, true).is_ok());
    }

    #[test]
    fn colour_rules() {
        assert_eq!(hex_color("c", "#ABCDEF").unwrap(), "#abcdef");
        assert!(hex_color("c", "#abc").is_err());
        assert!(hex_color("c", "red").is_err());
    }
}
