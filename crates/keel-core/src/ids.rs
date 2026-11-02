/// New time-ordered UUIDv7 as a lowercase hyphenated string.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// True if `s` is a syntactically valid UUID.
pub fn is_valid_id(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}
