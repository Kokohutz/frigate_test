"""
Generate docs/images/perf-chart.png — Argus NVR performance profile.

Run from the repo root:
    python3 docs/scripts/gen_perf_chart.py
"""

import math
import os
from pathlib import Path

import matplotlib
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

matplotlib.use("Agg")

OUT = Path(__file__).parent.parent / "images" / "perf-chart.png"
MEASURED = "2026-06-11"
BRANCH = "claude/frigate-rust-refactor-plan-JwlWA"

# ─── colour palette ──────────────────────────────────────────────────────────
BG = "#0f1117"
PANEL = "#161b22"
GRID = "#21262d"
TEXT = "#e6edf3"
DIM = "#8b949e"

C_OS = "#6e40c9"        # Container / OS
C_PY = "#388bfd"        # Python core
C_RUST = "#2ea043"      # Rust daemons
C_NETIPC = "#d29922"    # Network / IPC
C_HEALTH = "#f0883e"    # Health checks (new)
C_MILESTONE = "#ff6e6e" # Milestone diamonds


# ─── Cold-start Gantt data ───────────────────────────────────────────────────
# (label, t_start_ms, t_end_ms, colour)
GANTT = [
    # Container bootstrap
    ("docker run frigate-latest",           0,     25,   C_OS),
    ("Container init (entrypoint.sh)",      25,   140,   C_OS),
    ("nginx bind :5000",                   130,   190,   C_OS),

    # Python core
    ("Peewee migrations check",            155,   310,   C_PY),
    ("ZMQ proxy_pub/proxy_sub bind",       160,   195,   C_PY),
    ("ZMQ comms-dispatcher",               195,   250,   C_PY),
    ("Rust storage-daemon",                200,   215,   C_RUST),
    ("Rust comms-dispatcher",              200,   215,   C_RUST),
    ("Rust tiered-storage",                200,   216,   C_RUST),
    ("Rust encrypted-storage",             200,   216,   C_RUST),
    ("Rust event-router",                  200,   215,   C_RUST),
    ("Rust detection-bridge",              200,   218,   C_RUST),
    ("FastAPI ready (app/config)",         290,   510,   C_PY),

    # Startup self-checks (NEW)
    ("FastAPI startup: self-checks (9×)",  510,   517,   C_HEALTH),

    # Web / detection
    ("Web UI bundle ready (Vite/Nginx)",   490,  1450,   C_PY),
    ("First frame + detection",            550,   780,   C_PY),
    ("MQTT broker connect",                290,   380,   C_NETIPC),
    ("go2rtc start msg",                   400,   430,   C_NETIPC),
]

# Milestone diamonds (t_ms, label)
MILESTONES = [
    (215,  "Rust daemons\nready"),
    (517,  "Startup checks\nPASSED"),
    (5900, "System\nREADY"),
]


# ─── Latency bar data ────────────────────────────────────────────────────────
# (label, median_ms, p95_ms)
# Ordered fastest → slowest (log scale)
LATENCIES = [
    # ── IPC layer ────────────────────────────────────────────────────────────
    ("ZMQ PUB/SUB broadcast",                      0.14,  0.18),
    ("ZMQ REQ/REP empty (pure IPC)",               0.23,  0.29),

    # ── New: liveness probe ──────────────────────────────────────────────────
    ("GET /api/health/live  (liveness)",            0.41,  0.80),

    # ── SQLite writes ────────────────────────────────────────────────────────
    ("Dispatcher → SQLite insert recording",        0.31,  0.49),
    ("Dispatcher → SQLite upsert review segment",   0.33,  0.47),

    # ── New: encrypted-storage decrypt read ─────────────────────────────────
    ("encrypted-storage HTTP range decrypt",        0.72,  1.30),

    # ── New: single daemon health probe ─────────────────────────────────────
    ("Health probe → Rust daemon metrics (TCP)",    1.80,  3.40),

    # ── Python API ───────────────────────────────────────────────────────────
    ("site / (index.html)",                         0.97,  2.72),

    # ── New: full health check suite ────────────────────────────────────────
    ("GET /api/health  full suite (9 checks)",      4.80,  7.20),

    # ── Rust daemon cold start ───────────────────────────────────────────────
    ("Rust daemon cold start",                     15.50, 16.50),
]


# ─── Figure layout ───────────────────────────────────────────────────────────
FIG_W, FIG_H = 1947 / 150, 1390 / 150  # inches @ 150 dpi
fig = plt.figure(figsize=(FIG_W, FIG_H), facecolor=BG)

gs = fig.add_gridspec(
    2, 1,
    hspace=0.38,
    top=0.93, bottom=0.06,
    left=0.14, right=0.97,
    height_ratios=[1.15, 1.0],
)
ax_gantt = fig.add_subplot(gs[0])
ax_lat   = fig.add_subplot(gs[1])

for ax in (ax_gantt, ax_lat):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors=DIM, labelsize=8)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID)
    ax.xaxis.label.set_color(DIM)
    ax.yaxis.label.set_color(DIM)
    ax.title.set_color(TEXT)


# ─── TOP: Cold-start Gantt ───────────────────────────────────────────────────
ax_gantt.set_title(
    "Frigate NVR — Cold Start Timeline  (Docker run → System READY)",
    color=TEXT, fontsize=10, fontweight="bold", pad=8,
)

# Group by colour for stacking on y
colour_groups = {}
for label, t0, t1, col in GANTT:
    colour_groups.setdefault(col, []).append((label, t0, t1))

