// Background segment migration (hot → cold).
// Uses tokio::fs::copy + remove_file (works across filesystem boundaries).
// Updates Recordings.path in SQLite after successful copy.
// Preserves relative path structure: {YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4

use std::path::Path;

use anyhow::{Context, Result};
use tokio_rusqlite::Connection;
use tracing::{debug, error, info, warn};

use crate::policy;
use crate::tiers::TierConfig;

pub struct MigrationResult {
    pub migrated: usize,
    pub failed: usize,
    pub bytes_moved: u64,
}

/// Migrate one recording: copy the file to the cold path, update DB, then
/// delete the hot file.  Uses copy-then-unlink so it works across filesystem
/// boundaries (e.g. NVMe → NAS).
///
/// Returns the number of bytes moved (file size before deletion).
pub async fn migrate_recording(
    conn: &Connection,
    id: String,
    hot_path: &Path,
    cold_path: &Path,
) -> Result<u64> {
    // Ensure parent directory exists on cold storage.
    if let Some(parent) = cold_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("create cold dir {}", parent.display()))?;
    }

    // Copy the file (works across filesystems).
    let bytes = tokio::fs::copy(hot_path, cold_path)
        .await
        .with_context(|| format!("copy {} → {}", hot_path.display(), cold_path.display()))?;

    // Update the DB path.
    let cold_path_str = cold_path
        .to_str()
        .with_context(|| format!("cold path is not valid UTF-8: {}", cold_path.display()))?
        .to_owned();

    {
        let id_clone = id.clone();
        conn.call(move |c| {
            c.execute(
                "UPDATE recordings SET path = ?1 WHERE id = ?2",
                rusqlite::params![cold_path_str, id_clone],
            )
            .map(|_| ())
            .map_err(|e| tokio_rusqlite::Error::Other(e.into()))
        })
        .await
        .context("update recordings.path in DB")?;
    }

    // Remove the hot file.
    tokio::fs::remove_file(hot_path)
        .await
        .with_context(|| format!("remove hot file {}", hot_path.display()))?;

    debug!(
        id = %id,
        bytes,
        hot = %hot_path.display(),
        cold = %cold_path.display(),
        "migrated recording"
    );

    Ok(bytes)
}

/// Candidate recording returned from the DB.
struct Candidate {
    id: String,
    path: String,
    end_time: f64,
}

/// Run a full migration sweep.
///
/// Fetches up to 1000 recordings whose path starts with the hot prefix and
/// whose `end_time` is older than `hot_max_days`.  For each candidate,
/// `policy::should_migrate` is re-evaluated (guard against clock skew),
/// the cold path is computed, and the file is migrated.
pub async fn run_migration_sweep(
    conn: &Connection,
    tier_config: &TierConfig,
    now: f64,
) -> Result<MigrationResult> {
    let hot_max_days = tier_config.hot.max_days;
    let expire_ts = now - hot_max_days * 86_400.0;

    let hot_path_str = tier_config
        .hot
        .path
        .to_str()
        .context("hot path is not valid UTF-8")?
        .to_owned();

    let like_pattern = format!("{hot_path_str}%");

    // Fetch candidates from the DB.
    let candidates: Vec<Candidate> = conn
        .call(move |c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, path, end_time \
                 FROM recordings \
                 WHERE path LIKE ?1 \
                   AND end_time < ?2 \
                 ORDER BY end_time ASC \
                 LIMIT 1000",
            )?;
            let rows = stmt
                .query_map(rusqlite::params![like_pattern, expire_ts], |row| {
                    Ok(Candidate {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        end_time: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
        .context("fetch migration candidates")?;

    if candidates.is_empty() {
        debug!("migration sweep: no candidates");
        return Ok(MigrationResult {
            migrated: 0,
            failed: 0,
            bytes_moved: 0,
        });
    }

    info!("migration sweep: {} candidates", candidates.len());

    let mut migrated = 0usize;
    let mut failed = 0usize;
    let mut bytes_moved = 0u64;

    for candidate in candidates {
        // Re-check policy (defensive guard).
        if !policy::should_migrate(candidate.end_time, now, hot_max_days) {
            continue;
        }

        let hot_file = std::path::Path::new(&candidate.path);
        let cold_file =
            match policy::cold_path(hot_file, &tier_config.hot.path, &tier_config.cold.path) {
                Ok(p) => p,
                Err(e) => {
                    warn!(id = %candidate.id, "cold_path error: {e:#}");
                    failed += 1;
                    continue;
                }
            };

        match migrate_recording(conn, candidate.id.clone(), hot_file, &cold_file).await {
            Ok(bytes) => {
                migrated += 1;
                bytes_moved += bytes;
            }
            Err(e) => {
                error!(id = %candidate.id, "migration failed: {e:#}");
                failed += 1;
            }
        }
    }

    info!(migrated, failed, bytes_moved, "migration sweep complete");

    Ok(MigrationResult {
        migrated,
        failed,
        bytes_moved,
    })
}
