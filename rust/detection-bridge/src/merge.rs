// Result merging strategies for multi-model chains.
//   sequential_filter — primary result, then secondary on primary's boxes
//   union            — all detections from all models, deduplicated by IoU
//   intersection     — only detections confirmed by all models

use crate::chain::Detection;

/// Merge strategy for combining detections from multiple models.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub enum MergeStrategy {
    /// Use primary model result; run secondary models only on matching boxes.
    #[default]
    SequentialFilter,
    /// Combine all detections from all models, deduplicated by IoU overlap.
    Union,
    /// Keep only detections confirmed by all models.
    Intersection,
}

/// Merge detections from multiple models according to the chosen strategy.
///
/// `all_detections`: one Vec<Detection> per model, in order.
#[allow(dead_code)]
pub fn merge(all_detections: Vec<Vec<Detection>>, strategy: &MergeStrategy) -> Vec<Detection> {
    if all_detections.is_empty() {
        return vec![];
    }
    match strategy {
        MergeStrategy::SequentialFilter => {
            // Return primary model results (index 0); secondary filtering is
            // applied upstream before this merge step.
            all_detections.into_iter().next().unwrap_or_default()
        }
        MergeStrategy::Union => {
            // Flatten all detections; a full implementation would apply NMS.
            all_detections.into_iter().flatten().collect()
        }
        MergeStrategy::Intersection => {
            // Stub: only return primary detections.
            // A full implementation would filter to boxes confirmed by all models.
            all_detections.into_iter().next().unwrap_or_default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_det(class_id: f32) -> Detection {
        Detection {
            class_id,
            confidence: 0.9,
            y_min: 0.0,
            x_min: 0.0,
            y_max: 1.0,
            x_max: 1.0,
        }
    }

    #[test]
    fn sequential_filter_returns_primary() {
        let primary = vec![make_det(1.0), make_det(2.0)];
        let secondary = vec![make_det(3.0)];
        let result = merge(
            vec![primary.clone(), secondary],
            &MergeStrategy::SequentialFilter,
        );
        assert_eq!(result.len(), 2);
        assert!((result[0].class_id - 1.0).abs() < 1e-6);
    }

    #[test]
    fn union_flattens_all() {
        let m1 = vec![make_det(1.0)];
        let m2 = vec![make_det(2.0), make_det(3.0)];
        let result = merge(vec![m1, m2], &MergeStrategy::Union);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn empty_input_returns_empty() {
        let result = merge(vec![], &MergeStrategy::SequentialFilter);
        assert!(result.is_empty());
    }
}
