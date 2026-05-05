# CLAUDE.md — Frigate NVR Development Guide

## Repository Layout

| Directory | Language | Purpose |
|-----------|----------|---------|
| `frigate/` | Python | Backend: FastAPI, multiprocessing, ZMQ, detection, recording |
| `web/` | TypeScript | Frontend: Vite + React |
| `docker/` | Dockerfile | Multi-arch Docker builds |
| `migrations/` | Python | Peewee database migrations |
| `rust/` | Rust | Microservices (NEW — see below) |

---

## Python Development

### Commands
```bash
# Unit tests
python3 -u -m unittest

# Type checking
python3 -u -m mypy --config-file frigate/mypy.ini frigate

# Format + lint (uses Ruff — see pyproject.toml)
ruff format frigate/
ruff check frigate/
```

### Key Architecture Invariants

**Process model:** Python multiprocessing with `forkserver` backend (set in `frigate/__main__.py`).

**ZMQ sockets:**
| Socket | Address | Pattern | Used for |
|--------|---------|---------|---------|
| REP/REQ | `ipc:///tmp/cache/comms` | Synchronous | DB writes, config queries |
| PUB (publish to) | `ipc:///tmp/cache/proxy_pub` | Pub/Sub | Detection/recording/event data |
| SUB (subscribe to) | `ipc:///tmp/cache/proxy_sub` | Pub/Sub | Receiving same |

**REP/REQ wire format** (`inter_process.py`):
- Send: `socket.send_json(["topic_name", data])` — always a 2-element JSON array
- Recv: `socket.recv_json()` — any JSON (must **always** recv after every send)

**PUB/SUB wire format** (`zmq_proxy.py`):
- Publish: `socket.send_string(f"{topic} {json.dumps(payload)}")`
- Receive: `parts = msg.split(maxsplit=1)` → `[topic, json_payload]`

**Topic namespaces:** `recordings/`, `detection/`, `event/`, `review/`

**Shared memory** (`util/image.py`):
- Camera frames: `/dev/shm/{camera_name}` — raw frame bytes
- Detector output: `/dev/shm/out-{camera_name}` — `(20, 6)` float32 array
- Columns: `[class_id, confidence, y_min, x_min, y_max, x_max]` (normalized 0–1)

**Database:** SQLite at `/config/frigate.db` via Peewee ORM, WAL mode, WAL truncated at >10MB.

**File paths:**
- Cache segments: `/tmp/cache/{camera}@{YYYYMMDDHHMMSS+UTC}.mp4`
- Permanent: `/media/frigate/recordings/{YYYY-MM-DD}/{HH}/{camera}/{MM.SS}.mp4`
- Segment duration: 10 seconds (configured in `ffmpeg_presets.py`)

### Files to Never Change Without Understanding
- `frigate/comms/zmq_proxy.py` — ZMQ proxy addresses; changing breaks all IPC
- `frigate/comms/inter_process.py` — REP/REQ socket address
- `frigate/const.py` — all topic name constants and path constants
- `frigate/models.py` — Peewee ORM models; column changes require a migration in `migrations/`

### Adding a New IPC Topic
1. Add constant to `frigate/const.py`
2. Add handler in `frigate/comms/dispatcher.py`
3. Add to `_WS_BLOCKED_TOPICS` in `frigate/comms/ws.py` if it must not be WebSocket-accessible
4. Implement the Rust client/server in `rust/common/src/zmq_types.rs`

---

## Rust Development

### Workspace Location
All Rust code lives under `rust/`. Run commands from that directory.

```bash
cd rust

# Format (required before commit)
cargo fmt --all

# Lint (zero warnings policy)
cargo clippy --all-targets --all-features -- -D warnings

# Build (debug)
cargo build --all

# Build (release — used in Docker)
cargo build --release --all

# Tests
cargo test --all
cargo test --all -- --nocapture   # with stdout
```

### MSRV
**Minimum Supported Rust Version: 1.82.0** (edition 2021)

### Crate Overview

| Crate | Binary | Replaces / Adds |
|-------|--------|----------------|
| `frigate-common` | (library) | Shared ZMQ types, error types |
| `storage-daemon` | `storage-daemon` | RecordingMaintainer + RecordingCleanup + StorageMaintainer |
| `encrypted-storage` | `encrypted-storage` | New: AES-256-GCM/ChaCha20 at-rest encryption |
| `tiered-storage` | `tiered-storage` | New: Hot NVMe → Cold HDD automatic migration |
| `detection-bridge` | `detection-bridge` | Multi-model ONNX inference chain (extends ZmqIpcDetector) |
| `event-router` | `event-router` | New: MQTT/webhook/Discord/Telegram/Slack routing |

### ZMQ Compatibility Rules
Rust services **must** be wire-compatible with the Python ZMQ code above:
1. REQ socket always alternates send/recv — reconnect the socket on any error
2. PUB messages: `"{topic} {json_payload}"` (single space, topic has no spaces)
3. SUB subscriptions are prefix-based (`"detection/"` catches all detection subtopics)
4. REQ socket busy_timeout doesn't apply — handle timeouts by reconnecting

### SQLite Compatibility
Both Python (Peewee) and Rust (rusqlite) may read/write the same database. Required Rust pragma on every connection:
```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=30000;
PRAGMA synchronous=NORMAL;
```

### Coding Conventions
- All I/O must be `async` (tokio)
- Use `tracing::info!/warn!/error!` (not `println!`)
- `anyhow::Result` for binary code; `thiserror` errors for library code
- Prefer `dashmap::DashMap` over `Mutex<HashMap>` for concurrent read-heavy maps
- All ZMQ message structs go in `rust/common/src/zmq_types.rs`

---

## Docker Build

```bash
make local      # standard build (amd64)
make debug      # debug build
make amd64      # explicit amd64
make arm64      # explicit arm64
```

The Rust binaries are built in the `rust-builder` Docker stage and installed to `/usr/local/bin/` in the final image.

---

## Branch Strategy

```
claude/rust-workspace-init         # workspace scaffold, CI, Dockerfile stub
claude/rust-storage-daemon-phase-a # shadow validation mode
claude/rust-storage-daemon-phase-b # cleanup + storage pressure cutover
claude/rust-storage-daemon-phase-c # full recording maintainer cutover
claude/rust-encrypted-storage      # Module 2
claude/rust-tiered-storage         # Module 3
claude/rust-detection-bridge       # Module 4
claude/rust-event-router           # Module 5
```

---

## Testing

### Python
```bash
python3 -u -m unittest
ruff format --check frigate/
ruff check frigate/
```

### Rust
```bash
cd rust
cargo test --all
```

### Integration (Python + Rust)
See `rust/storage-daemon/tests/` for the integration test harness that
exercises Python ZMQ clients against the Rust server.
