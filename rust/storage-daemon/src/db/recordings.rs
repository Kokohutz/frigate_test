// Recordings table queries.
// Schema (from frigate/models.py):
//   id VARCHAR(30) PK, camera VARCHAR(20), path VARCHAR(255) UNIQUE,
//   start_time DATETIME, end_time DATETIME, duration FLOAT,
//   motion INT, objects INT, dBFS INT, segment_size FLOAT,
//   regions INT, motion_heatmap JSON

use std::path::Path;

use anyhow::{Context, Result};
use tokio_rusqlite::Connection;

pub struct RecordingRow {
    pub id: String,
    pub camera: String,
    pub path: String,
    pub start_time: f64,
    pub end_time: f64,
    #[allow(dead_code)]
    pub motion: i64,
    #[allow(dead_code)]
    pub objects: i64,
    #[allow(dead_code)]
    pub db_fs: i64,
    pub segment_size: f64,
}

pub struct EventRow {
    pub id: String,
    #[allow(dead_code)]
    pub camera: String,
    pub start_time: f64,
    pub end_time: Option<f64>,
}

/// Open a tokio-rusqlite connection and apply required WAL pragmas.
pub async fn open(db_path: &Path) -> Result<Connection> {
    let path = db_path.to_owned();
    let conn = Connection::open(&path)
        .await
        .with_context(|| format!("open SQLite {}", path.display()))?;

    conn.call(|c| {
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA busy_timeout=30000;
             PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| tokio_rusqlite::Error::Other(e.into()))
    })
    .await
    .context("apply WAL pragmas")?;

    Ok(conn)
}

