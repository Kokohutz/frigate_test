//! ZMQ socket retry / reconnect helpers shared across all Argus Rust daemons.

use anyhow::Result;
use std::time::Duration;
use tracing::{error, info, warn};
use zmq::Context;

/// Reconnect policy for a ZMQ socket.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Initial backoff duration.
    pub initial_backoff: Duration,
    /// Maximum backoff duration (exponential backoff caps here).
    pub max_backoff: Duration,
    /// Maximum total attempts before giving up (0 = retry forever).
    pub max_attempts: u32,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            initial_backoff: Duration::from_millis(250),
            max_backoff: Duration::from_secs(30),
            max_attempts: 0, // retry forever
        }
    }
}

/// Connect a ZMQ socket with exponential backoff.
/// Returns the connected socket or an error if max_attempts exceeded.
pub fn connect_with_retry(
    ctx: &Context,
    socket_type: zmq::SocketType,
    addr: &str,
    policy: &RetryPolicy,
) -> Result<zmq::Socket> {
    let mut backoff = policy.initial_backoff;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match ctx.socket(socket_type) {
            Ok(sock) => {
                if sock.connect(addr).is_ok() {
                    if attempt > 1 {
                        info!(addr, attempt, "ZMQ socket connected after retries");
                    }
                    return Ok(sock);
                }
            }
            Err(e) => {
                warn!(addr, attempt, error = %e, "ZMQ socket connect failed");
            }
        }
        if policy.max_attempts > 0 && attempt >= policy.max_attempts {
            return Err(anyhow::anyhow!(
                "ZMQ connect to {addr} failed after {attempt} attempts"
            ));
        }
        std::thread::sleep(backoff);
        backoff = (backoff * 2).min(policy.max_backoff);
    }
}

/// Reconnect a REQ socket after a failed send/recv cycle.
/// REQ sockets must be recreated (not just reconnected) after an error.
pub fn reconnect_req(ctx: &Context, addr: &str, policy: &RetryPolicy) -> Result<zmq::Socket> {
    error!(addr, "REQ socket error — reconnecting with backoff");
    connect_with_retry(ctx, zmq::REQ, addr, policy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_policy_default_is_forever() {
        let p = RetryPolicy::default();
        assert_eq!(p.max_attempts, 0);
        assert!(p.initial_backoff < p.max_backoff);
    }
}
