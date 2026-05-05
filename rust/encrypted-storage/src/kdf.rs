// Key derivation from user passphrase using Argon2id.
// Output: 32-byte key for AES-256-GCM or ChaCha20-Poly1305.
// The key_id is SHA-256(key) and is stored in the file header to identify
// which derivation produced this key — enabling key rotation.

use anyhow::Result;
use argon2::{Algorithm, Argon2, Params, Version};
use sha2::{Digest, Sha256};

/// Fixed salt for Argon2id key derivation — "frigate-storage-v1" UTF-8 padded to 16 bytes.
const KDF_SALT: &[u8; 16] = b"frigate-storagev";

/// Derive a 32-byte key from a passphrase using Argon2id.
/// Salt is fixed as "frigate-storage-v1" UTF-8 padded to 16 bytes.
pub fn derive_key(passphrase: &str) -> Result<[u8; 32]> {
    let params = Params::new(
        Params::DEFAULT_M_COST,
        Params::DEFAULT_T_COST,
        Params::DEFAULT_P_COST,
        Some(32),
    )
    .map_err(|e| anyhow::anyhow!("Argon2id params error: {}", e))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), KDF_SALT, &mut key)
        .map_err(|e| anyhow::anyhow!("Argon2id key derivation failed: {}", e))?;
    Ok(key)
}

/// Compute key_id = first 32 bytes of SHA-256(key).
pub fn key_id(key: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(key);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_key_deterministic() {
        let k1 = derive_key("test-passphrase").unwrap();
        let k2 = derive_key("test-passphrase").unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_derive_key_different_passphrases() {
        let k1 = derive_key("pass1").unwrap();
        let k2 = derive_key("pass2").unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn test_key_id_deterministic() {
        let key = [42u8; 32];
        let id1 = key_id(&key);
        let id2 = key_id(&key);
        assert_eq!(id1, id2);
        assert_ne!(id1, key); // key_id should differ from key
    }
}