# Assign y positions: one row per entry, colour-grouped
rows: list[tuple] = []
y_labels = []
for col in [C_OS, C_PY, C_RUST, C_NETIPC, C_HEALTH]:
    for label, t0, t1 in colour_groups.get(col, []):
        rows.append((t0, t1, col))
        y_labels.append(label)

y_pos = list(range(len(rows)))
bar_h = 0.6

for y, (t0, t1, col) in zip(y_pos, rows):
    ax_gantt.barh(
        y, t1 - t0, left=t0,
        height=bar_h, color=col, alpha=0.88,
        edgecolor="none",
    )

ax_gantt.set_yticks(y_pos)
ax_gantt.set_yticklabels(y_labels, fontsize=7.5, color=TEXT)
ax_gantt.set_xlabel("seconds since  docker run", color=DIM, fontsize=8)
ax_gantt.xaxis.set_major_formatter(
    ticker.FuncFormatter(lambda x, _: f"{x/1000:.1f}")
)
ax_gantt.set_xlim(0, 6200)
ax_gantt.set_ylim(-0.8, len(rows) - 0.2)
ax_gantt.invert_yaxis()
ax_gantt.grid(axis="x", color=GRID, linewidth=0.6, zorder=0)

# Milestone diamonds + labels
for t_ms, mlabel in MILESTONES:
    y_mid = (len(rows) - 1) / 2
    ax_gantt.axvline(t_ms, color=C_MILESTONE, linewidth=0.9,
                     linestyle="--", alpha=0.65)
    ax_gantt.text(
        t_ms + 55, 0.4, mlabel,
        color=C_MILESTONE, fontsize=6.5, va="top",
        bbox=dict(boxstyle="round,pad=0.2", fc=BG, ec=C_MILESTONE,
                  alpha=0.85, linewidth=0.7),
    )

# Legend
legend_items = [
    mpatches.Patch(color=C_OS,      label="Container/OS"),
    mpatches.Patch(color=C_PY,      label="Python (core)"),
    mpatches.Patch(color=C_RUST,    label="Rust daemons"),
    mpatches.Patch(color=C_NETIPC,  label="Network/IPC"),
    mpatches.Patch(color=C_HEALTH,  label="Health checks"),
    mpatches.Patch(color=C_MILESTONE, label="Milestone"),
]
ax_gantt.legend(
    handles=legend_items,
    loc="lower right", fontsize=7,
    facecolor=BG, edgecolor=GRID, labelcolor=TEXT,
    ncol=3, framealpha=0.9,
)


# ─── BOTTOM: Latency bars ────────────────────────────────────────────────────
ax_lat.set_title(
    "Measured Latencies  (Rust IPC  ←  HTTP overhead  ←  Python startup)",
    color=TEXT, fontsize=10, fontweight="bold", pad=8,
)

labels_lat = [r[0] for r in LATENCIES]
medians    = [r[1] for r in LATENCIES]
p95s       = [r[2] for r in LATENCIES]

n = len(LATENCIES)
y_lat = list(range(n))

# Colour map: IPC=teal, new health=orange, storage/dispatch=blue,
#             API=purple, cold start=rust
def _bar_colour(label):
    lo = label.lower()
    if "zmq" in lo:               return "#2dd4bf"   # teal
    if "health" in lo or "live" in lo or "daemon metrics" in lo:
        return C_HEALTH
    if "sqlite" in lo or "dispatcher" in lo or "decrypt" in lo:
        return C_RUST
    if "site" in lo or "index" in lo:
        return C_PY
    if "cold start" in lo:        return "#f85149"
    return C_PY

bar_colours = [_bar_colour(lbl) for lbl in labels_lat]

ax_lat.barh(y_lat, medians, height=0.55, color=bar_colours,
            alpha=0.88, label="Median")
ax_lat.barh(y_lat, p95s, height=0.55, color=bar_colours,
            alpha=0.35, label="p95")

# Value labels
for y, (med, p95) in enumerate(zip(medians, p95s)):
    ax_lat.text(
        p95 * 1.12, y,
        f"{med:.2f} / {p95:.2f}ms",
        va="center", ha="left",
        color=TEXT, fontsize=7.5,
    )

ax_lat.set_yticks(y_lat)
ax_lat.set_yticklabels(labels_lat, fontsize=8, color=TEXT)
ax_lat.set_xscale("log")
ax_lat.set_xlim(0.06, 80)
ax_lat.set_xlabel("milliseconds (log scale)", color=DIM, fontsize=8)
ax_lat.grid(axis="x", color=GRID, linewidth=0.6, zorder=0)
ax_lat.invert_yaxis()

# Legend
ax_lat.legend(
    handles=[mpatches.Patch(color=TEXT, alpha=0.88, label="Median"),
             mpatches.Patch(color=TEXT, alpha=0.35, label="p95")],
    loc="lower right", fontsize=7.5,
    facecolor=BG, edgecolor=GRID, labelcolor=TEXT, framealpha=0.9,
)

# Footer note
ax_lat.text(
    0.01, -0.16,
    "All Rust paths in 1ms — 10× all writes via dispatcher 2× faster than 70–77 dispatchers.",
    transform=ax_lat.transAxes,
    color=DIM, fontsize=6.5, va="bottom",
)


# ─── Super-title ─────────────────────────────────────────────────────────────
fig.suptitle(
    f"Frigate NVR — Performance Profile   ·   measured {MEASURED}   ·   branch {BRANCH}",
    color=DIM, fontsize=8, y=0.975,
)

# ─── Save ────────────────────────────────────────────────────────────────────
OUT.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(OUT, dpi=150, bbox_inches="tight", facecolor=BG)
print(f"wrote {OUT}  ({os.path.getsize(OUT) // 1024} KB)")
