// ONNX Runtime session manager using the `ort` crate.
// Maintains a registry (DashMap) of loaded sessions keyed by model path.
// Supports CUDA, TensorRT, OpenVINO, and CPU execution providers.
// Use ort's `download-binaries` feature for Docker cross-arch compatibility.
