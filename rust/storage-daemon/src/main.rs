mod config;
mod db;
mod heatmap;
mod maintainer;
mod cleanup;
mod storage;
mod zmq;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "storage_daemon=info".into()),
        )
        .init();

    info!("storage-daemon starting (not yet implemented)");
    // TODO: load config, start maintainer/cleanup/storage tasks
    Ok(())
}
