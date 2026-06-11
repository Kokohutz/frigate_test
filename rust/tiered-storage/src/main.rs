mod db_watcher;
mod migrator;
mod policy;
mod tiers;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Handle --version flag
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--version") {
        println!("tiered-storage {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tiered_storage=info".into()),
        )
        .init();

    let metrics = frigate_common::metrics::MetricsRegistry::new();
    metrics.register_counter(
        "tiered_storage_migrations_total",
        "Total segment migrations hot→cold",
    );
    metrics.register_gauge("tiered_storage_hot_bytes", "Bytes currently in hot tier");
    metrics.register_gauge("tiered_storage_cold_bytes", "Bytes currently in cold tier");
    let metrics_port: u16 = std::env::var("TIERED_STORAGE_METRICS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(9094);
    frigate_common::metrics::spawn_metrics_server(metrics.clone(), metrics_port).await;

    // 1. Load tier config from YAML or env vars.
    let config_file = tiers::config_file_path();
    let tier_config = tiers::TierConfig::from_yaml_or_env(&config_file)?;

    info!(
        hot_path = %tier_config.hot.path.display(),
        hot_max_days = tier_config.hot.max_days,
        hot_max_gb = tier_config.hot.max_gb,
        cold_path = %tier_config.cold.path.display(),
        cold_max_days = tier_config.cold.max_days,
        migration_interval_secs = tier_config.policy.migration_interval,
        "tiered-storage starting"
    );

    // 2. Open DB connection with WAL pragmas.
    let db_path = tiers::db_path();
    let conn = db_watcher::open(&db_path).await?;

    // 3. Loop every migration_interval seconds, running a full migration sweep.
    let interval = tokio::time::Duration::from_secs(tier_config.policy.migration_interval);
    let mut ticker = tokio::time::interval(interval);
    // The first tick fires immediately — that's intentional (run on startup).

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock is before Unix epoch")
                    .as_secs_f64();

                match migrator::run_migration_sweep(&conn, &tier_config, now).await {
                    Ok(result) => {
                        info!(
                            migrated = result.migrated,
                            failed   = result.failed,
                            bytes_moved = result.bytes_moved,
                            "sweep finished"
                        );
                    }
                    Err(e) => {
                        tracing::error!("migration sweep error: {e:#}");
                    }
                }
            }

            // 4. Graceful shutdown on SIGINT or SIGTERM (docker stop).
            _ = shutdown_signal() => {
                info!("shutdown signal received, exiting");
                break;
            }
        }
    }

    Ok(())
}

/// Wait for SIGINT (Ctrl-C) or SIGTERM (docker stop).
/// Docker sends SIGTERM to the main process on `docker stop`, so handling it
/// allows the daemon to flush and exit cleanly within the grace period.
async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };

    #[cfg(unix)]
    {
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {}
            _ = sigterm.recv() => {}
        }
    }
    #[cfg(not(unix))]
    ctrl_c.await;
}
