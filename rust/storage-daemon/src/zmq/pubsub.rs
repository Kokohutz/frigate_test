use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tracing::{debug, error, warn};

use frigate_common::zmq_types::{SOCKET_PUB, SOCKET_SUB};

/// A parsed detection event from the ZMQ pub/sub proxy.
#[derive(Debug, Clone)]
pub enum DetectionEvent {
    /// detection/video — (camera, frame_name, frame_time, tracked_objects, motion_boxes, regions)
    Video {
        camera: String,
        frame_time: f64,
        tracked_objects: Vec<TrackedObject>,
        motion_boxes: Vec<[i32; 4]>,
        regions: Vec<[i32; 4]>,
    },
    /// detection/audio — (camera, frame_time, dBFS, audio_labels)
    Audio {
        camera: String,
        frame_time: f64,
        db_fs: f64,
        audio_labels: Vec<String>,
    },
}

/// Minimal tracked object fields needed for SegmentInfo.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TrackedObject {
    pub false_positive: bool,
    pub motionless_count: u32,
}

/// Spawns a background thread (not tokio task — ZMQ is not async) that:
/// 1. Connects a SUB socket to ipc:///tmp/cache/proxy_sub
/// 2. Subscribes to "detection/" prefix
/// 3. Parses each message and sends it on `tx`
///
/// Returns the receiver end. Call this once at startup.
pub fn spawn_detection_subscriber(tx: mpsc::Sender<DetectionEvent>) {
    std::thread::spawn(move || {
        let ctx = zmq::Context::new();
        let socket = match ctx.socket(zmq::SUB) {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to create ZMQ SUB socket: {e}");
                return;
            }
        };

        if let Err(e) = socket.connect(SOCKET_SUB) {
            error!("Failed to connect ZMQ SUB to {SOCKET_SUB}: {e}");
            return;
        }

        // Subscribe to all detection subtopics
        if let Err(e) = socket.set_subscribe(b"detection/") {
            error!("Failed to set SUB filter: {e}");
            return;
        }

        tracing::info!("ZMQ detection subscriber connected to {SOCKET_SUB}");

        loop {
            // recv_string blocks until a message arrives (no timeout needed — thread is dedicated)
            match socket.recv_string(0) {
                Ok(Ok(msg)) => {
                    // Wire format: "{topic} {json_payload}" (zmq_proxy.py Publisher.publish)
                    let Some((topic, payload_str)) = msg.split_once(' ') else {
                        warn!("Malformed ZMQ message (no space separator): {msg:?}");
                        continue;
                    };

                    match parse_detection_message(topic, payload_str) {
                        Ok(Some(event)) => {
                            if tx.blocking_send(event).is_err() {
                                // Receiver dropped — main task shut down
                                break;
                            }
                        }
                        Ok(None) => {
                            // Ignored topic (api, lpr, etc.)
                            debug!("Ignoring detection topic: {topic}");
                        }
                        Err(e) => {
                            warn!("Failed to parse detection message on {topic}: {e}");
                        }
                    }
                }
                Ok(Err(bytes)) => {
                    warn!("Received non-UTF8 ZMQ message ({} bytes)", bytes.len());
                }
                Err(e) => {
                    error!("ZMQ recv error: {e}");
                    break;
                }
            }
        }
    });
}

/// Parse a raw "detection/{subtype}" message.
/// Returns None for subtopics we don't care about (api, lpr).
fn parse_detection_message(topic: &str, payload_str: &str) -> Result<Option<DetectionEvent>> {
    let subtype = topic.strip_prefix("detection/").unwrap_or("");

    let payload: serde_json::Value =
        serde_json::from_str(payload_str).context("JSON parse error")?;

    let arr = payload
        .as_array()
        .context("detection payload is not a JSON array")?;

    match subtype {
        "video" => {
            // Payload: [camera, frame_name, frame_time, tracked_objects, motion_boxes, regions]
            if arr.len() < 6 {
                anyhow::bail!("detection/video: expected 6 elements, got {}", arr.len());
            }
            let camera = arr[0]
                .as_str()
                .context("camera is not a string")?
                .to_string();
            // arr[1] is frame_name — we don't use it
            let frame_time = arr[2].as_f64().context("frame_time is not a number")?;

            // tracked_objects: list of dicts, we only need false_positive + motionless_count
            let tracked_objects: Vec<TrackedObject> = arr[3]
                .as_array()
                .context("tracked_objects is not an array")?
                .iter()
                .filter_map(|o| serde_json::from_value(o.clone()).ok())
                .collect();

            // motion_boxes: [[x1,y1,x2,y2], ...]
            let motion_boxes = parse_box_array(&arr[4]).context("motion_boxes parse error")?;

            // regions: [[x1,y1,x2,y2], ...]
            let regions = parse_box_array(&arr[5]).context("regions parse error")?;

            Ok(Some(DetectionEvent::Video {
                camera,
                frame_time,
                tracked_objects,
                motion_boxes,
                regions,
            }))
        }
        "audio" => {
            // Payload: [camera, frame_time, dBFS, audio_labels]
            if arr.len() < 4 {
                anyhow::bail!("detection/audio: expected 4 elements, got {}", arr.len());
            }
            let camera = arr[0]
                .as_str()
                .context("camera is not a string")?
                .to_string();
            let frame_time = arr[1].as_f64().context("frame_time is not a number")?;
            let db_fs = arr[2].as_f64().context("dBFS is not a number")?;
            let audio_labels: Vec<String> = arr[3]
                .as_array()
                .context("audio_labels is not an array")?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();

            Ok(Some(DetectionEvent::Audio {
                camera,
                frame_time,
                db_fs,
                audio_labels,
            }))
        }
        // api, lpr — not relevant to recording maintenance
        _ => Ok(None),
    }
}

/// Parse a JSON value as a list of [x1, y1, x2, y2] integer boxes.
fn parse_box_array(val: &serde_json::Value) -> Result<Vec<[i32; 4]>> {
    let arr = val.as_array().context("expected array")?;
    let mut boxes = Vec::with_capacity(arr.len());
    for item in arr {
        let coords = item.as_array().context("box is not an array")?;
        if coords.len() < 4 {
            anyhow::bail!("box has fewer than 4 elements");
        }
        boxes.push([
            coords[0].as_i64().unwrap_or(0) as i32,
            coords[1].as_i64().unwrap_or(0) as i32,
            coords[2].as_i64().unwrap_or(0) as i32,
            coords[3].as_i64().unwrap_or(0) as i32,
        ]);
    }
    Ok(boxes)
}

/// Publisher for recordings/ topics (used in Phase C).
/// Sends to ipc:///tmp/cache/proxy_pub using the wire format:
///   "{topic} {json_payload}"
#[allow(dead_code)]
pub struct RecordingsPublisher {
    socket: zmq::Socket,
}

#[allow(dead_code)]
impl RecordingsPublisher {
    pub fn new() -> Result<Self> {
        let ctx = zmq::Context::new();
        let socket = ctx.socket(zmq::PUB)?;
        socket.connect(SOCKET_PUB)?;
        // Small sleep to let pub socket register with proxy
        std::thread::sleep(std::time::Duration::from_millis(50));
        Ok(Self { socket })
    }

    /// Publish a recordings/{subtype} message.
    /// payload is serialized to JSON and appended after a space.
    pub fn publish(&self, subtype: &str, payload: &serde_json::Value) -> Result<()> {
        let msg = format!("recordings/{subtype} {}", serde_json::to_string(payload)?);
        self.socket.send(&msg, 0)?;
        Ok(())
    }
}
