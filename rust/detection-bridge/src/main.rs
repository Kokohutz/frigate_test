// detection-bridge: Multi-model ONNX inference chain.
// Implements the ZmqIpcDetector wire protocol from frigate/detectors/plugins/zmq_ipc.py.
//
// Build with ONNX Runtime support:
//   ORT_LIB_LOCATION=/path/to/onnxruntime cargo build --features with-onnx

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
    info!("Build with '--features with-onnx' and ORT_LIB_LOCATION set to enable ONNX inference.");
    Ok(())
}
