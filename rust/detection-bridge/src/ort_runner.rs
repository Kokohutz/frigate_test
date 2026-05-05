// ONNX Runtime session manager using the `ort` crate.
// Maintains a registry (DashMap) of loaded sessions keyed by model path.
// Supports CUDA, TensorRT, OpenVINO, and CPU execution providers.
// Use ort's `download-binaries` feature for Docker cross-arch compatibility.

#[cfg(feature = "with-onnx")]
pub mod ort_impl {
    // Placeholder — real ONNX session would go here.
    // A full implementation would:
    //   1. Load an ONNX session from `model_path` using ort::Session::builder()
    //   2. Reshape the raw tensor bytes into ndarray::Array4<u8> (1, H, W, 3)
    //   3. Run the session and parse output tensors into Detection results
    //   4. Apply NMS (non-maximum suppression) if needed
    //
    // For now: return empty detections (safe stub).
    pub fn run_onnx(
        _model_path: &std::path::Path,
        _tensor: &[u8],
        _w: u32,
        _h: u32,
    ) -> anyhow::Result<Vec<super::super::chain::Detection>> {
        Ok(vec![])
    }
}
