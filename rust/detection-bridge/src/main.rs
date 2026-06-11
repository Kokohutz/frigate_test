// detection-bridge: Multi-model ONNX inference chain.
// Implements the ZmqIpcDetector wire protocol from frigate/detectors/plugins/zmq_ipc.py.
//
// Environment variables:
//   ZMQ_DETECTOR_SOCKET   — ZMQ endpoint (default: ipc:///tmp/cache/zmq_detector)
//   DETECTION_MODEL_PATH  — comma-separated list of .onnx model paths
//
// Build with ONNX Runtime support:
//   ORT_LIB_LOCATION=/path/to/onnxruntime cargo build --features with-onnx

mod chain;
mod merge;
mod ort_runner;
mod shm;
mod zmq_server;

use anyhow::Result;
use chain::InferenceChain;
use std::path::PathBuf;
use tracing::info;
use zmq_server::SOCKET_DETECTOR;

fn main() -> Result<()> {
    // Handle --version flag
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("--version") {
        println!("detection-bridge {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "detection_bridge=info".into()),
        )
        .init();

    // Parse ZMQ socket address.
    let socket_addr =
        std::env::var("ZMQ_DETECTOR_SOCKET").unwrap_or_else(|_| SOCKET_DETECTOR.to_string());

    // Parse model paths from comma-separated env var.
    let model_paths: Vec<PathBuf> = std::env::var("DETECTION_MODEL_PATH")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect();

    let chain = InferenceChain::new(model_paths.clone());

    if model_paths.is_empty() {
        info!("detection-bridge: no models configured (stub mode — all inference returns empty)");
    } else {
        #[cfg(feature = "with-onnx")]
        info!(
            "detection-bridge: ONNX mode, {} model(s): {:?}",
            model_paths.len(),
            model_paths
        );
        #[cfg(not(feature = "with-onnx"))]
        info!(
            "detection-bridge: stub mode (build with --features with-onnx for real inference), {} model path(s) configured",
            model_paths.len()
        );
    }

    info!("detection-bridge: starting ZMQ REP server at {socket_addr}");

    zmq_server::run_server(&socket_addr, move |w, h, tensor| {
        chain
            .infer(w, h, tensor)
            .map(|ds: Vec<chain::Detection>| ds.into_iter().map(Into::into).collect())
    })
}
