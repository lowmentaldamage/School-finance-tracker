use serde::Serialize;

/// Errors surfaced to the UI.
///
/// Messages must never contain user financial data (amounts, payees, names),
/// because errors may be logged.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid value for `{field}`: {reason}")]
    Validation {
        field: &'static str,
        reason: &'static str,
    },

    #[error("{entity} not found")]
    NotFound { entity: &'static str },

    #[error("conflict: {reason}")]
    Conflict { reason: &'static str },

    #[error("the database key is incorrect or the file is not a Keel database")]
    WrongKeyOrCorrupt,

    #[error("database schema version {found} is newer than this app supports ({supported})")]
    SchemaTooNew { found: i64, supported: i64 },

    #[error("key storage error: {reason}")]
    Keystore { reason: &'static str },

    #[error("Keel is locked")]
    Locked,

    #[error("the PIN, password or recovery key is not correct")]
    WrongSecret { retry_after_secs: u64 },

    #[error("too many attempts; try again in {retry_after_secs} seconds")]
    Throttled { retry_after_secs: u64 },

    #[error("database error")]
    Db(#[from] rusqlite::Error),
}

pub type CoreResult<T> = Result<T, CoreError>;

impl CoreError {
    pub fn validation(field: &'static str, reason: &'static str) -> Self {
        Self::Validation { field, reason }
    }

    /// Stable machine-readable code for the UI.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation { .. } => "validation",
            Self::NotFound { .. } => "not_found",
            Self::Conflict { .. } => "conflict",
            Self::WrongKeyOrCorrupt => "wrong_key",
            Self::SchemaTooNew { .. } => "schema_too_new",
            Self::Keystore { .. } => "keystore",
            Self::Locked => "locked",
            Self::WrongSecret { .. } => "wrong_secret",
            Self::Throttled { .. } => "throttled",
            Self::Db(_) => "database",
        }
    }
}

/// Serializable error shape sent across the Tauri boundary.
#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub field: Option<&'static str>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
}

impl From<&CoreError> for ErrorPayload {
    fn from(e: &CoreError) -> Self {
        let field = match e {
            CoreError::Validation { field, .. } => Some(*field),
            _ => None,
        };
        let retry_after_secs = match e {
            CoreError::WrongSecret { retry_after_secs }
            | CoreError::Throttled { retry_after_secs } => Some(*retry_after_secs),
            _ => None,
        };
        Self {
            code: e.code(),
            field,
            message: e.to_string(),
            retry_after_secs,
        }
    }
}
