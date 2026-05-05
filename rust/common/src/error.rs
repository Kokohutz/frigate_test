use thiserror::Error;

#[derive(Debug, Error)]
pub enum FrigateError {
    #[error("ZMQ error: {0}")]
    Zmq(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(String),

    #[error("MP4 parse error: {0}")]
    Mp4Parse(String),

    #[error("{0}")]
    Other(String),
}
