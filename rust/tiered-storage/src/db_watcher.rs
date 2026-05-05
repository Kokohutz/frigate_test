// Polls the Recordings SQLite table for migration candidates.
// Runs on policy.migration_interval (default 3600 seconds).
// Direct SQLite connection in WAL mode with busy_timeout=30000ms.

use std::path::Path;

use anyhow::{Context, Result};
use tokio_rusqlite::Connection;

/// Open a tokio-rusqlite connection and apply required WAL pragmas.
///
/// Required pragmas (same as storage-daemon):
///   PRAGMA journal_mode=WAL;
///   PRAGMA busy_timeout=30000;
///   PRAGMA synchronous=NORMAL;
pub async fn open(db_path: &Path) -> Result<Connection> {
    let path = db_path.to_owned();
    let conn = Connection::open(&path)
        .await
        .with_context(|| format!("open SQLite {}", path.display()))?;

    conn.call(|c| {
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA busy_timeout=30000;
             PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| tokio_rusqlite::Error::Other(e.into()))
    })
    .await
    .context("apply WAL pragmas")?;

    Ok(conn)
}
