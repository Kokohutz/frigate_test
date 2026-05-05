//! 16×16 motion heatmap computation.
//!
//! Port of RecordingMaintainer._compute_motion_heatmap() in maintainer.py.
//! Each motion box [x1, y1, x2, y2] (pixel coordinates) is mapped to cells
//! in a 16×16 grid over the frame and its count incremented.

use std::collections::HashMap;

/// Compute a sparse 16×16 motion heatmap from a list of motion bounding boxes.
///
/// `motion_boxes` — list of [x1, y1, x2, y2] pixel boxes
/// `frame_width`, `frame_height` — frame dimensions in pixels
///
/// Returns a map from cell index (row*16 + col rendered as a string) to count.
pub fn compute_motion_heatmap(
    motion_boxes: &[[i32; 4]],
    frame_width: u32,
    frame_height: u32,
) -> HashMap<String, u8> {
    let mut grid = [[0u32; 16]; 16];
    let fw = frame_width as f32;
    let fh = frame_height as f32;

    for &[x1, y1, x2, y2] in motion_boxes {
        // Clamp to frame bounds
        let x1 = (x1.max(0) as f32 / fw * 16.0).floor() as usize;
        let y1 = (y1.max(0) as f32 / fh * 16.0).floor() as usize;
        let x2 = ((x2 as f32 / fw * 16.0).ceil() as usize).min(16);
        let y2 = ((y2 as f32 / fh * 16.0).ceil() as usize).min(16);

        for row in y1..y2 {
            for col in x1..x2 {
                grid[row][col] = grid[row][col].saturating_add(1);
            }
        }
    }

    // Emit sparse map — only non-zero cells
    let mut result = HashMap::new();
    for row in 0..16usize {
        for col in 0..16usize {
            let count = grid[row][col];
            if count > 0 {
                let key = (row * 16 + col).to_string();
                result.insert(key, count.min(255) as u8);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_boxes_produces_empty_heatmap() {
        let map = compute_motion_heatmap(&[], 1920, 1080);
        assert!(map.is_empty());
    }

    #[test]
    fn full_frame_box_fills_all_cells() {
        let map = compute_motion_heatmap(&[[0, 0, 1920, 1080]], 1920, 1080);
        assert_eq!(map.len(), 256);
        for v in map.values() {
            assert_eq!(*v, 1);
        }
    }

    #[test]
    fn single_cell_box() {
        // Box occupying exactly the top-left cell (0,0)-(120,67) on 1920x1080
        let map = compute_motion_heatmap(&[[0, 0, 120, 67]], 1920, 1080);
        assert_eq!(map.len(), 1);
        assert_eq!(*map.get("0").unwrap(), 1);
    }
}
