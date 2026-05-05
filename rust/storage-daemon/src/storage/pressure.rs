// Disk pressure detection and relief.
// Port of StorageMaintainer.check_storage_needs_cleanup() and reduce_storage_consumption().

use std::collections::HashMap;
use std::path::Path;

use anyhow::Result;
use tokio_rusqlite::Connection;
use tracing::{debug, error, info, warn};

use crate::db::recordings::{
    compute_camera_bandwidth, delete_recordings_batch, fetch_oldest_recordings,
    fetch_retained_events, total_recordings_count, update_events_has_clip,
};

/// Per-camera bandwidth state (MB/hr).
pub struct PressureState {
    /// MB/hr estimate per camera name.
    pub camera_bandwidth: HashMap<String, f64>,
    /// Whether each camera's estimate needs refreshing (< 50 segments).
    pub needs_refresh: HashMap<String, bool>,
}

impl PressureState {
    pub fn new() -> Self {
        Self {
            camera_bandwidth: HashMap::new(),
            needs_refresh: HashMap::new(),
        }
    }

    pub fn total_hourly_mb(&self) -> f64 {
        self.camera_bandwidth.values().sum()
    }
}

/// Refresh bandwidth estimates for cameras that need it.
pub async fn refresh_bandwidths(
    conn: &Connection,
    state: &mut PressureState,
    cameras: &[String],
) -> Result<()> {
    for camera in cameras {
        let needs = state.needs_refresh.get(camera).copied().unwrap_or(true);
        if !needs {
            continue;
        }

        let count = total_recordings_count(conn, camera.clone()).await?;
        let needs_refresh_next = count < 50;

        let bw = compute_camera_bandwidth(conn, camera.clone()).await?;
        // Cap at Python's MAX_CALCULATED_BANDWIDTH (10,000 MB/hr = ~10 GB/hr)
        let bw = bw.min(10_000.0);

        debug!(camera, bandwidth_mb_hr = bw, "camera bandwidth estimate");

        state.camera_bandwidth.insert(camera.clone(), bw);
        state
            .needs_refresh
            .insert(camera.clone(), needs_refresh_next);
    }
    Ok(())
}

/// Return free disk space in MB for the filesystem containing `dir`.
/// Falls back to 0 on error (conservative — triggers cleanup).
pub fn free_space_mb(dir: &Path) -> f64 {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();

    // Find the disk whose mount point is the longest prefix of `dir`
    let best = disks
        .iter()
        .filter(|d| dir.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());

    match best {
        Some(disk) => disk.available_space() as f64 / (1024.0 * 1024.0),
        None => {
            warn!(
                "Could not determine disk for {}, assuming full",
                dir.display()
            );
            0.0
        }
    }
}

/// Check whether disk pressure exists and relieve it if so.
/// Mirrors StorageMaintainer.run() logic: runs every 5 minutes in the caller.
pub async fn check_and_relieve_pressure(
    conn: &Connection,
    record_dir: &Path,
    state: &mut PressureState,
    cameras: &[String],
) -> Result<()> {
    refresh_bandwidths(conn, state, cameras).await?;

    let hourly_bandwidth = state.total_hourly_mb();
    let free_mb = free_space_mb(record_dir);

    debug!(
        free_mb,
        hourly_bandwidth_mb = hourly_bandwidth,
        "storage pressure check"
    );

    if hourly_bandwidth == 0.0 || free_mb >= hourly_bandwidth {
        return Ok(());
    }

    info!(
        free_mb,
        hourly_bandwidth_mb = hourly_bandwidth,
        "Less than 1 hour of recording space left, running storage maintenance"
    );

    relieve_pressure(conn, state, hourly_bandwidth).await
}

async fn relieve_pressure(
    conn: &Connection,
    state: &mut PressureState,
    hourly_bandwidth: f64,
) -> Result<()> {
    // Fetch events retained indefinitely (must skip their recordings)
    let retained_events = fetch_retained_events(conn).await?;

    // Fetch oldest recordings in large batches
    let recordings = fetch_oldest_recordings(conn, 100_000).await?;

    let mut deleted_size_mb = 0.0f64;
    let mut deleted_recordings = Vec::new();

    let mut event_start = 0usize;

    for recording in &recordings {
        if deleted_size_mb >= hourly_bandwidth {
            break;
        }

        let mut keep = false;
        let mut new_event_start = event_start;
        for (i, ev) in retained_events[event_start..].iter().enumerate() {
            let abs_idx = event_start + i;
            if ev.start_time > recording.end_time {
                keep = false;
                break;
            }
            if ev.end_time.is_none_or(|et| et >= recording.start_time) {
                keep = true;
                break;
            }
            if ev.end_time.is_some_and(|et| et < recording.start_time) {
                new_event_start = abs_idx;
            }
        }
        event_start = new_event_start;

        if !keep {
            match std::fs::remove_file(&recording.path) {
                Ok(()) => {
                    deleted_size_mb += recording.segment_size;
                    deleted_recordings.push(recording);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => warn!(path = %recording.path, "unlink failed: {e}"),
            }
        }
    }

    // If still short, delete retained recordings too
    if deleted_size_mb < hourly_bandwidth {
        error!(
            freed_mb = deleted_size_mb,
            needed_mb = hourly_bandwidth,
            "Could not clear enough space from non-retained recordings; deleting retained"
        );
        for recording in &recordings {
            if deleted_size_mb >= hourly_bandwidth {
                break;
            }
            match std::fs::remove_file(&recording.path) {
                Ok(()) => {
                    deleted_size_mb += recording.segment_size;
                    deleted_recordings.push(recording);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => warn!(path = %recording.path, "unlink failed: {e}"),
            }
        }
    } else {
        info!(freed_mb = deleted_size_mb, "Storage cleanup complete");
    }

    if deleted_recordings.is_empty() {
        return Ok(());
    }

    // Mark cameras with deleted segments as needing bandwidth refresh
    for r in &deleted_recordings {
        state.needs_refresh.insert(r.camera.clone(), true);
    }

    // Find overlapping events to clear has_clip
    let events_to_clear = find_overlapping_events(&retained_events, &deleted_recordings);
    if !events_to_clear.is_empty() {
        update_events_has_clip(conn, events_to_clear).await?;
    }

    // Delete recording rows
    let ids: Vec<String> = deleted_recordings.iter().map(|r| r.id.clone()).collect();
    let deleted = delete_recordings_batch(conn, ids).await?;
    info!(deleted, "Removed recording rows after pressure relief");

    Ok(())
}

/// Collect event IDs that overlap with any deleted recording time range.
/// We need to query separately since retained_events only has retain_indefinitely=1 events.
/// For simplicity, we mark the retained events that overlap.
fn find_overlapping_events<'a>(
    retained_events: &'a [crate::db::recordings::EventRow],
    deleted: &[&'a crate::db::recordings::RecordingRow],
) -> Vec<String> {
    let mut ids = Vec::new();
    for ev in retained_events {
        let ev_end = ev.end_time.unwrap_or(f64::MAX);
        for rec in deleted {
            if ev.start_time < rec.end_time && ev_end > rec.start_time {
                ids.push(ev.id.clone());
                break;
            }
        }
    }
    ids
}
