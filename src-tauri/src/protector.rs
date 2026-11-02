//! Platform key protection for the database key.

use keel_core::keystore::DeviceProtector;

#[cfg(target_os = "android")]
pub fn platform<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Box<dyn DeviceProtector> {
    use tauri::Manager;
    match app.try_state::<android::NativeHandle<R>>() {
        Some(h) => Box::new(android::AndroidKeystore(h.0.clone())),
        None => Box::new(keel_core::keystore::PlainProtector),
    }
}

/// Desktop development builds: no OS protector (Keel currently ships for Android only).
#[cfg(not(target_os = "android"))]
pub fn platform<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Box<dyn DeviceProtector> {
    Box::new(keel_core::keystore::PlainProtector)
}

#[cfg(target_os = "android")]
pub mod android {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use keel_core::keystore::DeviceProtector;
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{Manager, Runtime};
    use zeroize::Zeroizing;

    pub struct NativeHandle<R: Runtime>(pub PluginHandle<R>);

    /// Registers the Kotlin `KeelPlugin` (gen/android/.../KeelPlugin.kt).
    pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("keel-native")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.keel.finance", "KeelPlugin")?;
                app.manage(NativeHandle(handle));
                Ok(())
            })
            .build()
    }

    #[derive(Serialize)]
    struct DataArgs<'a> {
        data: &'a str,
    }

    #[derive(Deserialize)]
    struct DataResp {
        data: String,
    }

    /// Wraps the database key with a non-exportable AES-256-GCM key in the Android Keystore.
    pub struct AndroidKeystore<R: Runtime>(pub PluginHandle<R>);

    impl<R: Runtime> AndroidKeystore<R> {
        fn call(&self, method: &str, input: &[u8]) -> Result<Vec<u8>, String> {
            let encoded = Zeroizing::new(STANDARD.encode(input));
            let resp: DataResp = self
                .0
                .run_mobile_plugin(method, DataArgs { data: &encoded })
                .map_err(|_| format!("keystore {method} failed"))?;
            let resp = Zeroizing::new(resp.data);
            STANDARD
                .decode(resp.as_bytes())
                .map_err(|_| "invalid keystore response".into())
        }
    }

    impl<R: Runtime> DeviceProtector for AndroidKeystore<R> {
        fn scheme(&self) -> &'static str {
            "android-keystore"
        }
        fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            self.call("wrap", data)
        }
        fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            self.call("unwrap", data)
        }
    }
}
