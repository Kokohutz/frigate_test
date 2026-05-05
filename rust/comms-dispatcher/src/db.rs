use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde_json::Value;
use tracing::debug;

pub fn open(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path).with_context(|| format!("open SQLite at {db_path}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA busy_timeout=30000;
         PRAGMA synchronous=NORMAL;",
    )?;
    Ok(conn)
}

/// INSERT OR IGNORE a batch of recording rows from the insert_many_recordings payload.
pub fn insert_many_recordings(conn: &Connection, payload: &Value) -> Result<Vec<u8>> {
    let rows = payload
        .as_array()
        .context("insert_many_recordings payload is not a JSON array")?;

    for row in rows {
        let id = row["id"].as_str().unwrap_or_default();
        let camera = row["camera"].as_str().unwrap_or_default();
        let path = row["path"].as_str().unwrap_or_default();
        let start_time = row["start_time"].as_f64().unwrap_or(0.0);
        let end_time = row["end_time"].as_f64().unwrap_or(0.0);
        let duration = row["duration"].as_f64().unwrap_or(0.0);
        let motion = row.get("motion").and_then(|v| v.as_i64());
        let objects = row.get("objects").and_then(|v| v.as_i64());
        let regions = row.get("regions").and_then(|v| v.as_i64());
        let dbfs = row.get("dBFS").and_then(|v| v.as_i64());
        let segment_size = row["segment_size"].as_f64().unwrap_or(0.0);
        let motion_heatmap = row
            .get("motion_heatmap")
            .filter(|v| !v.is_null())
            .map(|v| v.to_string());

        conn.execute(
            "INSERT OR IGNORE INTO recordings \
             (id, camera, path, start_time, end_time, duration, motion, objects, regions, dBFS, segment_size, motion_heatmap) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![id, camera, path, start_time, end_time, duration, motion, objects, regions, dbfs, segment_size, motion_heatmap],
        )?;
    }

    debug!(count = rows.len(), "insert_many_recordings done");
    Ok(b"[]".to_vec())
}

/// INSERT OR IGNORE a single preview row.
pub fn insert_preview(conn: &Connection, payload: &Value) -> Result<Vec<u8>> {
    let id = payload["id"].as_str().unwrap_or_default();
    let camera = payload["camera"].as_str().unwrap_or_default();
    let path = payload["path"].as_str().unwrap_or_default();
    let start_time = payload["start_time"].as_f64().unwrap_or(0.0);
    let end_time = payload["end_time"].as_f64().unwrap_or(0.0);
    let duration = payload["duration"].as_f64().unwrap_or(0.0);

    conn.execute(
        "INSERT OR IGNORE INTO previews (id, camera, path, start_time, end_time, duration) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, camera, path, start_time, end_time, duration],
    )?;

    debug!(id, "insert_preview done");
    Ok(b"[]".to_vec())
}

/// UPSERT a review segment row (Python uses insert().on_conflict(update=payload)).
pub fn upsert_review_segment(conn: &Connection, payload: &Value) -> Result<Vec<u8>> {
    let id = payload["id"].as_str().unwrap_or_default();
    let camera = payload["camera"].as_str().unwrap_or_default();
    let start_time = payload["start_time"].as_f64().unwrap_or(0.0);
    let end_time = payload.get("end_time").and_then(|v| v.as_f64());
    let severity = payload["severity"].as_str().unwrap_or("detection");
    let thumb_path = payload["thumb_path"].as_str().unwrap_or_default();
    let data = payload
        .get("data")
        .filter(|v| !v.is_null())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string());

    conn.execute(
        "INSERT INTO reviewsegment (id, camera, start_time, end_time, severity, thumb_path, data) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(id) DO UPDATE SET \
           camera=excluded.camera, \
           start_time=excluded.start_time, \
           end_time=excluded.end_time, \
           severity=excluded.severity, \
           thumb_path=excluded.thumb_path, \
           data=excluded.data",
        params![id, camera, start_time, end_time, severity, thumb_path, data],
    )?;

    debug!(id, "upsert_review_segment done");
    Ok(b"[]".to_vec())
}

/// SET end_time=now() for all review segments where end_time IS NULL.
pub fn clear_ongoing_review_segments(conn: &Connection) -> Result<Vec<u8>> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    let n = conn.execute(
        "UPDATE reviewsegment SET end_time=?1 WHERE end_time IS NULL",
        params![now],
    )?;

    debug!(cleared = n, "clear_ongoing_review_segments done");
    Ok(b"[]".to_vec())
}
