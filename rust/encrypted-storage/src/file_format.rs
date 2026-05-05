// Encrypted file header layout (FRGE format):
//   [0..4]   magic:     b"FRGE" (0x46524745)
//   [4..8]   version:   u32 LE (currently 1)
//   [8..9]   algorithm: 1 byte (0x01=AES-256-GCM, 0x02=ChaCha20-Poly1305)
//   [9..21]  nonce:     12 bytes (random, for AES-GCM or ChaCha20)
//   [21..53] key_id:    32 bytes (first 32 bytes of SHA-256(key))
//   [53..]   ciphertext (includes 16-byte appended auth tag)
//
// On read, check magic bytes to detect encrypted vs plaintext files.
// Plaintext files pass through unchanged (for migration period).

use crate::cipher::Cipher;
use anyhow::{bail, Result};

pub const MAGIC: &[u8; 4] = b"FRGE";
pub const VERSION: u32 = 1;

// Header field sizes and offsets
const MAGIC_LEN: usize = 4;
const VERSION_LEN: usize = 4;
const ALGO_LEN: usize = 1;
const NONCE_LEN: usize = 12;
const KEY_ID_LEN: usize = 32;

const VERSION_OFFSET: usize = MAGIC_LEN;
const ALGO_OFFSET: usize = VERSION_OFFSET + VERSION_LEN;
const NONCE_OFFSET: usize = ALGO_OFFSET + ALGO_LEN;
const KEY_ID_OFFSET: usize = NONCE_OFFSET + NONCE_LEN;
const CIPHERTEXT_OFFSET: usize = KEY_ID_OFFSET + KEY_ID_LEN;

/// Encrypt plaintext MP4 bytes into FRGE file bytes.
/// Used by the storage-daemon write path and tests.
#[allow(dead_code)]
pub fn encrypt_file(cipher: &dyn Cipher, key_id: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    // cipher.encrypt prepends nonce to the ciphertext+tag
    let nonce_and_ciphertext = cipher.encrypt(plaintext)?;

    if nonce_and_ciphertext.len() < NONCE_LEN {
        bail!("cipher.encrypt returned fewer bytes than expected for nonce");
    }

    let (nonce, ciphertext) = nonce_and_ciphertext.split_at(NONCE_LEN);

    let mut out = Vec::with_capacity(CIPHERTEXT_OFFSET + ciphertext.len());

    // magic
    out.extend_from_slice(MAGIC);
    // version (LE u32)
    out.extend_from_slice(&VERSION.to_le_bytes());
    // algorithm byte
    out.push(cipher.algorithm_byte());
    // nonce
    out.extend_from_slice(nonce);
    // key_id
    out.extend_from_slice(key_id);
    // ciphertext + auth tag
    out.extend_from_slice(ciphertext);

    Ok(out)
}

/// Decrypt FRGE file bytes into plaintext MP4 bytes.
/// Returns Err if magic/version mismatch or wrong key.
pub fn decrypt_file(
    cipher: &dyn Cipher,
    expected_key_id: &[u8; 32],
    data: &[u8],
) -> Result<Vec<u8>> {
    if data.len() < CIPHERTEXT_OFFSET {
        bail!(
            "FRGE file too short: {} bytes (minimum {})",
            data.len(),
            CIPHERTEXT_OFFSET
        );
    }

    // Check magic
    if &data[..MAGIC_LEN] != MAGIC {
        bail!("not an FRGE file: invalid magic bytes");
    }

    // Check version
    let version = u32::from_le_bytes(
        data[VERSION_OFFSET..VERSION_OFFSET + VERSION_LEN]
            .try_into()
            .unwrap(),
    );
    if version != VERSION {
        bail!(
            "unsupported FRGE version: {} (expected {})",
            version,
            VERSION
        );
    }

    // Check algorithm byte matches cipher
    let algo_byte = data[ALGO_OFFSET];
    if algo_byte != cipher.algorithm_byte() {
        bail!(
            "FRGE algorithm mismatch: file uses 0x{:02x}, cipher is 0x{:02x}",
            algo_byte,
            cipher.algorithm_byte()
        );
    }

    // Check key_id
    let file_key_id = &data[KEY_ID_OFFSET..KEY_ID_OFFSET + KEY_ID_LEN];
    if file_key_id != expected_key_id {
        bail!("FRGE key_id mismatch: wrong encryption key");
    }

    // Reconstruct nonce+ciphertext for cipher.decrypt
    let nonce = &data[NONCE_OFFSET..NONCE_OFFSET + NONCE_LEN];
    let ciphertext = &data[CIPHERTEXT_OFFSET..];

    // cipher.decrypt expects nonce prepended to ciphertext
    let mut nonce_and_ciphertext = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    nonce_and_ciphertext.extend_from_slice(nonce);
    nonce_and_ciphertext.extend_from_slice(ciphertext);

    cipher.decrypt(&nonce_and_ciphertext)
}

/// Return true if the first 4 bytes are the FRGE magic.
pub fn is_encrypted(data: &[u8]) -> bool {
    data.len() >= MAGIC_LEN && &data[..MAGIC_LEN] == MAGIC
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cipher::{Aes256GcmCipher, ChaCha20Cipher};

    #[test]
    fn test_encrypt_decrypt_aes_roundtrip() {
        let key = [7u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let plaintext = b"fake mp4 data for testing 1234";

        let encrypted = encrypt_file(&cipher, &kid, plaintext).unwrap();
        assert!(is_encrypted(&encrypted));

        let decrypted = decrypt_file(&cipher, &kid, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_chacha20_roundtrip() {
        let key = [8u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = ChaCha20Cipher::new(key);
        let plaintext = b"chacha20 test data";

        let encrypted = encrypt_file(&cipher, &kid, plaintext).unwrap();
        assert!(is_encrypted(&encrypted));

        let decrypted = decrypt_file(&cipher, &kid, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_is_encrypted_plaintext() {
        let plaintext = b"this is not an FRGE file";
        assert!(!is_encrypted(plaintext));
    }

    #[test]
    fn test_magic_bytes() {
        let key = [0u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let encrypted = encrypt_file(&cipher, &kid, b"test").unwrap();
        assert_eq!(&encrypted[..4], b"FRGE");
    }

    #[test]
    fn test_wrong_key_id_rejected() {
        let key = [9u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let encrypted = encrypt_file(&cipher, &kid, b"secret data").unwrap();

        let wrong_kid = [0u8; 32];
        let result = decrypt_file(&cipher, &wrong_kid, &encrypted);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("key_id mismatch"));
    }

    #[test]
    fn test_wrong_magic_rejected() {
        let key = [0u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let result = decrypt_file(&cipher, &kid, b"notFRGEdata");
        assert!(result.is_err());
    }

    #[test]
    fn test_version_in_header() {
        let key = [0u8; 32];
        let kid = crate::kdf::key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let encrypted = encrypt_file(&cipher, &kid, b"test").unwrap();
        // version field at bytes [4..8] should be 1 LE
        assert_eq!(
            u32::from_le_bytes(encrypted[4..8].try_into().unwrap()),
            1u32
        );
    }
}
