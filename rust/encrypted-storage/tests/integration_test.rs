//! Integration tests for encrypted-storage: encrypt → persist → decrypt round-trip.
//! These tests use the with-onnx-free code paths only (no network downloads needed).

#[cfg(test)]
mod tests {
    use encrypted_storage::cipher::{Aes256GcmCipher, ChaCha20Cipher};
    use encrypted_storage::file_format::{decrypt_file, encrypt_file};
    use encrypted_storage::kdf::{derive_key_with_salt, key_id};

    const TEST_PASSPHRASE: &str = "integration-test-passphrase";
    const TEST_SALT: &[u8; 16] = b"integ_test_salt!";

    #[test]
    fn full_aes_gcm_roundtrip() {
        let key = derive_key_with_salt(TEST_PASSPHRASE, TEST_SALT).unwrap();
        let kid = key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let plaintext = b"Hello from encrypted-storage integration test!";
        let encrypted = encrypt_file(&cipher, &kid, plaintext).unwrap();
        let decrypted = decrypt_file(&cipher, &kid, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn full_chacha20_roundtrip() {
        let key = derive_key_with_salt(TEST_PASSPHRASE, TEST_SALT).unwrap();
        let kid = key_id(&key);
        let cipher = ChaCha20Cipher::new(key);
        let plaintext = b"ChaCha20-Poly1305 integration test payload";
        let encrypted = encrypt_file(&cipher, &kid, plaintext).unwrap();
        let decrypted = decrypt_file(&cipher, &kid, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_id_is_rejected() {
        let key = derive_key_with_salt(TEST_PASSPHRASE, TEST_SALT).unwrap();
        let kid = key_id(&key);
        let wrong_kid = [0xFFu8; 32];
        let cipher = Aes256GcmCipher::new(key);
        let encrypted = encrypt_file(&cipher, &kid, b"secret").unwrap();
        let result = decrypt_file(&cipher, &wrong_kid, &encrypted);
        assert!(result.is_err(), "wrong key_id should be rejected");
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = derive_key_with_salt(TEST_PASSPHRASE, TEST_SALT).unwrap();
        let kid = key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let mut encrypted = encrypt_file(&cipher, &kid, b"tamper me").unwrap();
        // Flip a byte in the ciphertext region
        let last = encrypted.len() - 1;
        encrypted[last] ^= 0xFF;
        let result = decrypt_file(&cipher, &kid, &encrypted);
        assert!(
            result.is_err(),
            "tampered ciphertext should fail authentication"
        );
    }

    #[test]
    fn two_encryptions_of_same_plaintext_differ() {
        let key = derive_key_with_salt(TEST_PASSPHRASE, TEST_SALT).unwrap();
        let kid = key_id(&key);
        let cipher = Aes256GcmCipher::new(key);
        let pt = b"same plaintext";
        let e1 = encrypt_file(&cipher, &kid, pt).unwrap();
        let e2 = encrypt_file(&cipher, &kid, pt).unwrap();
        assert_ne!(e1, e2, "random nonces should produce different ciphertexts");
    }
}
