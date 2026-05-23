# Running Argus — Docker Compose Setup Guide

This document covers a full production setup from scratch using Docker Compose,
including every pre-start setting, volume layout, hardware accelerator option,
and environment variable.

---

## Table of Contents

1. [Host directory structure](#1-host-directory-structure)
2. [Minimum config.yml](#2-minimum-configyml)
3. [docker-compose.yml](#3-docker-composeyml)
4. [Pre-start settings (env vars)](#4-pre-start-settings)
5. [Hardware acceleration](#5-hardware-acceleration)
6. [TLS / HTTPS](#6-tls--https)
7. [Port reference](#7-port-reference)
8. [First-run checklist](#8-first-run-checklist)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Host directory structure

Create these directories on your host **before** starting the container.
Argus will not create them automatically.

```
/opt/argus/
├── config/              ← mounted to /config inside container
│   └── config.yml       ← your main config file (required)
└── media/               ← mounted to /media/frigate inside container
    ├── recordings/      ← continuous MP4 segments (auto-created)
    ├── clips/           ← event snapshots, thumbnails, faces
    └── exports/         ← manually exported recordings
```

```bash
mkdir -p /opt/argus/config /opt/argus/media
```

> **Why two volumes?**  
> `/config` is small (config, database, model cache, TLS certs).  
> `/media/frigate` grows large — put it on your largest disk or NAS mount.

---

## 2. Minimum config.yml

Place this at `/opt/argus/config/config.yml` before first start.
Argus will **refuse to start** if no config file exists.

```yaml
# /opt/argus/config/config.yml

mqtt:
  enabled: false   # set to true and add host/port if you use MQTT

cameras:
  front_door:
    ffmpeg:
      inputs:
        - path: rtsp://user:pass@192.168.1.100:554/stream
          roles:
            - detect
            - record
    detect:
      width: 1280
      height: 720
      fps: 5
```

> **Note:** every key in `config.yml` can reference an environment variable
> set with the `FRIGATE_` prefix. Example:
> ```yaml
> rtsp://user:{FRIGATE_CAM_PASS}@192.168.1.100:554/stream
> ```
> Set `FRIGATE_CAM_PASS=mypassword` in `environment:` or a `.env` file.

---

## 3. docker-compose.yml

This is a **production** Compose file (not the dev build).
Copy it next to your `config/` directory or anywhere convenient.

```yaml
services:

  argus:
    image: ghcr.io/blakeblackshear/frigate:stable   # or :0.18.0 for a pinned version
    container_name: argus
    restart: unless-stopped

    # ── Shared memory ─────────────────────────────────────────────────────────
    # Frigate passes camera frames via /dev/shm. Size = num_cameras × frame_size.
    # Rule of thumb: 128 MB per 1080p camera. Minimum 256 MB.
    shm_size: "256mb"

    # ── Ports ─────────────────────────────────────────────────────────────────
    ports:
      - "8971:8971"   # HTTPS UI + API  (self-signed cert by default)
      - "5000:5000"   # HTTP  UI + API  (internal, no auth check)
      # Uncomment streaming ports if you need direct RTSP/WebRTC access:
      # - "8554:8554"   # RTSP  (go2rtc)
      # - "8555:8555/tcp"  # WebRTC TCP  (go2rtc)
      # - "8555:8555/udp"  # WebRTC UDP  (go2rtc)

    # ── Volumes ───────────────────────────────────────────────────────────────
    volumes:
      - /opt/argus/config:/config              # config, DB, model cache, TLS
      - /opt/argus/media:/media/frigate        # recordings, clips, exports
      - /etc/localtime:/etc/localtime:ro       # timezone sync

    # ── Environment variables ─────────────────────────────────────────────────
    # See Section 4 for every supported variable.
    environment:
      FRIGATE_JWT_SECRET: "change-me-to-a-long-random-string"
      # PLUS_API_KEY: ""          # Frigate+ subscription key
      # FRIGATE_BASE_PATH: ""     # e.g. /frigate  if behind a sub-path proxy
      # YOLO_MODELS: ""           # leave empty to skip YOLO model download

    # ── Hardware: Google Coral USB ────────────────────────────────────────────
    # devices:
    #   - /dev/bus/usb:/dev/bus/usb

    # ── Hardware: Intel GPU (VAAPI / QSV) ────────────────────────────────────
    # devices:
    #   - /dev/dri:/dev/dri
    # group_add:
    #   - "109"   # render  (check: getent group render)
    #   - "44"    # video   (check: getent group video)

    # ── Hardware: NVIDIA GPU (TensorRT / NVDEC) ───────────────────────────────
    # Requires: nvidia-container-toolkit installed on host
    # image: ghcr.io/blakeblackshear/frigate:stable-tensorrt
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

  # ── Optional: local MQTT broker ─────────────────────────────────────────────
  mqtt:
    image: eclipse-mosquitto:2.0
    container_name: mqtt
    restart: unless-stopped
    command: mosquitto -c /mosquitto-no-auth.conf
    ports:
      - "1883:1883"
```

Start it:

```bash
docker compose up -d
```

Tail logs:

```bash
docker compose logs -f argus
```

---

## 4. Pre-start settings

These are set in `environment:` in the Compose file (or a `.env` file next to
`docker-compose.yml`).

### 4.1 Essential

| Variable | Required | Description |
|---|---|---|
| `FRIGATE_JWT_SECRET` | **Yes (for auth)** | Secret used to sign login tokens. Set to any long random string. If omitted, a new random secret is generated each restart — all sessions are invalidated on restart. Generate one with `openssl rand -hex 32`. |

### 4.2 Camera credentials (keep out of config.yml)

Any variable prefixed `FRIGATE_` is available inside `config.yml` via
`{FRIGATE_VARNAME}` interpolation:

```bash
# .env file or docker-compose environment:
FRIGATE_CAM_USER=admin
FRIGATE_CAM_PASS=s3cr3t
```

```yaml
# config.yml
cameras:
  driveway:
    ffmpeg:
      inputs:
        - path: rtsp://{FRIGATE_CAM_USER}:{FRIGATE_CAM_PASS}@192.168.1.50:554/main
```

### 4.3 Optional tuning

| Variable | Default | Description |
|---|---|---|
| `PLUS_API_KEY` | *(none)* | Frigate+ subscription key for cloud model downloads. |
| `FRIGATE_BASE_PATH` | *(empty)* | URL prefix when running behind a reverse proxy sub-path (e.g. `/frigate`). Nginx rewrites paths automatically. |
| `YOLO_MODELS` | *(auto)* | Comma-separated list of YOLO model names to pre-download. Set to `""` to skip all downloads. |
| `DEBIAN_FRONTEND` | `noninteractive` | Already baked into the image; no need to set. |

### 4.4 Config file location override

By default Argus looks for `/config/config.yml` then `/config/config.yaml`.
Override with:

```yaml
environment:
  CONFIG_FILE: /config/my-custom-name.yml
```

### 4.5 Pre-start file layout inside /config

The container reads (and creates) these files under `/config` on startup.
Mount `/config` to a persistent volume so none of it is lost on restart.

```
/config/
├── config.yml             ← YOUR config (required before first start)
├── frigate.db             ← SQLite database (auto-created on first run)
├── frigate.db-wal         ← SQLite WAL file (auto-created)
├── model_cache/           ← downloaded ONNX / TFLite / EdgeTPU models
│   └── converted/         ← output of the built-in model converter
├── .jwt_secret            ← auto-generated if FRIGATE_JWT_SECRET is not set
└── exports/               ← (optional) alternate export location
```

> **Before first start**, the only file you need to create is `config.yml`.
> Everything else is generated automatically.

---

## 5. Hardware acceleration

### Google Coral (USB)

```yaml
devices:
  - /dev/bus/usb:/dev/bus/usb
```

Config:
```yaml
detectors:
  coral:
    type: edgetpu
    device: usb
```

### Google Coral (PCIe / M.2)

```yaml
devices:
  - /dev/apex_0:/dev/apex_0
group_add:
  - "apex"    # check: getent group apex
```

Config:
```yaml
detectors:
  coral:
    type: edgetpu
    device: pci
```

### Intel GPU (VAAPI / QuickSync)

```yaml
devices:
  - /dev/dri:/dev/dri
group_add:
  - "109"   # render group ID — check: getent group render
  - "44"    # video group ID  — check: getent group video
```

Config (`config.yml`):
```yaml
ffmpeg:
  hwaccel_args: preset-vaapi
detectors:
  ov:
    type: openvino
    device: GPU
```

### NVIDIA (TensorRT / NVDEC)

Use the `-tensorrt` image variant and add the deploy block:

```yaml
image: ghcr.io/blakeblackshear/frigate:stable-tensorrt
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

Config:
```yaml
ffmpeg:
  hwaccel_args: preset-nvidia-h264
detectors:
  tensorrt:
    type: tensorrt
```

### Hailo-8 / Hailo-8L

```yaml
devices:
  - /dev/hailo0:/dev/hailo0
group_add:
  - "hailo"   # check: getent group hailo
```

Config:
```yaml
detectors:
  hailo:
    type: hailo8
```

### Rockchip NPU (RK3588 / RK3576 etc.)

Use the Rockchip image and map the NPU device:

```yaml
image: ghcr.io/blakeblackshear/frigate:stable-rk
privileged: true   # required for NPU + DRI access on Rockchip
```

Config:
```yaml
detectors:
  rknn:
    type: rknn
    num_cores: 3
```

---

## 6. TLS / HTTPS

### Default (self-signed cert — works out of the box)

Port `8971` serves HTTPS with a self-signed certificate. Your browser will warn
you the first time. Add a browser exception or use the HTTP port `5000` on your
LAN only.

### Custom certificate (Let's Encrypt or your own CA)

Place your certs at these exact paths inside the container
(i.e. bind-mount them or copy them into `/opt/argus/config/letsencrypt/`):

```
/etc/letsencrypt/live/frigate/fullchain.pem
/etc/letsencrypt/live/frigate/privkey.pem
```

Example via volume mount:

```yaml
volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro
```

Argus reloads nginx automatically when the cert is renewed
(the `certsync` s6 service watches for changes).

### Disable TLS (HTTP only on 8971)

```yaml
# config.yml
tls:
  enabled: false
```

---

## 7. Port reference

| Port | Protocol | Description | Default mapping |
|---|---|---|---|
| `8971` | HTTPS | Main UI + REST API. Auth-protected when auth is enabled. | Always expose |
| `5000` | HTTP | Same UI, **no TLS**, intended for localhost/internal proxy use only. | LAN-only or localhost |
| `1984` | HTTP | go2rtc internal API (direct camera stream controls). Internal-only. | Do not expose |
| `8554` | RTSP | go2rtc RTSP re-stream. Expose only if you need direct RTSP pull. | Optional |
| `8555` | TCP+UDP | go2rtc WebRTC. Required for WebRTC live view from outside Docker. | Optional |
| `1883` | TCP | MQTT broker (only if you run the `mqtt` service in Compose). | Optional |

---

## 8. First-run checklist

```
[ ] /opt/argus/config/config.yml exists with at least one camera defined
[ ] /opt/argus/config/ and /opt/argus/media/ directories exist on host
[ ] shm_size is set appropriately (256 MB min; more for many cameras)
[ ] FRIGATE_JWT_SECRET is set to a stable random value
[ ] Correct /dev/* devices are mapped for your hardware accelerator
[ ] Correct group IDs added in group_add (Intel/Coral PCIe only)
[ ] docker compose up -d runs without error
[ ] docker compose logs -f argus shows "[INFO] Starting Frigate..."
[ ] https://your-host:8971 opens the Argus login page
[ ] Camera streams appear in the dashboard within ~30 seconds
```

---

## 9. Troubleshooting

### Container exits immediately

```bash
docker compose logs argus
```

Most common causes:
- `config.yml` not found → Ensure it exists at `/opt/argus/config/config.yml`
- `config.yml` has a YAML syntax error → Validate with `python3 -c "import yaml; yaml.safe_load(open('config.yml'))"`
- Bad camera URL → Check FFmpeg errors in logs

### "Permission denied" on /dev/dri or /dev/bus/usb

Check the group IDs on your host:
```bash
getent group render   # → render:x:109:...
getent group video    # → video:x:44:...
```
Then set `group_add: ["109", "44"]` to match.

### WebRTC live view not working

Port `8555` (TCP + UDP) must both be reachable. Add to your Compose:
```yaml
ports:
  - "8555:8555/tcp"
  - "8555:8555/udp"
```

### Database locked / WAL errors

`/config` must be a **real bind mount to a local disk**, not a Docker named
volume backed by NFS/CIFS. SQLite WAL mode and NFS do not mix.

### Recordings not appearing

Ensure `/media/frigate/recordings` is writable by the container user (uid 0).
Check with:
```bash
docker exec argus ls -la /media/frigate/
```

### Reset everything

```bash
docker compose down
rm -rf /opt/argus/media           # recordings, clips
rm -f  /opt/argus/config/frigate.db*  # database only (keeps config)
docker compose up -d
```
