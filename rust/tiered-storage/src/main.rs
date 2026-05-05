mod db_watcher;
mod migrator;
mod policy;
mod tiers;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tiered_storage=info".into()),
        )
        .init();

    info!("tiered-storage starting (not yet implemented)");
    // TODO: load tier config from YAML, start migration loop
    Ok(())
}
