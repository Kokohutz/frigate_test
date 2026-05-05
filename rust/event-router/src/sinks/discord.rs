use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;
use tracing::debug;

use super::Sink;
use crate::subscriber::FrigateEvent;

/// Discord incoming-webhook sink.
///
/// Sends a simple text message to a Discord channel via an Incoming Webhook URL.
/// The message format is: "Camera {camera}: {event_type} {event_state}"
pub struct DiscordSink {
    webhook_url: String,
    client: reqwest::Client,
}

impl DiscordSink {
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
impl Sink for DiscordSink {
    fn name(&self) -> &str {
        "discord"
    }

    async fn send(&self, event: &FrigateEvent) -> Result<()> {
        let content = format!(
            "Camera {}: {} {}",
            event.camera, event.event_type, event.event_state
        );
        if let Some(ref id) = event.event_id {
            debug!("DiscordSink: sending event {} for {}", id, event.camera);
        }

        let body = json!({ "content": content });

        let resp = self
            .client
            .post(&self.webhook_url)
            .json(&body)
            .send()
            .await?;

        // Discord returns 204 No Content on success for webhook POSTs
        if resp.status().is_success() || resp.status().as_u16() == 204 {
            Ok(())
        } else {
            anyhow::bail!("discord webhook returned HTTP {}", resp.status())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> FrigateEvent {
        FrigateEvent {
            topic: "event/update".to_string(),
            camera: "backyard".to_string(),
            event_id: Some("ev1".to_string()),
            event_type: "object".to_string(),
            event_state: "end".to_string(),
            payload: serde_json::Value::Array(vec![]),
        }
    }

    #[test]
    fn test_discord_sink_name() {
        let s = DiscordSink::new("https://discord.com/api/webhooks/test".to_string());
        assert_eq!(s.name(), "discord");
    }

    #[tokio::test]
    async fn test_discord_sink_unreachable_returns_err() {
        let s = DiscordSink::new("http://127.0.0.1:1/discord".to_string());
        let result = s.send(&dummy_event()).await;
        assert!(result.is_err());
    }
}
