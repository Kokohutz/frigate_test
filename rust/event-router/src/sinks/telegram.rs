use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;
use tracing::debug;

use super::Sink;
use crate::subscriber::FrigateEvent;

/// Telegram Bot API sink.
///
/// Sends a text notification to a Telegram chat via `sendMessage`.
/// Requires a bot token and a chat ID.
pub struct TelegramSink {
    bot_token: String,
    chat_id: String,
    client: reqwest::Client,
}

impl TelegramSink {
    pub fn new(bot_token: String, chat_id: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self {
            bot_token,
            chat_id,
            client,
        }
    }

    fn api_url(&self) -> String {
        format!("https://api.telegram.org/bot{}/sendMessage", self.bot_token)
    }
}

#[async_trait]
impl Sink for TelegramSink {
    fn name(&self) -> &str {
        "telegram"
    }

    async fn send(&self, event: &FrigateEvent) -> Result<()> {
        let text = format!(
            "Frigate: Camera {} — {} {}",
            event.camera, event.event_type, event.event_state
        );
        debug!("TelegramSink: sending to chat_id={}", self.chat_id);

        let body = json!({
            "chat_id": self.chat_id,
            "text":    text,
        });

        let resp = self.client.post(self.api_url()).json(&body).send().await?;

        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            anyhow::bail!("telegram API returned HTTP {}: {}", status, err_body)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> FrigateEvent {
        FrigateEvent {
            topic: "event/finalized".to_string(),
            camera: "driveway".to_string(),
            event_id: Some("tg1".to_string()),
            event_type: "object".to_string(),
            event_state: "end".to_string(),
            payload: serde_json::Value::Array(vec![]),
        }
    }

    #[test]
    fn test_telegram_sink_name() {
        let s = TelegramSink::new("bot_token_123".to_string(), "-100456789".to_string());
        assert_eq!(s.name(), "telegram");
    }

    #[test]
    fn test_telegram_api_url_format() {
        let s = TelegramSink::new("mytoken".to_string(), "0".to_string());
        assert_eq!(
            s.api_url(),
            "https://api.telegram.org/botmytoken/sendMessage"
        );
        // Silence unused-variable lint in test
        let _ = dummy_event();
    }
}
