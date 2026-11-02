//! Storage of the database key (DEK) outside the database, and the app lock.
//!
//! `keystore.json` holds only wrapped (encrypted) copies of the DEK:
//! - without app lock: `device` = DEK wrapped by the platform protector (Android Keystore);
//! - with app lock: `lock.secret` = platform-wrapped( XChaCha20(Argon2id(PIN or password), DEK) ),
//!   `lock.recovery` = the same with the recovery key, and optionally `lock.biometric` =
//!   DEK wrapped by a Keystore key that needs a fingerprint/face unlock.
//!
//! Because the PIN-wrapped copy is additionally wrapped by the device key, the PIN cannot be
//! brute-forced offline from a copied file: the attacker also needs this phone's Keystore.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams};
use crate::db::DbKey;
use crate::error::{CoreError, CoreResult};

pub trait DeviceProtector: Send + Sync {
    /// Short identifier stored with the wrapped key, e.g. `android-keystore`.
    fn scheme(&self) -> &'static str;
    fn protect(&self, data: &[u8]) -> Result<Vec<u8>, String>;
    fn unprotect(&self, data: &[u8]) -> Result<Vec<u8>, String>;
}

/// No wrapping. Used where no OS protector exists (desktop development builds, tests).
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

#[derive(Serialize, Deserialize, Clone)]
struct Wrapped {
    scheme: String,
    data: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct SecretWrap {
    salt: String,
    kdf: KdfParams,
    /// Device-wrapped XChaCha20 box of the DEK.
    wrapped: Wrapped,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum LockKind {
    Pin,
    Password,
}

#[derive(Serialize, Deserialize, Clone)]
struct LockSection {
    kind: LockKind,
    secret: SecretWrap,
    recovery: SecretWrap,
    #[serde(default)]
    biometric: Option<Wrapped>,
    #[serde(default)]
    failed_attempts: u32,
    #[serde(default)]
    locked_until: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct KeystoreFile {
    version: u32,
    #[serde(default)]
    device: Option<Wrapped>,
    #[serde(default)]
    lock: Option<LockSection>,
}

/// Public view of the lock configuration (no secrets).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LockInfo {
    pub kind: LockKind,
    pub biometric: bool,
    pub failed_attempts: u32,
    /// Seconds until another attempt is allowed (0 = now).
    pub retry_after_secs: u64,
}

pub const KEYSTORE_FILE: &str = "keystore.json";
pub const DB_FILE: &str = "keel.db";
const DEK_AAD: &[u8] = b"keel-dek-v2";
const FREE_ATTEMPTS: u32 = 5;

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

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Delay after `failed` consecutive wrong attempts: none for the first 5, then 30 s doubling to 1 h.
pub fn backoff_secs(failed: u32) -> u64 {
    if failed < FREE_ATTEMPTS {
        0
    } else {
        (30u64 << (failed - FREE_ATTEMPTS).min(7)).min(3600)
    }
}

/// Validate a PIN (exactly 8 digits) or password (10–128 characters).
pub fn validate_secret(kind: LockKind, secret: &str) -> CoreResult<()> {
    match kind {
        LockKind::Pin if secret.len() == 8 && secret.bytes().all(|b| b.is_ascii_digit()) => Ok(()),
        LockKind::Pin => Err(CoreError::validation(
            "secret",
            "the PIN must be exactly 8 digits",
        )),
        LockKind::Password => {
            let n = secret.chars().count();
            if (10..=128).contains(&n) {
                Ok(())
            } else {
                Err(CoreError::validation(
                    "secret",
                    "the password must be 10 to 128 characters",
                ))
            }
        }
    }
}

fn read(dir: &Path) -> CoreResult<Option<KeystoreFile>> {
    let ks = keystore_path(dir);
    if !ks.exists() {
        return Ok(None);
    }
    let raw =
        Zeroizing::new(fs::read_to_string(&ks).map_err(|_| ks_err("cannot read the key file"))?);
    let file: KeystoreFile =
        serde_json::from_str(&raw).map_err(|_| ks_err("the key file is damaged"))?;
    Ok(Some(file))
}

fn write(dir: &Path, file: &KeystoreFile) -> CoreResult<()> {
    let json = Zeroizing::new(
        serde_json::to_string_pretty(file).map_err(|_| ks_err("cannot write the key file"))?,
    );
    let tmp = dir.join(format!("{KEYSTORE_FILE}.tmp"));
    let _ = fs::remove_file(&tmp);
    write_private(&tmp, json.as_bytes()).map_err(|_| ks_err("cannot write the key file"))?;
    fs::rename(&tmp, keystore_path(dir)).map_err(|_| ks_err("cannot write the key file"))?;
    Ok(())
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

fn device_wrap(p: &dyn DeviceProtector, data: &[u8]) -> CoreResult<Wrapped> {
    let w = p
        .protect(data)
        .map_err(|_| ks_err("the key cannot be protected"))?;
    Ok(Wrapped {
        scheme: p.scheme().into(),
        data: to_hex(&w),
    })
}

fn device_unwrap(p: &dyn DeviceProtector, w: &Wrapped) -> CoreResult<Zeroizing<Vec<u8>>> {
    let raw = Zeroizing::new(from_hex(&w.data).ok_or_else(|| ks_err("the key file is damaged"))?);
    if w.scheme == "plain" {
        return Ok(raw);
    }
    if w.scheme != p.scheme() {
        return Err(ks_err(
            "the key file was created with a different protection method",
        ));
    }
    Ok(Zeroizing::new(p.unprotect(&raw).map_err(|_| {
        ks_err("the key cannot be unlocked on this device")
    })?))
}

fn to_dek(bytes: &[u8]) -> CoreResult<DbKey> {
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ks_err("the key file is damaged"))?;
    Ok(DbKey::from_bytes(arr))
}

fn secret_wrap(
    p: &dyn DeviceProtector,
    secret: &[u8],
    dek: &DbKey,
    kdf: KdfParams,
) -> CoreResult<SecretWrap> {
    let salt: [u8; 16] = crypto::random()?;
    let kek = crypto::derive_key(secret, &salt, kdf)?;
    let boxed = Zeroizing::new(crypto::seal(&kek, dek.as_bytes(), DEK_AAD)?);
    Ok(SecretWrap {
        salt: to_hex(&salt),
        kdf,
        wrapped: device_wrap(p, &boxed)?,
    })
}

fn secret_unwrap(
    p: &dyn DeviceProtector,
    secret: &[u8],
    w: &SecretWrap,
) -> CoreResult<Option<DbKey>> {
    let salt = from_hex(&w.salt).ok_or_else(|| ks_err("the key file is damaged"))?;
    let boxed = device_unwrap(p, &w.wrapped)?;
    let kek = crypto::derive_key(secret, &salt, w.kdf)?;
    match crypto::open(&kek, &boxed, DEK_AAD) {
        Some(dek) => Ok(Some(to_dek(&dek)?)),
        None => Ok(None),
    }
}

/// Whether a key file exists in `dir`.
pub fn exists(dir: &Path) -> bool {
    keystore_path(dir).exists()
}

pub fn lock_info(dir: &Path) -> CoreResult<Option<LockInfo>> {
    Ok(read(dir)?.and_then(|f| f.lock).map(|l| LockInfo {
        kind: l.kind,
        biometric: l.biometric.is_some(),
        failed_attempts: l.failed_attempts,
        retry_after_secs: l.locked_until.saturating_sub(now_secs()),
    }))
}

/// Load the DEK when no app lock is set, or create a new one on a fresh install.
///
/// Refuses to create a new key when a database already exists without a key file, because
/// that would make the existing data unreadable. Returns `Locked` when an app lock is set.
pub fn load_or_create(dir: &Path, protector: &dyn DeviceProtector) -> CoreResult<DbKey> {
    fs::create_dir_all(dir).map_err(|_| ks_err("cannot create the data folder"))?;
    if let Some(mut file) = read(dir)? {
        if file.lock.is_some() {
            return Err(CoreError::Locked);
        }
        let w = file
            .device
            .clone()
            .ok_or_else(|| ks_err("the key file is damaged"))?;
        if w.scheme == "plain" && protector.scheme() != "plain" {
            // Upgrade an unprotected key file to the platform protector. Never downgrade.
            let dek = to_dek(&Zeroizing::new(
                from_hex(&w.data).ok_or_else(|| ks_err("the key file is damaged"))?,
            ))?;
            file.device = Some(device_wrap(protector, dek.as_bytes())?);
            write(dir, &file)?;
            return Ok(dek);
        }
        if w.scheme != protector.scheme() {
            return Err(ks_err(
                "the key file was created with a different protection method",
            ));
        }
        return to_dek(&device_unwrap(protector, &w)?);
    }
    if db_path(dir).exists() {
        return Err(ks_err("the database exists but its key file is missing"));
    }
    let bytes: Zeroizing<[u8; 32]> = Zeroizing::new(crypto::random()?);
    let file = KeystoreFile {
        version: 2,
        device: Some(device_wrap(protector, bytes.as_ref())?),
        lock: None,
    };
    write(dir, &file)?;
    Ok(DbKey::from_bytes(*bytes))
}

fn locked_file(dir: &Path) -> CoreResult<(KeystoreFile, LockSection)> {
    let file = read(dir)?.ok_or_else(|| ks_err("the key file is missing"))?;
    let lock = file
        .lock
        .clone()
        .ok_or_else(|| ks_err("no app lock is set"))?;
    Ok((file, lock))
}

fn record_attempt(dir: &Path, mut file: KeystoreFile, ok: bool) -> CoreResult<u64> {
    let mut retry = 0;
    if let Some(l) = file.lock.as_mut() {
        if ok {
            l.failed_attempts = 0;
            l.locked_until = 0;
        } else {
            l.failed_attempts = l.failed_attempts.saturating_add(1);
            retry = backoff_secs(l.failed_attempts);
            l.locked_until = now_secs() + retry;
        }
    }
    write(dir, &file)?;
    Ok(retry)
}

fn check_throttle(lock: &LockSection) -> CoreResult<()> {
    let wait = lock.locked_until.saturating_sub(now_secs());
    if wait > 0 {
        return Err(CoreError::Throttled {
            retry_after_secs: wait,
        });
    }
    Ok(())
}

/// Unlock with the PIN or password.
pub fn unlock_with_secret(
    dir: &Path,
    protector: &dyn DeviceProtector,
    secret: &str,
) -> CoreResult<DbKey> {
    let (file, lock) = locked_file(dir)?;
    check_throttle(&lock)?;
    match secret_unwrap(protector, secret.as_bytes(), &lock.secret)? {
        Some(dek) => {
            record_attempt(dir, file, true)?;
            Ok(dek)
        }
        None => {
            let retry = record_attempt(dir, file, false)?;
            Err(CoreError::WrongSecret {
                retry_after_secs: retry,
            })
        }
    }
}

/// Unlock with the recovery key (same throttling as the PIN).
pub fn unlock_with_recovery(
    dir: &Path,
    protector: &dyn DeviceProtector,
    recovery: &str,
) -> CoreResult<DbKey> {
    let (file, lock) = locked_file(dir)?;
    check_throttle(&lock)?;
    let norm = Zeroizing::new(crypto::normalize_recovery_key(recovery));
    match secret_unwrap(protector, norm.as_bytes(), &lock.recovery)? {
        Some(dek) => {
            record_attempt(dir, file, true)?;
            Ok(dek)
        }
        None => {
            let retry = record_attempt(dir, file, false)?;
            Err(CoreError::WrongSecret {
                retry_after_secs: retry,
            })
        }
    }
}

/// Unlock with biometrics. The protector shows the system prompt.
pub fn unlock_with_biometric(dir: &Path, bio: &dyn DeviceProtector) -> CoreResult<DbKey> {
    let (file, lock) = locked_file(dir)?;
    let w = lock
        .biometric
        .clone()
        .ok_or_else(|| ks_err("biometric unlock is not set up"))?;
    let dek = to_dek(&device_unwrap(bio, &w)?)?;
    record_attempt(dir, file, true)?;
    Ok(dek)
}

/// Turn on the app lock. Returns the recovery key, which is shown to the user once.
pub fn enable_lock(
    dir: &Path,
    protector: &dyn DeviceProtector,
    dek: &DbKey,
    kind: LockKind,
    secret: &str,
    kdf: KdfParams,
) -> CoreResult<String> {
    validate_secret(kind, secret)?;
    let mut file = read(dir)?.ok_or_else(|| ks_err("the key file is missing"))?;
    if file.lock.is_some() {
        return Err(CoreError::Conflict {
            reason: "an app lock is already set",
        });
    }
    let recovery = crypto::new_recovery_key()?;
    let norm = Zeroizing::new(crypto::normalize_recovery_key(&recovery));
    file.lock = Some(LockSection {
        kind,
        secret: secret_wrap(protector, secret.as_bytes(), dek, kdf)?,
        recovery: secret_wrap(protector, norm.as_bytes(), dek, kdf)?,
        biometric: None,
        failed_attempts: 0,
        locked_until: 0,
    });
    // The DEK no longer exists in a form that opens without the PIN, password or recovery key.
    file.device = None;
    file.version = 2;
    write(dir, &file)?;
    Ok(recovery)
}

/// Replace the PIN/password (the recovery key stays the same). Requires the unlocked DEK.
pub fn change_secret(
    dir: &Path,
    protector: &dyn DeviceProtector,
    dek: &DbKey,
    kind: LockKind,
    secret: &str,
    kdf: KdfParams,
) -> CoreResult<()> {
    validate_secret(kind, secret)?;
    let (mut file, mut lock) = locked_file(dir)?;
    lock.kind = kind;
    lock.secret = secret_wrap(protector, secret.as_bytes(), dek, kdf)?;
    lock.failed_attempts = 0;
    lock.locked_until = 0;
    file.lock = Some(lock);
    write(dir, &file)
}

/// Issue a new recovery key (the old one stops working).
pub fn regenerate_recovery(
    dir: &Path,
    protector: &dyn DeviceProtector,
    dek: &DbKey,
    kdf: KdfParams,
) -> CoreResult<String> {
    let (mut file, mut lock) = locked_file(dir)?;
    let recovery = crypto::new_recovery_key()?;
    let norm = Zeroizing::new(crypto::normalize_recovery_key(&recovery));
    lock.recovery = secret_wrap(protector, norm.as_bytes(), dek, kdf)?;
    file.lock = Some(lock);
    write(dir, &file)?;
    Ok(recovery)
}

/// Turn off the app lock: the DEK is protected by the device only again.
pub fn disable_lock(dir: &Path, protector: &dyn DeviceProtector, dek: &DbKey) -> CoreResult<()> {
    let (mut file, _) = locked_file(dir)?;
    file.device = Some(device_wrap(protector, dek.as_bytes())?);
    file.lock = None;
    write(dir, &file)
}

pub fn enable_biometric(dir: &Path, bio: &dyn DeviceProtector, dek: &DbKey) -> CoreResult<()> {
    let (mut file, mut lock) = locked_file(dir)?;
    lock.biometric = Some(device_wrap(bio, dek.as_bytes())?);
    file.lock = Some(lock);
    write(dir, &file)
}

pub fn disable_biometric(dir: &Path) -> CoreResult<()> {
    let (mut file, mut lock) = locked_file(dir)?;
    lock.biometric = None;
    file.lock = Some(lock);
    write(dir, &file)
}

/// Remove the key file and database files (delete all data).
pub fn destroy(dir: &Path) -> CoreResult<()> {
    for name in [DB_FILE, "keel.db-wal", "keel.db-shm", KEYSTORE_FILE] {
        let p = dir.join(name);
        if p.exists() {
            fs::remove_file(&p).map_err(|_| ks_err("cannot delete the data files"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::TEST_KDF;

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
    fn plain_key_file_is_upgraded_to_protected() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = load_or_create(dir.path(), &PlainProtector).unwrap();
        let k2 = load_or_create(dir.path(), &XorProtector).unwrap();
        assert_eq!(k1.as_bytes(), k2.as_bytes());
        assert!(fs::read_to_string(keystore_path(dir.path()))
            .unwrap()
            .contains("xor-test"));
        // A protected key is never downgraded to plain.
        assert!(matches!(
            load_or_create(dir.path(), &PlainProtector),
            Err(CoreError::Keystore { .. })
        ));
    }

    #[test]
    fn lock_unlock_recover_change_disable() {
        let dir = tempfile::tempdir().unwrap();
        let p = XorProtector;
        let dek = load_or_create(dir.path(), &p).unwrap();
        assert!(enable_lock(dir.path(), &p, &dek, LockKind::Pin, "1234", TEST_KDF).is_err());
        let rec = enable_lock(dir.path(), &p, &dek, LockKind::Pin, "12345678", TEST_KDF).unwrap();
        let raw = fs::read_to_string(keystore_path(dir.path())).unwrap();
        assert!(
            !raw.contains("\"device\": {"),
            "device-only copy removed when locked"
        );

        assert!(matches!(
            load_or_create(dir.path(), &p),
            Err(CoreError::Locked)
        ));
        assert!(matches!(
            unlock_with_secret(dir.path(), &p, "87654321"),
            Err(CoreError::WrongSecret {
                retry_after_secs: 0
            })
        ));
        assert_eq!(lock_info(dir.path()).unwrap().unwrap().failed_attempts, 1);
        let k = unlock_with_secret(dir.path(), &p, "12345678").unwrap();
        assert_eq!(k.as_bytes(), dek.as_bytes());
        assert_eq!(lock_info(dir.path()).unwrap().unwrap().failed_attempts, 0);

        let k =
            unlock_with_recovery(dir.path(), &p, &rec.to_lowercase().replace('-', " ")).unwrap();
        assert_eq!(k.as_bytes(), dek.as_bytes());

        change_secret(
            dir.path(),
            &p,
            &dek,
            LockKind::Password,
            "correct horse battery",
            TEST_KDF,
        )
        .unwrap();
        assert!(unlock_with_secret(dir.path(), &p, "12345678").is_err());
        assert!(unlock_with_secret(dir.path(), &p, "correct horse battery").is_ok());
        assert!(
            unlock_with_recovery(dir.path(), &p, &rec).is_ok(),
            "recovery key survives a PIN change"
        );

        let rec2 = regenerate_recovery(dir.path(), &p, &dek, TEST_KDF).unwrap();
        assert!(unlock_with_recovery(dir.path(), &p, &rec).is_err());
        assert!(unlock_with_recovery(dir.path(), &p, &rec2).is_ok());

        disable_lock(dir.path(), &p, &dek).unwrap();
        assert_eq!(
            load_or_create(dir.path(), &p).unwrap().as_bytes(),
            dek.as_bytes()
        );
        assert!(lock_info(dir.path()).unwrap().is_none());
    }

    #[test]
    fn throttles_after_repeated_failures() {
        let dir = tempfile::tempdir().unwrap();
        let p = XorProtector;
        let dek = load_or_create(dir.path(), &p).unwrap();
        enable_lock(dir.path(), &p, &dek, LockKind::Pin, "12345678", TEST_KDF).unwrap();
        for _ in 0..4 {
            assert!(matches!(
                unlock_with_secret(dir.path(), &p, "00000000"),
                Err(CoreError::WrongSecret {
                    retry_after_secs: 0
                })
            ));
        }
        assert!(matches!(
            unlock_with_secret(dir.path(), &p, "00000000"),
            Err(CoreError::WrongSecret {
                retry_after_secs: 30
            })
        ));
        // Even the right PIN is refused while throttled.
        assert!(matches!(
            unlock_with_secret(dir.path(), &p, "12345678"),
            Err(CoreError::Throttled { .. })
        ));
        assert_eq!(backoff_secs(6), 60);
        assert_eq!(backoff_secs(30), 3600);
    }

    #[test]
    fn biometric_wrap() {
        let dir = tempfile::tempdir().unwrap();
        let p = XorProtector;
        let dek = load_or_create(dir.path(), &p).unwrap();
        enable_lock(dir.path(), &p, &dek, LockKind::Pin, "12345678", TEST_KDF).unwrap();
        assert!(unlock_with_biometric(dir.path(), &p).is_err());
        enable_biometric(dir.path(), &p, &dek).unwrap();
        assert!(lock_info(dir.path()).unwrap().unwrap().biometric);
        assert_eq!(
            unlock_with_biometric(dir.path(), &p).unwrap().as_bytes(),
            dek.as_bytes()
        );
        disable_biometric(dir.path()).unwrap();
        assert!(!lock_info(dir.path()).unwrap().unwrap().biometric);
    }

    #[test]
    fn secret_rules() {
        assert!(validate_secret(LockKind::Pin, "12345678").is_ok());
        assert!(validate_secret(LockKind::Pin, "1234567").is_err());
        assert!(validate_secret(LockKind::Pin, "1234567a").is_err());
        assert!(validate_secret(LockKind::Password, "short").is_err());
        assert!(validate_secret(LockKind::Password, "long enough!").is_ok());
    }
}
