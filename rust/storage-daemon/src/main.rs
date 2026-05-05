mod cleanup;
mod config;
mod db;
mod heatmap;
mod maintainer;
mod storage;
mod zmq;

use cleanup::{
    retention::{expire_recordings, RetentionConfig},
    wal::check_and_truncate_wal_or_warn,
};
use db::recordings::open as open_db;
use storage::pressure::{check_and_relieve_pressure, PressureState};

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use dashmap::DashMap;
use tokio::sync::mpsc;
use tokio::time::sleep;
use tracing::{info, warn};

use config::Config;
use frigate_common::zmq_types::RetainMode;
use maintainer::{
    compute_segment_info, prune_old_frames, record_audio_frame, record_video_frame, scan_cache,
    validate_segment, CameraAudioFrames, CameraVideoFrames,
};
use zmq::{spawn_detection_subscriber, DetectionEvent};

/// Retention mode to use when no camera-specific config is available.
/// In shadow mode this doesn't affect files — it only affects logged decisions.
const DEFAULT_RETAIN_MODE: RetainMode = RetainMode::Motion;

/// How often to scan the cache directory (seconds).
const SCAN_INTERVAL_SECS: u64 = 5;

/// How far back to keep detection frames in memory (seconds).
/// Frames older than this relative to now are pruned.
const FRAME_RETENTION_SECS: f64 = 120.0;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "storage_daemon=info,frigate_common=info".into()),
        )
        .init();

    let config = Config::from_env();

    if config.shadow_mode {
        info!(
            "storage-daemon starting in SHADOW MODE — will log decisions but not move files. \
             Set FRIGATE_RUST_SHADOW=0 to enable full operation."
        );
    } else {
        info!("storage-daemon starting in ACTIVE MODE");
    }

    info!(
        cache_dir = %config.cache_dir.display(),
        record_dir = %config.record_dir.display(),
        db_path = %config.db_path.display(),
        "Configuration loaded"
    );

    // Shared per-camera detection frame accumulators
    let video_frames: Arc<CameraVideoFrames> = Arc::new(DashMap::new());
    let audio_frames: Arc<CameraAudioFrames> = Arc::new(DashMap::new());

    // ZMQ detection subscriber channel
    let (det_tx, mut det_rx) = mpsc::channel::<DetectionEvent>(4096);

    // Spawn background thread for ZMQ SUB (ZMQ is not async-safe)
    spawn_detection_subscriber(det_tx);

    // Task 1: consume detection events and accumulate per-camera frame data
    let vf = Arc::clone(&video_frames);
    let af = Arc::clone(&audio_frames);
    tokio::spawn(async move {
        while let Some(event) = det_rx.recv().await {
            match event {
                DetectionEvent::Video {
                    camera,
                    frame_time,
                    tracked_objects,
                    motion_boxes,
                    regions,
                } => {
                    record_video_frame(
                        &vf,
                        &camera,
                        frame_time,
                        tracked_objects,
                        motion_boxes,
                        regions,
                    );
                }
                DetectionEvent::Audio {
                    camera,
                    frame_time,
                    db_fs,
                    audio_labels,
                } => {
                    record_audio_frame(&af, &camera, frame_time, db_fs, audio_labels);
                }
            }
        }
    });

    // Task 2: periodic cache scan + segment validation (shadow mode: log only)
    let config_arc = Arc::new(config);
    let vf = Arc::clone(&video_frames);
    let af = Arc::clone(&audio_frames);
    let cfg = Arc::clone(&config_arc);

    tokio::spawn(async move {
        // Track which segments we've already processed (by path string)
        let processed: DashMap<String, bool> = DashMap::new();

        loop {
            let cycle_start = Instant::now();

            match run_scan_cycle(&cfg, &vf, &af, &processed).await {
                Ok(count) => {
                    if count > 0 {
                        info!("Scan cycle: processed {count} segments");
                    }
                }
                Err(e) => {
                    warn!("Scan cycle error: {e}");
                }
            }

            // Prune old frames (> FRAME_RETENTION_SECS seconds old)
            let cutoff = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs_f64() - FRAME_RETENTION_SECS)
                .unwrap_or(0.0);
            prune_old_frames(&vf, &af, cutoff);

            // Wait remainder of SCAN_INTERVAL_SECS
            let elapsed = cycle_start.elapsed();
            let wait = Duration::from_secs(SCAN_INTERVAL_SECS).saturating_sub(elapsed);
            sleep(wait).await;
        }
    });

    // Task 3 & 4: cleanup + storage pressure (only when FRIGATE_RUST_CLEANUP=1)
    if config_arc.cleanup_enabled {
        info!(
            continuous_retain_days = config_arc.continuous_retain_days,
            motion_retain_days = config_arc.motion_retain_days,
            "Cleanup enabled — Rust owns WAL truncation, retention, and disk pressure"
        );

        let cfg = Arc::clone(&config_arc);
        tokio::spawn(async move {
            let conn = match open_db(&cfg.db_path).await {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Cleanup: failed to open DB: {e}");
                    return;
                }
            };
            let retention_cfg = RetentionConfig {
                continuous_retain_days: cfg.continuous_retain_days,
                motion_retain_days: cfg.motion_retain_days,
            };
            // Cameras list is empty in Phase B; cleanup still runs for all cameras it finds.
            let cameras: Vec<String> = cfg.cameras.iter().map(|c| c.name.clone()).collect();

            let mut wal_counter = 0u64;
            loop {
                // WAL check every loop iteration (60s)
                check_and_truncate_wal_or_warn(&cfg.db_path).await;

                // Retention sweep hourly (every 60 iterations × 60s)
                wal_counter += 1;
                if wal_counter % 60 == 0 {
                    if let Err(e) = expire_recordings(&conn, &cameras, &retention_cfg).await {
                        warn!("Retention sweep failed: {e}");
                    }
                }

                sleep(Duration::from_secs(60)).await;
            }
        });

        let cfg = Arc::clone(&config_arc);
        tokio::spawn(async move {
            let conn = match open_db(&cfg.db_path).await {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Storage pressure: failed to open DB: {e}");
                    return;
                }
            };
            let cameras: Vec<String> = cfg.cameras.iter().map(|c| c.name.clone()).collect();
            let mut state = PressureState::new();
            loop {
                if let Err(e) =
                    check_and_relieve_pressure(&conn, &cfg.record_dir, &mut state, &cameras).await
                {
                    warn!("Storage pressure check failed: {e}");
                }
                sleep(Duration::from_secs(300)).await;
            }
        });
    }

    // Keep main alive until Ctrl-C
    tokio::signal::ctrl_c().await?;
    info!("storage-daemon shutting down");
    Ok(())
}

