// Shared memory I/O for detection tensors.
// Input:  /dev/shm/{connection_id}       — (1, H, W, 3) uint8
// Output: /dev/shm/out-{connection_id}   — (20, 6) float32
//         Columns: [class_id, confidence, y_min, x_min, y_max, x_max]

use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

/// Read a raw tensor from shared memory.
///
/// Path: `/dev/shm/{connection_id}`
#[allow(dead_code)]
pub fn read_tensor(connection_id: &str) -> Result<Vec<u8>> {
    let path = shm_input_path(connection_id);
    fs::read(&path).with_context(|| format!("reading shm tensor from {path:?}"))
}

/// Write detection results to shared memory.
///
/// Path: `/dev/shm/out-{connection_id}`
/// Writes exactly 20*6*4 = 480 bytes (float32 LE).
#[allow(dead_code)]
pub fn write_detections(connection_id: &str, data: &[u8]) -> Result<()> {
    let path = shm_output_path(connection_id);
    fs::write(&path, data).with_context(|| format!("writing detections to {path:?}"))
}

fn shm_input_path(connection_id: &str) -> PathBuf {
    PathBuf::from(format!("/dev/shm/{connection_id}"))
}

fn shm_output_path(connection_id: &str) -> PathBuf {
    PathBuf::from(format!("/dev/shm/out-{connection_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_path_format() {
        let p = shm_input_path("cam1");
        assert_eq!(p, PathBuf::from("/dev/shm/cam1"));
    }

    #[test]
    fn output_path_format() {
        let p = shm_output_path("cam1");
        assert_eq!(p, PathBuf::from("/dev/shm/out-cam1"));
    }
}
