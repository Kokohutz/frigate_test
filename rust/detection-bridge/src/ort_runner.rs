//! ONNX Runtime session manager using the `ort` crate.
//! Gated behind the `with-onnx` feature flag.
//!
//! When `with-onnx` is not enabled (e.g. in CI without network access),
//! the stub below is used — it logs a warning and returns empty detections.

#[cfg(not(feature = "with-onnx"))]
pub mod ort_impl {
    use crate::chain::Detection;
    use std::path::Path;
    use tracing::warn;

    pub fn run_onnx(
        model_path: &Path,
        tensor: &[u8],
        w: u32,
        h: u32,
    ) -> anyhow::Result<Vec<Detection>> {
        warn!(
            model = %model_path.display(),
            "detection-bridge compiled without with-onnx feature — returning empty detections"
        );
        let _ = (tensor, w, h);
        Ok(vec![])
    }
}

#[cfg(feature = "with-onnx")]
pub mod ort_impl {
    use crate::chain::Detection;
    use anyhow::{bail, Context, Result};
    use dashmap::DashMap;
    use ndarray::Array4;
    use ort::{Session, SessionBuilder};
    use std::path::Path;
    use std::sync::{Arc, OnceLock};
    use tracing::{debug, info};

    static SESSIONS: OnceLock<DashMap<String, Arc<Session>>> = OnceLock::new();

    fn sessions() -> &'static DashMap<String, Arc<Session>> {
        SESSIONS.get_or_init(DashMap::new)
    }

    fn get_or_load_session(model_path: &Path) -> Result<Arc<Session>> {
        let key = model_path.to_string_lossy().into_owned();
        if let Some(sess) = sessions().get(&key) {
            return Ok(Arc::clone(&sess));
        }
        info!(model = %model_path.display(), "loading ONNX model");
        let session = SessionBuilder::new()?
            .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
            .with_intra_threads(2)?
            .commit_from_file(model_path)
            .with_context(|| format!("loading ONNX model {}", model_path.display()))?;
        let session = Arc::new(session);
        sessions().insert(key, Arc::clone(&session));
        Ok(session)
    }

    /// Run ONNX inference on a raw RGB/BGR frame tensor.
    ///
    /// `tensor` is raw bytes: H×W×3 uint8, row-major.
    /// Returns bounding boxes in normalized [0,1] coordinates.
    pub fn run_onnx(model_path: &Path, tensor: &[u8], w: u32, h: u32) -> Result<Vec<Detection>> {
        let session = get_or_load_session(model_path)?;

        // Build input tensor: shape [1, 3, H, W] float32, normalized to [0,1]
        let (ww, hh) = (w as usize, h as usize);
        if tensor.len() != hh * ww * 3 {
            bail!(
                "tensor size mismatch: got {} bytes for {}×{}×3",
                tensor.len(),
                hh,
                ww
            );
        }

        // Convert HWC uint8 → CHW float32
        let mut input = Array4::<f32>::zeros((1, 3, hh, ww));
        for y in 0..hh {
            for x in 0..ww {
                let base = (y * ww + x) * 3;
                for c in 0..3 {
                    input[[0, c, y, x]] = tensor[base + c] as f32 / 255.0;
                }
            }
        }

        let input_dyn = input.into_dyn();
        let outputs = session.run(ort::inputs![input_dyn]?)?;
        let output = outputs[0].try_extract_tensor::<f32>()?;
        let view = output.view();

        // Parse YOLOv8-style output: shape [1, 84, 8400] → 4 bbox + 80 classes
        let mut detections = Vec::new();
        let shape = view.shape();
        let rows = shape.get(2).copied().unwrap_or(0);
        let cols = shape.get(1).copied().unwrap_or(0);

        for i in 0..rows {
            // YOLOv8: cx, cy, w, h in rows 0-3; class scores in rows 4+
            if cols < 5 {
                continue;
            }
            let cx = view[[0, 0, i]];
            let cy = view[[0, 1, i]];
            let bw = view[[0, 2, i]];
            let bh = view[[0, 3, i]];

            // Find max class score
            let (class_id, confidence) = (4..cols)
                .map(|c| (c - 4, view[[0, c, i]]))
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or((0, 0.0));

            if confidence < 0.25 {
                continue;
            }

            // Convert cx,cy,w,h → x_min,y_min,x_max,y_max normalized
            let x_min = ((cx - bw / 2.0) / w as f32).clamp(0.0, 1.0);
            let y_min = ((cy - bh / 2.0) / h as f32).clamp(0.0, 1.0);
            let x_max = ((cx + bw / 2.0) / w as f32).clamp(0.0, 1.0);
            let y_max = ((cy + bh / 2.0) / h as f32).clamp(0.0, 1.0);

            debug!(
                class_id,
                confidence, x_min, y_min, x_max, y_max, "detection"
            );
            detections.push(Detection {
                class_id: class_id as u32,
                confidence,
                x_min,
                y_min,
                x_max,
                y_max,
            });
        }

        Ok(detections)
    }
}
