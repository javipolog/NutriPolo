// encryption.rs — NutriPolo
// ============================================================================
// AES-256-GCM at-rest encryption with Argon2id key derivation.
// Protects all local JSON data files and document PDFs under AppData with a
// user-supplied master password. The derived key is held in memory only for
// the duration of the unlocked session and is zeroized on lock.
//
// Ciphertext layout for every encrypted blob:
//   [ nonce (12 bytes) ][ aes-gcm ciphertext + 16-byte tag ]
//
// Argon2id params: m=64MiB, t=3, p=4 — takes ~1-2s on commodity hardware
// (intentional; unlock is a once-per-session operation).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use std::sync::Mutex;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const SALT_LEN: usize = 32;
pub const MAGIC_VERIFY: &[u8] = b"NutriPoloVerifyV1";

const ARGON2_M_COST: u32 = 65_536; // 64 MiB
const ARGON2_T_COST: u32 = 3;
const ARGON2_P_COST: u32 = 4;

// Singleton in-memory holder of the master key. None when locked.
// NOTE: we intentionally avoid any serde traces on this Mutex.
pub static MASTER_KEY: Mutex<Option<[u8; KEY_LEN]>> = Mutex::new(None);

/// Derive a 32-byte key from password + salt using Argon2id.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, Some(KEY_LEN))
        .map_err(|_| "argon2_params_error".to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "argon2_derive_failed".to_string())?;
    Ok(key)
}

/// Encrypt plaintext with AES-256-GCM. Output = nonce || ciphertext.
pub fn encrypt(plaintext: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encrypt_failed".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a blob produced by `encrypt`. Expects nonce || ciphertext.
pub fn decrypt(blob: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    if blob.len() < NONCE_LEN + 16 {
        return Err("invalid_ciphertext".into());
    }
    let (nonce_bytes, ct) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| "decrypt_failed".to_string())
}

/// Generate a cryptographically random salt.
pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Store the unlocked key in the in-memory singleton.
pub fn set_master_key(key: [u8; KEY_LEN]) {
    if let Ok(mut guard) = MASTER_KEY.lock() {
        // Zeroize any previously held key before replacing it.
        if let Some(ref mut prev) = *guard {
            for b in prev.iter_mut() {
                *b = 0;
            }
        }
        *guard = Some(key);
    }
}

/// Clear the in-memory key and zeroize it.
pub fn clear_master_key() {
    if let Ok(mut guard) = MASTER_KEY.lock() {
        if let Some(mut k) = guard.take() {
            for b in k.iter_mut() {
                *b = 0;
            }
        }
    }
}

/// Return a copy of the current key, if unlocked. Returns `Err("not_unlocked")`
/// if the store is locked. Callers should treat the copy as sensitive and avoid
/// persisting it anywhere.
pub fn current_key() -> Result<[u8; KEY_LEN], String> {
    let guard = MASTER_KEY.lock().map_err(|_| "mutex_poisoned".to_string())?;
    guard.as_ref().copied().ok_or_else(|| "not_unlocked".to_string())
}

pub fn is_unlocked() -> bool {
    MASTER_KEY
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}
