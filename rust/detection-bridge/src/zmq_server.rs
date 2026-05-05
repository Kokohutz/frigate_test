// ZMQ REP server implementing the ZmqIpcDetector wire protocol.
// (frigate/detectors/plugins/zmq_ipc.py defines the exact protocol)
//
// Listens at: ipc:///tmp/cache/zmq_detector
//
// Request (Python → Rust):
//   Multipart: [header_json_bytes, tensor_bytes]
//   header: {"shape": [1,H,W,3], "dtype": "uint8", "model_type": "yolox"}
//   tensor_bytes: raw C-order uint8 bytes of shape (1, H, W, 3)
//
// Response (Rust → Python):
//   Multipart: [header_json_bytes, result_bytes]
//   header: {"shape": [20, 6], "dtype": "float32"}
//   result_bytes: 480 bytes (20×6 float32, C-order)
//   Columns: [class_id, confidence, y_min, x_min, y_max, x_max] all in [0,1]
//
// Model management (no tensor frame):
//   Request:  [{"model_request": true, "model_name": "yolov8n.onnx"}]
//   Response: {"model_available": true, "model_loaded": true}
//          or {"model_available": false}  → Python will upload model bytes
//
//   Request:  [{"model_data": true, "model_name": "..."}, <model_bytes>]
//   Response: {"model_saved": true, "model_loaded": true}

use anyhow::Result;
use serde_json::Value;
use tracing::{debug, error, info, warn};

pub const SOCKET_DETECTOR: &str = "ipc:///tmp/cache/zmq_detector";

/// Maximum number of detections in a single response frame.
pub const MAX_DETECTIONS: usize = 20;
/// Number of values per detection: [class_id, confidence, y_min, x_min, y_max, x_max]
pub const DETECTION_COLS: usize = 6;
/// Total bytes in a result tensor: 20 * 6 * 4 (float32)
pub const RESULT_BYTES: usize = MAX_DETECTIONS * DETECTION_COLS * 4;

/// Build the 20×6 result byte buffer from detection rows.
/// Pads unused rows with zeros. Truncates to MAX_DETECTIONS.
pub fn build_result_bytes(detections: &[[f32; 6]]) -> Vec<u8> {
    let mut buf = vec![0u8; RESULT_BYTES];
    let count = detections.len().min(MAX_DETECTIONS);
    for (i, row) in detections[..count].iter().enumerate() {
        for (j, val) in row.iter().enumerate() {
            let offset = (i * DETECTION_COLS + j) * 4;
            buf[offset..offset + 4].copy_from_slice(&val.to_le_bytes());
        }
    }
    buf
}

/// Build the response header JSON bytes.
fn build_response_header(count: usize) -> Vec<u8> {
    let h = serde_json::json!({
        "shape": [MAX_DETECTIONS, DETECTION_COLS],
        "dtype": "float32",
        "count": count
    });
    h.to_string().into_bytes()
}

/// Empty response — used on any error to keep the REP state machine valid.
fn empty_response() -> (Vec<u8>, Vec<u8>) {
    (build_response_header(0), vec![0u8; RESULT_BYTES])
}

