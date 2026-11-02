mod protector;

use std::sync::Mutex;

use keel_core::error::ErrorPayload;
use keel_core::{db, keystore, CoreError};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

/// The database is opened on the first command, after the platform (and on Android the
/// Keystore plugin) is fully initialised.
#[derive(Default)]
struct AppState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    db: Option<Connection>,
    error: Option<CoreError>,
    key_protection: &'static str,
}

#[derive(Serialize)]
struct Status {
    ready: bool,
    error: Option<ErrorPayload>,
    key_protection: &'static str,
}

fn ensure_open<R: Runtime>(app: &AppHandle<R>, inner: &mut Inner) {
    if inner.db.is_some() || inner.error.is_some() {
        return;
    }
    let protector = protector::platform(app);
    inner.key_protection = protector.scheme();
    let result = app
        .path()
        .app_data_dir()
        .map_err(|_| CoreError::Keystore {
            reason: "cannot locate the app data folder",
        })
        .and_then(|dir| {
            let key = keystore::load_or_create(&dir, protector.as_ref())?;
            db::open(&keystore::db_path(&dir), &key)
        });
    match result {
        Ok(c) => inner.db = Some(c),
        Err(e) => inner.error = Some(e),
    }
}

#[tauri::command]
async fn app_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Status, ()> {
    let mut inner = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    ensure_open(&app, &mut inner);
    Ok(Status {
        ready: inner.db.is_some(),
        error: inner.error.as_ref().map(ErrorPayload::from),
        key_protection: inner.key_protection,
    })
}

/// Every data operation goes through the core dispatcher, which allow-lists commands
/// and validates arguments. No SQL crosses this boundary.
#[tauri::command]
async fn core_call<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cmd: String,
    args: Value,
) -> Result<Value, ErrorPayload> {
    let mut inner = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    ensure_open(&app, &mut inner);
    if let Some(e) = &inner.error {
        return Err(e.into());
    }
    let conn = inner.db.as_ref().ok_or(ErrorPayload {
        code: "unavailable",
        field: None,
        message: "database not open".into(),
    })?;
    keel_core::api::dispatch(conn, &cmd, args).map_err(|e| ErrorPayload::from(&e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(AppState::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(protector::android::plugin());
    builder
        .invoke_handler(tauri::generate_handler![app_status, core_call])
        .run(tauri::generate_context!())
        .expect("error while running Keel");
}
