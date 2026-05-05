// AES-256-GCM and ChaCha20-Poly1305 wrappers.
// Cipher selection: AES-256-GCM on x86_64, ChaCha20-Poly1305 on other archs.

use std::sync::Arc;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce as AesNonce,
};
use anyhow::Result;
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaNonce};
use rand::RngCore;

const NONCE_LEN: usize = 12;

pub trait Cipher: Send + Sync {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>>;
    fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>>;
    fn algorithm_byte(&self) -> u8;
}

pub struct Aes256GcmCipher {
    key: [u8; 32],
}

impl Aes256GcmCipher {
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }
}

impl Cipher for Aes256GcmCipher {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("AES-256-GCM key init failed: {}", e))?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = AesNonce::from_slice(&nonce_bytes);

        let encrypted = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| anyhow::anyhow!("AES-256-GCM encrypt failed: {}", e))?;

        let mut out = Vec::with_capacity(NONCE_LEN + encrypted.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&encrypted);
        Ok(out)
    }

    fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < NONCE_LEN {
            return Err(anyhow::anyhow!(
                "AES-256-GCM ciphertext too short: {} bytes",
                data.len()
            ));
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let nonce = AesNonce::from_slice(nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("AES-256-GCM key init failed: {}", e))?;

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("AES-256-GCM decrypt failed: {}", e))
    }

    fn algorithm_byte(&self) -> u8 {
        0x01
    }
}

// ChaCha20Cipher is selected on non-x86_64 architectures and used in tests on all platforms.
#[allow(dead_code)]
pub struct ChaCha20Cipher {
    key: [u8; 32],
}

#[allow(dead_code)]
impl ChaCha20Cipher {
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }
}

impl Cipher for ChaCha20Cipher {
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("ChaCha20-Poly1305 key init failed: {}", e))?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = ChaNonce::from_slice(&nonce_bytes);

        let encrypted = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| anyhow::anyhow!("ChaCha20-Poly1305 encrypt failed: {}", e))?;

        let mut out = Vec::with_capacity(NONCE_LEN + encrypted.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&encrypted);
        Ok(out)
    }

    fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < NONCE_LEN {
            return Err(anyhow::anyhow!(
                "ChaCha20-Poly1305 ciphertext too short: {} bytes",
                data.len()
            ));
        }
        let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
        let nonce = ChaNonce::from_slice(nonce_bytes);

        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("ChaCha20-Poly1305 key init failed: {}", e))?;

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("ChaCha20-Poly1305 decrypt failed: {}", e))
    }

    fn algorithm_byte(&self) -> u8 {
        0x02
    }
}

/// Select cipher: AES-256-GCM on x86_64, ChaCha20-Poly1305 on other archs.
pub fn select_cipher(key: &[u8; 32]) -> Arc<dyn Cipher> {
    #[cfg(target_arch = "x86_64")]
    {
        Arc::new(Aes256GcmCipher::new(*key))
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        Arc::new(ChaCha20Cipher::new(*key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = [0u8; 32];
        let cipher = Aes256GcmCipher::new(key);
        let plaintext = b"Hello, Frigate!";
        let encrypted = cipher.encrypt(plaintext).unwrap();
        let decrypted = cipher.decrypt(&encrypted).unwrap();
        assert_eq!(plaintext, decrypted.as_slice());
    }

    #[test]
    fn test_chacha20_roundtrip() {
        let key = [1u8; 32];
        let cipher = ChaCha20Cipher::new(key);
        let plaintext = b"Hello, encrypted storage!";
        let encrypted = cipher.encrypt(plaintext).unwrap();
        let decrypted = cipher.decrypt(&encrypted).unwrap();
        assert_eq!(plaintext, decrypted.as_slice());
    }

    #[test]
    fn test_aes_gcm_algorithm_byte() {
        let cipher = Aes256GcmCipher::new([0u8; 32]);
        assert_eq!(cipher.algorithm_byte(), 0x01);
    }

    #[test]
    fn test_chacha20_algorithm_byte() {
        let cipher = ChaCha20Cipher::new([0u8; 32]);
        assert_eq!(cipher.algorithm_byte(), 0x02);
    }

    #[test]
    fn test_encrypt_is_nondeterministic() {
        let key = [2u8; 32];
        let cipher = Aes256GcmCipher::new(key);
        let plaintext = b"same plaintext";
        let e1 = cipher.encrypt(plaintext).unwrap();
        let e2 = cipher.encrypt(plaintext).unwrap();
        // Two encryptions should produce different ciphertext due to random nonce
        assert_ne!(e1, e2);
    }
}
