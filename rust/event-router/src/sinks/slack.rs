use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;
use tracing::debug;

use super::Sink;
use crate::subscriber::FrigateEvent;

/// Slack Incoming Webhook sink.
///
/// Posts a simple text notification to a Slack channel using the
/// [Incoming Webhooks](https://api.slack.com/messaging/webhooks) API.
pub struct SlackSink {
    webhook_url: String,
    client: reqwest::Client,
}

impl SlackSink {
    pub fn new(webhook_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self {
            webhook_url,
            client,
        }
    }
}

#[async_trait]
impl Sink for SlackSink {
    fn name(&self) -> &str {
        "slack"
    }

    async fn send(&self, event: &FrigateEvent) -> Result<()> {
        let text = format!(
            "Frigate | Camera *{}*: `{}` {}",
            event.camera, event.event_type, event.event_state
        );
        debug!("SlackSink: sending to channel — {}", text);

        let body = json!({ "text": text });

        let resp = self
            .client
            .post(&self.webhook_url)
            .json(&body)
            .send()
            .await?;

        if resp.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("slack webhook returned HTTP {}", resp.status())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> FrigateEvent {
        FrigateEvent {
            topic: "event/update".to_string(),
            camera: "garage".to_string(),
            event_id: None,
            event_type: "audio".to_string(),
            event_state: "new".to_string(),
            payload: serde_json::Value::Array(vec![]),
        }
    }

    #[test]
    fn test_slack_sink_name() {
        let s = SlackSink::new("https://hooks.slack.com/services/test".to_string());
        assert_eq!(s.name(), "slack");
    }

    #[tokio::test]
    async fn test_slack_sink_unreachable_returns_err() {
        let s = SlackSink::new("http://127.0.0.1:1/slack".to_string());
        let result = s.send(&dummy_event()).await;
        assert!(result.is_err());
    }
}
