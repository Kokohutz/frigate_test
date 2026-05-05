// MP4 segment validation using mp4parse.
// Replaces the ffprobe subprocess call in maintainer.py:validate_and_move_segment().
//
// Checks:
//   1. File is a valid MP4 (parseable moov/trak/mdhd boxes)
//   2. Has at least one video track
//   3. Duration is between 0 and MAX_SEGMENT_DURATION (600s)
//
// Falls back to spawning `ffprobe` as a subprocess if mp4parse fails,
// logging the fallback so it can be tracked.
