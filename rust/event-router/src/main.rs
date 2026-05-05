mod dlq;
mod rate_limiter;
mod router;
mod sinks;
mod subscriber;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "event_router=info".into()),
        )
        .init();

    info!("event-router starting (not yet implemented)");
    // TODO: load event_router: config, subscribe to event/ ZMQ topics,
    //       dispatch to sinks with rate limiting and DLQ
    Ok(())
}
