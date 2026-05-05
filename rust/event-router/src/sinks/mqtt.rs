use anyhow::Result;
use async_trait::async_trait;
use rumqttc::{AsyncClient, EventLoop, MqttOptions, QoS};
use serde_json::json;
use tracing::{debug, error};

use super::Sink;
use crate::subscriber::FrigateEvent;

/// MQTT sink using the `rumqttc` async client.
///
/// Publishes events to `{topic_prefix}/frigate/{camera}/{event_type}` with
/// QoS::AtLeastOnce. The event loop is driven in a background tokio task.
pub struct MqttSink {
    client: AsyncClient,
    topic_prefix: String,
}

impl MqttSink {
    /// Create an MQTT sink and start the event loop.
    ///
    /// The event loop task is spawned via `tokio::spawn` and runs until the
    /// program exits.
    pub async fn new(host: &str, port: u16, topic_prefix: &str) -> Result<Self> {
        let client_id = format!("frigate-event-router-{}", std::process::id());
        let mut mqtt_options = MqttOptions::new(client_id, host, port);
        mqtt_options.set_keep_alive(std::time::Duration::from_secs(30));

        let (client, event_loop) = AsyncClient::new(mqtt_options, 64);

        // Spawn a background task to drive the MQTT event loop.
        tokio::spawn(run_event_loop(event_loop));

        Ok(Self {
            client,
            topic_prefix: topic_prefix.to_string(),
        })
    }
}

#[async_trait]
impl Sink for MqttSink {
    fn name(&self) -> &str {
        "mqtt"
    }

    async fn send(&self, event: &FrigateEvent) -> Result<()> {
        let topic = format!(
            "{}/frigate/{}/{}",
            self.topic_prefix, event.camera, event.event_type
        );

        let payload = serde_json::to_vec(&json!({
            "event_state": event.event_state,
            "event_id":    event.event_id,
            "payload":     event.payload,
        }))?;

        debug!("MqttSink: publish to {topic}");

        self.client
            .publish(topic, QoS::AtLeastOnce, false, payload)
            .await
            .map_err(|e| anyhow::anyhow!("MQTT publish error: {e}"))?;

        Ok(())
    }
}

/// Drive the MQTT event loop, logging errors but never panicking.
async fn run_event_loop(mut event_loop: EventLoop) {
    loop {
        match event_loop.poll().await {
            Ok(event) => {
                debug!("MQTT event: {:?}", event);
            }
            Err(e) => {
                error!("MQTT event loop error: {e}");
                // Back off briefly before reconnect attempt
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_mqtt_topic_format() {
        // Verify the topic format without a live broker
        let prefix = "home";
        let camera = "front_door";
        let event_type = "object";
        let expected = "home/frigate/front_door/object";
        let actual = format!("{}/frigate/{}/{}", prefix, camera, event_type);
        assert_eq!(actual, expected);
    }
}
