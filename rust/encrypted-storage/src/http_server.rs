// Axum HTTP server on 127.0.0.1:5002.
// Serves encrypted .mp4 files with transparent range-request decryption.
// Nginx proxies read requests from the Frigate API to this server.
//
// Supports HTTP Range header: decrypt only the requested byte range.
// Response headers: Content-Type: video/mp4, Accept-Ranges: bytes.

use crate::cipher::Cipher;
use crate::file_format;
use anyhow::Result;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{path::PathBuf, sync::Arc};
use tracing::{error, info, warn};

#[derive(Clone)]
struct AppState {
    record_dir: PathBuf,
    cipher: Arc<dyn Cipher + Send + Sync>,
    key_id: [u8; 32],
}

/// Parse a `Range: bytes=N-M` header. Returns `(start, end_inclusive)`.
/// M may be omitted (meaning to the end of the file).
fn parse_range(header_value: &str, file_len: usize) -> Option<(usize, usize)> {
    let stripped = header_value.strip_prefix("bytes=")?;
    let (start_str, end_str) = stripped.split_once('-')?;

    let start: usize = start_str.trim().parse().ok()?;
    let end: usize = if end_str.trim().is_empty() {
        file_len.saturating_sub(1)
    } else {
        end_str.trim().parse().ok()?
    };

    if start > end || start >= file_len {
        return None;
    }

    let clamped_end = end.min(file_len.saturating_sub(1));
    Some((start, clamped_end))
}

async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn recordings_handler(
    State(state): State<AppState>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> Response {
    let file_path = state.record_dir.join(&path);

    // Read the file
    let data = match tokio::fs::read(&file_path).await {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            warn!("File not found: {}", file_path.display());
            return (StatusCode::NOT_FOUND, "file not found").into_response();
        }
        Err(e) => {
            error!("Failed to read file {}: {}", file_path.display(), e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to read file").into_response();
        }
    };

    // Check if it's an encrypted FRGE file
    if !file_format::is_encrypted(&data) {
        warn!(
            "Requested file is not an FRGE-encrypted file: {}",
            file_path.display()
        );
        return (StatusCode::BAD_REQUEST, "not an encrypted FRGE file").into_response();
    }

    // Decrypt the file
    let plaintext = match file_format::decrypt_file(state.cipher.as_ref(), &state.key_id, &data) {
        Ok(p) => p,
        Err(e) => {
            error!("Decryption failed for {}: {}", file_path.display(), e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "decryption failed").into_response();
        }
    };

    let total_len = plaintext.len();

    // Handle Range header
    if let Some(range_val) = headers.get(header::RANGE) {
        let range_str = match range_val.to_str() {
            Ok(s) => s,
            Err(_) => {
                return (StatusCode::BAD_REQUEST, "invalid Range header").into_response();
            }
        };

        match parse_range(range_str, total_len) {
            Some((start, end)) => {
                let slice = plaintext[start..=end].to_vec();
                let content_range = format!("bytes {}-{}/{}", start, end, total_len);
                let content_len = slice.len().to_string();

                Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, "video/mp4")
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_RANGE, content_range)
                    .header(header::CONTENT_LENGTH, content_len)
                    .body(Body::from(slice))
                    .unwrap_or_else(|e| {
                        error!("Failed to build range response: {}", e);
                        (StatusCode::INTERNAL_SERVER_ERROR, "response build error").into_response()
                    })
            }
            None => {
                // Range not satisfiable
                let content_range = format!("bytes */{}", total_len);
                Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", content_range)
                    .body(Body::empty())
                    .unwrap_or_else(|_| StatusCode::RANGE_NOT_SATISFIABLE.into_response())
            }
        }
    } else {
        // Full response
        let content_len = total_len.to_string();
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "video/mp4")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, content_len)
            .body(Body::from(plaintext))
            .unwrap_or_else(|e| {
                error!("Failed to build response: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "response build error").into_response()
            })
    }
}

pub async fn run_server(
    bind_addr: &str,
    record_dir: PathBuf,
    cipher: Arc<dyn Cipher + Send + Sync>,
    key_id: [u8; 32],
) -> Result<()> {
    let state = AppState {
        record_dir,
        cipher,
        key_id,
    };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/recordings/*path", get(recordings_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    info!("encrypted-storage HTTP server listening on {}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range_full() {
        assert_eq!(parse_range("bytes=0-99", 200), Some((0, 99)));
    }

    #[test]
    fn test_parse_range_open_end() {
        assert_eq!(parse_range("bytes=100-", 200), Some((100, 199)));
    }

    #[test]
    fn test_parse_range_clamp_end() {
        // End extends beyond file length — clamp to last byte
        assert_eq!(parse_range("bytes=0-999", 200), Some((0, 199)));
    }

    #[test]
    fn test_parse_range_invalid_start() {
        // Start beyond file length
        assert_eq!(parse_range("bytes=500-999", 200), None);
    }

    #[test]
    fn test_parse_range_start_gt_end() {
        assert_eq!(parse_range("bytes=50-10", 200), None);
    }

    #[test]
    fn test_parse_range_bad_format() {
        assert_eq!(parse_range("bytes=abc-def", 200), None);
        assert_eq!(parse_range("invalid", 200), None);
    }
}
