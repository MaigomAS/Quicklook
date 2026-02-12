#!/usr/bin/env python3
"""Golden reference tool: counts per channel and 8x8 rate map from event lines.

Expected input format
---------------------
A UTF-8 text file with one JSON object per line (JSONL). Each event should include:
- t_us: event timestamp in microseconds (positive integer)
- channel: channel id (0..63 for 8x8 layout)
Optional ADC fields are ignored by this script.

Scientific meaning
------------------
- Counts by channel: number of accepted events observed in each channel.
- Rate heatmap: counts divided by the selected integration window in seconds.

Relation to Quicklook snapshot
------------------------------
The calculations mirror backend snapshot fields:
- counts_by_channel
- ratemap_8x8 (counts / window_s)
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
            if int(ev.get("t_us", 0)) <= 0:
                continue
            ch = int(ev.get("channel", -1))
            if ch < 0 or ch >= 64:
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
    window_s = max(float(window_s), 1e-9)
    heatmap = [[0.0 for _ in range(8)] for _ in range(8)]
    for ch, count in counts_by_channel.items():
        row = ch // 8
        col = ch % 8
        if row < 8 and col < 8:
            heatmap[row][col] = count / window_s
    return heatmap


def plot_counts_by_channel(counts_by_channel: dict[int, int], out_path: str | None = None) -> None:
    x = sorted(counts_by_channel)
    y = [counts_by_channel[ch] for ch in x]
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.bar(x, y, width=0.8)
    ax.set_title("Counts by channel")
    ax.set_xlabel("Channel")
    ax.set_ylabel("Counts")
    ax.grid(axis="y", alpha=0.3)
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
    span_s = (max(ts) - min(ts)) / 1_000_000.0
    return span_s if span_s > 0 else 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Golden reference counts-by-channel plotter")
    parser.add_argument("input_path", help="Input JSONL event file")
    parser.add_argument("--out", dest="out", default=None, help="Optional PNG output path")
    args = parser.parse_args()

    events = load_data(args.input_path)
    counts = compute_counts_by_channel(events)
    _ = compute_rate_heatmap_8x8(counts, _derive_window_s(events))
    plot_counts_by_channel(counts, args.out)


if __name__ == "__main__":
    main()
