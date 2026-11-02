//! Platform key protection for the database key.

use keel_core::keystore::DeviceProtector;

/// (device protector, biometric protector if the device supports strong biometrics)
pub type Protectors = (Box<dyn DeviceProtector>, Option<Box<dyn DeviceProtector>>);

#[cfg(target_os = "android")]
pub fn platform<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Protectors {
    use tauri::Manager;
    match app.try_state::<android::NativeHandle<R>>() {
        Some(h) => {
            let bio: Option<Box<dyn DeviceProtector>> = if android::biometric_available(&h.0) {
                Some(Box::new(android::Biometric(h.0.clone())))
            } else {
                None
            };
            (Box::new(android::AndroidKeystore(h.0.clone())), bio)
        }
        None => (Box::new(keel_core::keystore::PlainProtector), None),
    }
}

/// Desktop development builds: no OS protector (Keel currently ships for Android only).
#[cfg(not(target_os = "android"))]
pub fn platform<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Protectors {
    (Box::new(keel_core::keystore::PlainProtector), None)
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

    #[derive(Serialize)]
    struct PromptArgs<'a> {
        data: &'a str,
        title: &'a str,
        cancel: &'a str,
    }

    #[derive(Deserialize)]
    struct DataResp {
        data: String,
    }

    #[derive(Deserialize)]
    struct BioStatus {
        available: bool,
    }

    pub fn biometric_available<R: Runtime>(h: &PluginHandle<R>) -> bool {
        h.run_mobile_plugin::<BioStatus>("bioStatus", ())
            .map(|s| s.available)
            .unwrap_or(false)
    }

    fn call<R: Runtime, A: Serialize>(
        h: &PluginHandle<R>,
        method: &str,
        args: A,
    ) -> Result<Vec<u8>, String> {
        let resp: DataResp = h
            .run_mobile_plugin(method, args)
            .map_err(|_| format!("{method} failed"))?;
        let resp = Zeroizing::new(resp.data);
        STANDARD
            .decode(resp.as_bytes())
            .map_err(|_| "invalid native response".into())
    }

    /// Wraps the database key with a non-exportable AES-256-GCM key in the Android Keystore.
    pub struct AndroidKeystore<R: Runtime>(pub PluginHandle<R>);

    impl<R: Runtime> DeviceProtector for AndroidKeystore<R> {
        fn scheme(&self) -> &'static str {
            "android-keystore"
        }
        fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let e = Zeroizing::new(STANDARD.encode(data));
            call(&self.0, "wrap", DataArgs { data: &e })
        }
        fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let e = STANDARD.encode(data);
            call(&self.0, "unwrap", DataArgs { data: &e })
        }
    }

    /// Keystore key usable only after a strong biometric check (the system prompt is shown).
    pub struct Biometric<R: Runtime>(pub PluginHandle<R>);

    impl<R: Runtime> DeviceProtector for Biometric<R> {
        fn scheme(&self) -> &'static str {
            "android-biometric"
        }
        fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let e = Zeroizing::new(STANDARD.encode(data));
            call(
                &self.0,
                "bioWrap",
                PromptArgs {
                    data: &e,
                    title: "Confirm to turn on biometric unlock",
                    cancel: "Cancel",
                },
            )
        }
        fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let e = STANDARD.encode(data);
            call(
                &self.0,
                "bioUnwrap",
                PromptArgs {
                    data: &e,
                    title: "Unlock Keel",
                    cancel: "Use PIN",
                },
            )
        }
    }
}
