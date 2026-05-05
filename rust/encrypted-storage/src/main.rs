mod cipher;
mod file_format;
mod http_server;
mod kdf;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "encrypted_storage=info".into()),
        )
        .init();

    info!("encrypted-storage starting (not yet implemented)");
    // TODO: load key from STORAGE_ENCRYPTION_KEY env var,
    //       derive with Argon2id, start hyper HTTP server for range decrypt
    Ok(())
}
