// SQLite WAL truncation.
// Port of RecordingCleanup.truncate_wal() in cleanup.py.
// Runs PRAGMA wal_checkpoint(TRUNCATE) when WAL file exceeds 10MB.

use std::path::Path;

use anyhow::Result;
use tracing::{debug, info, warn};

/// WAL file must exceed this size before we force a checkpoint (matches Python MAX_WAL_SIZE = 10).
const MAX_WAL_SIZE_MB: u64 = 10;

/// Check the WAL file size; if it exceeds MAX_WAL_SIZE_MB, run a blocking TRUNCATE checkpoint.
pub async fn check_and_truncate_wal(db_path: &Path) -> Result<()> {
    let wal_path = {
        let mut p = db_path.as_os_str().to_owned();
        p.push("-wal");
        std::path::PathBuf::from(p)
    };

    let size_mb = match tokio::fs::metadata(&wal_path).await {
        Ok(m) => m.len() / (1024 * 1024),
        Err(_) => {
            // WAL file doesn't exist — nothing to do
            debug!("WAL file not present, skipping checkpoint");
            return Ok(());
        }
    };

    if size_mb < MAX_WAL_SIZE_MB {
        debug!(size_mb, "WAL size within limit, no checkpoint needed");
        return Ok(());
    }

    info!(
        size_mb,
        "WAL exceeds {MAX_WAL_SIZE_MB}MB, running TRUNCATE checkpoint"
    );

    let db_path = db_path.to_owned();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let conn = rusqlite::Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    })
    .await
    .map_err(|e| anyhow::anyhow!("WAL checkpoint task panicked: {e}"))??;

    info!("WAL checkpoint complete");
    Ok(())
}

/// Log a warning if the WAL check fails, but do not propagate — WAL truncation is best-effort.
pub async fn check_and_truncate_wal_or_warn(db_path: &Path) {
    if let Err(e) = check_and_truncate_wal(db_path).await {
        warn!("WAL checkpoint failed: {e}");
    }
}
