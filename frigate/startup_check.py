"""Startup self-tests for Argus.

Runs a battery of lightweight checks at server startup and on every
GET /api/health request.  Results are returned as a dict of CheckResult so
the caller can decide how to surface them (log, API response, UI badge).
"""

import logging
import os
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from frigate.const import CACHE_DIR, RECORD_DIR  # noqa: E402 — after stdlib

logger = logging.getLogger(__name__)

# Metrics ports match the defaults in each Rust binary's main.rs
RUST_DAEMON_PORTS: dict[str, int] = {
    "rust_storage_daemon": 9091,
    "rust_comms_dispatcher": 9092,
    "rust_encrypted_storage": 9093,
    "rust_tiered_storage": 9094,
    "rust_event_router": 9095,
}

# Timeout for Rust daemon TCP probe (seconds)
DAEMON_PROBE_TIMEOUT = 2.0


class CheckStatus(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


@dataclass
class CheckResult:
    status: CheckStatus
    message: str
    duration_ms: int = 0

    def as_dict(self) -> dict:
        return {
            "status": self.status.value,
            "message": self.message,
            "duration_ms": self.duration_ms,
        }


class StartupChecker:
    def __init__(self, config, db):
        self.config = config
        self.db = db

    # ------------------------------------------------------------------
    # Synchronous checks
    # ------------------------------------------------------------------

    def check_database(self) -> CheckResult:
        t0 = time.monotonic()
        try:
            if self.db.is_closed():
                self.db.connect()
            self.db.execute_sql("SELECT 1")
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.PASS, "SQLite WAL accessible", ms)
        except Exception as exc:
            ms = int((time.monotonic() - t0) * 1000)
            logger.warning("Startup DB check failed: %s", exc)
            return CheckResult(CheckStatus.FAIL, f"DB error: {exc}", ms)

    def check_config(self) -> CheckResult:
        t0 = time.monotonic()
        try:
            cam_count = len(self.config.cameras)
            det_count = len(self.config.detectors)
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(
                CheckStatus.PASS,
                f"{cam_count} camera(s), {det_count} detector(s) loaded",
                ms,
            )
        except Exception as exc:
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.FAIL, f"Config error: {exc}", ms)

    def check_storage_path(self, path: str, label: str) -> CheckResult:
        t0 = time.monotonic()
        p = Path(path)
        if not p.exists():
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(
                CheckStatus.WARN, f"{label}: {path} — directory not found", ms
            )
        if not os.access(path, os.W_OK):
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.WARN, f"{label}: {path} — not writable", ms)
        try:
            stat = os.statvfs(path)
            free_gb = stat.f_bavail * stat.f_frsize / (1024**3)
            total_gb = stat.f_blocks * stat.f_frsize / (1024**3)
            ms = int((time.monotonic() - t0) * 1000)
            if free_gb < 1.0:
                return CheckResult(
                    CheckStatus.WARN,
                    f"{label}: {path} — only {free_gb:.1f} GB free",
                    ms,
                )
            return CheckResult(
                CheckStatus.PASS,
                f"{label}: {path} — {free_gb:.0f} GB free of {total_gb:.0f} GB",
                ms,
            )
        except Exception as exc:
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.WARN, f"{label}: {path} — {exc}", ms)

    # ------------------------------------------------------------------
    # Async checks
    # ------------------------------------------------------------------

    async def check_rust_daemon(self, key: str, port: int) -> CheckResult:
        import asyncio

        t0 = time.monotonic()
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port),
                timeout=DAEMON_PROBE_TIMEOUT,
            )
            writer.write(b"GET /metrics HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            await writer.drain()
            data = await asyncio.wait_for(
                reader.read(512), timeout=DAEMON_PROBE_TIMEOUT
            )
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            ms = int((time.monotonic() - t0) * 1000)
            if b"200" in data:
                return CheckResult(CheckStatus.PASS, f"metrics OK (port {port})", ms)
            return CheckResult(
                CheckStatus.WARN, f"unexpected response from port {port}", ms
            )
        except TimeoutError:
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(
                CheckStatus.FAIL,
                f"no response on port {port} — daemon may not be running",
                ms,
            )
        except OSError as exc:
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.FAIL, f"port {port}: {exc}", ms)
        except Exception as exc:
            ms = int((time.monotonic() - t0) * 1000)
            return CheckResult(CheckStatus.FAIL, f"port {port}: {exc}", ms)

    # ------------------------------------------------------------------
    # Run all checks
    # ------------------------------------------------------------------

    async def run_all(self) -> dict[str, CheckResult]:
        import asyncio

        results: dict[str, CheckResult] = {}

        # --- synchronous ---
        results["database"] = self.check_database()
        results["config"] = self.check_config()
        results["storage_recordings"] = self.check_storage_path(
            RECORD_DIR, "recordings"
        )
        results["storage_cache"] = self.check_storage_path(CACHE_DIR, "cache")

        # --- configured storage tiers (optional) ---
        storage_tiers = getattr(self.config, "storage_tiers", None)
        if storage_tiers:
            hot = getattr(storage_tiers, "hot", None)
            cold = getattr(storage_tiers, "cold", None)
            if hot and getattr(hot, "path", None):
                results["storage_hot"] = self.check_storage_path(hot.path, "hot tier")
            if cold and getattr(cold, "path", None):
                results["storage_cold"] = self.check_storage_path(
                    cold.path, "cold tier"
                )

        # --- Rust daemon probes (concurrent) ---
        daemon_tasks = [
            (key, asyncio.ensure_future(self.check_rust_daemon(key, port)))
            for key, port in RUST_DAEMON_PORTS.items()
        ]
        for key, task in daemon_tasks:
            results[key] = await task

        return results


def overall_status(checks: dict[str, dict]) -> str:
    statuses = {c["status"] for c in checks.values()}
    if "fail" in statuses:
        return "critical"
    if "warn" in statuses:
        return "degraded"
    return "healthy"
