// ZMQ REP server implementing the ZmqIpcDetector wire protocol.
// (frigate/detectors/plugins/zmq_ipc.py defines the exact protocol)
//
// Listens at: ipc:///tmp/cache/zmq_detector
//
// Request (Python → Rust):
//   Multipart: [header_json_bytes, tensor_bytes]
//   header: {"shape": [1,H,W,3], "dtype": "uint8", "model_type": "yolox"}
//   tensor_bytes: raw C-order uint8 bytes of shape (1, H, W, 3)
//
// Response (Rust → Python):
//   Multipart: [header_json_bytes, result_bytes]
//   header: {"shape": [20, 6], "dtype": "float32"}
//   result_bytes: 480 bytes (20×6 float32, C-order)
//   Columns: [class_id, confidence, y_min, x_min, y_max, x_max] all in [0,1]
//
// Model management (no tensor frame):
//   Request:  [{"model_request": true, "model_name": "yolov8n.onnx"}]
//   Response: {"model_available": true, "model_loaded": true}
//          or {"model_available": false}  → Python will upload model bytes
