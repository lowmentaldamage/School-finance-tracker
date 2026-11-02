pub mod accounts;
pub mod budgets;
pub mod categories;
pub mod currencies;
pub mod goals;
pub mod rates;
pub mod recurring;
pub mod reports;
pub mod settings;
pub mod tags;
pub mod transactions;

/// Escape `%`, `_` and `\` for a LIKE pattern used with `ESCAPE '\'`.
pub(crate) fn like_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('%');
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}
