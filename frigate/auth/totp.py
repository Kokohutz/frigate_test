"""TOTP (RFC 6238) implementation using only stdlib + cryptography.

We avoid adding pyotp/qrcode as dependencies — Argus already ships with the
cryptography wheel, and a TOTP generator is ~20 lines.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time

DIGITS = 6
PERIOD = 30
ISSUER = "Argus"


def generate_secret() -> str:
    """Generate a fresh base32 TOTP secret (160 bits of entropy)."""
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = (
        (h[offset] & 0x7F) << 24
        | (h[offset + 1] & 0xFF) << 16
        | (h[offset + 2] & 0xFF) << 8
        | (h[offset + 3] & 0xFF)
    )
    return str(code % (10**DIGITS)).zfill(DIGITS)


def current_code(secret_b32: str, now: float | None = None) -> str:
    """Return the TOTP code for `now` (defaults to time.time())."""
    t = int((now or time.time()) // PERIOD)
    return _hotp(secret_b32, t)


def verify_code(secret_b32: str, code: str, drift: int = 1) -> bool:
    """Verify `code` against `secret_b32`, accepting ±`drift` 30s windows."""
    if not code or not code.isdigit() or len(code) != DIGITS:
        return False
    t = int(time.time() // PERIOD)
    for d in range(-drift, drift + 1):
        if secrets.compare_digest(_hotp(secret_b32, t + d), code):
            return True
    return False


def provisioning_uri(username: str, secret_b32: str, issuer: str = ISSUER) -> str:
    """Build an otpauth:// URI for QR-code rendering in authenticator apps."""
    from urllib.parse import quote

    label = quote(f"{issuer}:{username}", safe="")
    return (
        f"otpauth://totp/{label}?secret={secret_b32}"
        f"&issuer={quote(issuer)}&digits={DIGITS}&period={PERIOD}"
    )


def generate_recovery_codes(n: int = 10) -> list[str]:
    """Generate one-time recovery codes (format: XXXX-XXXX-XXXX)."""
    out = []
    for _ in range(n):
        raw = secrets.token_hex(6).upper()
        out.append(f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}")
    return out


def hash_recovery_code(code: str) -> str:
    """Hash a recovery code for at-rest storage.

    Recovery codes are high-entropy (48 bits) so a single SHA-256 is sufficient
    and avoids storing the plaintext. Normalises case/whitespace first so the
    stored hash matches what verification computes.
    """
    normalized = code.strip().upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def verify_recovery_code(code: str, hashed_codes: list[str]) -> str | None:
    """Return the matching stored hash if `code` is valid, else None.

    Comparison is constant-time per candidate to avoid leaking which code matched.
    """
    candidate = hash_recovery_code(code)
    for stored in hashed_codes:
        if secrets.compare_digest(candidate, stored):
            return stored
    return None
