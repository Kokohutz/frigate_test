mod dlq;
mod rate_limiter;
mod router;
mod sinks;
mod subscriber;

use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use anyhow::Result;
use tokio::sync::mpsc;
use tokio::time;
use tracing::{info, warn};

use dlq::DeadLetterQueue;
use rate_limiter::EventRateLimiter;
use router::Router;
use sinks::Sink;
use subscriber::spawn_event_subscriber;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "event_router=info".into()),
        )
        .init();

    info!("event-router starting");

    // ── Configuration from environment variables ──────────────────────────────

    let rate_limit: u32 = std::env::var("EVENT_ROUTER_RATE_LIMIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let dlq_path = std::env::var("EVENT_ROUTER_DLQ_PATH")
        .unwrap_or_else(|_| "/tmp/event-router-dlq.db".to_string());

    let webhook_url = std::env::var("EVENT_ROUTER_WEBHOOK_URL").ok();
    let discord_url = std::env::var("EVENT_ROUTER_DISCORD_URL").ok();
    let slack_url = std::env::var("EVENT_ROUTER_SLACK_URL").ok();

    let telegram_token = std::env::var("EVENT_ROUTER_TELEGRAM_TOKEN").ok();
    let telegram_chat_id = std::env::var("EVENT_ROUTER_TELEGRAM_CHAT_ID").ok();

    let mqtt_host = std::env::var("EVENT_ROUTER_MQTT_HOST").ok();
    let mqtt_port: u16 = std::env::var("EVENT_ROUTER_MQTT_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1883);
    let mqtt_prefix =
        std::env::var("EVENT_ROUTER_MQTT_PREFIX").unwrap_or_else(|_| "frigate".to_string());

    // ── Build sink list ───────────────────────────────────────────────────────

    let mut sink_list: Vec<Box<dyn Sink>> = Vec::new();

    if let Some(url) = webhook_url {
        info!("Webhook sink enabled: {url}");
        sink_list.push(Box::new(sinks::webhook::WebhookSink::new(url)));
    }

    if let Some(url) = discord_url {
        info!("Discord sink enabled");
        sink_list.push(Box::new(sinks::discord::DiscordSink::new(url)));
    }

    if let Some(url) = slack_url {
        info!("Slack sink enabled");
        sink_list.push(Box::new(sinks::slack::SlackSink::new(url)));
    }

    if let (Some(token), Some(chat_id)) = (telegram_token, telegram_chat_id) {
        info!("Telegram sink enabled (chat_id={chat_id})");
        sink_list.push(Box::new(sinks::telegram::TelegramSink::new(token, chat_id)));
    }

    if let Some(host) = mqtt_host {
        info!("MQTT sink enabled: {host}:{mqtt_port} prefix={mqtt_prefix}");
        match sinks::mqtt::MqttSink::new(&host, mqtt_port, &mqtt_prefix).await {
            Ok(mqtt_sink) => sink_list.push(Box::new(mqtt_sink)),
            Err(e) => warn!("Failed to create MQTT sink: {e}"),
        }
    }

    if sink_list.is_empty() {
        warn!(
            "No sinks configured — events will be consumed but not delivered. \
             Set EVENT_ROUTER_WEBHOOK_URL, EVENT_ROUTER_DISCORD_URL, \
             EVENT_ROUTER_SLACK_URL, EVENT_ROUTER_TELEGRAM_TOKEN/CHAT_ID, \
             or EVENT_ROUTER_MQTT_HOST to enable delivery."
        );
    } else {
        info!("{} sink(s) configured", sink_list.len());
    }

    // ── Open DLQ ─────────────────────────────────────────────────────────────

    let dlq = DeadLetterQueue::open(Path::new(&dlq_path)).await?;
    info!("DLQ opened at {dlq_path}");

    // ── Build router ──────────────────────────────────────────────────────────

    let rate_limiter = EventRateLimiter::new(rate_limit);
    let router = std::sync::Arc::new(Router::new(sink_list, rate_limiter, dlq));

    // ── Start ZMQ subscriber ──────────────────────────────────────────────────

    let (tx, mut rx) = mpsc::channel(256);
    spawn_event_subscriber(tx);
    info!("ZMQ event subscriber started (rate_limit={rate_limit}/min/camera)");

    // ── Periodic DLQ retry timer ──────────────────────────────────────────────

    let router_retry = router.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let now = unix_now();
            router_retry.retry_dlq(now).await;
        }
    });

    // ── Main event loop ───────────────────────────────────────────────────────

    info!("event-router ready");
    while let Some(event) = rx.recv().await {
        router.route(&event).await;
    }

    info!("event-router shutting down");
    Ok(())
}

/// Current UNIX timestamp as f64.
fn unix_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
