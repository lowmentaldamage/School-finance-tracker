//! Password-based key derivation and authenticated encryption.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{CoreError, CoreResult};

/// Argon2id cost parameters, stored alongside each derived key so they can be raised later.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

/// Default: 64 MiB, 3 passes. Roughly 0.3–1 s on current phones.
pub const DEFAULT_KDF: KdfParams = KdfParams {
    m_kib: 64 * 1024,
    t: 3,
    p: 1,
};

/// Cheap parameters. Tests and the development server only; never used by the app.
pub const TEST_KDF: KdfParams = KdfParams {
    m_kib: 64,
    t: 1,
    p: 1,
};

pub fn random<const N: usize>() -> CoreResult<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|_| CoreError::Keystore {
        reason: "the system random generator failed",
    })?;
    Ok(b)
}

pub fn derive_key(secret: &[u8], salt: &[u8], kdf: KdfParams) -> CoreResult<Zeroizing<[u8; 32]>> {
    if !(8..=1024 * 1024).contains(&kdf.m_kib)
        || kdf.t == 0
        || kdf.t > 20
        || kdf.p == 0
        || kdf.p > 8
    {
        return Err(CoreError::Keystore {
            reason: "invalid key derivation parameters",
        });
    }
    let params =
        Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32)).map_err(|_| CoreError::Keystore {
            reason: "invalid key derivation parameters",
        })?;
    let mut out = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, out.as_mut())
        .map_err(|_| CoreError::Keystore {
            reason: "key derivation failed",
        })?;
    Ok(out)
}

/// Encrypt with XChaCha20-Poly1305. Output: nonce (24 bytes) || ciphertext+tag.
pub fn seal(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> CoreResult<Vec<u8>> {
    let nonce: [u8; 24] = random()?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CoreError::Keystore {
            reason: "encryption failed",
        })?;
    let mut out = Vec::with_capacity(24 + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decrypt the output of [`seal`]. Fails if the key is wrong or the data was modified.
pub fn open(key: &[u8; 32], sealed: &[u8], aad: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    if sealed.len() < 24 + 16 {
        return None;
    }
    let (nonce, ct) = sealed.split_at(24);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
        .ok()
        .map(Zeroizing::new)
}

/// Crockford Base32 recovery key: 128 random bits shown as 8 groups of 4 characters.
pub fn new_recovery_key() -> CoreResult<String> {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let bytes: [u8; 20] = random()?; // 160 bits drawn, 32 chars × 5 bits = 160 bits used
    let mut bits: u64 = 0;
    let mut nbits = 0;
    let mut chars = String::with_capacity(39);
    for b in bytes {
        bits = (bits << 8) | b as u64;
        nbits += 8;
        while nbits >= 5 {
            nbits -= 5;
            let idx = ((bits >> nbits) & 31) as usize;
            if chars.len() % 5 == 4 {
                chars.push('-');
            }
            chars.push(ALPHABET[idx] as char);
        }
    }
    Ok(chars)
}

/// Normalise user-typed recovery keys: uppercase, drop separators, map look-alike characters.
pub fn normalize_recovery_key(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_round_trip_and_tamper() {
        let k = [7u8; 32];
        let s = seal(&k, b"secret", b"aad").unwrap();
        assert_eq!(open(&k, &s, b"aad").unwrap().as_slice(), b"secret");
        assert!(open(&[8u8; 32], &s, b"aad").is_none());
        assert!(open(&k, &s, b"other").is_none());
        let mut t = s.clone();
        let last = t.len() - 1;
        t[last] ^= 1;
        assert!(open(&k, &t, b"aad").is_none());
    }

    #[test]
    fn kdf_is_deterministic_and_salted() {
        let a = derive_key(b"12345678", b"saltsaltsaltsalt", TEST_KDF).unwrap();
        let b = derive_key(b"12345678", b"saltsaltsaltsalt", TEST_KDF).unwrap();
        let c = derive_key(b"12345678", b"othersaltothersa", TEST_KDF).unwrap();
        assert_eq!(*a, *b);
        assert_ne!(*a, *c);
    }

    #[test]
    fn recovery_key_format() {
        let k = new_recovery_key().unwrap();
        assert_eq!(k.len(), 39);
        assert_eq!(k.split('-').count(), 8);
        assert_eq!(normalize_recovery_key(&k.to_lowercase()).len(), 32);
        assert_eq!(normalize_recovery_key("oil-0"), "0110");
    }
}
