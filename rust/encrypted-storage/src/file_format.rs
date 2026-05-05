// Encrypted file header layout:
//   [0..4]   magic:   0x46524745 ("FRGE" as little-endian u32)
//   [4..8]   version: u32 LE (currently 1)
//   [8..20]  nonce:   12 bytes (random, for AES-GCM or ChaCha20)
//   [20..52] key_id:  32 bytes (Argon2id salt — identifies derivation)
//   [52..]   ciphertext
//
// On read, check magic bytes to detect encrypted vs plaintext files.
// Plaintext files pass through unchanged (for migration period).
