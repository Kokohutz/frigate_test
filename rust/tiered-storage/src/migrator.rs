// Background segment migration (hot → cold).
// Uses tokio::fs::copy + remove_file (works across filesystem boundaries).
// Updates Recordings.path in SQLite after successful copy.
// Preserves relative path structure: {YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4
