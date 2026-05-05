//! Serde structs matching Frigate's ZMQ wire protocol.
//!
//! REQ/REP format:  json(["topic_name", data])  sent via send_json
//! PUB/SUB format:  "{topic} {json_payload}"    received via recv_string().split(maxsplit=1)

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── REQ/REP topics (const.py) ────────────────────────────────────────────────

pub const TOPIC_INSERT_MANY_RECORDINGS: &str = "insert_many_recordings";
pub const TOPIC_INSERT_PREVIEW: &str = "insert_preview";
pub const TOPIC_UPSERT_REVIEW_SEGMENT: &str = "upsert_review_segment";
pub const TOPIC_UPDATE_CAMERA_ACTIVITY: &str = "update_camera_activity";

// ── PUB/SUB socket addresses (zmq_proxy.py) ──────────────────────────────────

/// Publishers connect here to send messages into the proxy.
pub const SOCKET_PUB: &str = "ipc:///tmp/cache/proxy_pub";
/// Subscribers connect here to receive messages from the proxy.
pub const SOCKET_SUB: &str = "ipc:///tmp/cache/proxy_sub";
/// Synchronous REQ/REP for DB writes and config queries.
pub const SOCKET_REP_REQ: &str = "ipc:///tmp/cache/comms";

// ── Recording types ───────────────────────────────────────────────────────────

/// One row inserted via INSERT_MANY_RECORDINGS.
/// Matches the dict constructed in maintainer.py:move_segment().
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingInsert {
    pub id: String,
    pub camera: String,
    pub path: String,
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
    pub motion: i64,
    pub objects: i64,
    pub regions: i64,
    #[serde(rename = "dBFS")]
    pub db_fs: i64,
    pub segment_size: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_heatmap: Option<HashMap<String, u8>>,
}

// ── Detection pub/sub payloads ────────────────────────────────────────────────

/// Payload published on "detection/video" topic.
/// Fields: (camera, frame_id, frame_time, tracked_objects, motion_boxes, regions)
#[derive(Debug, Clone, Deserialize)]
pub struct DetectionVideoPayload {
    pub camera: String,
    pub frame_id: Option<String>,
    pub frame_time: f64,
    pub tracked_objects: serde_json::Value,
    pub motion_boxes: Vec<[i32; 4]>,
    pub regions: Vec<[i32; 4]>,
}

/// Payload published on "detection/audio" topic.
/// Fields: (camera, frame_time, dBFS, audio_detections)
#[derive(Debug, Clone, Deserialize)]
pub struct DetectionAudioPayload {
    pub camera: String,
    pub frame_time: f64,
    pub db_fs: i64,
    pub audio_detections: serde_json::Value,
}

// ── Recordings pub/sub payloads ───────────────────────────────────────────────

/// Subtopics published on "recordings/" prefix (recordings_updater.py).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingsSubTopic {
    Latest,
    Saved,
    Valid,
    Invalid,
}

/// [camera, start_time | null, path | null]
#[derive(Debug, Clone, Serialize)]
pub struct RecordingsPayload {
    pub camera: String,
    pub start_time: Option<f64>,
    pub path: Option<String>,
}

// ── Segment info (retention decisions) ───────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetainMode {
    All,
    Motion,
    ActiveObjects,
}

#[derive(Debug, Clone)]
pub struct SegmentInfo {
    pub motion_count: i64,
    pub active_object_count: i64,
    pub region_count: i64,
    pub average_db_fs: i64,
    pub motion_heatmap: Option<HashMap<String, u8>>,
}

impl SegmentInfo {
    /// Port of SegmentInfo.should_discard_segment() in maintainer.py.
    pub fn should_discard(&self, retain_mode: RetainMode) -> bool {
        let keep = match retain_mode {
            RetainMode::All => true,
            RetainMode::Motion => self.motion_count > 0 || self.average_db_fs != 0,
            RetainMode::ActiveObjects => self.active_object_count > 0,
        };
        !keep
    }
}

// ── Cache file naming ─────────────────────────────────────────────────────────

/// Parse camera name and start time from a cache filename like:
///   `front_door@20250505120000+0000.mp4`
/// Returns (camera_name, start_time_utc).
pub fn parse_cache_filename(filename: &str) -> Option<(String, DateTime<Utc>)> {
    let stem = filename.strip_suffix(".mp4")?;
    let at_pos = stem.rfind('@')?;
    let camera = stem[..at_pos].to_string();
    let ts_str = &stem[at_pos + 1..];
    let dt = DateTime::parse_from_str(ts_str, "%Y%m%d%H%M%S%z").ok()?;
    Some((camera, dt.with_timezone(&Utc)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cache_filename() {
        let (cam, dt) = parse_cache_filename("front_door@20250505120000+0000.mp4").unwrap();
        assert_eq!(cam, "front_door");
        assert_eq!(dt.format("%Y-%m-%d %H:%M:%S").to_string(), "2025-05-05 12:00:00");
    }

    #[test]
    fn test_should_discard_all_mode() {
        let info = SegmentInfo {
            motion_count: 0,
            active_object_count: 0,
            region_count: 0,
            average_db_fs: 0,
            motion_heatmap: None,
        };
        assert!(!info.should_discard(RetainMode::All));
    }

    #[test]
    fn test_should_discard_motion_mode_no_motion() {
        let info = SegmentInfo {
            motion_count: 0,
            active_object_count: 0,
            region_count: 0,
            average_db_fs: 0,
            motion_heatmap: None,
        };
        assert!(info.should_discard(RetainMode::Motion));
    }

    #[test]
    fn test_should_discard_motion_mode_with_audio() {
        let info = SegmentInfo {
            motion_count: 0,
            active_object_count: 0,
            region_count: 0,
            average_db_fs: -20,
            motion_heatmap: None,
        };
        assert!(!info.should_discard(RetainMode::Motion));
    }

    #[test]
    fn test_should_discard_active_objects() {
        let info = SegmentInfo {
            motion_count: 5,
            active_object_count: 0,
            region_count: 0,
            average_db_fs: 0,
            motion_heatmap: None,
        };
        assert!(info.should_discard(RetainMode::ActiveObjects));
    }
}
