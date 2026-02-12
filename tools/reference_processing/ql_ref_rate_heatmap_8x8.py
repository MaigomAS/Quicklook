#!/usr/bin/env python3
"""Golden reference tool: 8x8 per-channel rates from event lines.

Expected input format
---------------------
A JSONL file where each non-empty line is an event with:
- t_us: timestamp in microseconds (>0)
- channel: integer channel id

Scientific meaning
------------------
- Counts by channel are first accumulated from valid events.
- Rate heatmap values are computed as counts / seconds.

Relation to Quicklook snapshot
------------------------------
Implements the same mapping used by snapshot.ratemap_8x8:
row = channel // 8, col = channel % 8, value = count / window_s.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt


def load_data(path: str) -> list[dict]:
    events: list[dict] = []
    with open(path, "r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t_us = int(ev.get("t_us", 0))
            ch = int(ev.get("channel", -1))
            if t_us <= 0 or not (0 <= ch < 64):
                continue
            events.append(ev)
    return events


def compute_counts_by_channel(events: Iterable[dict], channels: int = 64) -> dict[int, int]:
    counts = {ch: 0 for ch in range(channels)}
    for ev in events:
        ch = int(ev["channel"])
        if 0 <= ch < channels:
            counts[ch] += 1
    return counts


def compute_rate_heatmap_8x8(counts_by_channel: dict[int, int], window_s: float) -> list[list[float]]:
    safe_window_s = max(float(window_s), 1e-9)
    heatmap = [[0.0 for _ in range(8)] for _ in range(8)]
    for ch, count in counts_by_channel.items():
        r, c = divmod(ch, 8)
        if r < 8:
            heatmap[r][c] = count / safe_window_s
    return heatmap


def plot_rate_heatmap_8x8(heatmap: list[list[float]], out_path: str | None = None) -> None:
    fig, ax = plt.subplots(figsize=(6, 5))
    img = ax.imshow(heatmap, cmap="viridis", origin="upper")
    ax.set_title("Rate heatmap 8x8 (counts/s)")
    ax.set_xlabel("Column")
    ax.set_ylabel("Row")
    fig.colorbar(img, ax=ax, label="Hz")
    fig.tight_layout()
    if out_path:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=150)
    else:
        plt.show()


def _derive_window_s(events: list[dict]) -> float:
    if not events:
        return 1.0
    ts = [int(ev["t_us"]) for ev in events]
    width = (max(ts) - min(ts)) / 1_000_000.0
    return width if width > 0 else 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Golden reference 8x8 rate heatmap")
    parser.add_argument("input_path", help="Input JSONL event file")
    parser.add_argument("--out", dest="out", default=None, help="Optional PNG output path")
    args = parser.parse_args()

    events = load_data(args.input_path)
    counts = compute_counts_by_channel(events)
    heatmap = compute_rate_heatmap_8x8(counts, _derive_window_s(events))
    plot_rate_heatmap_8x8(heatmap, args.out)


if __name__ == "__main__":
    main()
