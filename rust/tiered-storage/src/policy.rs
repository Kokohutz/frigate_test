// Hot/cold decision engine.
// For each recording row: determine if it should migrate based on age,
// whether it contains detections (objects > 0 → event_hot_days), and tier capacity.

use std::path::{Path, PathBuf};

use anyhow::Result;

/// Decide if a recording should migrate from hot to cold.
///
/// Returns `true` when:
///   - `recording_end_time < now - hot_max_days * 86400`
///
/// The caller is responsible for checking the event-clip retention window
/// (event_hot_days) and should skip migration for recordings that overlap
/// an indefinitely-retained event clip still inside its hot window.
pub fn should_migrate(recording_end_time: f64, now: f64, hot_max_days: f64) -> bool {
    let expire_ts = now - hot_max_days * 86_400.0;
    recording_end_time < expire_ts
}

/// Compute the destination cold path for a file currently on hot storage.
///
/// Strips `hot_prefix` from `hot_path` and prepends `cold_prefix`.
///
/// # Errors
/// Returns an error if `hot_path` does not start with `hot_prefix`.
pub fn cold_path(hot_path: &Path, hot_prefix: &Path, cold_prefix: &Path) -> Result<PathBuf> {
    let relative = hot_path.strip_prefix(hot_prefix).map_err(|_| {
        anyhow::anyhow!(
            "hot path {} does not start with hot prefix {}",
            hot_path.display(),
            hot_prefix.display()
        )
    })?;
    Ok(cold_prefix.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── should_migrate ────────────────────────────────────────────────────────

    #[test]
    fn should_migrate_old_recording() {
        // Recording ended 10 days ago; hot_max_days = 7 → should migrate.
        let now = 1_700_000_000.0_f64;
        let end = now - 10.0 * 86_400.0;
        assert!(should_migrate(end, now, 7.0));
    }

    #[test]
    fn should_not_migrate_recent_recording() {
        // Recording ended 3 days ago; hot_max_days = 7 → keep on hot.
        let now = 1_700_000_000.0_f64;
        let end = now - 3.0 * 86_400.0;
        assert!(!should_migrate(end, now, 7.0));
    }

    #[test]
    fn should_not_migrate_at_exact_boundary() {
        // end_time == expire_ts → not strictly less than, so keep on hot.
        let now = 1_700_000_000.0_f64;
        let hot_max_days = 7.0;
        let end = now - hot_max_days * 86_400.0;
        assert!(!should_migrate(end, now, hot_max_days));
    }

    #[test]
    fn should_migrate_just_past_boundary() {
        let now = 1_700_000_000.0_f64;
        let hot_max_days = 7.0;
        let end = now - hot_max_days * 86_400.0 - 1.0; // 1 second past expiry
        assert!(should_migrate(end, now, hot_max_days));
    }

    // ── cold_path ─────────────────────────────────────────────────────────────

    #[test]
    fn cold_path_replaces_prefix() {
        let hot = Path::new("/media/frigate/recordings/2024-01-15/12/front/30.00.mp4");
        let hot_prefix = Path::new("/media/frigate/recordings");
        let cold_prefix = Path::new("/mnt/nas/frigate/recordings");

        let result = cold_path(hot, hot_prefix, cold_prefix).unwrap();
        assert_eq!(
            result,
            PathBuf::from("/mnt/nas/frigate/recordings/2024-01-15/12/front/30.00.mp4")
        );
    }

    #[test]
    fn cold_path_error_wrong_prefix() {
        let hot = Path::new("/other/path/file.mp4");
        let hot_prefix = Path::new("/media/frigate/recordings");
        let cold_prefix = Path::new("/mnt/nas/frigate/recordings");

        let result = cold_path(hot, hot_prefix, cold_prefix);
        assert!(result.is_err());
        let msg = format!("{}", result.unwrap_err());
        assert!(msg.contains("does not start with hot prefix"));
    }

    #[test]
    fn cold_path_handles_root_prefix() {
        let hot = Path::new("/media/frigate/recordings/cam1/file.mp4");
        let hot_prefix = Path::new("/media/frigate/recordings");
        let cold_prefix = Path::new("/cold");

        let result = cold_path(hot, hot_prefix, cold_prefix).unwrap();
        assert_eq!(result, PathBuf::from("/cold/cam1/file.mp4"));
    }
}
