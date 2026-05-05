use std::path::Path;

use anyhow::Result;
use tokio_rusqlite::Connection;
use tracing::debug;

/// A single failed-delivery entry stored in the dead-letter queue.
#[derive(Debug, Clone)]
pub struct DlqEntry {
    pub id: i64,
    pub event_json: String,
    pub sink: String,
    // These fields are stored for observability / future use
    #[allow(dead_code)]
    pub error: String,
    pub attempt_count: i64,
    #[allow(dead_code)]
    pub created_at: f64,
    #[allow(dead_code)]
    pub next_retry_at: f64,
}

/// SQLite-backed dead-letter queue for failed event deliveries.
///
/// Entries are retried with exponential backoff:
///   next_retry_at = now + min(attempt_count² × 60, 3600) seconds
pub struct DeadLetterQueue {
    conn: Connection,
}

impl DeadLetterQueue {
    /// Open (or create) the DLQ database at `path`.
    pub async fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).await?;

        conn.call(|c| {
            c.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA busy_timeout=30000;
                 PRAGMA synchronous=NORMAL;
                 CREATE TABLE IF NOT EXISTS dlq (
                     id             INTEGER PRIMARY KEY AUTOINCREMENT,
                     event_json     TEXT    NOT NULL,
                     sink           TEXT    NOT NULL,
                     error          TEXT    NOT NULL,
                     attempt_count  INTEGER NOT NULL DEFAULT 1,
                     created_at     REAL    NOT NULL,
                     next_retry_at  REAL    NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_dlq_next_retry ON dlq (next_retry_at);",
            )?;
            Ok(())
        })
        .await?;

        Ok(Self { conn })
    }

    /// Insert a new failed delivery into the DLQ.
    ///
    /// `next_retry_at` is set to `now + 60` seconds (first retry after 1 minute).
    pub async fn push(&self, event_json: &str, sink: &str, error: &str) -> Result<()> {
        let now = unix_now();
        let next_retry_at = now + 60.0;
        let event_json = event_json.to_string();
        let sink_name = sink.to_string();
        let error = error.to_string();
        let sink_log = sink_name.clone();

        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT INTO dlq (event_json, sink, error, attempt_count, created_at, next_retry_at)
                     VALUES (?1, ?2, ?3, 1, ?4, ?5)",
                    rusqlite::params![event_json, sink_name, error, now, next_retry_at],
                )?;
                Ok(())
            })
            .await?;

        debug!("DLQ: pushed failed delivery to sink={sink_log}");
        Ok(())
    }

    /// Fetch up to 50 entries whose `next_retry_at` is at or before `now`.
    pub async fn pop_due(&self, now: f64) -> Result<Vec<DlqEntry>> {
        let entries = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT id, event_json, sink, error, attempt_count, created_at, next_retry_at
                     FROM dlq
                     WHERE next_retry_at <= ?1
                     ORDER BY next_retry_at
                     LIMIT 50",
                )?;
                let rows = stmt.query_map(rusqlite::params![now], |row| {
                    Ok(DlqEntry {
                        id: row.get(0)?,
                        event_json: row.get(1)?,
                        sink: row.get(2)?,
                        error: row.get(3)?,
                        attempt_count: row.get(4)?,
                        created_at: row.get(5)?,
                        next_retry_at: row.get(6)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
            })
            .await?;

        Ok(entries)
    }

    /// Delete a successfully retried entry.
    pub async fn delete(&self, id: i64) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute("DELETE FROM dlq WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// Increment the attempt counter and schedule the next retry with exponential backoff.
    ///
    /// Back-off formula: `next_retry_at = now + min(attempt_count² × 60, 3600)`
    pub async fn increment_retry(&self, id: i64, next_retry_at: f64) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "UPDATE dlq SET attempt_count = attempt_count + 1, next_retry_at = ?1
                     WHERE id = ?2",
                    rusqlite::params![next_retry_at, id],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }
}

/// Current UNIX timestamp as f64 (seconds since epoch).
fn unix_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    async fn open_temp_dlq() -> DeadLetterQueue {
        let tmp = NamedTempFile::new().expect("temp file");
        let path = tmp.path().to_path_buf();
        // Keep the temp file alive by leaking (path persists for test duration)
        std::mem::forget(tmp);
        DeadLetterQueue::open(&path).await.expect("open DLQ")
    }

    #[tokio::test]
    async fn test_push_and_pop_due() {
        let dlq = open_temp_dlq().await;

        // Push an entry
        let event_json = r#"{"topic":"event/update","camera":"front"}"#;
        dlq.push(event_json, "webhook", "connection refused")
            .await
            .unwrap();

        // Nothing should be due right now (next_retry = now + 60)
        let now = unix_now();
        let entries = dlq.pop_due(now).await.unwrap();
        assert!(
            entries.is_empty(),
            "no entries should be due immediately after push"
        );

        // Entries should be due 120 seconds from now
        let far_future = now + 120.0;
        let entries = dlq.pop_due(far_future).await.unwrap();
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.sink, "webhook");
        assert_eq!(e.error, "connection refused");
        assert_eq!(e.attempt_count, 1);
    }

    #[tokio::test]
    async fn test_delete() {
        let dlq = open_temp_dlq().await;

        dlq.push(r#"{"camera":"back"}"#, "mqtt", "timeout")
            .await
            .unwrap();

        let far_future = unix_now() + 120.0;
        let entries = dlq.pop_due(far_future).await.unwrap();
        assert_eq!(entries.len(), 1);
        let id = entries[0].id;

        dlq.delete(id).await.unwrap();

        let after = dlq.pop_due(far_future).await.unwrap();
        assert!(after.is_empty(), "entry should have been deleted");
    }

    #[tokio::test]
    async fn test_increment_retry() {
        let dlq = open_temp_dlq().await;

        dlq.push(r#"{"camera":"side"}"#, "discord", "http 500")
            .await
            .unwrap();

        let far_future = unix_now() + 120.0;
        let entries = dlq.pop_due(far_future).await.unwrap();
        let id = entries[0].id;

        // Schedule next attempt 300 s from now
        let next = unix_now() + 300.0;
        dlq.increment_retry(id, next).await.unwrap();

        // Should not be due at far_future (300 > 120)
        let entries2 = dlq.pop_due(far_future).await.unwrap();
        assert!(
            entries2.is_empty(),
            "entry should not be due yet after increment"
        );

        // Should be due 400 s from now
        let entries3 = dlq.pop_due(unix_now() + 400.0).await.unwrap();
        assert_eq!(entries3.len(), 1);
        assert_eq!(entries3[0].attempt_count, 2);
    }
}
