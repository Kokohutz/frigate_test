use tracing::{debug, info, warn};

use crate::dlq::DeadLetterQueue;
use crate::rate_limiter::EventRateLimiter;
use crate::sinks::Sink;
use crate::subscriber::FrigateEvent;

/// Fan-out router that delivers events to all configured sinks.
///
/// Per-camera rate limiting is applied before dispatch. Failed deliveries
/// are written to the dead-letter queue for later retry.
pub struct Router {
    sinks: Vec<Box<dyn Sink>>,
    rate_limiter: EventRateLimiter,
    dlq: DeadLetterQueue,
}

impl Router {
    pub fn new(
        sinks: Vec<Box<dyn Sink>>,
        rate_limiter: EventRateLimiter,
        dlq: DeadLetterQueue,
    ) -> Self {
        Self {
            sinks,
            rate_limiter,
            dlq,
        }
    }

    /// Route an event to all sinks.
    ///
    /// If the per-camera rate limit is exceeded the event is silently dropped.
    /// Each sink is tried independently — a failure in one does not prevent
    /// delivery to others. Failed deliveries are stored in the DLQ.
    pub async fn route(&self, event: &FrigateEvent) {
        if !self.rate_limiter.allow(&event.camera) {
            debug!(
                "Rate limit exceeded for camera={} — dropping event",
                event.camera
            );
            return;
        }

        let event_json = match serde_json::to_string(&event.payload) {
            Ok(j) => j,
            Err(e) => {
                warn!("Failed to serialise event payload for DLQ: {e}");
                return;
            }
        };

        for sink in &self.sinks {
            match sink.send(event).await {
                Ok(()) => {
                    debug!(
                        "Delivered {}/{} to sink={}",
                        event.camera,
                        event.event_state,
                        sink.name()
                    );
                }
                Err(e) => {
                    warn!(
                        "Sink {} failed for camera={}: {e}",
                        sink.name(),
                        event.camera
                    );
                    if let Err(dlq_err) = self
                        .dlq
                        .push(&event_json, sink.name(), &e.to_string())
                        .await
                    {
                        warn!("Failed to write to DLQ: {dlq_err}");
                    }
                }
            }
        }
    }

    /// Retry any DLQ entries that are past their `next_retry_at` timestamp.
    ///
    /// Successful retries are deleted. Failed retries update the attempt count
    /// and schedule the next attempt with exponential back-off:
    ///   `next_retry = now + min(attempt² × 60, 3600)` seconds.
    pub async fn retry_dlq(&self, now: f64) {
        let entries = match self.dlq.pop_due(now).await {
            Ok(e) => e,
            Err(e) => {
                warn!("DLQ pop_due failed: {e}");
                return;
            }
        };

        if entries.is_empty() {
            return;
        }

        info!("DLQ retry: {} entries due", entries.len());

        for entry in entries {
            // Find the matching sink by name
            let sink = self.sinks.iter().find(|s| s.name() == entry.sink);
            let Some(sink) = sink else {
                // Sink no longer configured — delete the entry
                warn!(
                    "DLQ entry {} references unknown sink '{}' — removing",
                    entry.id, entry.sink
                );
                let _ = self.dlq.delete(entry.id).await;
                continue;
            };

            // Re-parse event from stored JSON
            let event_payload: serde_json::Value = match serde_json::from_str(&entry.event_json) {
                Ok(v) => v,
                Err(e) => {
                    warn!(
                        "DLQ entry {} has unparseable JSON: {e} — removing",
                        entry.id
                    );
                    let _ = self.dlq.delete(entry.id).await;
                    continue;
                }
            };

            // Reconstruct a minimal FrigateEvent for retry
            let retry_event = FrigateEvent {
                topic: "dlq/retry".to_string(),
                camera: String::new(),
                event_id: None,
                event_type: String::new(),
                event_state: String::new(),
                payload: event_payload,
            };

            match sink.send(&retry_event).await {
                Ok(()) => {
                    info!(
                        "DLQ retry succeeded for id={} sink={}",
                        entry.id, entry.sink
                    );
                    let _ = self.dlq.delete(entry.id).await;
                }
                Err(e) => {
                    let backoff = compute_backoff(entry.attempt_count + 1);
                    let next_retry = now + backoff;
                    warn!(
                        "DLQ retry failed for id={} sink={}: {e}; next in {:.0}s",
                        entry.id, entry.sink, backoff
                    );
                    let _ = self.dlq.increment_retry(entry.id, next_retry).await;
                }
            }
        }
    }
}

/// Exponential back-off: `min(attempt² × 60, 3600)` seconds.
fn compute_backoff(attempt: i64) -> f64 {
    let secs = (attempt * attempt * 60).min(3600);
    secs as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_backoff() {
        assert_eq!(compute_backoff(1), 60.0);
        assert_eq!(compute_backoff(2), 240.0);
        assert_eq!(compute_backoff(3), 540.0);
        // Should cap at 3600
        assert_eq!(compute_backoff(10), 3600.0);
        assert_eq!(compute_backoff(100), 3600.0);
    }
}
