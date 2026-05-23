<div align="center">

# 👁️ Argus

### **The watchman that never sleeps.**

A modern, AI-first NVR built on Rust microservices, with end-to-end TLS, hardware-agnostic detection, and a visual pipeline editor.

![Argus UI demo](docs/images/demo.gif)

</div>

---

## What is Argus?

**Argus** is an open-source Network Video Recorder (NVR) forked from Frigate and rebuilt around a Rust performance core. Where the original is single-threaded Python, Argus moves the hot paths — segment validation, retention, encryption, tiered storage, event routing, and ZMQ IPC — into purpose-built async Rust daemons. The Python orchestrator, web UI, and Home-Assistant integration remain familiar and compatible.

**You get:**

- 🦀 **6 Rust microservices** handling everything storage and IPC. Sub-millisecond IPC, 15 ms cold starts, 50× fewer subprocess forks per minute.
- 🎯 **Visual pipeline editor** — wire cameras → detectors → AI agents → storage from your browser. No more hand-edited YAML.
- 🤖 **8 LLM providers built-in** — Anthropic Claude, OpenAI, Azure, Gemini, Zhipu GLM, Alibaba Qwen, Ollama, llama.cpp. Hot-swap providers per camera.
- 🔐 **Native TOTP 2FA** for admin accounts with recovery codes. RFC 6238 implementation using only the `cryptography` wheel — no extra deps.
- 📦 **Transparent at-rest encryption** (AES-256-GCM / ChaCha20-Poly1305) of all MP4 segments.
- 🗄️ **Tiered storage** — automatic hot NVMe → cold HDD/NAS migration with retention policies that respect retained events.
- 🔍 **Multi-model detection chains** via the `zmq_ipc` detector — primary YOLO + secondary license-plate / face / animal model on the same frame.
- 📡 **Event routing** to MQTT, webhooks, Discord, Telegram, Slack with token-bucket rate limiting and SQLite-backed dead-letter queue.

> Argus is **wire-compatible with Frigate** — your existing `config.yml` works as-is. Drop in the new Docker image and you immediately get the Rust hot paths.

---

## Quick start

```yaml
# docker-compose.yml
services:
  argus:
    image: ghcr.io/kokohutz/argus:latest
    container_name: argus
    restart: unless-stopped
    privileged: true
    shm_size: 256mb
    environment:
      ARGUS_RUST_DISPATCHER: "1"     # route DB writes through Rust
      ARGUS_RUST_CLEANUP: "1"        # let Rust own retention + WAL truncation
      STORAGE_ENCRYPTION_KEY: ${ARGUS_AT_REST_KEY}
    devices:
      - /dev/bus/usb:/dev/bus/usb    # Coral USB
      - /dev/dri/renderD128          # Intel iGPU
    volumes:
      - ./config:/config
      - /mnt/nvme/argus:/media/argus/hot    # fast tier
      - /mnt/nas/argus:/media/argus/cold    # cold tier
    ports:
      - "8971:8971"   # HTTPS UI + API
```

```bash
docker compose up -d
open https://localhost:8971
```

First-time login: username `admin`, password printed once to the container log. Argus will immediately prompt you to **enable 2FA** before allowing any config changes.

---

## Screenshots

### Visual pipeline editor

The pipeline page gives a live graph of your entire NVR stack. Click any node to edit its settings. Drag nodes to rearrange. Use the toolbar to add detectors, GenAI agents, and configure tiered storage or event routing.

| Dark theme | Light theme |
|:---:|:---:|
| ![Pipeline dark](docs/images/v2/pipeline-tiered-dark.png) | ![Pipeline light](docs/images/v2/pipeline-tiered-light.png) |

### Tiered storage configuration

| Dark theme | Light theme |
|:---:|:---:|
| ![Tiers dark](docs/images/v2/dialog-tiers-dark.png) | ![Tiers light](docs/images/v2/dialog-tiers-light.png) |

### Event router configuration

| Dark theme | Light theme |
|:---:|:---:|
| ![Router dark](docs/images/v2/dialog-router-dark.png) | ![Router light](docs/images/v2/dialog-router-light.png) |

### User management with 2FA

| Users list | 2FA intro | QR code scan | Code verify | Recovery codes |
|:---:|:---:|:---:|:---:|:---:|
| ![Users](docs/images/v2/users-list-dark.png) | ![Intro](docs/images/v2/twofa-intro-dark.png) | ![QR](docs/images/v2/twofa-scan-dark.png) | ![Verify](docs/images/v2/twofa-verify-dark.png) | ![Recovery](docs/images/v2/twofa-recovery-dark.png) |

