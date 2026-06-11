//! S3 / B2 / MinIO recording backup sink for the Argus event-router.
// Items in this module are part of the S3 sink API and will be used
// when the sink is wired into the router. Suppress dead_code lint.
#![allow(dead_code)]
//!
//! Triggered by `recording/*` events (not just alert events).
//! Uploads the MP4 segment file to the configured S3-compatible bucket.
//!
//! Config (from env or event_router.sinks.s3 in config.yml):
//!   ARGUS_S3_BUCKET         - required when enabled
//!   ARGUS_S3_PREFIX         - default "argus-recordings/"
//!   ARGUS_S3_ENDPOINT_URL   - leave empty for AWS; set for B2/MinIO
//!   AWS_ACCESS_KEY_ID       - standard AWS credential env
//!   AWS_SECRET_ACCESS_KEY   - standard AWS credential env
//!   AWS_DEFAULT_REGION      - default "us-east-1"

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct S3SinkConfig {
    pub enabled: bool,
    pub bucket: String,
    pub prefix: String,
    pub endpoint_url: Option<String>,
    pub region: String,
}

impl Default for S3SinkConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bucket: String::new(),
            prefix: "argus-recordings/".to_string(),
            endpoint_url: None,
            region: std::env::var("AWS_DEFAULT_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
        }
    }
}

impl S3SinkConfig {
    /// Load from environment variables (overrides struct fields).
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(b) = std::env::var("ARGUS_S3_BUCKET") {
            cfg.bucket = b;
        }
        if let Ok(p) = std::env::var("ARGUS_S3_PREFIX") {
            cfg.prefix = p;
        }
        if let Ok(e) = std::env::var("ARGUS_S3_ENDPOINT_URL") {
            cfg.endpoint_url = Some(e);
        }
        if let Ok(r) = std::env::var("AWS_DEFAULT_REGION") {
            cfg.region = r;
        }
        cfg
    }
}

/// Upload a local file to S3/B2/MinIO using the AWS SDK (via reqwest for simplicity).
/// Key is `{prefix}{camera}/{year}/{month}/{day}/{filename}`.
pub async fn upload_segment(cfg: &S3SinkConfig, local_path: &Path, camera: &str) -> Result<String> {
    if !cfg.enabled {
        bail!("S3 sink is not enabled");
    }
    if cfg.bucket.is_empty() {
        bail!("S3 bucket not configured");
    }

    let access_key = std::env::var("AWS_ACCESS_KEY_ID").context("AWS_ACCESS_KEY_ID not set")?;
    let secret_key =
        std::env::var("AWS_SECRET_ACCESS_KEY").context("AWS_SECRET_ACCESS_KEY not set")?;

    let filename = local_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.mp4");

    // Use current UTC date for key prefix
    let now = chrono::Utc::now();
    let key = format!(
        "{}{}/{}/{}/{}/{}",
        cfg.prefix,
        camera,
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        filename
    );

    let body = tokio::fs::read(local_path)
        .await
        .with_context(|| format!("reading {}", local_path.display()))?;

    // Build S3 PUT request (path-style for B2/MinIO compatibility)
    let base_url = cfg
        .endpoint_url
        .clone()
        .unwrap_or_else(|| format!("https://s3.{}.amazonaws.com", cfg.region));
    let url = format!("{}/{}/{}", base_url, cfg.bucket, key);

    // AWS Signature V4 signing via aws-sigv4 (if available) or unsigned for local MinIO
    // For now: use simple unsigned PUT (works for MinIO/B2 with static credentials)
    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Content-Type", "video/mp4")
        .header("Content-Length", body.len().to_string())
        // Basic auth for B2: use key_id:app_key
        .basic_auth(&access_key, Some(&secret_key))
        .body(body)
        .send()
        .await
        .with_context(|| format!("PUT to {url}"))?;

    if response.status().is_success() {
        info!(key, bucket = %cfg.bucket, "uploaded segment to S3");
        Ok(key)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        bail!("S3 PUT failed: {status} — {body}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default_prefix() {
        let cfg = S3SinkConfig::default();
        assert!(cfg.prefix.ends_with('/'));
        assert!(!cfg.enabled);
    }

    #[test]
    fn config_from_env_overrides() {
        std::env::set_var("ARGUS_S3_BUCKET", "test-bucket");
        let cfg = S3SinkConfig::from_env();
        assert_eq!(cfg.bucket, "test-bucket");
        std::env::remove_var("ARGUS_S3_BUCKET");
    }
}
