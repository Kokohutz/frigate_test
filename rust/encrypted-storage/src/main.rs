mod cipher;
mod file_format;
mod http_server;
mod kdf;

use anyhow::{bail, Result};
use std::path::PathBuf;
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<()> {
    // Handle --version flag
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--version") {
        println!("encrypted-storage {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "encrypted_storage=info".into()),
        )
        .init();

    // Read required STORAGE_ENCRYPTION_KEY env var
    let passphrase = match std::env::var("STORAGE_ENCRYPTION_KEY") {
        Ok(v) if !v.is_empty() => v,
        Ok(_) => {
            error!("STORAGE_ENCRYPTION_KEY is set but empty");
            bail!("STORAGE_ENCRYPTION_KEY must not be empty");
        }
        Err(_) => {
            error!("STORAGE_ENCRYPTION_KEY environment variable is required");
            bail!("STORAGE_ENCRYPTION_KEY environment variable is required");
        }
    };

    // Optional env vars with defaults
    let record_dir = PathBuf::from(
        std::env::var("FRIGATE_RECORD_DIR")
            .unwrap_or_else(|_| "/media/frigate/recordings".to_string()),
    );
    let bind_addr =
        std::env::var("ENCRYPTED_STORAGE_BIND").unwrap_or_else(|_| "127.0.0.1:5002".to_string());

    let metrics = frigate_common::metrics::MetricsRegistry::new();
    metrics.register_counter(
        "encrypted_storage_decrypt_requests_total",
        "Total decrypt requests",
    );
    metrics.register_counter(
        "encrypted_storage_encrypt_writes_total",
        "Total files encrypted",
    );
    metrics.register_gauge(
        "encrypted_storage_encrypted_files_total",
        "Total encrypted files on disk",
    );
    let metrics_port: u16 = std::env::var("ENCRYPTED_STORAGE_METRICS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(9093);
    frigate_common::metrics::spawn_metrics_server(metrics.clone(), metrics_port).await;

    info!("encrypted-storage starting");
    info!("Record directory: {}", record_dir.display());
    info!("Bind address: {}", bind_addr);

    // Derive 32-byte key from passphrase using Argon2id
    info!("Deriving encryption key...");
    let key = kdf::derive_key(&passphrase)?;
    info!("Key derived successfully");

    // Compute key_id = SHA-256(key)
    let key_id = kdf::key_id(&key);

    // Select cipher (AES-256-GCM on x86_64, ChaCha20-Poly1305 elsewhere)
    let cipher = cipher::select_cipher(&key);

    // Run HTTP server
    http_server::run_server(&bind_addr, record_dir, cipher, key_id).await
}
