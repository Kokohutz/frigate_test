//! Key derivation from user passphrase using Argon2id.
//! Output: 32-byte key for AES-256-GCM or ChaCha20-Poly1305.
//!
//! The KDF salt is generated once per deployment and stored at
//! `ARGUS_SALT_FILE` (default: /config/encryption.salt).
//! On first run the file is created with 16 random bytes.
//! The key_id (SHA-256 of the key) is stored in each file header
//! to support key rotation without re-encrypting all files at once.

use anyhow::{Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use sha2::{Digest, Sha256};
use std::path::Path;

const SALT_LEN: usize = 16;
const SALT_FILE_ENV: &str = "ARGUS_SALT_FILE";
const SALT_FILE_DEFAULT: &str = "/config/encryption.salt";

/// Load the deployment salt from disk, creating it if absent.
pub fn load_or_create_salt() -> Result<[u8; SALT_LEN]> {
    let path_str = std::env::var(SALT_FILE_ENV).unwrap_or_else(|_| SALT_FILE_DEFAULT.to_string());
    let path = Path::new(&path_str);
    if path.exists() {
        let bytes = std::fs::read(path).with_context(|| format!("reading salt file {path_str}"))?;
        if bytes.len() != SALT_LEN {
            anyhow::bail!(
                "salt file {path_str} has wrong length {} (expected {SALT_LEN})",
                bytes.len()
            );
        }
        let mut salt = [0u8; SALT_LEN];
        salt.copy_from_slice(&bytes);
        Ok(salt)
    } else {
        // Generate and persist a new random salt
        use rand::RngCore;
        let mut salt = [0u8; SALT_LEN];
        rand::thread_rng().fill_bytes(&mut salt);
        // Create parent directory if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| "creating directory for salt file".to_string())?;
        }
        std::fs::write(path, salt).with_context(|| format!("writing salt file {path_str}"))?;
        tracing::info!("created new encryption salt at {path_str}");
        Ok(salt)
    }
}

/// Derive a 32-byte key from a passphrase using Argon2id.
/// The salt is loaded from the deployment salt file.
pub fn derive_key(passphrase: &str) -> Result<[u8; 32]> {
    let salt = load_or_create_salt()?;
    derive_key_with_salt(passphrase, &salt)
}

/// Derive a 32-byte key from passphrase + explicit salt.
/// Used in tests to avoid filesystem access.
pub fn derive_key_with_salt(passphrase: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let params = Params::new(64 * 1024, 3, 1, Some(32))
        .map_err(|e| anyhow::anyhow!("Argon2id params error: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow::anyhow!("Argon2id KDF failed: {e}"))?;
    Ok(key)
}

/// SHA-256(key) — stored in the file header to identify which derivation produced this key.
pub fn key_id(key: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_deterministic() {
        let salt = b"test_salt_16byte";
        let k1 = derive_key_with_salt("passphrase", salt).unwrap();
        let k2 = derive_key_with_salt("passphrase", salt).unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn different_passphrase_different_key() {
        let salt = b"test_salt_16byte";
        let k1 = derive_key_with_salt("pass1", salt).unwrap();
        let k2 = derive_key_with_salt("pass2", salt).unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn key_id_is_sha256_of_key() {
        let key = [0u8; 32];
        let id = key_id(&key);
        assert_eq!(id.len(), 32);
        // SHA-256 of 32 zero bytes is deterministic
        let id2 = key_id(&key);
        assert_eq!(id, id2);
    }
}
