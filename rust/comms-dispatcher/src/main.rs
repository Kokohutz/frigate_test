mod db;
mod forwarder;
mod server;

use anyhow::Result;
use tracing::info;

/// comms-dispatcher: Rust ZMQ REP server replacing Python InterProcessCommunicator
/// for the high-volume DB-write IPC topics.
///
/// Activation: set `FRIGATE_RUST_DISPATCHER=1` and start this binary before
/// Frigate. Python's InterProcessCommunicator will then bind its REP socket at
/// `ipc:///tmp/cache/comms_py` instead of `ipc:///tmp/cache/comms`, allowing
/// this daemon to own the primary address while still forwarding unknown topics
/// to Python.
///
/// Env vars:
///   FRIGATE_DB_PATH          — SQLite path (default: /config/frigate.db)
///   FRIGATE_COMMS_PY_ADDR    — Python fallback REP address
///                              (default: ipc:///tmp/cache/comms_py)
///                              Set to "" to disable forwarding entirely.
#[tokio::main]
async fn main() -> Result<()> {
    // Handle --version flag
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--version") {
        println!("comms-dispatcher {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "comms_dispatcher=info".into()),
        )
        .init();

    info!("comms-dispatcher starting");

    let metrics = frigate_common::metrics::MetricsRegistry::new();
    metrics.register_counter(
        "comms_dispatcher_messages_total",
        "Total messages dispatched",
    );
    metrics.register_counter("comms_dispatcher_db_writes_total", "Total SQLite writes");
    metrics.register_gauge(
        "comms_dispatcher_queue_depth",
        "Current message queue depth",
    );
    let metrics_port: u16 = std::env::var("COMMS_DISPATCHER_METRICS_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(9092);
    frigate_common::metrics::spawn_metrics_server(metrics.clone(), metrics_port).await;

    let db_path =
        std::env::var("FRIGATE_DB_PATH").unwrap_or_else(|_| "/config/frigate.db".to_string());

    let python_addr = std::env::var("FRIGATE_COMMS_PY_ADDR")
        .unwrap_or_else(|_| "ipc:///tmp/cache/comms_py".to_string());

    info!(db_path = %db_path, python_fallback = %python_addr, "configuration");

    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();

    // ZMQ loop runs in a dedicated blocking thread — the zmq crate is not async.
    let db_path_clone = db_path.clone();
    let python_addr_clone = python_addr.clone();
    let server_handle = std::thread::spawn(move || {
        if let Err(e) = server::run(&db_path_clone, &python_addr_clone, shutdown_rx) {
            tracing::error!("REP server exited with error: {e:#}");
        }
    });

    shutdown_signal().await;
    info!("shutdown signal received");

    // Signal the server thread to exit its recv loop.
    let _ = shutdown_tx.send(());
    server_handle.join().ok();

    info!("comms-dispatcher stopped");
    Ok(())
}

/// Wait for SIGINT (Ctrl-C) or SIGTERM (docker stop).
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
