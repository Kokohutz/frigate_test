use std::path::PathBuf;

use serde::Deserialize;

const DEFAULT_CACHE_DIR: &str = "/tmp/cache";
const DEFAULT_RECORD_DIR: &str = "/media/frigate/recordings";
const DEFAULT_DB_PATH: &str = "/config/frigate.db";
const DEFAULT_FFMPEG_PATH: &str = "ffmpeg";

/// Top-level runtime configuration for the storage daemon.
/// Loaded from environment variables; extended later to read FRIGATE_CONFIG_FILE.
#[derive(Debug, Clone)]
pub struct Config {
    /// Path to the tmpfs segment cache (default: /tmp/cache)
    pub cache_dir: PathBuf,
    /// Path to permanent recording storage (default: /media/frigate/recordings)
    pub record_dir: PathBuf,
    /// Path to the Frigate SQLite database
    pub db_path: PathBuf,
    /// Path to the ffmpeg binary (used as fallback for validation)
    pub ffmpeg_path: PathBuf,
    /// When true, shadow mode: log decisions but do not move files or write DB
    pub shadow_mode: bool,
    /// When true (FRIGATE_RUST_CLEANUP=1), Rust owns cleanup; Python threads are suppressed.
    pub cleanup_enabled: bool,
    /// Days to keep all recordings regardless of motion (FRIGATE_CONTINUOUS_RETAIN_DAYS).
    pub continuous_retain_days: f64,
    /// Days to keep recordings with motion or audio (FRIGATE_MOTION_RETAIN_DAYS).
    pub motion_retain_days: f64,
    /// Per-camera retain mode override (populated from Frigate YAML in Phase C)
    #[allow(dead_code)]
    pub cameras: Vec<CameraConfig>,
}

/// Per-camera recording configuration (loaded from Frigate YAML in Phase C).
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct CameraConfig {
    pub name: String,
    pub record_enabled: bool,
    pub retain_mode: RetainModeConfig,
    pub retain_days: f64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RetainModeConfig {
    All,
    Motion,
    ActiveObjects,
}

impl Config {
    pub fn from_env() -> Self {
        let shadow_mode = std::env::var("FRIGATE_RUST_SHADOW")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true); // default: shadow mode for safety

        let cleanup_enabled = std::env::var("FRIGATE_RUST_CLEANUP")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let continuous_retain_days = std::env::var("FRIGATE_CONTINUOUS_RETAIN_DAYS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30.0);

        let motion_retain_days = std::env::var("FRIGATE_MOTION_RETAIN_DAYS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10.0);

        Self {
            cache_dir: std::env::var("FRIGATE_CACHE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(DEFAULT_CACHE_DIR)),
            record_dir: std::env::var("FRIGATE_RECORD_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(DEFAULT_RECORD_DIR)),
            db_path: std::env::var("FRIGATE_DB_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(DEFAULT_DB_PATH)),
            ffmpeg_path: std::env::var("FRIGATE_FFMPEG_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(DEFAULT_FFMPEG_PATH)),
            shadow_mode,
            cleanup_enabled,
            continuous_retain_days,
            motion_retain_days,
            cameras: vec![],
        }
    }
}