### Mobile-responsive UI

All pages adapt to mobile viewports. The pipeline hides the minimap and collapses toolbar labels to icons on small screens.

| Login | 2FA prompt | Pipeline |
|:---:|:---:|:---:|
| ![Mobile login](docs/images/v2/mobile-login-dark.png) | ![Mobile 2FA](docs/images/v2/mobile-login-2fa-dark.png) | ![Mobile pipeline](docs/images/v2/mobile-pipeline-dark.png) |

| Settings menu | Users |
|:---:|:---:|
| ![Mobile settings](docs/images/v2/mobile-settings-menu-dark.png) | ![Mobile users](docs/images/v2/mobile-users-dark.png) |

---

## Features at a glance

### 🎯 Visual pipeline editor

Click a node to edit. Drag to rearrange. Add detectors and GenAI agents from a 2-column grid of provider cards. Every numeric field uses a slider so you can sweep through values and see the effect.

The pipeline automatically shows **tiered storage nodes** (hot/cold) when tiered storage is enabled, and always shows the **Event Router** node so you can configure notification sinks without touching YAML.

### 🤖 8 LLM providers, one click

| Provider | Model examples | Local / cloud | API key needed |
|---|---|---|---|
| **Anthropic Claude** | claude-opus-4-7, claude-sonnet-4-6 | Cloud | ✅ |
| **OpenAI** | gpt-4o, gpt-4o-mini, o1, o3 | Cloud | ✅ |
| **Azure OpenAI** | Any Azure deployment | Cloud | ✅ |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro | Cloud | ✅ |
| **Zhipu GLM** | glm-4v, glm-4v-plus | Cloud | ✅ |
| **Alibaba Qwen** | qwen-vl-max, qwen-vl-plus | Cloud | ✅ |
| **Ollama** | llava:34b, llava-phi3, moondream | Local | ❌ |
| **llama.cpp** | Any GGUF vision model | Local | ❌ |

Pick a provider card and Argus auto-fills the default model, recommended base URL, and shows only the fields that provider actually needs. Local-only setups (Ollama, llama.cpp) skip the API-key field entirely.

**GenAI roles:** Each agent can be assigned one or more roles — `descriptions` (generate natural-language event descriptions), `chat` (conversational Q&A about detections). Multiple agents can chain roles.

### 🔐 Secure login with 2FA

- **TOTP (RFC 6238)**, SHA-1, 30-second period, 6 digits — compatible with Google Authenticator, 1Password, Authy, Bitwarden, and Aegis.
- **4-stage enrollment wizard**: intro → QR code scan (with manual secret copy fallback) → first-code verification → recovery code download.
- **10 one-time recovery codes** (format `XXXX-XXXX-XXXX`) generated on enrollment. Each is consumed atomically — works exactly once.
- **Short-lived JWT challenge token** (5 min) issued after the password step; final session JWT only after the 2FA code verifies.
- `slowapi` rate-limit applied to both `/login` and `/login/2fa`.

### 🗄️ Tiered storage

Recordings flow into a **hot tier** (fast NVMe or SSD) and are automatically migrated to a **cold tier** (HDD or NAS) by the `tiered-storage` Rust daemon when they age past the hot policy. The move is a copy-then-unlink (works across filesystems) and the SQLite `Recordings.path` column is updated in WAL mode with a 30-second busy timeout so Python and Rust co-exist gracefully.

```yaml
storage_tiers:
  hot:  { path: /media/argus/hot,  max_days: 7,  max_gb: 500 }
  cold: { path: /media/argus/cold, max_days: 90 }
  policy:
    event_hot_days: 14          # retained events stay hot 2× longer
    migration_interval: 3600    # seconds between migration sweeps
```

Configure hot and cold paths, retention windows, and disk caps directly in the **Storage Tiers** dialog — no YAML required.

### 📡 Event routing

The `event-router` Rust daemon subscribes to `event/*` topics on the ZMQ proxy and fans them out to:

| Sink | Protocol | Rate-limited | Auth |
|---|---|---|---|
| **Webhook** | HTTP POST (JSON) | ✅ | HMAC-SHA256 signature |
| **Discord** | Webhook URL | ✅ | None (URL is secret) |
| **Slack** | Incoming webhook | ✅ | None (URL is secret) |
| **Telegram** | Bot API | ✅ | Bot token + chat ID |
| **MQTT** | TCP/TLS | ✅ | Username/password |

