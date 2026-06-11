pub mod discord;
pub mod mqtt;
pub mod s3;
pub mod slack;
pub mod telegram;
pub mod webhook;

use async_trait::async_trait;

/// A delivery target for Frigate events.
///
/// Implementations must be `Send + Sync` so they can be held in a shared
/// `Vec<Box<dyn Sink>>` and called concurrently from the async router.
#[async_trait]
pub trait Sink: Send + Sync {
    /// Short identifier used in logging and DLQ records (e.g. "webhook", "mqtt").
    fn name(&self) -> &str;

    /// Deliver `event` to this sink.
    ///
    /// Returns `Ok(())` on success or an error that will be stored in the DLQ.
    async fn send(&self, event: &crate::subscriber::FrigateEvent) -> anyhow::Result<()>;
}