/// Fetch recordings eligible for expiry for a given camera.
/// Returns recordings where end_time < motion_expire_ts, or where
/// end_time < continuous_expire_ts AND motion==0 AND dBFS==0.
pub async fn fetch_expired_recordings(
    conn: &Connection,
    camera: String,
    continuous_expire_ts: f64,
    motion_expire_ts: f64,
) -> Result<Vec<RecordingRow>> {
    conn.call(move |c| {
        let mut stmt = c.prepare_cached(
            "SELECT id, camera, path, start_time, end_time, \
                    COALESCE(motion, 0), COALESCE(objects, 0), \
                    COALESCE(dBFS, 0), COALESCE(segment_size, 0) \
             FROM recordings \
             WHERE camera = ?1 \
               AND ( end_time < ?2 \
                     OR (end_time < ?3 AND motion = 0 AND dBFS = 0) \
                   ) \
             ORDER BY start_time ASC",
        )?;
        let rows = stmt
            .query_map(
                rusqlite::params![camera, motion_expire_ts, continuous_expire_ts],
                |row| {
                    Ok(RecordingRow {
                        id: row.get(0)?,
                        camera: row.get(1)?,
                        path: row.get(2)?,
                        start_time: row.get(3)?,
                        end_time: row.get(4)?,
                        motion: row.get(5)?,
                        objects: row.get(6)?,
                        db_fs: row.get(7)?,
                        segment_size: row.get(8)?,
                    })
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
    .context("fetch_expired_recordings")
}

/// Fetch recordings for cameras no longer in the configured camera list.
pub async fn fetch_orphan_recordings(
    conn: &Connection,
    known_cameras: Vec<String>,
    expire_before_ts: f64,
) -> Result<Vec<RecordingRow>> {
    conn.call(move |c| {
        // Build NOT IN clause dynamically
        let placeholders: String = known_cameras
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT id, camera, path, start_time, end_time, \
                    COALESCE(motion, 0), COALESCE(objects, 0), \
                    COALESCE(dBFS, 0), COALESCE(segment_size, 0) \
             FROM recordings \
             WHERE end_time < ?1 \
               AND camera NOT IN ({placeholders}) \
             ORDER BY start_time ASC"
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(expire_before_ts)];
        for cam in &known_cameras {
            params.push(Box::new(cam.clone()));
        }
        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();

        // Use prepare() not prepare_cached(): the SQL is dynamic (variable number of
        // camera placeholders), so caching by SQL text would return a stale statement
        // with a mismatched parameter count on subsequent calls with a different camera list.
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(RecordingRow {
                    id: row.get(0)?,
                    camera: row.get(1)?,
                    path: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                    motion: row.get(5)?,
                    objects: row.get(6)?,
                    db_fs: row.get(7)?,
                    segment_size: row.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
    .context("fetch_orphan_recordings")
}

/// Bulk-delete recordings by ID. Deletes in chunks of 100,000.
pub async fn delete_recordings_batch(conn: &Connection, ids: Vec<String>) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut total = 0usize;
    for chunk in ids.chunks(100_000) {
        let chunk = chunk.to_vec();
        let deleted = conn
            .call(move |c| {
                let placeholders = chunk
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql = format!("DELETE FROM recordings WHERE id IN ({placeholders})");
                let params_refs: Vec<&dyn rusqlite::ToSql> =
                    chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                c.execute(&sql, params_refs.as_slice())
                    .map_err(|e| tokio_rusqlite::Error::Other(e.into()))
            })
            .await
            .context("delete_recordings_batch")?;
        total += deleted;
    }
    Ok(total)
}

/// Fetch the oldest recordings across all cameras for disk pressure relief.
pub async fn fetch_oldest_recordings(conn: &Connection, limit: usize) -> Result<Vec<RecordingRow>> {
    conn.call(move |c| {
        let mut stmt = c.prepare_cached(
            "SELECT id, camera, path, start_time, end_time, \
                    COALESCE(motion, 0), COALESCE(objects, 0), \
                    COALESCE(dBFS, 0), COALESCE(segment_size, 0) \
             FROM recordings \
             ORDER BY start_time ASC \
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![limit as i64], |row| {
                Ok(RecordingRow {
                    id: row.get(0)?,
                    camera: row.get(1)?,
                    path: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                    motion: row.get(5)?,
                    objects: row.get(6)?,
                    db_fs: row.get(7)?,
                    segment_size: row.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
    .context("fetch_oldest_recordings")
}

/// Fetch events that must be retained indefinitely and have a clip.
/// Used to skip their overlapping recordings during pressure relief.
pub async fn fetch_retained_events(conn: &Connection) -> Result<Vec<EventRow>> {
    conn.call(|c| {
        let mut stmt = c.prepare_cached(
            "SELECT id, camera, start_time, end_time \
             FROM event \
             WHERE retain_indefinitely = 1 AND has_clip = 1 \
             ORDER BY start_time ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(EventRow {
                    id: row.get(0)?,
                    camera: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
    .await
    .context("fetch_retained_events")
}

/// Set has_clip = 0 for a list of event IDs. Batched in chunks of 100,000.
pub async fn update_events_has_clip(conn: &Connection, event_ids: Vec<String>) -> Result<()> {
    if event_ids.is_empty() {
        return Ok(());
    }
    for chunk in event_ids.chunks(100_000) {
        let chunk = chunk.to_vec();
        conn.call(move |c| {
            let placeholders = chunk
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!("UPDATE event SET has_clip = 0 WHERE id IN ({placeholders})");
            let params_refs: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            c.execute(&sql, params_refs.as_slice())
                .map(|_| ())
                .map_err(|e| tokio_rusqlite::Error::Other(e.into()))
        })
        .await
        .context("update_events_has_clip")?;
    }
    Ok(())
}

/// Return the average MB/hr for a camera based on its last 100 segments.
/// Returns 0.0 if no segments with positive segment_size exist.
pub async fn compute_camera_bandwidth(conn: &Connection, camera: String) -> Result<f64> {
    conn.call(move |c| {
        // Subquery: last 100 segments, compute segment_size / duration seconds * 3600
        let bw: Option<f64> = c.query_row(
            "SELECT AVG(bw) FROM ( \
               SELECT CAST(segment_size AS REAL) / (end_time - start_time) * 3600.0 AS bw \
               FROM recordings \
               WHERE camera = ?1 AND segment_size > 0 AND end_time > start_time \
               ORDER BY start_time DESC \
               LIMIT 100 \
             )",
            rusqlite::params![camera],
            |row| row.get(0),
        )?;
        Ok(bw.unwrap_or(0.0))
    })
    .await
    .context("compute_camera_bandwidth")
}

/// Return the count of recordings with positive segment_size for a camera.
/// Used to decide whether the bandwidth estimate needs refresh (< 50 → refresh).
pub async fn total_recordings_count(conn: &Connection, camera: String) -> Result<i64> {
    conn.call(move |c| {
        let count: i64 = c.query_row(
            "SELECT COUNT(*) FROM recordings WHERE camera = ?1 AND segment_size > 0",
            rusqlite::params![camera],
            |row| row.get(0),
        )?;
        Ok(count)
    })
    .await
    .context("total_recordings_count")
}
