//! Storage of the database key (DEK) outside the database.
//!
//! The DEK is random. It is stored wrapped ("protected") by a platform mechanism:
//! - Windows: DPAPI, bound to the current Windows user account.
//! - Other platforms in this build: stored unwrapped (`plain`). See docs/ARCHITECTURE.md §5
//!   and docs/PROGRESS.md: Android Keystore wrapping and PIN/password wrapping are Phase 5 work.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::db::DbKey;
use crate::error::{CoreError, CoreResult};

pub trait DeviceProtector {
    /// Short identifier stored with the wrapped key, e.g. `dpapi`.
    fn scheme(&self) -> &'static str;
    fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String>;
    fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String>;
}

/// No wrapping. Only used where no OS protector is implemented yet.
pub struct PlainProtector;

impl DeviceProtector for PlainProtector {
    fn scheme(&self) -> &'static str {
        "plain"
    }
    fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
    fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

#[derive(Serialize, Deserialize)]
struct Wrapped {
    scheme: String,
    data: String,
}

#[derive(Serialize, Deserialize)]
struct KeystoreFile {
    version: u32,
    device: Wrapped,
}

pub const KEYSTORE_FILE: &str = "keystore.json";
pub const DB_FILE: &str = "keel.db";

pub fn keystore_path(dir: &Path) -> PathBuf {
    dir.join(KEYSTORE_FILE)
}

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn ks_err(reason: &'static str) -> CoreError {
    CoreError::Keystore { reason }
}

/// Load the DEK, or create a new one if this is a fresh install.
///
/// Refuses to create a new key when a database already exists without a keystore,
/// because that would make the existing data unreadable.
pub fn load_or_create(dir: &Path, protector: &dyn DeviceProtector) -> CoreResult<DbKey> {
    fs::create_dir_all(dir).map_err(|_| ks_err("cannot create the data folder"))?;
    let ks = keystore_path(dir);
    if ks.exists() {
        let raw = Zeroizing::new(
            fs::read_to_string(&ks).map_err(|_| ks_err("cannot read the key file"))?,
        );
        let file: KeystoreFile =
            serde_json::from_str(&raw).map_err(|_| ks_err("the key file is damaged"))?;
        if file.device.scheme != protector.scheme() {
            return Err(ks_err(
                "the key file was created with a different protection method",
            ));
        }
        let wrapped =
            from_hex(&file.device.data).ok_or_else(|| ks_err("the key file is damaged"))?;
        let plain =
            Zeroizing::new(protector.unprotect(&wrapped).map_err(|_| {
                ks_err("the key cannot be unlocked on this device or user account")
            })?);
        let bytes: [u8; 32] = plain
            .as_slice()
            .try_into()
            .map_err(|_| ks_err("the key file is damaged"))?;
        return Ok(DbKey::from_bytes(bytes));
    }
    if db_path(dir).exists() {
        return Err(ks_err("the database exists but its key file is missing"));
    }
    let mut bytes = Zeroizing::new([0u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|_| ks_err("the system random generator failed"))?;
    let wrapped = protector
        .protect(bytes.as_ref())
        .map_err(|_| ks_err("the key cannot be protected"))?;
    let file = KeystoreFile {
        version: 1,
        device: Wrapped {
            scheme: protector.scheme().into(),
            data: to_hex(&wrapped),
        },
    };
    let json = Zeroizing::new(
        serde_json::to_string_pretty(&file).map_err(|_| ks_err("cannot write the key file"))?,
    );
    let tmp = dir.join(format!("{KEYSTORE_FILE}.tmp"));
    let _ = fs::remove_file(&tmp);
    write_private(&tmp, json.as_bytes()).map_err(|_| ks_err("cannot write the key file"))?;
    fs::rename(&tmp, &ks).map_err(|_| ks_err("cannot write the key file"))?;
    Ok(DbKey::from_bytes(*bytes))
}

/// Write a file readable only by the current user (mode 0600 on Unix-like systems, including Android).
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(data)?;
    f.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct XorProtector;
    impl DeviceProtector for XorProtector {
        fn scheme(&self) -> &'static str {
            "xor-test"
        }
        fn protect(&self, d: &[u8]) -> Result<Vec<u8>, String> {
            Ok(d.iter().map(|b| b ^ 0xAA).collect())
        }
        fn unprotect(&self, d: &[u8]) -> Result<Vec<u8>, String> {
            self.protect(d)
        }
    }

    #[test]
    fn creates_then_loads_same_key() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = load_or_create(dir.path(), &XorProtector).unwrap();
        let k2 = load_or_create(dir.path(), &XorProtector).unwrap();
        assert_eq!(k1.as_bytes(), k2.as_bytes());
        let stored = fs::read_to_string(keystore_path(dir.path())).unwrap();
        assert!(
            !stored.contains(&to_hex(k1.as_bytes())),
            "key must be stored wrapped"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(keystore_path(dir.path()))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn refuses_to_replace_key_of_existing_database() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(db_path(dir.path()), b"x").unwrap();
        assert!(matches!(
            load_or_create(dir.path(), &PlainProtector),
            Err(CoreError::Keystore { .. })
        ));
    }

    #[test]
    fn scheme_mismatch_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        load_or_create(dir.path(), &XorProtector).unwrap();
        assert!(matches!(
            load_or_create(dir.path(), &PlainProtector),
            Err(CoreError::Keystore { .. })
        ));
    }
}