All sinks share a global `governor` token-bucket rate limiter (default: 30/min). Messages that exceed the rate are written to a SQLite **dead-letter queue** and retried on the next successful send window.

### 🔍 Multi-model detection chain

The `detection-bridge` Rust daemon speaks the exact `zmq_ipc` detector wire protocol, so activating it requires exactly one `config.yml` change:

```yaml
detectors:
  my_chain:
    type: zmq
detection_bridge:
  models:
    - path: /config/model_cache/yolov8s.onnx
      type: yolov8
    - path: /config/model_cache/license_plate.onnx
      type: yologeneric
      filter_labels: [car, motorcycle, bus, truck]
  merge: sequential_filter   # secondary runs on primary's boxes only
```

No Python changes. No rebuild. The bridge handles ONNX Runtime via the `ort` crate (statically linked), supports both `yolov8` and generic `yologeneric` ONNX topologies, and is multi-arch (amd64 + arm64/Jetson).

### 📦 At-rest encryption

The `encrypted-storage` Rust daemon transparently encrypts every MP4 segment before writing it to disk:

- **Algorithm:** AES-256-GCM on x86 (hardware AES-NI), ChaCha20-Poly1305 on ARM/Pi (NEON)
- **KDF:** Argon2id, memory cost 64 MiB, time cost 3, random salt per key
- **File header:** `[magic(4) | version(4) | nonce(12) | key_id(32) | ciphertext...]`
- **Read path:** HTTP range-decrypt server on `127.0.0.1:5002`; Nginx proxies `.mp4` reads there transparently

Activation: set `STORAGE_ENCRYPTION_KEY` in the container environment. Zero code changes.

### 🦀 Rust microservices

