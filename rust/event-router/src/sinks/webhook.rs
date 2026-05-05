use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;
use tracing::debug;

use super::Sink;
use crate::subscriber::FrigateEvent;

/// HTTP webhook sink.
///
/// POSTs a JSON object to the configured URL with a 10-second timeout.
/// Returns an error (→ DLQ) on any non-2xx response or network failure.
pub struct WebhookSink {
    url: String,
    client: reqwest::Client,
}

impl WebhookSink {
    pub fn new(url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self { url, client }
    }
}

#[async_trait]
impl Sink for WebhookSink {
    fn name(&self) -> &str {
        "webhook"
    }

    async fn send(&self, event: &FrigateEvent) -> Result<()> {
        let body = json!({
            "topic":       event.topic,
            "camera":      event.camera,
            "event_id":    event.event_id,
            "event_type":  event.event_type,
            "event_state": event.event_state,
            "payload":     event.payload,
        });

        debug!(
            "WebhookSink: POST {} — {}/{}",
            self.url, event.camera, event.event_state
        );

        let resp = self.client.post(&self.url).json(&body).send().await?;

        if resp.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("webhook returned HTTP {}", resp.status())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> FrigateEvent {
        FrigateEvent {
            topic: "event/update".to_string(),
            camera: "front".to_string(),
            event_id: Some("abc".to_string()),
            event_type: "object".to_string(),
            event_state: "new".to_string(),
            payload: serde_json::Value::Array(vec![]),
        }
    }

    #[test]
    fn test_webhook_sink_name() {
        let s = WebhookSink::new("http://localhost:9999/hook".to_string());
        assert_eq!(s.name(), "webhook");
    }

    #[tokio::test]
    async fn test_webhook_sink_unreachable_returns_err() {
        let s = WebhookSink::new("http://127.0.0.1:1/nonexistent".to_string());
        let result = s.send(&dummy_event()).await;
        assert!(result.is_err(), "expected error for unreachable endpoint");
    }
}
