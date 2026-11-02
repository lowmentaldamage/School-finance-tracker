use chrono::{Datelike, NaiveDate, SecondsFormat, Utc};

/// Current UTC timestamp, ISO-8601 with millisecond precision.
pub fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Today's date in local time, `YYYY-MM-DD`.
pub fn today_local() -> NaiveDate {
    chrono::Local::now().date_naive()
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    if s.len() != 10 {
        return None;
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

pub fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Parse `YYYY-MM` into the first day of that month.
pub fn parse_month(s: &str) -> Option<NaiveDate> {
    if s.len() != 7 {
        return None;
    }
    NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d").ok()
}

pub fn fmt_month(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}

/// Last day of the month containing `d`.
pub fn month_end(d: NaiveDate) -> NaiveDate {
    let (y, m) = if d.month() == 12 {
        (d.year() + 1, 1)
    } else {
        (d.year(), d.month() + 1)
    };
    NaiveDate::from_ymd_opt(y, m, 1)
        .expect("valid date")
        .pred_opt()
        .expect("valid date")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_strict_dates() {
        assert!(parse_date("2026-02-28").is_some());
        assert!(parse_date("2026-02-30").is_none());
        assert!(parse_date("2026-2-3").is_none());
        assert!(parse_date("2026-02-28T00:00").is_none());
    }

    #[test]
    fn month_end_handles_leap_years_and_december() {
        assert_eq!(
            fmt_date(month_end(parse_date("2024-02-10").unwrap())),
            "2024-02-29"
        );
        assert_eq!(
            fmt_date(month_end(parse_date("2026-12-01").unwrap())),
            "2026-12-31"
        );
    }
}
