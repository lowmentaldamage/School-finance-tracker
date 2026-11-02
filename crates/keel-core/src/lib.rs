//! Keel core: domain types, encrypted SQLite storage, and business rules.
//!
//! This crate has no UI or Tauri dependency, so all logic is testable in isolation.
//! The Tauri app (`src-tauri`) exposes these functions as typed commands.

pub mod api;
pub mod db;
pub mod error;
pub mod ids;
pub mod keystore;
pub mod money;
pub mod repo;
pub mod time;
pub mod validate;

pub use error::{CoreError, CoreResult};