/// Run the REP server loop. Calls `handler` for each inference request.
///
/// `handler`: fn(width, height, tensor_bytes) -> Result<Vec<[f32;6]>>
///
/// Returns at most MAX_DETECTIONS per frame. Pads with zeros to MAX_DETECTIONS rows.
/// Blocks indefinitely — call from a dedicated thread.
pub fn run_server<F>(socket_addr: &str, handler: F) -> Result<()>
where
    F: Fn(u32, u32, &[u8]) -> Result<Vec<[f32; 6]>>,
{
    info!("detection-bridge: binding REP socket to {socket_addr}");
    let ctx = zmq::Context::new();
    let socket = ctx.socket(zmq::REP)?;
    socket.bind(socket_addr)?;
    info!("detection-bridge: REP socket bound, ready for requests");

    loop {
        let frames = match socket.recv_multipart(0) {
            Ok(f) => f,
            Err(e) => {
                error!("detection-bridge: recv_multipart error: {e}");
                // REP socket: must send before we can recv again.
                let (hdr, body) = empty_response();
                if let Err(e2) = socket.send_multipart(&[hdr, body], 0) {
                    error!("detection-bridge: failed to send error response: {e2}");
                }
                continue;
            }
        };

        if frames.is_empty() {
            warn!("detection-bridge: received empty multipart message");
            let (hdr, body) = empty_response();
            let _ = socket.send_multipart(&[hdr, body], 0);
            continue;
        }

        // Parse the header JSON.
        let header: Value = match serde_json::from_slice(&frames[0]) {
            Ok(v) => v,
            Err(e) => {
                warn!("detection-bridge: failed to parse request header JSON: {e}");
                let (hdr, body) = empty_response();
                let _ = socket.send_multipart(&[hdr, body], 0);
                continue;
            }
        };

        // --- Model management: model_request ---
        if header
            .get("model_request")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let model_name = header
                .get("model_name")
                .and_then(Value::as_str)
                .unwrap_or("");
            debug!("detection-bridge: model_request for '{model_name}'");
            // Stub: report model not available so Python will upload it.
            let resp = serde_json::json!({
                "model_available": false,
                "model_loaded": false
            });
            let resp_bytes = resp.to_string().into_bytes();
            if let Err(e) = socket.send_multipart(&[resp_bytes], 0) {
                error!("detection-bridge: failed to send model_request response: {e}");
            }
            continue;
        }

        // --- Model management: model_data upload ---
        if header
            .get("model_data")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let model_name = header
                .get("model_name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let model_bytes = frames.get(1).map(|b| b.len()).unwrap_or(0);
            info!(
                "detection-bridge: received model_data for '{model_name}' ({model_bytes} bytes) — stub, not loading"
            );
            // Stub: acknowledge but don't actually load.
            let resp = serde_json::json!({
                "model_saved": false,
                "model_loaded": false
            });
            let resp_bytes = resp.to_string().into_bytes();
            if let Err(e) = socket.send_multipart(&[resp_bytes], 0) {
                error!("detection-bridge: failed to send model_data response: {e}");
            }
            continue;
        }

        // --- Inference request ---
        // Header must have "shape": [1, H, W, 3]
        let shape = header.get("shape").and_then(Value::as_array);
        let (width, height) = match shape {
            Some(s) if s.len() == 4 => {
                // shape = [batch, H, W, channels]
                let h = s[1].as_u64().unwrap_or(0) as u32;
                let w = s[2].as_u64().unwrap_or(0) as u32;
                (w, h)
            }
            _ => {
                // Fallback: try explicit width/height keys
                let w = header.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
                let h = header.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
                (w, h)
            }
        };

        if frames.len() < 2 {
            warn!("detection-bridge: inference request missing tensor frame");
            let (hdr, body) = empty_response();
            let _ = socket.send_multipart(&[hdr, body], 0);
            continue;
        }

        let tensor_bytes = &frames[1];
        debug!(
            "detection-bridge: inference request {}x{}, tensor {} bytes",
            width,
            height,
            tensor_bytes.len()
        );

        let detections = match handler(width, height, tensor_bytes) {
            Ok(d) => d,
            Err(e) => {
                error!("detection-bridge: handler error: {e}");
                vec![]
            }
        };

        let count = detections.len().min(MAX_DETECTIONS);
        let result_bytes = build_result_bytes(&detections);
        let resp_header = build_response_header(count);

        if let Err(e) = socket.send_multipart(&[resp_header, result_bytes], 0) {
            error!("detection-bridge: failed to send inference response: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_bytes_length_is_480() {
        let detections: Vec<[f32; 6]> = vec![];
        let buf = build_result_bytes(&detections);
        assert_eq!(buf.len(), RESULT_BYTES);
        assert_eq!(RESULT_BYTES, 480);
    }

    #[test]
    fn result_bytes_encodes_one_detection() {
        let det = [1.0_f32, 0.9, 0.1, 0.2, 0.8, 0.9];
        let buf = build_result_bytes(&[det]);
        assert_eq!(buf.len(), 480);

        // Verify first detection is encoded correctly in LE bytes.
        let expected_vals = [1.0_f32, 0.9, 0.1, 0.2, 0.8, 0.9];
        for (i, &expected) in expected_vals.iter().enumerate() {
            let offset = i * 4;
            let actual = f32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap());
            assert!(
                (actual - expected).abs() < 1e-6,
                "col {i}: expected {expected}, got {actual}"
            );
        }

        // Verify padding: row 1 onwards should be zero.
        for byte in &buf[24..] {
            assert_eq!(*byte, 0, "padding bytes should be zero");
        }
    }

    #[test]
    fn result_bytes_truncates_at_20() {
        // Build 25 detections — only first 20 should be encoded.
        let detections: Vec<[f32; 6]> = (0..25)
            .map(|i| [i as f32, 0.5, 0.0, 0.0, 1.0, 1.0])
            .collect();
        let buf = build_result_bytes(&detections);
        assert_eq!(buf.len(), 480);

        // Row 20+ should be zero (only 20 rows in output).
        // Row 19 class_id should be 19.0.
        let offset = 19 * DETECTION_COLS * 4;
        let val = f32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap());
        assert!((val - 19.0).abs() < 1e-6);
    }

    #[test]
    fn result_bytes_all_zeros_for_empty() {
        let buf = build_result_bytes(&[]);
        assert!(buf.iter().all(|&b| b == 0));
    }

    #[test]
    fn response_header_contains_shape() {
        let hdr_bytes = build_response_header(3);
        let v: serde_json::Value = serde_json::from_slice(&hdr_bytes).unwrap();
        assert_eq!(v["count"], 3);
        assert_eq!(v["shape"][0], 20);
        assert_eq!(v["shape"][1], 6);
        assert_eq!(v["dtype"], "float32");
    }
}
