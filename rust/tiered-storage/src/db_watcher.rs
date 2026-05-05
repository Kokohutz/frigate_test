// Polls the Recordings SQLite table for migration candidates.
// Runs on policy.migration_interval (default 3600 seconds).
// Direct SQLite connection in WAL mode with busy_timeout=30000ms.
