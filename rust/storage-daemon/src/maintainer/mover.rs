// Moves a validated segment from /tmp/cache/ to permanent storage.
// Replaces maintainer.py:move_segment().
//
// Steps:
//   1. Build destination path: RECORD_DIR/{YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4
//   2. tokio::fs::copy + faststart moov reorder (or ffmpeg subprocess fallback)
//   3. tokio::fs::remove_file cache file
//   4. Compute segment_size (bytes / 1MB)
//   5. Return RecordingInsert for DB write
