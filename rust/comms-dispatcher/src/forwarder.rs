use anyhow::Result;
use tracing::warn;

/// REQ socket client that forwards unknown topics to the Python fallback REP.
///
/// The Python InterProcessCommunicator binds at `ipc:///tmp/cache/comms_py` when
/// `FRIGATE_RUST_DISPATCHER=1`. We connect here and relay any message that the
/// Rust dispatcher does not handle natively.
///
/// ZMQ REQ/REP state machine: must always recv after send. Reconnect the socket
/// on any error to avoid leaving it in a mid-state.
pub struct Forwarder {
    ctx: zmq::Context,
    socket: zmq::Socket,
    addr: String,
    enabled: bool,
}

impl Forwarder {
    /// Create a forwarder. If `addr` is empty the forwarder is disabled and
    /// `forward()` returns an empty JSON array reply for all calls.
    pub fn new(addr: &str) -> Result<Self> {
        if addr.is_empty() {
            return Ok(Self {
                ctx: zmq::Context::new(),
                socket: zmq::Context::new().socket(zmq::REQ)?,
                addr: String::new(),
                enabled: false,
            });
        }

        let ctx = zmq::Context::new();
        let socket = Self::connect(&ctx, addr)?;
        Ok(Self {
            ctx,
            socket,
            addr: addr.to_string(),
            enabled: true,
        })
    }

    fn connect(ctx: &zmq::Context, addr: &str) -> Result<zmq::Socket> {
        let s = ctx.socket(zmq::REQ)?;
        s.set_linger(0)?;
        s.set_sndtimeo(5000)?;
        s.set_rcvtimeo(5000)?;
        s.connect(addr)?;
        Ok(s)
    }

    fn reconnect(&mut self) {
        warn!("Reconnecting forwarder REQ socket to {}", self.addr);
        drop(std::mem::replace(
            &mut self.socket,
            self.ctx.socket(zmq::REQ).expect("zmq socket alloc"),
        ));
        match Self::connect(&self.ctx, &self.addr) {
            Ok(s) => self.socket = s,
            Err(e) => warn!("Forwarder reconnect failed: {e}"),
        }
    }

    /// Forward raw message bytes to the Python fallback and return its reply.
    /// Returns `b"[]"` if the forwarder is disabled.
    pub fn forward(&mut self, msg: &[u8]) -> Result<Vec<u8>> {
        if !self.enabled {
            return Ok(b"[]".to_vec());
        }

        if let Err(e) = self.socket.send(msg, 0) {
            warn!("Forwarder send failed: {e}");
            self.reconnect();
            return Err(e.into());
        }

        match self.socket.recv_bytes(0) {
            Ok(reply) => Ok(reply),
            Err(e) => {
                warn!("Forwarder recv failed: {e}");
                self.reconnect();
                Err(e.into())
            }
        }
    }
}