| Crate | Replaces / adds | Cold start |
|---|---|---|
| `comms-dispatcher` | Python `InterProcessCommunicator` REP socket — handles DB writes natively, forwards unknown topics to Python for compat. | **15 ms** |
| `storage-daemon` | `RecordingMaintainer` + `RecordingCleanup` + `StorageMaintainer`. `mp4parse` instead of ffprobe → no subprocess forks. | **16 ms** |
| `encrypted-storage` | New. AES-256-GCM (x86) / ChaCha20-Poly1305 (ARM) at-rest segment encryption with Argon2id KDF. HTTP range-decrypt server for the nginx proxy. | **16 ms** |
| `tiered-storage` | New. Watches `Recordings` table, migrates segments from hot → cold tier when age/size policy hits. Updates SQLite paths in WAL mode. | **15 ms** |
| `detection-bridge` | New. ONNX inference chain (primary YOLO → secondary on primary's boxes). Speaks the `zmq_ipc` detector wire protocol, zero Python changes to activate. | n/a (long-lived) |
| `event-router` | New. Subscribes to `event/` topics, fans out to MQTT, webhooks, Discord, Telegram, Slack with `governor` rate-limiting and SQLite DLQ. | **15 ms** |

All cargo tests pass — **68 tests across 6 crates**, 0 clippy warnings.

---

## Performance

### Benchmark environment

| Component | Details |
|---|---|
| **Cloud provider** | KVM virtual machine |
| **CPU** | Intel Xeon @ 2.10 GHz — 4 vCPUs (4 cores, 1 thread/core) |
| **RAM** | 16 GB (DDR4, no swap) |
| **OS** | Ubuntu 24.04.4 LTS (Noble) — kernel 6.18.5 |
| **Compiler** | Rust 1.82.0, release profile (`opt-level=3`, `lto=thin`) |
| **ZMQ** | libzmq 4.3.5 (in-process IPC sockets, no network hops) |
| **SQLite** | 3.45.3, WAL mode, `synchronous=NORMAL`, `busy_timeout=30 000 ms` |

### Results

Measured with a real running `comms-dispatcher` and `pyzmq` clients (the same code path Frigate's Python uses):

![Performance chart](docs/images/perf-chart.png)

| Path | Median | p95 |
|---|---:|---:|
| ZMQ PUB/SUB broadcast | **0.14 ms** | 0.18 ms |
| ZMQ REQ/REP empty (pure IPC) | **0.23 ms** | 0.29 ms |
| Dispatcher → SQLite insert recording | **0.31 ms** | 0.49 ms |
| Dispatcher → SQLite upsert review segment | **0.33 ms** | 0.47 ms |
| Rust daemon spawn → first log | **~15 ms** | 16 ms |

**Cold Docker boot to system READY: ~5.9 seconds** with all 5 Rust daemons resident, vs. ~6 seconds for vanilla Frigate. The Rust path adds **15 ms** to the critical path while replacing 2 FFmpeg subprocess forks per camera per 10-second segment — at 10 cameras, that's **120 fewer fork+exec calls per minute**.

---

## Architecture

```
                       ┌────────────────────────────────────────┐
                       │  Browser  ·  React 19 + xyflow + SWR   │
                       └────────────────────┬───────────────────┘
                                            │ HTTPS (cookie JWT)
                       ┌────────────────────▼───────────────────┐
                       │       Nginx — TLS, basic auth gate     │
                       └──┬───────────────┬─────────────────┬──┘
                          │ /api          │ /vod (encrypted)│ /live
                          ▼               ▼                 ▼
   ┌────────────────────────────┐  ┌─────────────────┐  ┌──────────┐
   │   FastAPI (frigate.api)    │  │ encrypted-      │  │  go2rtc  │
   │   login · config · stats   │  │ storage 🦀      │  │  (RTSP   │
   │   2FA · users · events     │  │ AES-GCM range   │  │  proxy)  │
   └────────┬──────────┬────────┘  └────────┬────────┘  └──────────┘
            │          │                    │
            │ ZMQ REQ  │ ZMQ PUB             │ reads MP4
            ▼          ▼                    ▼
   ┌──────────────┐  ┌────────────────────────────────────┐
   │ comms-       │  │  /media/argus/{hot,cold}/...       │
   │ dispatcher🦀 │  │                                    │
   │  REP socket  │  │  tiered-storage 🦀 migrates old    │
   │  fast-paths  │  │   segments hot → cold via SQLite   │
   │  4 topics    │  │   path rewrite (WAL mode)          │
   └──┬───────────┘  └────────────────────────────────────┘
      │ writes
      ▼
   ┌──────────────┐    subscribes      ┌─────────────────┐
   │  SQLite WAL  │◄───────────────────│ storage-daemon🦀 │
   │  /config/    │    inserts segs    │ scans inotify   │
   │  argus.db    │    + previews +    │ validates with  │
   │              │    review segs     │ mp4parse        │
   └──────┬───────┘                    │ computes        │
          │ tracks expired             │  motion heatmap │
          ▼                            └────────┬────────┘
   ┌──────────────────┐                         │
   │ event-router 🦀  │◄─── PUB/SUB ────────────┘
   │ MQTT / Discord / │     event/* topics
   │ Slack / Webhook  │
   │ + DLQ + RL       │
   └──────────────────┘

   ┌──────────────────────────────────────────────────────────┐
   │     detection-bridge 🦀 — ZMQ REP at zmq_detector        │
   │       primary YOLO → secondary (LPR · face · …)          │
   │       activates by setting detector.type: zmq            │
   └──────────────────────────────────────────────────────────┘
```

---

## Detector hardware support

| Hardware | Type key | Notes |
|---|---|---|
| Google Coral TPU (USB) | `edgetpu` | M.2 + USB variants, SSD MobileNet v2 |
| Google Coral TPU (PCIe M.2) | `edgetpu` | Requires pcie driver in container |
| NVIDIA GPU | `tensorrt` | TensorRT 8+, YOLOv8 engines |
| Intel iGPU / Arc | `openvino` | OpenVINO IR format models |
| Hailo-8/8L | `hailo8` | Hailo Model Zoo YOLO variants |
| AMD GPU (ROCm) | `rocm` | ROCm 5.7+, experimental |
| Synaptics SL1680 | `sl1680` | SSD only (YOLOv8 pending) |
| Multi-model chain | `zmq` | Activates detection-bridge Rust daemon |
| CPU fallback | `cpu` | OpenCV DNN, no hardware needed |

---

## Migrating from Frigate

If you're running Frigate 0.18+ today, the migration is a Docker image swap:

1. Stop your Frigate container.
2. Replace the image with `ghcr.io/kokohutz/argus:latest`.
3. Add `ARGUS_RUST_DISPATCHER=1` and `ARGUS_RUST_CLEANUP=1` to your environment.
4. Start it. Your `config.yml`, `frigate.db`, and recordings work unchanged — `argus.db` is just a symlink to the existing database.
5. Visit the UI, set up 2FA on the admin account, and explore `/pipeline`.

Roll back at any time by reverting the image and removing the two env vars. The wire protocol is identical.

---

## Building from source

### Rust workspace

```bash
cd rust
cargo build --release --all     # all 6 crates, ~2 min on 8 cores
cargo test --all                # 68 tests
cargo clippy --all-targets -- -D warnings
```

MSRV: Rust **1.82.0** (edition 2021).

### Web UI

```bash
cd web
npm install --legacy-peer-deps
npm run dev                     # localhost:5173
npm run build                   # production bundle
```

### Python backend

```bash
make local                      # full Docker build, amd64
make arm64                      # ARM build (Raspberry Pi 5, Jetson)
```

---

## Configuration reference

Argus reads the same `config.yml` as Frigate, plus these new top-level keys:

```yaml
# Tiered storage — automatic hot→cold migration
storage_tiers:
  hot:  { path: /media/argus/hot,  max_days: 7,  max_gb: 500 }
  cold: { path: /media/argus/cold, max_days: 90 }
  policy:
    event_hot_days: 14          # retained events stay hot 2x longer
    migration_interval: 3600    # seconds between migration sweeps

# Multi-model detection chain
detection_bridge:
  models:
    - path: /config/model_cache/yolov8s.onnx
      type: yolov8
    - path: /config/model_cache/license_plate.onnx
      type: yologeneric
      filter_labels: [car, motorcycle, bus, truck]
  merge: sequential_filter      # secondary runs only on primary's boxes

# Event routing
event_router:
  sinks:
    mqtt:    { broker: tcp://mqtt:1883 }
    discord: { webhook_url: !env DISCORD_WEBHOOK, min_severity: alert }
    slack:   { webhook_url: !env SLACK_WEBHOOK }
    telegram:
      bot_token: !env TG_TOKEN
      chat_id:   !env TG_CHAT
  rate_limit: { per_minute: 10, burst: 3 }
```

---

## Roadmap

| Status | Item |
|---|---|
| ✅ | Rust storage-daemon (Phase A/B/C cutover) |
| ✅ | Rust comms-dispatcher (replaces Python REP) |
| ✅ | Rust encrypted-storage (AES-GCM at rest) |
| ✅ | Rust tiered-storage (hot/cold) |
| ✅ | Rust event-router (MQTT/Discord/Slack/Telegram/webhook) |
| ✅ | Rust detection-bridge (multi-model chain) |
| ✅ | Anthropic/GLM/Qwen GenAI providers |
| ✅ | Visual pipeline editor (React Flow) |
| ✅ | Native TOTP 2FA with recovery codes |
| ✅ | 2FA enrollment wizard UI (4-stage dialog) |
| ✅ | Tiered storage UI (hot/cold config dialog) |
| ✅ | Event router UI (per-sink enable/config dialog) |
| ✅ | Mobile-responsive pipeline (no minimap, compact toolbar) |
| 🚧 | Synaptics SL1680 YOLO support (currently SSD only) |
| 🔭 | WebAuthn / hardware security keys |
| 🔭 | Federated multi-site dashboard |

---

## Security

- All login + 2FA endpoints rate-limited via `slowapi` (default: 1/sec, 10/min per IP).
- TOTP codes are 6 digits, SHA-1 over 30-second windows, with ±1 window drift tolerance — verified against the [RFC 6238 reference vector](https://datatracker.ietf.org/doc/html/rfc6238#appendix-B).
- Recovery codes use 6 bytes of `secrets.token_hex` (48 bits per code, 480 bits total).
- JWT challenge tokens expire after 5 minutes and are marked with `stage=2fa` to prevent reuse for direct session establishment.
- At-rest encryption uses Argon2id KDF (memory cost 64 MiB, time cost 3) and per-file random nonces.
- The Rust dispatcher validates the SQLite path is inside `/config` and refuses paths outside.

Found a vulnerability? Email `security@argus-nvr.example` (PGP key in `SECURITY.md`).

---

## Credits

Argus is a fork of [Frigate](https://github.com/blakeblackshear/frigate) by Blake Blackshear, an excellent project that this build owes everything to. The Python core, FastAPI surface, Peewee schema, and ZMQ wire protocol are all upstream Frigate — Argus adds the Rust performance layer, the pipeline editor, the 2FA layer, and the GenAI provider plugins on top.

MIT licensed. See `LICENSE`.

---

<div align="center">

**Argus** · 100 eyes · One pipeline

</div>