/// One iteration of the cache scan loop.
/// Scans /tmp/cache/, validates each new segment, logs the retention decision.
async fn run_scan_cycle(
    config: &Config,
    video_frames: &CameraVideoFrames,
    audio_frames: &CameraAudioFrames,
    processed: &DashMap<String, bool>,
) -> Result<usize> {
    let segments = scan_cache(&config.cache_dir)?;
    let mut count = 0;

    // Group by camera and sort by start_time (oldest first)
    let mut by_camera: std::collections::HashMap<String, Vec<_>> = std::collections::HashMap::new();
    for seg in segments {
        by_camera.entry(seg.camera.clone()).or_default().push(seg);
    }
    for segs in by_camera.values_mut() {
        segs.sort_by_key(|s| s.start_time);
    }

    for camera_segs in by_camera.values() {
        // The newest segment is still being written — skip it (last in sorted order)
        let to_validate = if camera_segs.len() > 1 {
            &camera_segs[..camera_segs.len() - 1]
        } else {
            &[]
        };

        for seg in to_validate {
            let path_str = seg.path.to_string_lossy().into_owned();

            // Skip already-processed segments
            if processed.contains_key(&path_str) {
                continue;
            }

            // Validate the segment
            let validation = tokio::task::spawn_blocking({
                let path = seg.path.clone();
                let ffmpeg = config.ffmpeg_path.clone();
                move || validate_segment(&path, &ffmpeg)
            })
            .await??;

            if !validation.is_valid() {
                warn!(
                    path = %seg.path.display(),
                    duration = validation.duration_secs,
                    has_video = validation.has_video,
                    "SHADOW: segment invalid — would discard"
                );
                processed.insert(path_str, false);
                count += 1;
                continue;
            }

            // Compute end time from duration
            let end_time = seg.start_time
                + chrono::Duration::milliseconds((validation.duration_secs * 1000.0) as i64);

            // Compute segment info from accumulated detection data
            let seg_info = compute_segment_info(
                &seg.camera,
                seg.start_time,
                end_time,
                video_frames,
                audio_frames,
            );

            // Apply retention decision
            let should_discard = seg_info.should_discard(DEFAULT_RETAIN_MODE);

            info!(
                path = %seg.path.display(),
                camera = %seg.camera,
                duration = %format!("{:.2}s", validation.duration_secs),
                motion = seg_info.motion_count,
                objects = seg_info.active_object_count,
                db_fs = seg_info.average_db_fs,
                retain_mode = ?DEFAULT_RETAIN_MODE,
                decision = if should_discard { "DISCARD" } else { "KEEP" },
                "SHADOW: segment decision"
            );

            if config.shadow_mode {
                // Shadow mode: log only, do not move or delete
                processed.insert(path_str, !should_discard);
            }

            count += 1;
        }
    }

    Ok(count)
}
