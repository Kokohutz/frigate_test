// Watches /tmp/cache/ for completed .mp4 segment files.
// Uses the notify crate (inotify on Linux) instead of Python's polling loop.
// Filters out preview_ prefixed files and files still open by ffmpeg
// (checked via /proc/{pid}/fd/ symlinks on Linux).
