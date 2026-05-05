// Recording maintainer — replaces frigate/record/maintainer.py
//
// Responsibilities:
//   - Watch /tmp/cache/ for completed .mp4 segments (notify crate)
//   - Validate each segment with mp4parse (replaces ffprobe subprocess)
//   - Accumulate detection/motion data from ZMQ pub/sub
//   - Compute SegmentInfo (motion_count, object_count, dBFS, heatmap)
//   - Move segment to permanent storage with faststart reorder
//   - Send INSERT_MANY_RECORDINGS via ZMQ REQ to ipc:///tmp/cache/comms
//   - Publish recordings/{saved,valid,invalid,latest} on ZMQ PUB

pub mod mover;
pub mod scanner;
pub mod segment;
pub mod validator;
