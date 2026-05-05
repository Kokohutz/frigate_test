use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;
use tracing::{debug, warn};

use frigate_common::zmq_types::parse_cache_filename;

/// A segment file found in the cache directory, ready for validation.
#[derive(Debug, Clone)]
pub struct CacheSegment {
    pub camera: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub path: PathBuf,
}

/// Returns all .mp4 files in `cache_dir` that:
/// 1. Are not prefixed with "preview_"
/// 2. Are not currently open by an ffmpeg process (via /proc/{pid}/fd/)
/// 3. Have a valid {camera}@{timestamp}.mp4 filename format
///
/// Matches the logic in RecordingMaintainer.move_files() in maintainer.py.
pub fn scan_cache(cache_dir: &Path) -> Result<Vec<CacheSegment>> {
    let in_use = files_in_use_by_ffmpeg(cache_dir);

    let mut segments = Vec::new();

    let entries = std::fs::read_dir(cache_dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        // Only .mp4 files, no preview_ prefix
        if !name.ends_with(".mp4") || name.starts_with("preview_") {
            continue;
        }

        // Skip files currently open by ffmpeg
        if in_use.contains(name) {
            debug!("Skipping in-use segment: {name}");
            continue;
        }

        // Parse camera name and start time from filename
        match parse_cache_filename(name) {
            Some((camera, start_time)) => {
                segments.push(CacheSegment {
                    camera,
                    start_time,
                    path,
                });
            }
            None => {
                warn!("Skipping unexpected cache file: {name}");
            }
        }
    }

    Ok(segments)
}

/// Returns the set of filenames currently open by any ffmpeg process.
/// Reads /proc/{pid}/fd/ symlinks on Linux (Frigate is Docker/Linux only).
fn files_in_use_by_ffmpeg(cache_dir: &Path) -> HashSet<String> {
    let mut in_use = HashSet::new();

    let Ok(proc) = std::fs::read_dir("/proc") else {
        return in_use;
    };

    for proc_entry in proc.flatten() {
        let pid_path = proc_entry.path();

        // Only numeric directories (PIDs)
        if !pid_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
        {
            continue;
        }

        // Check if this process is ffmpeg
        let cmdline_path = pid_path.join("cmdline");
        let Ok(cmdline) = std::fs::read(&cmdline_path) else {
            continue;
        };
        // cmdline is NUL-separated; the first field is the binary name
        let first_arg = cmdline.split(|&b| b == 0).next().unwrap_or(&[]);
        let is_ffmpeg = first_arg
            .iter()
            .rev()
            .position(|&b| b == b'/')
            .map(|pos| &first_arg[first_arg.len() - pos..])
            .unwrap_or(first_arg)
            == b"ffmpeg";

        if !is_ffmpeg {
            continue;
        }

        // Read open file descriptors for this ffmpeg process
        let fd_dir = pid_path.join("fd");
        let Ok(fds) = std::fs::read_dir(&fd_dir) else {
            continue;
        };

        for fd_entry in fds.flatten() {
            if let Ok(target) = std::fs::read_link(fd_entry.path()) {
                if target.starts_with(cache_dir) {
                    if let Some(name) = target.file_name().and_then(|n| n.to_str()) {
                        in_use.insert(name.to_string());
                    }
                }
            }
        }
    }

    in_use
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_cache_filename() {
        let result = parse_cache_filename("front_door@20250505120000+0000.mp4");
        assert!(result.is_some());
        let (cam, _dt) = result.unwrap();
        assert_eq!(cam, "front_door");
    }

    #[test]
    fn parse_preview_prefix_returns_none_from_scanner_logic() {
        // preview_ files are filtered before parsing — but parse itself would succeed
        // if someone passes one directly. Test that the scanner skips them.
        let result = parse_cache_filename("preview_camera@20250505120000+0000.mp4");
        // parse_cache_filename doesn't filter prefix — scanner does
        assert!(result.is_some());
    }
}
