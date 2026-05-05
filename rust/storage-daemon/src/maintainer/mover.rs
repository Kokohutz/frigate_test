use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use tracing::{error, info};

/// Move a validated cache segment to permanent storage.
///
/// Cache path:     /tmp/cache/{camera}@{YYYYMMDDHHMMSS+UTC}.mp4
/// Permanent path: {record_dir}/{YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4
///
/// The segment is remuxed with `-movflags +faststart` via ffmpeg, then the
/// cache file is deleted.  Returns the permanent path on success.
pub async fn move_segment(
    cache_path: &Path,
    camera: &str,
    start_time: DateTime<Utc>,
    record_dir: &Path,
    ffmpeg_path: &Path,
) -> Result<PathBuf> {
    let perm_path = build_permanent_path(record_dir, camera, start_time);

    // Create parent directories
    if let Some(parent) = perm_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("create_dir_all: {}", parent.display()))?;
    }

    // Remux with faststart via ffmpeg.
    // Propagate path-not-UTF-8 as an error rather than silently passing "" to ffmpeg.
    let cache_str = cache_path
        .to_str()
        .context("cache path is not valid UTF-8")?;
    let perm_str = perm_path
        .to_str()
        .context("permanent path is not valid UTF-8")?;

    let output = tokio::process::Command::new(ffmpeg_path)
        .args(["-y", "-i", cache_str, "-c", "copy", "-movflags", "+faststart", perm_str])
        .output()
        .await
        .with_context(|| format!("ffmpeg spawn failed for {}", cache_path.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(
            cache_path = %cache_path.display(),
            perm_path = %perm_path.display(),
            stderr = %stderr,
            "ffmpeg remux failed"
        );
        return Err(anyhow::anyhow!(
            "ffmpeg failed (exit {:?}) for {}",
            output.status.code(),
            cache_path.display()
        ));
    }

    info!(
        from = %cache_path.display(),
        to = %perm_path.display(),
        "segment moved to permanent storage"
    );

    // Remove the cache file
    tokio::fs::remove_file(cache_path)
        .await
        .with_context(|| format!("remove_file: {}", cache_path.display()))?;

    Ok(perm_path)
}

/// Build the permanent storage path for a segment.
///
/// Format: `{record_dir}/{YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4`
/// where `{MM.SS}` = minute and second, zero-padded, separated by a dot.
fn build_permanent_path(record_dir: &Path, camera: &str, start_time: DateTime<Utc>) -> PathBuf {
    let date = start_time.format("%Y-%m-%d").to_string();
    let hour = start_time.format("%H").to_string();
    let minute_second = start_time.format("%M.%S").to_string();

    record_dir
        .join(date)
        .join(hour)
        .join(camera)
        .join(format!("{minute_second}.mp4"))
}

/// Return the segment size in MB (file size / 1024²).
///
/// Returns 0.0 if the file cannot be read (e.g. already deleted).
pub async fn segment_size_mb(path: &Path) -> f64 {
    match tokio::fs::metadata(path).await {
        Ok(meta) => meta.len() as f64 / (1024.0 * 1024.0),
        Err(_) => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_build_permanent_path() {
        let record_dir = Path::new("/media/frigate/recordings");
        let start = Utc.with_ymd_and_hms(2025, 5, 5, 14, 5, 30).unwrap();
        let path = build_permanent_path(record_dir, "front_door", start);
        assert_eq!(
            path,
            PathBuf::from("/media/frigate/recordings/2025-05-05/14/front_door/05.30.mp4")
        );
    }

    #[test]
    fn test_build_permanent_path_midnight() {
        let record_dir = Path::new("/media/frigate/recordings");
        let start = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let path = build_permanent_path(record_dir, "back_yard", start);
        assert_eq!(
            path,
            PathBuf::from("/media/frigate/recordings/2025-01-01/00/back_yard/00.00.mp4")
        );
    }
}
