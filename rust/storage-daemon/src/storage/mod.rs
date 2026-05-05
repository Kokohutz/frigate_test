// Storage pressure monitor — replaces frigate/storage.py StorageMaintainer.
//
// Responsibilities:
//   - Poll disk usage every 5 minutes (sysinfo crate)
//   - Trigger cleanup when free space < 1 hour of bandwidth
//   - Delete oldest non-retained recordings first, then retained if needed
//   - Update Event.has_clip for deleted recordings

pub mod pressure;
