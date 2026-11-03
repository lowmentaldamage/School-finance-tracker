mod protector;

use std::sync::Mutex;

use keel_core::crypto::DEFAULT_KDF;
use keel_core::error::ErrorPayload;
use keel_core::session::Session;
use keel_core::CoreError;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, State};

/// The session is created on the first command, after the platform (and on Android the
/// Keystore plugin) is fully initialised.
#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
}

fn with_session<R: Runtime, T>(
    app: &AppHandle<R>,
    state: &AppState,
    f: impl FnOnce(&mut Session) -> Result<T, ErrorPayload>,
) -> Result<T, ErrorPayload> {
    let mut guard = state.session.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_none() {
        let dir = app.path().app_data_dir().map_err(|_| {
            ErrorPayload::from(&CoreError::Keystore {
                reason: "cannot locate the app data folder",
            })
        })?;
        let (device, bio) = protector::platform(app);
        *guard = Some(Session::new(dir, device, bio, DEFAULT_KDF));
    }
    f(guard.as_mut().expect("session initialised"))
}

/// Every data operation goes through the session, whose dispatcher allow-lists commands
/// and validates arguments. No SQL crosses this boundary.
#[tauri::command]
async fn core_call<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cmd: String,
    args: Value,
) -> Result<Value, ErrorPayload> {
    with_session(&app, &state, |s| {
        s.call(&cmd, args).map_err(|e| ErrorPayload::from(&e))
    })
}

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct SaveArgs {
    name: String,
    mime: String,
    data_b64: String,
}

fn native_unavailable() -> ErrorPayload {
    ErrorPayload {
        code: "unavailable",
        field: None,
        message: "not available on this platform".into(),
        retry_after_secs: None,
    }
}

/// Save bytes through the system file picker. Returns `{ saved: bool }`.
#[tauri::command]
async fn save_file<R: Runtime>(app: AppHandle<R>, args: SaveArgs) -> Result<Value, ErrorPayload> {
    if args.name.len() > 120 || args.mime.len() > 80 {
        return Err(ErrorPayload::from(&CoreError::validation(
            "name", "too long",
        )));
    }
    #[cfg(target_os = "android")]
    {
        let h = app.state::<protector::android::NativeHandle<R>>();
        let v: Value =
            h.0.run_mobile_plugin(
                "saveFile",
                json!({ "name": args.name, "mime": args.mime, "data": args.data_b64 }),
            )
            .map_err(|_| {
                ErrorPayload::from(&CoreError::validation("file", "could not be saved"))
            })?;
        Ok(v)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(native_unavailable())
    }
}

/// Pick a file through the system file picker. Returns `{ data: base64 }` ("" if cancelled).
#[tauri::command]
async fn open_file<R: Runtime>(app: AppHandle<R>) -> Result<Value, ErrorPayload> {
    #[cfg(target_os = "android")]
    {
        let h = app.state::<protector::android::NativeHandle<R>>();
        let v: Value = h
            .0
            .run_mobile_plugin("openFile", json!({}))
            .map_err(|_| ErrorPayload::from(&CoreError::validation("file", "could not be read")))?;
        Ok(v)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(native_unavailable())
    }
}

/// Native Android services used by the web view. Only these methods can be called; the Kotlin
/// side additionally restricts network access to Dropbox and file names to `keel-*`.
const NATIVE_METHODS: &[&str] = &[
    "pickFolder",
    "writeToFolder",
    "listFolder",
    "deleteInFolder",
    "notifyPermission",
    "scheduleReminders",
    "showReminder",
    "openUrl",
    "takeAuthRedirect",
    "httpRequest",
];

#[tauri::command]
async fn native_call<R: Runtime>(
    app: AppHandle<R>,
    method: String,
    args: Value,
) -> Result<Value, ErrorPayload> {
    if !NATIVE_METHODS.contains(&method.as_str()) {
        return Err(ErrorPayload::from(&CoreError::validation(
            "method",
            "not allowed",
        )));
    }
    #[cfg(target_os = "android")]
    {
        let h = app.state::<protector::android::NativeHandle<R>>();
        h.0.run_mobile_plugin::<Value>(&method, args)
            .map_err(|e| ErrorPayload {
                code: "native",
                field: None,
                message: match e {
                    tauri::plugin::mobile::PluginInvokeError::InvokeRejected(r) => {
                        r.message.unwrap_or_else(|| "failed".into())
                    }
                    _ => "failed".into(),
                },
                retry_after_secs: None,
            })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(native_unavailable())
    }
}

/// Hide content in the app switcher and block screenshots (Android FLAG_SECURE).
#[tauri::command]
async fn set_secure<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<Value, ErrorPayload> {
    #[cfg(target_os = "android")]
    {
        let h = app.state::<protector::android::NativeHandle<R>>();
        let _: Value =
            h.0.run_mobile_plugin("setSecure", json!({ "enabled": enabled }))
                .unwrap_or(Value::Null);
        Ok(json!(null))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, enabled);
        Ok(json!(null))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(AppState::default());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(protector::android::plugin());
    builder
        .invoke_handler(tauri::generate_handler![
            core_call,
            save_file,
            open_file,
            set_secure,
            native_call
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keel");
}
