"""Unit tests for frigate.startup_check."""

import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from frigate.startup_check import (
    CheckStatus,
    StartupChecker,
    overall_status,
)


def _make_checker(config=None, db=None):
    if config is None:
        config = MagicMock()
        config.cameras = {"front_door": object(), "backyard": object()}
        config.detectors = {"cpu": object()}
        config.storage_tiers = None
    if db is None:
        db = MagicMock()
        db.is_closed.return_value = False
    return StartupChecker(config=config, db=db)


class TestCheckDatabase(unittest.TestCase):
    def test_pass(self):
        db = MagicMock()
        db.is_closed.return_value = False
        checker = _make_checker(db=db)
        result = checker.check_database()
        self.assertEqual(result.status, CheckStatus.PASS)
        db.execute_sql.assert_called_once_with("SELECT 1")

    def test_reconnects_when_closed(self):
        db = MagicMock()
        db.is_closed.return_value = True
        checker = _make_checker(db=db)
        checker.check_database()
        db.connect.assert_called_once()

    def test_fail_on_exception(self):
        db = MagicMock()
        db.is_closed.return_value = False
        db.execute_sql.side_effect = Exception("disk full")
        checker = _make_checker(db=db)
        result = checker.check_database()
        self.assertEqual(result.status, CheckStatus.FAIL)
        self.assertIn("disk full", result.message)


class TestCheckConfig(unittest.TestCase):
    def test_pass_reports_counts(self):
        checker = _make_checker()
        result = checker.check_config()
        self.assertEqual(result.status, CheckStatus.PASS)
        self.assertIn("2 camera(s)", result.message)
        self.assertIn("1 detector(s)", result.message)

    def test_fail_on_exception(self):
        config = MagicMock()
        type(config).cameras = property(
            fget=lambda self: (_ for _ in ()).throw(RuntimeError("bad config"))
        )
        checker = _make_checker(config=config)
        result = checker.check_config()
        self.assertEqual(result.status, CheckStatus.FAIL)


class TestCheckStoragePath(unittest.TestCase):
    def test_pass_with_real_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            checker = _make_checker()
            result = checker.check_storage_path(tmp, "test")
            self.assertEqual(result.status, CheckStatus.PASS)
            self.assertIn("GB free", result.message)

    def test_warn_missing_dir(self):
        checker = _make_checker()
        result = checker.check_storage_path("/does/not/exist", "missing")
        self.assertEqual(result.status, CheckStatus.WARN)
        self.assertIn("not found", result.message)

    def test_warn_not_writable(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.chmod(tmp, 0o444)
            try:
                checker = _make_checker()
                result = checker.check_storage_path(tmp, "readonly")
                # On CI running as root this will pass; skip assertion if root
                if os.getuid() != 0:
                    self.assertEqual(result.status, CheckStatus.WARN)
                    self.assertIn("not writable", result.message)
            finally:
                os.chmod(tmp, 0o755)


class TestCheckRustDaemon(unittest.IsolatedAsyncioTestCase):
    async def test_pass_on_200_response(self):
        checker = _make_checker()
        mock_reader = AsyncMock()
        mock_reader.read.return_value = b"HTTP/1.0 200 OK\r\n\r\n# metrics\n"
        mock_writer = MagicMock()
        mock_writer.drain = AsyncMock()
        mock_writer.wait_closed = AsyncMock()

        with patch(
            "asyncio.open_connection",
            AsyncMock(return_value=(mock_reader, mock_writer)),
        ):
            result = await checker.check_rust_daemon("rust_storage_daemon", 9091)

        self.assertEqual(result.status, CheckStatus.PASS)
        self.assertIn("9091", result.message)

    async def test_fail_on_connection_refused(self):
        checker = _make_checker()
        with patch(
            "asyncio.open_connection",
            AsyncMock(side_effect=OSError("Connection refused")),
        ):
            result = await checker.check_rust_daemon("rust_event_router", 9095)

        self.assertEqual(result.status, CheckStatus.FAIL)

    async def test_fail_on_timeout(self):
        checker = _make_checker()
        with patch(
            "asyncio.open_connection",
            AsyncMock(side_effect=TimeoutError()),
        ):
            result = await checker.check_rust_daemon("rust_tiered_storage", 9094)

        self.assertEqual(result.status, CheckStatus.FAIL)
        self.assertIn("no response", result.message)

    async def test_warn_on_non_200_response(self):
        checker = _make_checker()
        mock_reader = AsyncMock()
        mock_reader.read.return_value = b"HTTP/1.0 503 Service Unavailable\r\n\r\n"
        mock_writer = MagicMock()
        mock_writer.drain = AsyncMock()
        mock_writer.wait_closed = AsyncMock()

        with patch(
            "asyncio.open_connection",
            AsyncMock(return_value=(mock_reader, mock_writer)),
        ):
            result = await checker.check_rust_daemon("rust_comms_dispatcher", 9092)

        self.assertEqual(result.status, CheckStatus.WARN)


class TestOverallStatus(unittest.TestCase):
    def test_all_pass(self):
        checks = {
            "a": {"status": "pass"},
            "b": {"status": "pass"},
        }
        self.assertEqual(overall_status(checks), "healthy")

    def test_any_warn(self):
        checks = {
            "a": {"status": "pass"},
            "b": {"status": "warn"},
        }
        self.assertEqual(overall_status(checks), "degraded")

    def test_any_fail(self):
        checks = {
            "a": {"status": "warn"},
            "b": {"status": "fail"},
        }
        self.assertEqual(overall_status(checks), "critical")

    def test_empty(self):
        self.assertEqual(overall_status({}), "healthy")


class TestRunAll(unittest.IsolatedAsyncioTestCase):
    async def test_run_all_returns_all_expected_keys(self):
        checker = _make_checker()

        async def _fake_probe(key, port):
            from frigate.startup_check import CheckResult, CheckStatus

            return CheckResult(CheckStatus.PASS, f"ok port {port}", 1)

        with (
            tempfile.TemporaryDirectory() as rec_dir,
            tempfile.TemporaryDirectory() as cache_dir,
            patch("frigate.startup_check.RECORD_DIR", rec_dir),
            patch("frigate.startup_check.CACHE_DIR", cache_dir),
            patch.object(checker, "check_rust_daemon", side_effect=_fake_probe),
        ):
            results = await checker.run_all()

        required_keys = {
            "database",
            "config",
            "storage_recordings",
            "storage_cache",
            "rust_storage_daemon",
            "rust_comms_dispatcher",
            "rust_encrypted_storage",
            "rust_tiered_storage",
            "rust_event_router",
        }
        self.assertTrue(required_keys.issubset(set(results.keys())))
