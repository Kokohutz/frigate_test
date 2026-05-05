use std::path::Path;

use anyhow::{Context, Result};
use tracing::{debug, warn};

const MAX_SEGMENT_DURATION: f64 = 600.0;

/// Result of validating a cached MP4 segment.
#[derive(Debug, Clone)]
pub struct SegmentValidation {
    pub duration_secs: f64,
    pub has_video: bool,
}

impl SegmentValidation {
    pub fn is_valid(&self) -> bool {
        self.has_video && self.duration_secs > 0.0 && self.duration_secs <= MAX_SEGMENT_DURATION
    }
}

/// Validate a cached MP4 segment using mp4parse (pure Rust, zero subprocess).
/// Falls back to ffprobe subprocess if mp4parse cannot parse the file.
///
/// Port of get_video_properties() + validation check in maintainer.py:validate_and_move_segment().
pub fn validate_segment(path: &Path, ffmpeg_path: &Path) -> Result<SegmentValidation> {
    match validate_with_mp4parse(path) {
        Ok(v) => {
            debug!(
                "mp4parse validated {:?}: duration={:.2}s",
                path, v.duration_secs
            );
            return Ok(v);
        }
        Err(e) => {
            warn!(
                "mp4parse failed for {:?}, falling back to ffprobe: {e}",
                path
            );
        }
    }

    // Fallback: ffprobe subprocess
    validate_with_ffprobe(path, ffmpeg_path)
}

fn validate_with_mp4parse(path: &Path) -> Result<SegmentValidation> {
    let file = std::fs::File::open(path).context("open mp4")?;
    let size = file.metadata()?.len();
    let mut reader = std::io::BufReader::new(file);

    let ctx = mp4parse::read_mp4(&mut reader).context("mp4parse::read_mp4")?;

    let mut duration_secs = 0.0f64;
    let mut has_video = false;

    for track in ctx.tracks.iter() {
        if track.track_type == mp4parse::TrackType::Video {
            has_video = true;
        }

        // Compute duration from track-level fields.
        // TrackScaledTime<u64>(ticks, track_index), TrackTimeScale<u64>(scale, track_index)
        if let (Some(dur), Some(scale)) = (&track.duration, &track.timescale) {
            let ticks = dur.0;
            let timescale = scale.0;
            if timescale > 0 {
                let track_dur = ticks as f64 / timescale as f64;
                if track_dur > duration_secs {
                    duration_secs = track_dur;
                }
            }
        }
    }

    // Sanity check: file must be non-trivially sized
    if size < 1024 && duration_secs == 0.0 {
        anyhow::bail!("File too small ({size} bytes) and zero duration — likely incomplete");
    }

    Ok(SegmentValidation {
        duration_secs,
        has_video,
    })
}

fn validate_with_ffprobe(path: &Path, ffmpeg_path: &Path) -> Result<SegmentValidation> {
    let ffprobe_path = ffmpeg_path
        .parent()
        .map(|p| p.join("ffprobe"))
        .unwrap_or_else(|| std::path::PathBuf::from("ffprobe"));

    let output = std::process::Command::new(&ffprobe_path)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .context("ffprobe subprocess failed")?;

    if !output.status.success() {
        anyhow::bail!(
            "ffprobe exited non-zero: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("ffprobe JSON parse")?;

    let duration_secs = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let has_video = json["streams"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .any(|s| s["codec_type"].as_str() == Some("video"))
        })
        .unwrap_or(false);

    Ok(SegmentValidation {
        duration_secs,
        has_video,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_segment_check() {
        let v = SegmentValidation {
            duration_secs: 10.0,
            has_video: true,
        };
        assert!(v.is_valid());
    }

    #[test]
    fn zero_duration_invalid() {
        let v = SegmentValidation {
            duration_secs: 0.0,
            has_video: true,
        };
        assert!(!v.is_valid());
    }

    #[test]
    fn no_video_track_invalid() {
        let v = SegmentValidation {
            duration_secs: 10.0,
            has_video: false,
        };
        assert!(!v.is_valid());
    }

    #[test]
    fn too_long_invalid() {
        let v = SegmentValidation {
            duration_secs: 700.0,
            has_video: true,
        };
        assert!(!v.is_valid());
    }
}
