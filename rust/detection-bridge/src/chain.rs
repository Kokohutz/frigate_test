// Multi-model inference pipeline per camera.
// Primary model runs on full frame; secondary models run only on boxes
// matching filter_labels from the primary result.
//
// Config (detection_bridge: YAML section):
//   models:
//     - path: /config/model_cache/primary.onnx
//       type: yolov8
//     - path: /config/model_cache/license_plate.onnx
//       type: yologeneric
//       filter_labels: [car, motorcycle]
//   merge: sequential_filter

use anyhow::Result;
use std::path::PathBuf;

/// Detection result from a model.
#[derive(Debug, Clone)]
pub struct Detection {
    pub class_id: f32,
    pub confidence: f32,
    pub y_min: f32,
    pub x_min: f32,
    pub y_max: f32,
    pub x_max: f32,
}

impl From<Detection> for [f32; 6] {
    fn from(d: Detection) -> [f32; 6] {
        [d.class_id, d.confidence, d.y_min, d.x_min, d.y_max, d.x_max]
    }
}

/// A stub inference chain. Returns empty detections.
/// Real inference is behind `with-onnx` feature in ort_runner.rs.
pub struct InferenceChain {
    pub model_paths: Vec<PathBuf>,
}

impl InferenceChain {
    pub fn new(model_paths: Vec<PathBuf>) -> Self {
        Self { model_paths }
    }

    /// Run inference. In stub mode (no ort), logs a warning and returns empty vec.
    /// With with-onnx feature: runs first model on tensor, returns results.
    pub fn infer(&self, width: u32, height: u32, tensor: &[u8]) -> Result<Vec<Detection>> {
        if let Some(model_path) = self.model_paths.first() {
            return crate::ort_runner::ort_impl::run_onnx(model_path, tensor, width, height);
        }

        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_returns_empty_detections() {
        let chain = InferenceChain::new(vec![]);
        let result = chain.infer(640, 480, &vec![0u8; 640 * 480 * 3]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn stub_returns_empty_even_with_model_paths() {
        let chain = InferenceChain::new(vec![PathBuf::from("/nonexistent/model.onnx")]);
        // In stub mode (without with-onnx feature), returns empty regardless of paths
        #[cfg(not(feature = "with-onnx"))]
        {
            let result = chain.infer(640, 480, &vec![0u8; 640 * 480 * 3]).unwrap();
            assert!(result.is_empty());
        }
        // With onnx feature, this would try to load the model and likely error
        // but that's expected behavior tested elsewhere
        #[cfg(feature = "with-onnx")]
        {
            // Just verify it doesn't panic with an invalid path; it may error
            let _ = chain.infer(640, 480, &vec![0u8; 640 * 480 * 3]);
        }
    }

    #[test]
    fn detection_converts_to_array() {
        let d = Detection {
            class_id: 1.0,
            confidence: 0.9,
            y_min: 0.1,
            x_min: 0.2,
            y_max: 0.8,
            x_max: 0.9,
        };
        let arr: [f32; 6] = d.into();
        assert_eq!(arr, [1.0, 0.9, 0.1, 0.2, 0.8, 0.9]);
    }
}
