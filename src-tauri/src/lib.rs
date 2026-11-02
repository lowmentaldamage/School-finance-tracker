mod protector;

use std::sync::Mutex;

use keel_core::error::ErrorPayload;
use keel_core::{db, keystore, CoreError};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{Manager, State};

/// The open database, or the reason it could not be opened.
struct AppState {
    db: Mutex<Result<Connection, CoreError>>,
    key_protection: &'static str,
}

#[derive(Serialize)]
struct Status {
    ready: bool,
    error: Option<ErrorPayload>,
    key_protection: &'static str,
}

#[tauri::command]
fn app_status(state: State<'_, AppState>) -> Status {
    let guard = state.db.lock().unwrap_or_else(|p| p.into_inner());
    match &*guard {
        Ok(_) => Status {
            ready: true,
            error: None,
            key_protection: state.key_protection,
        },
        Err(e) => Status {
            ready: false,
            error: Some(e.into()),
            key_protection: state.key_protection,
        },
    }
}

/// Every data operation goes through the core dispatcher, which allow-lists commands
/// and validates arguments. No SQL crosses this boundary.
#[tauri::command]
fn core_call(state: State<'_, AppState>, cmd: String, args: Value) -> Result<Value, ErrorPayload> {
    let guard = state.db.lock().unwrap_or_else(|p| p.into_inner());
    let conn = guard.as_ref().map_err(ErrorPayload::from)?;
    keel_core::api::dispatch(conn, &cmd, args).map_err(|e| ErrorPayload::from(&e))
}

fn open_database(
    app: &tauri::AppHandle,
    protector: &dyn keystore::DeviceProtector,
) -> Result<Connection, CoreError> {
    let dir = app.path().app_data_dir().map_err(|_| CoreError::Keystore {
        reason: "cannot locate the app data folder",
    })?;
    let key = keystore::load_or_create(&dir, protector)?;
    db::open(&keystore::db_path(&dir), &key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let protector = protector::platform();
            let db = open_database(app.handle(), protector.as_ref());
            app.manage(AppState {
                db: Mutex::new(db),
                key_protection: protector.scheme(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_status, core_call])
        .run(tauri::generate_context!())
        .expect("error while running Keel");
}
