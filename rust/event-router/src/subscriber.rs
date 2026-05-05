use tokio::sync::mpsc;
use tracing::{debug, error, warn};

use frigate_common::zmq_types::SOCKET_SUB;

/// A parsed Frigate event from the ZMQ event/ pub/sub topics.
#[derive(Debug, Clone)]
pub struct FrigateEvent {
    pub topic: String, // "event/update" or "event/finalized"
    pub camera: String,
    pub event_id: Option<String>,
    pub event_type: String,  // "object", "audio"
    pub event_state: String, // "new", "update", "end"
    pub payload: serde_json::Value,
}

/// Spawn a background thread (ZMQ is not async) that subscribes to event/ topics.
///
/// Wire format: `"{topic} {json_payload}"` (single space separator)
///
/// Topics:
///   event/update    → [event_type, event_state, event_id_or_null, camera, data_dict]
///   event/finalized → [event_type, event_state, event_id, data_dict]
pub fn spawn_event_subscriber(tx: mpsc::Sender<FrigateEvent>) {
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

        if let Err(e) = socket.set_subscribe(b"event/") {
            error!("Failed to set SUB filter: {e}");
            return;
        }

        tracing::info!("ZMQ event subscriber connected to {SOCKET_SUB}");

        loop {
            match socket.recv_string(0) {
                Ok(Ok(msg)) => {
                    let Some((topic, payload_str)) = msg.split_once(' ') else {
                        warn!("Malformed ZMQ message (no space separator): {msg:?}");
                        continue;
                    };

                    match parse_event_message(topic, payload_str) {
                        Ok(Some(event)) => {
                            if tx.blocking_send(event).is_err() {
                                // Receiver dropped — main task shut down
                                break;
                            }
                        }
                        Ok(None) => {
                            debug!("Ignoring unknown event topic: {topic}");
                        }
                        Err(e) => {
                            warn!("Failed to parse event message on {topic}: {e}");
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

/// Parse a raw "event/{subtype}" message into a FrigateEvent.
/// Returns None for unrecognised subtopics.
fn parse_event_message(topic: &str, payload_str: &str) -> anyhow::Result<Option<FrigateEvent>> {
    use anyhow::Context;

    let subtype = topic.strip_prefix("event/").unwrap_or("");
    if subtype != "update" && subtype != "finalized" {
        return Ok(None);
    }

    let payload: serde_json::Value =
        serde_json::from_str(payload_str).context("JSON parse error")?;

    let arr = payload
        .as_array()
        .context("event payload is not a JSON array")?;

    // event/update    → [event_type, event_state, event_id_or_null, camera, data_dict]
    // event/finalized → [event_type, event_state, event_id,         data_dict]
    if arr.len() < 4 {
        anyhow::bail!("{topic}: expected at least 4 elements, got {}", arr.len());
    }

    let event_type = arr[0]
        .as_str()
        .context("event_type is not a string")?
        .to_string();
    let event_state = arr[1]
        .as_str()
        .context("event_state is not a string")?
        .to_string();

    let (event_id, camera) = if subtype == "update" {
        // index 2 = event_id | null, index 3 = camera
        let id = arr[2].as_str().map(str::to_string);
        let cam = arr[3]
            .as_str()
            .context("camera is not a string")?
            .to_string();
        (id, cam)
    } else {
        // event/finalized: index 2 = event_id (never null), index 3 = data_dict
        // camera field may be inside data_dict
        let id = arr[2].as_str().map(str::to_string);
        let cam = arr[3]
            .get("camera")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        (id, cam)
    };

    Ok(Some(FrigateEvent {
        topic: topic.to_string(),
        camera,
        event_id,
        event_type,
        event_state,
        payload,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_update_payload(
        event_type: &str,
        event_state: &str,
        event_id: Option<&str>,
        camera: &str,
    ) -> String {
        let id_val = match event_id {
            Some(id) => format!("\"{}\"", id),
            None => "null".to_string(),
        };
        format!(
            "[\"{}\", \"{}\", {}, \"{}\", {{}}]",
            event_type, event_state, id_val, camera
        )
    }

    fn make_finalized_payload(event_type: &str, event_state: &str, event_id: &str) -> String {
        format!(
            "[\"{}\", \"{}\", \"{}\", {{\"camera\": \"front\"}}]",
            event_type, event_state, event_id
        )
    }

    #[test]
    fn test_parse_event_update_with_id() {
        let payload = make_update_payload("object", "update", Some("abc123"), "front_door");
        let event = parse_event_message("event/update", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(event.topic, "event/update");
        assert_eq!(event.event_type, "object");
        assert_eq!(event.event_state, "update");
        assert_eq!(event.event_id, Some("abc123".to_string()));
        assert_eq!(event.camera, "front_door");
    }

    #[test]
    fn test_parse_event_update_null_id() {
        let payload = make_update_payload("audio", "new", None, "backyard");
        let event = parse_event_message("event/update", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(event.event_id, None);
        assert_eq!(event.camera, "backyard");
    }

    #[test]
    fn test_parse_event_finalized() {
        let payload = make_finalized_payload("object", "end", "xyz789");
        let event = parse_event_message("event/finalized", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(event.topic, "event/finalized");
        assert_eq!(event.event_id, Some("xyz789".to_string()));
        assert_eq!(event.camera, "front");
    }

    #[test]
    fn test_unknown_topic_returns_none() {
        let result = parse_event_message("event/unknown", "[\"a\",\"b\",\"c\",\"d\"]").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_malformed_payload_returns_err() {
        let result = parse_event_message("event/update", "not json");
        assert!(result.is_err());
    }
}
