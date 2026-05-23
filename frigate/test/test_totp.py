"""Tests for the Argus TOTP implementation.

Verifies the RFC 6238 reference vectors and the recovery-code generator.
"""

import unittest

from frigate.auth.totp import (
    _hotp,
    DIGITS,
    PERIOD,
    current_code,
    generate_recovery_codes,
    generate_secret,
    provisioning_uri,
    verify_code,
)


# ASCII "12345678901234567890" base32-encoded — the RFC 6238 SHA-1 test seed.
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


class TotpTest(unittest.TestCase):
    def test_rfc6238_vectors(self):
        # T=59 → 287082, T=1111111109 → 081804 (per RFC appendix B)
        cases = [
            (59, "287082"),
            (1111111109, "081804"),
            (1111111111, "050471"),
            (1234567890, "005924"),
            (2000000000, "279037"),
        ]
        for t, expected in cases:
            with self.subTest(t=t):
                self.assertEqual(_hotp(RFC_SECRET, t // PERIOD), expected)

    def test_current_code_roundtrip(self):
        secret = generate_secret()
        code = current_code(secret)
        self.assertEqual(len(code), DIGITS)
        self.assertTrue(code.isdigit())
        self.assertTrue(verify_code(secret, code))

    def test_verify_rejects_garbage(self):
        secret = generate_secret()
        self.assertFalse(verify_code(secret, ""))
        self.assertFalse(verify_code(secret, "12345"))   # too short
        self.assertFalse(verify_code(secret, "1234567")) # too long
        self.assertFalse(verify_code(secret, "abcdef"))  # non-digit
        self.assertFalse(verify_code(secret, "000000"))  # almost certainly wrong

    def test_verify_drift_tolerance(self):
        import time as _time

        # Force a code generated 30 seconds in the past — should still verify
        # because verify_code accepts drift=±1 window by default.
        secret = generate_secret()
        old_code = current_code(secret, now=_time.time() - PERIOD)
        self.assertTrue(verify_code(secret, old_code))

        # Two windows old should NOT verify with default drift.
        very_old = current_code(secret, now=_time.time() - 2 * PERIOD)
        # (Edge case: if "current" code happens to match, retry with another
        # secret to avoid a flake.)
        if very_old == current_code(secret):
            secret = generate_secret()
            very_old = current_code(secret, now=_time.time() - 2 * PERIOD)
        self.assertFalse(verify_code(secret, very_old))

    def test_secret_uniqueness(self):
        secrets_seen = {generate_secret() for _ in range(50)}
        self.assertEqual(len(secrets_seen), 50)

    def test_recovery_codes_format(self):
        codes = generate_recovery_codes(10)
        self.assertEqual(len(codes), 10)
        self.assertEqual(len(set(codes)), 10)  # unique
        for c in codes:
            parts = c.split("-")
            self.assertEqual(len(parts), 3)
            for p in parts:
                self.assertEqual(len(p), 4)
                self.assertTrue(p.isalnum())
                self.assertEqual(p, p.upper())

    def test_provisioning_uri(self):
        secret = "JBSWY3DPEHPK3PXP"  # canonical example
        uri = provisioning_uri("alice", secret)
        self.assertIn("otpauth://totp/", uri)
        self.assertIn("Argus%3Aalice", uri)
        self.assertIn(f"secret={secret}", uri)
        self.assertIn("issuer=Argus", uri)
        self.assertIn(f"digits={DIGITS}", uri)
        self.assertIn(f"period={PERIOD}", uri)


if __name__ == "__main__":
    unittest.main()
