// SQLite access via rusqlite + tokio-rusqlite.
// Replaces Peewee ORM queries in the recording/cleanup/storage subsystems.
//
// Connection settings applied to every connection:
//   PRAGMA journal_mode=WAL;
//   PRAGMA busy_timeout=30000;   -- handles concurrent Python writes
//   PRAGMA synchronous=NORMAL;

pub mod recordings;
