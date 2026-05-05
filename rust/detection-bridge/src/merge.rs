// Result merging strategies for multi-model chains.
//   sequential_filter — primary result, then secondary on primary's boxes
//   union            — all detections from all models, deduplicated by IoU
//   intersection     — only detections confirmed by all models
