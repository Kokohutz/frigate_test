mod chain;
mod merge;
mod ort_runner;
mod shm;
mod zmq_server;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "detection_bridge=info".into()),
        )
        .init();

    info!("detection-bridge starting (not yet implemented)");
    // TODO: load detection_bridge: config section, start ZMQ REP server,
    //       load ONNX models, handle inference requests
    Ok(())
}
