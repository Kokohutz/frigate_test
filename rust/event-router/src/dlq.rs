// Dead-letter queue for failed event deliveries.
// Persists to SQLite at the path configured by event_router.dead_letter.path.
// Retries failed deliveries on event_router.dead_letter.retry_interval (seconds).
