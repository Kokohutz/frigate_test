// Key derivation from user passphrase using Argon2id.
// Output: 32-byte key for AES-256-GCM or ChaCha20-Poly1305.
// The 32-byte salt (key_id) is stored in the file header and used to identify
// which derivation produced this key — enabling key rotation.
