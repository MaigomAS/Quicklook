#!/usr/bin/env python3
"""Compare a live Quicklook snapshot with golden reference processing.

The script fetches /config and /snapshot from a running backend and prints summary
statistics. Optionally, if --input is provided, it computes reference counts/rates
from the same JSONL dataset and prints a compact comparison.
"""

from __future__ import annotations

import argparse
import json
from urllib.request import urlopen

from ql_ref_counts_by_channel import (
    compute_counts_by_channel,
    compute_rate_heatmap_8x8,
    load_data,
)


def _fetch_json(url: str) -> dict:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _top_channels(counts: dict[str, int], n: int = 8) -> list[tuple[str, int]]:
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:n]


def _ratemap_summary(ratemap: list[list[float]]) -> dict[str, float]:
    flat = [v for row in ratemap for v in row]
    return {
        "min": min(flat) if flat else 0.0,
        "max": max(flat) if flat else 0.0,
        "mean": (sum(flat) / len(flat)) if flat else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Quicklook snapshot with reference")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--input", default=None, help="Optional local JSONL file for reference")
    args = parser.parse_args()

    config = _fetch_json(f"{args.base_url}/config")
    snapshot = _fetch_json(f"{args.base_url}/snapshot")

    print(f"window_s: {config.get('window_s')}")
    print(f"top_channels_by_count: {_top_channels(snapshot.get('counts_by_channel', {}))}")
    print(f"ratemap_summary: {_ratemap_summary(snapshot.get('ratemap_8x8', []))}")
    print(f"quality: {snapshot.get('quality', {})}")

    if args.input:
        events = load_data(args.input)
        ref_counts = compute_counts_by_channel(events, channels=int(config.get("channels", 64)))
        ref_heatmap = compute_rate_heatmap_8x8(ref_counts, float(config.get("window_s", 1)))
        snap_counts = {int(k): int(v) for k, v in snapshot.get("counts_by_channel", {}).items()}
        print("reference_comparison:")
        delta_total = sum(abs(snap_counts.get(ch, 0) - ref_counts.get(ch, 0)) for ch in ref_counts)
        print(f"  total_count_abs_delta: {delta_total}")
        print(f"  reference_ratemap_summary: {_ratemap_summary(ref_heatmap)}")


if __name__ == "__main__":
    main()
