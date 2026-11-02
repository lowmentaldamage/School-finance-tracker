//! Platform key protection for the database key.

use keel_core::keystore::DeviceProtector;

#[cfg(windows)]
pub fn platform() -> Box<dyn DeviceProtector> {
    Box::new(dpapi::Dpapi)
}

/// Android Keystore wrapping is Phase 5 work; until then the key file is stored unwrapped
/// inside the app's private storage (inaccessible to other apps on non-rooted devices).
#[cfg(not(windows))]
pub fn platform() -> Box<dyn DeviceProtector> {
    Box::new(keel_core::keystore::PlainProtector)
}

#[cfg(windows)]
mod dpapi {
    use keel_core::keystore::DeviceProtector;
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Windows Data Protection API, scoped to the current user.
    pub struct Dpapi;

    const ENTROPY: &[u8] = b"keel.dek.v1";

    fn blob(d: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: d.len() as u32,
            pbData: d.as_ptr() as *mut u8,
        }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        v
    }

    impl DeviceProtector for Dpapi {
        fn scheme(&self) -> &'static str {
            "dpapi"
        }

        fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let input = blob(data);
            let entropy = blob(ENTROPY);
            let mut out = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: ptr::null_mut(),
            };
            // SAFETY: all pointers reference live buffers for the duration of the call.
            let ok = unsafe {
                CryptProtectData(
                    &input,
                    ptr::null(),
                    &entropy,
                    ptr::null(),
                    ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )
            };
            if ok == 0 {
                return Err("CryptProtectData failed".into());
            }
            Ok(unsafe { take(out) })
        }

        fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            let input = blob(data);
            let entropy = blob(ENTROPY);
            let mut out = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: ptr::null_mut(),
            };
            // SAFETY: as above.
            let ok = unsafe {
                CryptUnprotectData(
                    &input,
                    ptr::null_mut(),
                    &entropy,
                    ptr::null(),
                    ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out,
                )
            };
            if ok == 0 {
                return Err("CryptUnprotectData failed".into());
            }
            Ok(unsafe { take(out) })
        }
    }
}
