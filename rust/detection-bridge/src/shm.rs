// Shared memory I/O for detection tensors.
// Input:  /dev/shm/{connection_id}       — (1, H, W, 3) uint8
// Output: /dev/shm/out-{connection_id}   — (20, 6) float32
//         Columns: [class_id, confidence, y_min, x_min, y_max, x_max]
