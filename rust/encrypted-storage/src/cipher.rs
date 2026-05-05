// AES-256-GCM and ChaCha20-Poly1305 wrappers.
// Cipher selection via STORAGE_CIPHER env var: "aes-gcm" (default on x86) or "chacha20".
// ChaCha20-Poly1305 preferred on ARM devices without hardware AES (Raspberry Pi 4).
