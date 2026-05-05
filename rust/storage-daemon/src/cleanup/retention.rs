// Per-camera retention enforcement.
// Port of RecordingCleanup.expire_recordings() in cleanup.py.
//
// Simplified vs Python: no ReviewSegment-overlap logic.
// Applies time-based expiry using continuous and motion retain days.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use tokio_rusqlite::Connection;
use tracing::{debug, info, warn};

use crate::db::recordings::{
    delete_recordings_batch, fetch_expired_recordings, fetch_orphan_recordings,
};

pub struct RetentionConfig {
    /// Days to keep all recordings (regardless of motion/objects).
    pub continuous_retain_days: f64,
    /// Days to keep recordings with motion or audio (motion > 0 OR dBFS != 0).
    pub motion_retain_days: f64,
}

/// Run the full retention sweep: orphan cameras first, then per-camera expiry.
pub async fn expire_recordings(
    conn: &Connection,
    cameras: &[String],
    cfg: &RetentionConfig,
) -> Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    // The broadest window: we never keep anything older than max(continuous, motion) days
    let max_retain_days = f64::max(cfg.continuous_retain_days, cfg.motion_retain_days);
    let orphan_expire_ts = now - max_retain_days * 86_400.0;

    // --- Orphan cameras (camera no longer in config) ---
    expire_orphan_cameras(conn, cameras, orphan_expire_ts).await?;

    // --- Active cameras ---
    for camera in cameras {
        expire_camera(conn, camera, now, cfg).await?;
    }

    Ok(())
}

async fn expire_orphan_cameras(
    conn: &Connection,
    known_cameras: &[String],
    expire_before_ts: f64,
) -> Result<()> {
    let rows = fetch_orphan_recordings(conn, known_cameras.to_vec(), expire_before_ts).await?;
    if rows.is_empty() {
        return Ok(());
    }
    info!("Expiring {} orphan-camera recordings", rows.len());
    let ids: Vec<String> = rows
        .iter()
        .map(|r| {
            if let Err(e) = std::fs::remove_file(&r.path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    warn!(path = %r.path, "failed to unlink orphan recording: {e}");
                }
            }
            r.id.clone()
        })
        .collect();
    let deleted = delete_recordings_batch(conn, ids).await?;
    debug!("Deleted {deleted} orphan recording rows");
    Ok(())
}

async fn expire_camera(
    conn: &Connection,
    camera: &str,
    now: f64,
    cfg: &RetentionConfig,
) -> Result<()> {
    // continuous_expire_ts: delete recordings with no motion/audio older than this
    let continuous_expire_ts = now - cfg.continuous_retain_days * 86_400.0;
    // motion_expire_ts: delete ALL recordings older than this (even with motion)
    // Python uses max(motion_days, continuous_days) to avoid keeping motion for less than
    // continuous (which would be illogical)
    let effective_motion_days = f64::max(cfg.motion_retain_days, cfg.continuous_retain_days);
    let motion_expire_ts = now - effective_motion_days * 86_400.0;

    let rows = fetch_expired_recordings(
        conn,
        camera.to_string(),
        continuous_expire_ts,
        motion_expire_ts,
    )
    .await?;

    if rows.is_empty() {
        return Ok(());
    }

    debug!(camera, count = rows.len(), "expiring recordings");

    let ids: Vec<String> = rows
        .iter()
        .map(|r| {
            if let Err(e) = std::fs::remove_file(&r.path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    warn!(camera, path = %r.path, "failed to unlink recording: {e}");
                }
            }
            r.id.clone()
        })
        .collect();

    let deleted = delete_recordings_batch(conn, ids).await?;
    info!(camera, deleted, "expired recordings");
    Ok(())
}
