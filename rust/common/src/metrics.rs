//! Simple Prometheus-format metrics exposition.
//!
//! Each Argus daemon embeds a lightweight HTTP server that serves /metrics.
//! The format is text/plain; version=0.0.4 (Prometheus default).
//!
//! Usage:
//!   1. Create a MetricsRegistry
//!   2. Register counters/gauges with register_counter / register_gauge
//!   3. Call spawn_metrics_server(registry, port) to start the HTTP server
//!   4. Use increment_counter / set_gauge to update values

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::net::TcpListener;
use tracing::{error, info};

#[derive(Clone, Debug)]
pub enum MetricValue {
    Counter(f64),
    Gauge(f64),
}

#[derive(Clone)]
pub struct MetricsRegistry {
    inner: Arc<RwLock<RegistryInner>>,
}

#[derive(Default)]
struct RegistryInner {
    metrics: HashMap<String, (String, MetricValue)>, // name → (help, value)
}

impl MetricsRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(RegistryInner::default())),
        }
    }

    pub fn register_counter(&self, name: &str, help: &str) {
        let mut inner = self.inner.write().unwrap();
        inner.metrics.insert(
            name.to_string(),
            (help.to_string(), MetricValue::Counter(0.0)),
        );
    }

    pub fn register_gauge(&self, name: &str, help: &str) {
        let mut inner = self.inner.write().unwrap();
        inner.metrics.insert(
            name.to_string(),
            (help.to_string(), MetricValue::Gauge(0.0)),
        );
    }

    pub fn increment_counter(&self, name: &str, by: f64) {
        let mut inner = self.inner.write().unwrap();
        if let Some((_, MetricValue::Counter(v))) = inner.metrics.get_mut(name) {
            *v += by;
        }
    }

    pub fn set_gauge(&self, name: &str, value: f64) {
        let mut inner = self.inner.write().unwrap();
        if let Some((_, MetricValue::Gauge(v))) = inner.metrics.get_mut(name) {
            *v = value;
        }
    }

    /// Render all metrics in Prometheus text format.
    pub fn render(&self) -> String {
        let inner = self.inner.read().unwrap();
        let mut out = String::new();
        let mut names: Vec<&String> = inner.metrics.keys().collect();
        names.sort();
        for name in names {
            let (help, value) = &inner.metrics[name];
            let (type_str, num) = match value {
                MetricValue::Counter(v) => ("counter", v),
                MetricValue::Gauge(v) => ("gauge", v),
            };
            out.push_str(&format!("# HELP {name} {help}\n"));
            out.push_str(&format!("# TYPE {name} {type_str}\n"));
            out.push_str(&format!("{name} {num}\n"));
        }
        out
    }
}

impl Default for MetricsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Spawn a Tokio task serving /metrics on the given port (e.g. 9091).
/// The server responds to GET /metrics with Prometheus text format.
/// All other paths get 404.
pub async fn spawn_metrics_server(registry: MetricsRegistry, port: u16) {
    let addr = format!("0.0.0.0:{port}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => {
            info!("metrics server listening on http://{addr}/metrics");
            l
        }
        Err(e) => {
            error!("failed to bind metrics server on {addr}: {e}");
            return;
        }
    };
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(c) => c,
                Err(_) => continue,
            };
            let reg = registry.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                let req = String::from_utf8_lossy(&buf);
                let is_metrics = req.starts_with("GET /metrics");
                let (status, body) = if is_metrics {
                    let body = reg.render();
                    ("200 OK", body)
                } else {
                    ("404 Not Found", "Not found\n".to_string())
                };
                let content_type = if is_metrics {
                    "text/plain; version=0.0.4; charset=utf-8"
                } else {
                    "text/plain"
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_counter_and_gauge() {
        let reg = MetricsRegistry::new();
        reg.register_counter("requests_total", "Total requests");
        reg.register_gauge("queue_depth", "Current queue depth");
        reg.increment_counter("requests_total", 5.0);
        reg.set_gauge("queue_depth", 3.0);
        let out = reg.render();
        assert!(out.contains("# TYPE requests_total counter"));
        assert!(out.contains("requests_total 5"));
        assert!(out.contains("# TYPE queue_depth gauge"));
        assert!(out.contains("queue_depth 3"));
    }
}
