#!/usr/bin/env python3
"""Golden reference tool: per-channel ADC spectra grid from event lines.

Expected input format
---------------------
Input is JSONL with one event per line and at least:
- t_us (microseconds, >0)
- channel (integer channel id)
- adc_x (optional, defaults to 0)

Scientific meaning
------------------
- Counts by channel: accepted events per channel, used for occupancy context.
- Rate heatmap 8x8: counts per channel normalized by acquisition seconds.
- Spectra view: distribution of adc_x into 64 bins (0..63) per channel.

Relation to Quicklook snapshot
------------------------------
ADC binning follows Quicklook style: adc_bin = clamp(adc_x, 0..4095) // 64.
Counts and rates are directly comparable to snapshot.counts_by_channel and
snapshot.ratemap_8x8.
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
            ev["adc_x"] = int(ev.get("adc_x", 0))
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


def _adc_bin(adc: int) -> int:
    return min(63, max(0, adc) // 64)


def _compute_adc_spectra(events: Iterable[dict], channels: int = 64) -> dict[int, list[int]]:
    spectra = {ch: [0 for _ in range(64)] for ch in range(channels)}
    for ev in events:
        ch = int(ev["channel"])
        if 0 <= ch < channels:
            spectra[ch][_adc_bin(int(ev.get("adc_x", 0)))] += 1
    return spectra


def plot_grid_spectra(events: list[dict], out_path: str | None = None) -> None:
    spectra = _compute_adc_spectra(events)
    fig, axes = plt.subplots(8, 8, figsize=(16, 16), sharex=True, sharey=True)
    for ch in range(64):
        r, c = divmod(ch, 8)
        ax = axes[r][c]
        ax.plot(spectra[ch], linewidth=0.8)
        ax.set_title(str(ch), fontsize=8)
        ax.tick_params(labelsize=6)
    fig.suptitle("ADC X spectra by channel")
    fig.tight_layout(rect=[0, 0, 1, 0.98])
    if out_path:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=120)
    else:
        plt.show()


def _derive_window_s(events: list[dict]) -> float:
    if not events:
        return 1.0
    ts = [int(ev["t_us"]) for ev in events]
    width = (max(ts) - min(ts)) / 1_000_000.0
    return width if width > 0 else 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Golden reference ADC grid spectra")
    parser.add_argument("input_path", help="Input JSONL event file")
    parser.add_argument("--out", dest="out", default=None, help="Optional PNG output path")
    args = parser.parse_args()

    events = load_data(args.input_path)
    counts = compute_counts_by_channel(events)
    _ = compute_rate_heatmap_8x8(counts, _derive_window_s(events))
    plot_grid_spectra(events, args.out)


if __name__ == "__main__":
    main()
