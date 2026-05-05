// SQLite WAL truncation.
// Port of RecordingCleanup._check_and_truncate_wal() in cleanup.py.
// Runs PRAGMA wal_checkpoint(TRUNCATE) when WAL file exceeds 10MB.
