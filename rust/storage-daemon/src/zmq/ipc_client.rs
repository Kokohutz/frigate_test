use anyhow::{Context, Result};
use tracing::{debug, warn};

use frigate_common::zmq_types::{RecordingInsert, SOCKET_REP_REQ, TOPIC_INSERT_MANY_RECORDINGS};

/// REQ socket client for ipc:///tmp/cache/comms.
/// Used in Phase C (full recording maintainer cutover).
///
/// Wire protocol (inter_process.py):
///   send: socket.send_json(["topic_name", data])   — JSON 2-tuple
///   recv: socket.recv_json()                        — any JSON (must always recv)
///
/// Reconnects on any error: the ZMQ REQ state machine requires a fresh socket
/// after any failure (cannot recv after a failed send, etc.).
pub struct IpcClient {
    ctx: zmq::Context,
    socket: zmq::Socket,
}

impl IpcClient {
    pub fn new() -> Result<Self> {
        let ctx = zmq::Context::new();
        let socket = Self::make_socket(&ctx)?;
        Ok(Self { ctx, socket })
    }

    fn make_socket(ctx: &zmq::Context) -> Result<zmq::Socket> {
        let socket = ctx.socket(zmq::REQ)?;
        socket.set_linger(0)?;
        socket.set_sndtimeo(5000)?; // 5 s send timeout
        socket.set_rcvtimeo(5000)?; // 5 s recv timeout
        socket.connect(SOCKET_REP_REQ)?;
        Ok(socket)
    }

    fn reconnect(&mut self) {
        warn!("Reconnecting ZMQ REQ socket");
        // Drop old socket — close with linger=0
        drop(std::mem::replace(
            &mut self.socket,
            self.ctx.socket(zmq::REQ).expect("zmq socket alloc"),
        ));
        match Self::make_socket(&self.ctx) {
            Ok(s) => self.socket = s,
            Err(e) => warn!("Reconnect failed: {e}"),
        }
    }

    /// Send INSERT_MANY_RECORDINGS to the Python dispatcher.
    /// Always reconnects on error (REQ state machine requirement).
    pub fn insert_recordings(&mut self, recordings: &[RecordingInsert]) -> Result<()> {
        let payload = serde_json::json!([TOPIC_INSERT_MANY_RECORDINGS, recordings]);
        let msg = serde_json::to_string(&payload)?;

        if let Err(e) = self.socket.send(msg.as_bytes(), 0) {
            warn!("ZMQ send failed: {e}");
            self.reconnect();
            return Err(e.into());
        }

        // Must always recv after send (REP state machine)
        match self.socket.recv_bytes(0) {
            Ok(bytes) => {
                debug!("INSERT_MANY_RECORDINGS ack: {} bytes", bytes.len());
                Ok(())
            }
            Err(e) => {
                warn!("ZMQ recv failed: {e}");
                self.reconnect();
                Err(e).context("ZMQ recv after INSERT_MANY_RECORDINGS")
            }
        }
    }
}
