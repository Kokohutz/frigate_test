// Tier configuration loaded from the storage_tiers: YAML section.
//
// Example:
//   storage_tiers:
//     hot:  {path: /media/frigate/recordings, max_days: 7, max_gb: 500}
//     cold: {path: /mnt/nas/frigate/recordings, max_days: 90}
//     policy: {event_hot_days: 14, migration_interval: 3600}

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;

const DEFAULT_HOT_PATH: &str = "/media/frigate/recordings";
const DEFAULT_HOT_MAX_DAYS: f64 = 7.0;
const DEFAULT_HOT_MAX_GB: f64 = 500.0;
const DEFAULT_COLD_MAX_DAYS: f64 = 90.0;
const DEFAULT_MIGRATION_INTERVAL: u64 = 3600;
const DEFAULT_EVENT_HOT_DAYS: f64 = 14.0;

#[derive(Debug, Clone, Deserialize)]
pub struct TierConfig {
    pub hot: HotTierConfig,
    pub cold: ColdTierConfig,
    pub policy: PolicyConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HotTierConfig {
    pub path: PathBuf,
    pub max_days: f64,
    pub max_gb: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ColdTierConfig {
    pub path: PathBuf,
    pub max_days: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyConfig {
    /// Number of days to keep event clips on hot storage.
    /// Reserved for future use in the event-aware migration policy.
    #[allow(dead_code)]
    pub event_hot_days: f64,
    pub migration_interval: u64, // seconds
}

/// Wrapper for the top-level YAML file — we only care about `storage_tiers`.
#[derive(Debug, Deserialize)]
struct FrigateConfig {
    storage_tiers: Option<TierConfig>,
}

impl TierConfig {
    /// Load from a Frigate YAML config file.
    /// Returns `None` when the file doesn't exist or has no `storage_tiers` key.
    fn from_yaml(config_file: &Path) -> Result<Option<Self>> {
        let text = match std::fs::read_to_string(config_file) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                return Err(e)
                    .with_context(|| format!("read config file {}", config_file.display()));
            }
        };

        let parsed: FrigateConfig =
            serde_yaml::from_str(&text).context("parse YAML config file")?;

        Ok(parsed.storage_tiers)
    }

    /// Load from environment variables. `COLD_PATH` is required.
    fn from_env() -> Result<Self> {
        let cold_path = std::env::var("COLD_PATH").ok().map(PathBuf::from).context(
            "COLD_PATH env var is required when no YAML storage_tiers section is present",
        )?;

        Ok(TierConfig {
            hot: HotTierConfig {
                path: std::env::var("HOT_PATH")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from(DEFAULT_HOT_PATH)),
                max_days: std::env::var("HOT_MAX_DAYS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_HOT_MAX_DAYS),
                max_gb: std::env::var("HOT_MAX_GB")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_HOT_MAX_GB),
            },
            cold: ColdTierConfig {
                path: cold_path,
                max_days: std::env::var("COLD_MAX_DAYS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_COLD_MAX_DAYS),
            },
            policy: PolicyConfig {
                event_hot_days: std::env::var("EVENT_HOT_DAYS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_EVENT_HOT_DAYS),
                migration_interval: std::env::var("MIGRATION_INTERVAL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_MIGRATION_INTERVAL),
            },
        })
    }

    /// Try YAML first; fall back to env vars if the file is absent or has no
    /// `storage_tiers` section. Returns an error if neither source provides a
    /// cold path.
    pub fn from_yaml_or_env(config_file: &Path) -> Result<Self> {
        match Self::from_yaml(config_file) {
            Ok(Some(cfg)) => {
                tracing::info!("loaded storage_tiers from {}", config_file.display());
                Ok(cfg)
            }
            Ok(None) => {
                tracing::info!(
                    "no storage_tiers in {}; loading from env vars",
                    config_file.display()
                );
                Self::from_env()
            }
            Err(e) => {
                tracing::warn!(
                    "could not parse {}: {e:#}; falling back to env vars",
                    config_file.display()
                );
                Self::from_env()
            }
        }
    }
}

/// Return the path for the Frigate config YAML (env var or default).
pub fn config_file_path() -> PathBuf {
    std::env::var("FRIGATE_CONFIG_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/config/config.yml"))
}

/// Return the path for the Frigate SQLite database (env var or default).
pub fn db_path() -> PathBuf {
    std::env::var("FRIGATE_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/config/frigate.db"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn from_yaml_parses_storage_tiers() {
        let yaml = r#"
cameras:
  front_door:
    ffmpeg:
      inputs: []
storage_tiers:
  hot:
    path: /nvme/recordings
    max_days: 5
    max_gb: 200
  cold:
    path: /hdd/recordings
    max_days: 60
  policy:
    event_hot_days: 10
    migration_interval: 1800
"#;
        let dir = tempfile::tempdir().unwrap();
        let cfg_path = dir.path().join("config.yml");
        std::fs::File::create(&cfg_path)
            .unwrap()
            .write_all(yaml.as_bytes())
            .unwrap();

        let cfg = TierConfig::from_yaml_or_env(&cfg_path).unwrap();
        assert_eq!(cfg.hot.path, PathBuf::from("/nvme/recordings"));
        assert_eq!(cfg.hot.max_days, 5.0);
        assert_eq!(cfg.hot.max_gb, 200.0);
        assert_eq!(cfg.cold.path, PathBuf::from("/hdd/recordings"));
        assert_eq!(cfg.cold.max_days, 60.0);
        assert_eq!(cfg.policy.event_hot_days, 10.0);
        assert_eq!(cfg.policy.migration_interval, 1800);
    }

    #[test]
    fn from_env_used_when_no_yaml() {
        // Point at a non-existent file; env COLD_PATH must be set.
        std::env::set_var("COLD_PATH", "/mnt/nas/recordings");
        std::env::set_var("HOT_MAX_DAYS", "3");

        let cfg = TierConfig::from_yaml_or_env(Path::new("/nonexistent/config.yml")).unwrap();
        assert_eq!(cfg.cold.path, PathBuf::from("/mnt/nas/recordings"));
        assert_eq!(cfg.hot.max_days, 3.0);

        std::env::remove_var("COLD_PATH");
        std::env::remove_var("HOT_MAX_DAYS");
    }

    #[test]
    fn from_env_fails_without_cold_path() {
        std::env::remove_var("COLD_PATH");
        let result = TierConfig::from_env();
        assert!(result.is_err());
    }
}
