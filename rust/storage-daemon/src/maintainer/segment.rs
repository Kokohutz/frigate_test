use chrono::{DateTime, Utc};
use dashmap::DashMap;
use tracing::debug;

use crate::heatmap::compute_motion_heatmap;
use crate::zmq::pubsub::TrackedObject;
use frigate_common::zmq_types::SegmentInfo;

/// Default frame dimensions for heatmap computation when unknown.
/// Frigate detects on 1920×1080 canonical resolution by default.
const DEFAULT_FRAME_WIDTH: u32 = 1920;
const DEFAULT_FRAME_HEIGHT: u32 = 1080;

/// A single video frame's detection data, stored per-camera for segment annotation.
/// Mirrors the tuples appended to object_recordings_info[camera] in maintainer.py.
#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub frame_time: f64,
    pub tracked_objects: Vec<TrackedObject>,
    pub motion_boxes: Vec<[i32; 4]>,
    pub regions: Vec<[i32; 4]>,
}

/// A single audio frame's data.
/// Mirrors the tuples appended to audio_recordings_info[camera] in maintainer.py.
#[derive(Debug, Clone)]
pub struct AudioFrame {
    pub frame_time: f64,
    pub db_fs: f64,
    pub audio_labels: Vec<String>,
}

/// Per-camera detection accumulator.
/// Shared across tokio tasks via Arc<DashMap<...>>.
pub type CameraVideoFrames = DashMap<String, Vec<VideoFrame>>;
pub type CameraAudioFrames = DashMap<String, Vec<AudioFrame>>;

/// Append a video frame to the per-camera accumulator.
pub fn record_video_frame(
    video_frames: &CameraVideoFrames,
    camera: &str,
    frame_time: f64,
    tracked_objects: Vec<TrackedObject>,
    motion_boxes: Vec<[i32; 4]>,
    regions: Vec<[i32; 4]>,
) {
    let frame = VideoFrame {
        frame_time,
        tracked_objects,
        motion_boxes,
        regions,
    };
    video_frames
        .entry(camera.to_string())
        .or_default()
        .push(frame);
}

/// Append an audio frame to the per-camera accumulator.
pub fn record_audio_frame(
    audio_frames: &CameraAudioFrames,
    camera: &str,
    frame_time: f64,
    db_fs: f64,
    audio_labels: Vec<String>,
) {
    let frame = AudioFrame {
        frame_time,
        db_fs,
        audio_labels,
    };
    audio_frames
        .entry(camera.to_string())
        .or_default()
        .push(frame);
}

/// Compute SegmentInfo for a given [start_time, end_time] window.
/// Port of RecordingMaintainer.segment_stats() in maintainer.py.
pub fn compute_segment_info(
    camera: &str,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    video_frames: &CameraVideoFrames,
    audio_frames: &CameraAudioFrames,
) -> SegmentInfo {
    let start_ts = start_time.timestamp() as f64;
    let end_ts = end_time.timestamp() as f64;

    let mut motion_count: i64 = 0;
    let mut active_count: i64 = 0;
    let mut region_count: i64 = 0;
    let mut all_motion_boxes: Vec<[i32; 4]> = Vec::new();

    // Process video frames
    if let Some(frames) = video_frames.get(camera) {
        for frame in frames.iter() {
            if frame.frame_time > end_ts {
                break;
            }
            if frame.frame_time < start_ts {
                continue;
            }

            // Count active (non-false-positive, non-stationary) tracked objects
            let active: i64 = frame
                .tracked_objects
                .iter()
                .filter(|o| !o.false_positive && o.motionless_count == 0)
                .count() as i64;
            active_count += active;
            motion_count += frame.motion_boxes.len() as i64;
            region_count += frame.regions.len() as i64;
            all_motion_boxes.extend_from_slice(&frame.motion_boxes);
        }
    }

    // Process audio frames
    let mut audio_values: Vec<f64> = Vec::new();
    if let Some(frames) = audio_frames.get(camera) {
        for frame in frames.iter() {
            if frame.frame_time > end_ts {
                break;
            }
            if frame.frame_time < start_ts {
                continue;
            }
            // audio label count adds to active_count (matches Python: active_count += len(frame[2]))
            active_count += frame.audio_labels.len() as i64;
            audio_values.push(frame.db_fs);
        }
    }

    let average_db_fs = if audio_values.is_empty() {
        0i64
    } else {
        let avg = audio_values.iter().sum::<f64>() / audio_values.len() as f64;
        avg.round() as i64
    };

    // Compute 16×16 motion heatmap
    let motion_heatmap = if all_motion_boxes.is_empty() {
        None
    } else {
        let heatmap =
            compute_motion_heatmap(&all_motion_boxes, DEFAULT_FRAME_WIDTH, DEFAULT_FRAME_HEIGHT);
        if heatmap.is_empty() {
            None
        } else {
            Some(heatmap)
        }
    };

    debug!(
        camera,
        motion_count, active_count, region_count, average_db_fs, "computed segment info"
    );

    SegmentInfo {
        motion_count,
        active_object_count: active_count,
        region_count,
        average_db_fs,
        motion_heatmap,
    }
}

/// Prune old frames from the accumulator to prevent unbounded memory growth.
/// Removes all frames with frame_time < cutoff_timestamp.
pub fn prune_old_frames(
    video_frames: &CameraVideoFrames,
    audio_frames: &CameraAudioFrames,
    cutoff_ts: f64,
) {
    for mut entry in video_frames.iter_mut() {
        entry.retain(|f| f.frame_time >= cutoff_ts);
    }
    for mut entry in audio_frames.iter_mut() {
        entry.retain(|f| f.frame_time >= cutoff_ts);
    }
}
