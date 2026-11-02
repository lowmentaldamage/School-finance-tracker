//! The app session: opening, locking and unlocking the encrypted database, plus data-level
//! operations (backup, restore, export, delete everything). Shared by the Android app and the
//! development server so both behave identically.

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::crypto::KdfParams;
use crate::db::{self, DbKey};
use crate::error::{CoreError, CoreResult, ErrorPayload};
use crate::keystore::{self, DeviceProtector, LockInfo, LockKind};
use crate::{api, backup};

pub struct Session {
    dir: PathBuf,
    device: Box<dyn DeviceProtector>,
    biometric: Option<Box<dyn DeviceProtector>>,
    kdf: KdfParams,
    conn: Option<Connection>,
    dek: Option<DbKey>,
    error: Option<CoreError>,
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub ready: bool,
    pub locked: bool,
    pub lock: Option<LockInfo>,
    pub biometric_available: bool,
    pub key_protection: &'static str,
    pub error: Option<ErrorPayload>,
}

fn args<T: for<'de> Deserialize<'de>>(v: Value) -> CoreResult<T> {
    serde_json::from_value(v).map_err(|_| CoreError::validation("args", "malformed arguments"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretArg {
    secret: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryArg {
    recovery_key: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnableArg {
    kind: LockKind,
    secret: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChangeArg {
    current: String,
    kind: LockKind,
    secret: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordArg {
    password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreArg {
    data_b64: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfirmArg {
    confirm: String,
}

fn file_stamp() -> String {
    crate::time::today_local().format("%Y-%m-%d").to_string()
}

impl Session {
    pub fn new(
        dir: PathBuf,
        device: Box<dyn DeviceProtector>,
        biometric: Option<Box<dyn DeviceProtector>>,
        kdf: KdfParams,
    ) -> Self {
        Self {
            dir,
            device,
            biometric,
            kdf,
            conn: None,
            dek: None,
            error: None,
        }
    }

    fn open_with(&mut self, dek: DbKey) -> CoreResult<()> {
        let conn = db::open(&keystore::db_path(&self.dir), &dek)?;
        self.conn = Some(conn);
        self.dek = Some(dek);
        self.error = None;
        Ok(())
    }

    /// Open automatically when no app lock is set.
    fn ensure_open(&mut self) {
        if self.conn.is_some() {
            return;
        }
        match keystore::load_or_create(&self.dir, self.device.as_ref()) {
            Ok(dek) => {
                if let Err(e) = self.open_with(dek) {
                    self.error = Some(e);
                }
            }
            Err(CoreError::Locked) => {}
            Err(e) => self.error = Some(e),
        }
    }

    pub fn status(&mut self) -> Status {
        self.ensure_open();
        let lock = keystore::lock_info(&self.dir).ok().flatten();
        Status {
            ready: self.conn.is_some(),
            locked: self.conn.is_none() && lock.is_some() && self.error.is_none(),
            lock,
            biometric_available: self.biometric.is_some(),
            key_protection: self.device.scheme(),
            error: self.error.as_ref().map(ErrorPayload::from),
        }
    }

    fn conn(&mut self) -> CoreResult<&Connection> {
        self.ensure_open();
        if let Some(e) = &self.error {
            return Err(match e {
                CoreError::Keystore { reason } => CoreError::Keystore { reason },
                CoreError::WrongKeyOrCorrupt => CoreError::WrongKeyOrCorrupt,
                _ => CoreError::Keystore {
                    reason: "the database could not be opened",
                },
            });
        }
        self.conn.as_ref().ok_or(CoreError::Locked)
    }

    fn dek(&self) -> CoreResult<&DbKey> {
        self.dek.as_ref().ok_or(CoreError::Locked)
    }

    /// Close the database and forget the key. No effect unless an app lock is set.
    pub fn lock(&mut self) -> bool {
        if keystore::lock_info(&self.dir).ok().flatten().is_none() {
            return false;
        }
        self.conn = None;
        self.dek = None;
        true
    }

    fn verify_secret(&self, secret: &str) -> CoreResult<()> {
        let dek = keystore::unlock_with_secret(&self.dir, self.device.as_ref(), secret)?;
        if dek.as_bytes() != self.dek()?.as_bytes() {
            return Err(CoreError::Keystore {
                reason: "key mismatch",
            });
        }
        Ok(())
    }

    pub fn call(&mut self, cmd: &str, a: Value) -> CoreResult<Value> {
        match cmd {
            "session.status" => Ok(serde_json::to_value(self.status()).unwrap_or(Value::Null)),
            "session.lock" => Ok(json!({ "locked": self.lock() })),
            "session.unlock" => {
                let p: SecretArg = args(a)?;
                let secret = Zeroizing::new(p.secret);
                let dek = keystore::unlock_with_secret(&self.dir, self.device.as_ref(), &secret)?;
                self.open_with(dek)?;
                Ok(json!(null))
            }
            "session.unlock_recovery" => {
                let p: RecoveryArg = args(a)?;
                let rk = Zeroizing::new(p.recovery_key);
                let dek = keystore::unlock_with_recovery(&self.dir, self.device.as_ref(), &rk)?;
                self.open_with(dek)?;
                Ok(json!(null))
            }
            "session.unlock_biometric" => {
                let bio = self.biometric.as_deref().ok_or(CoreError::Conflict {
                    reason: "biometrics are not available",
                })?;
                let dek = keystore::unlock_with_biometric(&self.dir, bio)?;
                self.open_with(dek)?;
                Ok(json!(null))
            }
            "session.enable_lock" => {
                let p: EnableArg = args(a)?;
                let secret = Zeroizing::new(p.secret);
                self.conn()?;
                let rk = keystore::enable_lock(
                    &self.dir,
                    self.device.as_ref(),
                    self.dek()?,
                    p.kind,
                    &secret,
                    self.kdf,
                )?;
                Ok(json!({ "recovery_key": rk }))
            }
            "session.change_secret" => {
                let p: ChangeArg = args(a)?;
                let (cur, new) = (Zeroizing::new(p.current), Zeroizing::new(p.secret));
                self.conn()?;
                self.verify_secret(&cur)?;
                keystore::change_secret(
                    &self.dir,
                    self.device.as_ref(),
                    self.dek()?,
                    p.kind,
                    &new,
                    self.kdf,
                )?;
                Ok(json!(null))
            }
            "session.regenerate_recovery" => {
                let p: SecretArg = args(a)?;
                let secret = Zeroizing::new(p.secret);
                self.conn()?;
                self.verify_secret(&secret)?;
                let rk = keystore::regenerate_recovery(
                    &self.dir,
                    self.device.as_ref(),
                    self.dek()?,
                    self.kdf,
                )?;
                Ok(json!({ "recovery_key": rk }))
            }
            "session.disable_lock" => {
                let p: SecretArg = args(a)?;
                let secret = Zeroizing::new(p.secret);
                self.conn()?;
                self.verify_secret(&secret)?;
                keystore::disable_lock(&self.dir, self.device.as_ref(), self.dek()?)?;
                Ok(json!(null))
            }
            "session.enable_biometric" => {
                self.conn()?;
                let bio = self.biometric.as_deref().ok_or(CoreError::Conflict {
                    reason: "biometrics are not available",
                })?;
                keystore::enable_biometric(
                    &self.dir,
                    bio,
                    self.dek.as_ref().ok_or(CoreError::Locked)?,
                )?;
                Ok(json!(null))
            }
            "session.disable_biometric" => {
                self.conn()?;
                keystore::disable_biometric(&self.dir)?;
                Ok(json!(null))
            }
            "backup.export" => {
                let p: PasswordArg = args(a)?;
                let pw = Zeroizing::new(p.password);
                let kdf = self.kdf;
                let bytes = backup::export(self.conn()?, &pw, kdf)?;
                Ok(
                    json!({ "file_name": format!("keel-backup-{}.keelbak", file_stamp()), "data_b64": B64.encode(bytes) }),
                )
            }
            "backup.inspect" => {
                let p: RestoreArg = args(a)?;
                let bytes = B64
                    .decode(p.data_b64.as_bytes())
                    .map_err(|_| CoreError::validation("file", "could not be read"))?;
                let pw = Zeroizing::new(p.password);
                Ok(serde_json::to_value(backup::inspect(&bytes, &pw)?).unwrap_or(Value::Null))
            }
            "backup.restore" => {
                let p: RestoreArg = args(a)?;
                let bytes = B64
                    .decode(p.data_b64.as_bytes())
                    .map_err(|_| CoreError::validation("file", "could not be read"))?;
                let pw = Zeroizing::new(p.password);
                let summary = backup::restore(self.conn()?, &bytes, &pw)?;
                Ok(serde_json::to_value(summary).unwrap_or(Value::Null))
            }
            "data.export_csv" => {
                let csv = backup::transactions_csv(self.conn()?)?;
                Ok(
                    json!({ "file_name": format!("keel-transactions-{}.csv", file_stamp()), "data_b64": B64.encode(csv.as_bytes()) }),
                )
            }
            "data.delete_all" => {
                let p: ConfirmArg = args(a)?;
                if p.confirm != "DELETE" {
                    return Err(CoreError::validation("confirm", "type DELETE to confirm"));
                }
                self.conn()?;
                self.conn = None;
                self.dek = None;
                keystore::destroy(&self.dir)?;
                self.error = None;
                Ok(json!(null))
            }
            _ => {
                let conn = self.conn()?;
                api::dispatch(conn, cmd, a)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::TEST_KDF;
    use crate::keystore::PlainProtector;

    fn session(dir: &std::path::Path) -> Session {
        Session::new(
            dir.to_path_buf(),
            Box::new(PlainProtector),
            Some(Box::new(PlainProtector)),
            TEST_KDF,
        )
    }

    fn create_account(s: &mut Session, name: &str) {
        s.call(
            "accounts.create",
            json!({"input": {"name": name, "kind": "checking", "currency": "EUR", "opening_balance_minor": 1000, "opening_date": "2026-01-01"}}),
        )
        .unwrap();
    }

    #[test]
    fn lock_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = session(dir.path());
        assert!(s.status().ready);
        create_account(&mut s, "Main");
        let rk = s
            .call(
                "session.enable_lock",
                json!({"kind": "pin", "secret": "12345678"}),
            )
            .unwrap();
        let rk = rk["recovery_key"].as_str().unwrap().to_owned();

        assert!(s.lock());
        let st = s.status();
        assert!(!st.ready && st.locked);
        assert!(matches!(
            s.call("accounts.list", json!({})),
            Err(CoreError::Locked)
        ));
        assert!(matches!(
            s.call("session.unlock", json!({"secret": "00000000"})),
            Err(CoreError::WrongSecret { .. })
        ));
        s.call("session.unlock", json!({"secret": "12345678"}))
            .unwrap();
        assert_eq!(
            s.call("accounts.list", json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );

        // A fresh session (app restart) starts locked.
        let mut s2 = session(dir.path());
        assert!(s2.status().locked);
        s2.call("session.unlock_recovery", json!({"recovery_key": rk}))
            .unwrap();
        s2.call("session.enable_biometric", json!({})).unwrap();
        s2.lock();
        s2.call("session.unlock_biometric", json!({})).unwrap();

        assert!(s2
            .call("session.disable_lock", json!({"secret": "11111111"}))
            .is_err());
        s2.call("session.disable_lock", json!({"secret": "12345678"}))
            .unwrap();
        assert!(!s2.lock(), "lock has no effect without an app lock");
        let mut s3 = session(dir.path());
        assert!(s3.status().ready);
    }

    #[test]
    fn backup_restore_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = session(dir.path());
        create_account(&mut s, "Main");
        let acc = s.call("accounts.list", json!({})).unwrap()[0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let food = s
            .call("categories.list", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "Food")
            .unwrap()["id"]
            .clone();
        s.call(
            "transactions.create",
            json!({"input": {"type": "expense", "account_id": acc, "amount_minor": 250, "date": "2026-01-02", "category_id": food, "tags": ["x"]}}),
        )
        .unwrap();
        assert!(s
            .call("backup.export", json!({"password": "short"}))
            .is_err());
        let b = s
            .call("backup.export", json!({"password": "backup password 1"}))
            .unwrap();
        let data = b["data_b64"].as_str().unwrap().to_owned();
        assert!(b["file_name"].as_str().unwrap().ends_with(".keelbak"));

        // Restore into a different, fresh install.
        let dir2 = tempfile::tempdir().unwrap();
        let mut t = session(dir2.path());
        create_account(&mut t, "Other");
        assert!(t
            .call(
                "backup.restore",
                json!({"data_b64": data, "password": "wrong password!!"})
            )
            .is_err());
        assert_eq!(
            t.call("accounts.list", json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1,
            "failed restore changes nothing"
        );
        let sum = t
            .call(
                "backup.restore",
                json!({"data_b64": data, "password": "backup password 1"}),
            )
            .unwrap();
        assert_eq!(sum["transactions"], 1);
        let accs = t.call("accounts.list", json!({})).unwrap();
        assert_eq!(accs.as_array().unwrap().len(), 1);
        assert_eq!(accs[0]["name"], "Main");
        assert_eq!(accs[0]["balance_minor"], 750);
        let page = t.call("transactions.list", json!({"filter": {}})).unwrap();
        assert_eq!(page["items"][0]["tags"][0], "x");

        // Tampered file is rejected.
        let mut raw = B64.decode(&data).unwrap();
        let n = raw.len();
        raw[n - 5] ^= 0x55;
        assert!(t
            .call(
                "backup.restore",
                json!({"data_b64": B64.encode(raw), "password": "backup password 1"})
            )
            .is_err());
    }

    #[test]
    fn csv_and_delete_all() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = session(dir.path());
        create_account(&mut s, "Main, \"joint\"");
        let acc = s.call("accounts.list", json!({})).unwrap()[0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        s.call(
            "transactions.create",
            json!({"input": {"type": "expense", "account_id": acc, "amount_minor": 1234, "date": "2026-01-02", "payee": "=cmd", "tags": []}}),
        )
        .unwrap();
        let out = s.call("data.export_csv", json!({})).unwrap();
        let csv =
            String::from_utf8(B64.decode(out["data_b64"].as_str().unwrap()).unwrap()).unwrap();
        let line = csv.lines().nth(1).unwrap();
        assert!(line.starts_with("2026-01-02,expense,\"Main, \"\"joint\"\"\",-12.34,EUR"));
        assert!(line.contains("'=cmd"));

        assert!(s
            .call("data.delete_all", json!({"confirm": "yes"}))
            .is_err());
        s.call("data.delete_all", json!({"confirm": "DELETE"}))
            .unwrap();
        assert!(!keystore::exists(dir.path()));
        // Next use starts from scratch.
        assert!(s.status().ready);
        assert_eq!(
            s.call("accounts.list", json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }
}
