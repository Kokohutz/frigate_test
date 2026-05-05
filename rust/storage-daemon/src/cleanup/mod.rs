// Recording cleanup — replaces frigate/record/cleanup.py
//
// Responsibilities:
//   - Enforce per-camera retention policies (days, mode: all/motion/active_objects)
//   - Delete recordings older than configured retention
//   - Truncate SQLite WAL when > 10MB (PRAGMA wal_checkpoint(TRUNCATE))
//   - Update has_clip on overlapping Event rows after deletion
//   - Run on configurable interval (default: every 60 minutes)

pub mod retention;
pub mod wal;
