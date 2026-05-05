use anyhow::Result;
use tracing::{debug, error, info, warn};

use crate::db;
use crate::forwarder::Forwarder;

/// Run the REP server loop in a blocking thread.
///
/// Binds ZMQ REP at `ipc:///tmp/cache/comms`, receives `["topic", payload]` JSON
/// messages, dispatches to native DB handlers or forwards to the Python fallback,
/// and sends back the reply.
///
/// Exits when a message arrives on `shutdown`.
pub fn run(
    db_path: &str,
    python_addr: &str,
    shutdown: std::sync::mpsc::Receiver<()>,
) -> Result<()> {
    let conn = db::open(db_path)?;
    let mut forwarder = Forwarder::new(python_addr)?;

    let ctx = zmq::Context::new();
    let rep = ctx.socket(zmq::REP)?;
    rep.set_linger(0)?;
    rep.set_rcvtimeo(1000)?; // 1 s poll — lets us check shutdown flag
    rep.bind("ipc:///tmp/cache/comms")?;

    info!("ZMQ REP bound at ipc:///tmp/cache/comms");

    loop {
        if shutdown.try_recv().is_ok() {
            info!("shutdown signal received, stopping REP loop");
            break;
        }

        let msg = match rep.recv_bytes(0) {
            Ok(b) => b,
            Err(zmq::Error::EAGAIN) => continue, // 1 s timeout elapsed, re-check shutdown
            Err(e) => return Err(e.into()),
        };

        let reply = dispatch(&conn, &mut forwarder, &msg);

        if let Err(e) = rep.send(&reply, 0) {
            error!("REP send failed: {e}");
            // Cannot recover REP state machine after a failed send — rebind.
            return Err(e.into());
        }
    }

    Ok(())
}

fn dispatch(conn: &rusqlite::Connection, forwarder: &mut Forwarder, msg: &[u8]) -> Vec<u8> {
    let raw: serde_json::Value = match serde_json::from_slice(msg) {
        Ok(v) => v,
        Err(e) => {
            warn!("bad JSON from REQ client: {e}");
            return b"[]".to_vec();
        }
    };

    let arr = match raw.as_array() {
        Some(a) if a.len() == 2 => a,
        _ => {
            warn!("expected [topic, payload] 2-element array");
            return b"[]".to_vec();
        }
    };

    let topic = match arr[0].as_str() {
        Some(s) => s,
        None => {
            warn!("topic is not a string");
            return b"[]".to_vec();
        }
    };
    let payload = &arr[1];

    debug!(topic, "dispatching");

    let result = match topic {
        "insert_many_recordings" => db::insert_many_recordings(conn, payload),
        "insert_preview" => db::insert_preview(conn, payload),
        "upsert_review_segment" => db::upsert_review_segment(conn, payload),
        "clear_ongoing_review_segments" => db::clear_ongoing_review_segments(conn),
        other => {
            debug!(topic = other, "forwarding to Python fallback");
            forwarder.forward(msg)
        }
    };

    match result {
        Ok(reply) => reply,
        Err(e) => {
            error!(topic, "handler error: {e:#}");
            b"[]".to_vec()
        }
    }
}
