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
